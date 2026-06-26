import { Op } from 'sequelize';
import logger from '../../utils/logger.js';
import {
    notifyAdmins,
    NotificationTypes,
    NotificationPriority
} from '../../services/notification.service.js';
import { recordLicenceAudit, statusToAuditAction, getLicenceAuditTrail, isCaseworkerAssigned } from '../../services/licenceAssignment.service.js';
import { hasFullAccessRole } from '../../middlewares/role.middleware.js';
import * as sponsorshipNotify from '../../services/sponsorshipNotification.service.js';
import { loadFullApplication as loadFullApplicationV2, serializeApplication as serializeApplicationV2 } from '../../services/licenceApplicationV2.service.js';
import { ensureStageTasks } from '../../services/licenceStageTask.service.js';
import { resolveLicenceDocumentPaths } from '../../utils/licenceDocuments.util.js';
import { validateTransition, WORKFLOW_TYPES } from '../../services/workflowEngine.service.js';
import { getPaginationParams, buildPaginationMeta } from '../../utils/paginate.js';

export const getAssignedLicenceApplications = async (req, res) => {
    try {
        const caseworkerId = req.user.userId;

        // Server-side pagination (?page & ?limit). Defaults/clamping are handled
        // by the shared helper so the contract matches other paginated endpoints.
        const { page, limit, offset } = getPaginationParams(req.query);

        // Find applications where caseworkerId array contains this caseworkerId.
        // findAndCountAll gives us the total for the pagination meta.
        const { rows: applications, count } = await req.tenantDb.LicenceApplication.findAndCountAll({
            where: {
                assignedcaseworkerId: {
                    [Op.contains]: [caseworkerId]
                }
            },
            // Include government tracking so the UI can show saved values (e.g. the
            // SMS registration reference) instead of always offering "Save" again.
            // Encrypted credential fields are intentionally excluded.
            include: [{
                model: req.tenantDb.LicenceGovernmentTracking,
                as: "governmentTracking",
                required: false,
                attributes: [
                    "id", "ukviPortalUserId", "smsPortalUsername", "smsRegistrationRef",
                    "credentialsGeneratedAt", "credentialsSentAt",
                    "governmentRegistrationRef", "governmentSubmissionRef", "governmentSubmissionDate",
                ],
            }],
            order: [['createdAt', 'DESC']],
            limit,
            offset,
            // A hasMany include can multiply rows; distinct keeps the count = number
            // of distinct LicenceApplication rows so totalPages is correct.
            distinct: true
        });

        // findAndCountAll returns count as a number for a single-model count, but
        // can return an array of group rows when grouping is used. Normalise to a
        // plain integer for the pagination meta.
        const total = Array.isArray(count) ? count.length : count;

        // V2-aware: merge V2 appendix evidence (file_path) into each app's
        // documents array so the caseworker sees uploaded V2 documents, not just V1.
        const data = await Promise.all(
            applications.map(async (app) => {
                const plain = app.toJSON();
                plain.documents = await resolveLicenceDocumentPaths(req.tenantDb, app);
                return plain;
            })
        );

        res.status(200).json({
            status: 'success',
            data,
            pagination: buildPaginationMeta(total, page, limit)
        });
    } catch (error) {
        logger.error({ err: error }, 'Error fetching assigned licence applications');
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch assigned licence applications',
            error: error.message
        });
    }
};

export const updateLicenceReviewStatus = async (req, res) => {
    try {
        const caseworkerId = req.user.userId;
        const { id } = req.params;
        const { status, adminNotes } = req.body;

        // Authorisation (assigned caseworker OR admin override) is enforced by the
        // ensureAssignedCaseworker middleware, which also loads the application.
        const application =
            req.licenceApplication ||
            (await req.tenantDb.LicenceApplication.findByPk(id));

        if (!application) {
            return res.status(404).json({
                status: 'error',
                message: 'Licence application not found'
            });
        }

        const previousStatus = application.status;

        const transitionCheck = validateTransition(WORKFLOW_TYPES.LICENCE, previousStatus, status, { roleId: req.user.role_id });
        if (!transitionCheck.valid) {
            return res.status(400).json({ status: 'error', message: transitionCheck.message });
        }

        application.status = status;
        if (adminNotes) {
            application.adminNotes = adminNotes;
        }
        await application.save();

        // Licence activation (ISSUE-013): activation is owned exclusively by
        // grantLicence() (Decision Pending → Licence Granted). Caseworkers
        // advance the application through review stages; only an admin/superadmin
        // may grant (via the dedicated grant endpoint). The legacy
        // Approved branch that called activateSponsorLicence() directly
        // has been removed to prevent double-activation.

        // Notify Sponsor (centralized: Information Requested / Rejected / status change).
        try {
            await sponsorshipNotify.licenceStatusChanged({
                tenantDb: req.tenantDb,
                application,
                status,
                previousStatus,
                adminNotes,
                req,
            });

            // Notify Admins about caseworker decision
            await notifyAdmins(req.tenantDb, {
                type: NotificationTypes.INFO,
                priority: NotificationPriority.MEDIUM,
                title: `Licence Decision by Caseworker: #LIC-${application.id}`,
                message: `Caseworker ${req.user.firstName || 'assigned'} has updated application #LIC-${application.id} to ${status}.`,
                actionType: 'caseworker_decision',
                entityId: application.id,
                entityType: 'licence_application',
                metadata: {
                    applicationId: application.id,
                    company: application.companyName,
                    newStatus: status,
                    caseworkerId: caseworkerId
                }
            });
        } catch (notifyErr) {
            logger.error({ err: notifyErr }, 'Failed to send caseworker decision notifications');
        }

        // Audit the reviewer action (approve / reject / request_info / ...).
        await recordLicenceAudit({
            tenantDb: req.tenantDb,
            application,
            actorId: caseworkerId,
            action: statusToAuditAction(status),
            previousStatus,
            newStatus: status,
            notes: adminNotes || null,
            req,
        });

        // Re-sync the stage tasks after the caseworker's decision.
        try {
            await ensureStageTasks(req.tenantDb, application, { req });
        } catch (err) {
            logger.error({ err }, 'ensureStageTasks failed on caseworker review');
        }

        res.status(200).json({
            status: 'success',
            message: `Licence application status updated to ${status}`,
            data: application
        });
    } catch (error) {
        logger.error({ err: error }, 'Error updating licence review status');
        res.status(500).json({
            status: 'error',
            message: 'Failed to update status',
            error: error.message
        });
    }
};

/**
 * "My Assigned Applications" dashboard for the logged-in caseworker:
 * the list of licence applications assigned to them, plus status counts.
 */
export const getMyAssignedDashboard = async (req, res) => {
    try {
        const caseworkerId = req.user.userId;

        const applications = await req.tenantDb.LicenceApplication.findAll({
            where: { assignedcaseworkerId: { [Op.contains]: [caseworkerId] } },
            include: [{
                model: req.tenantDb.User,
                as: 'user',
                attributes: ['id', 'first_name', 'last_name', 'email'],
                required: false
            }],
            order: [['updatedAt', 'DESC']]
        });

        const stats = applications.reduce((acc, a) => {
            acc.total += 1;
            const key = String(a.status || 'unknown').toLowerCase().replace(/\s+/g, '_');
            acc.byStatus[key] = (acc.byStatus[key] || 0) + 1;
            return acc;
        }, { total: 0, byStatus: {} });

        res.status(200).json({
            status: 'success',
            data: { stats, applications }
        });
    } catch (error) {
        logger.error({ err: error }, 'Error fetching assigned applications dashboard');
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch assigned applications',
            error: error.message
        });
    }
};

/**
 * GET /api/caseworker/licence/v2/:id — full normalized V2 application (read-only).
 * Primary authorization is enforced by the ensureAssignedCaseworker middleware
 * on the route. BUG-09 fix: the handler also validates the application ID
 * against the middleware-loaded req.licenceApplication so it cannot be bypassed
 * if this handler is ever mounted without the middleware, or if the middleware
 * is reconfigured with a different idParam.
 */
export const getLicenceApplicationV2Full = async (req, res) => {
    try {
        const requestedId = Number(req.params.id);

        // Defence-in-depth: if the middleware loaded the application, verify the
        // IDs match before trusting it. If middleware was skipped (misconfiguration),
        // req.licenceApplication is undefined and we fall through to the DB load
        // which exposes no cross-tenant data since it is scoped to req.tenantDb.
        if (req.licenceApplication && Number(req.licenceApplication.id) !== requestedId) {
            return res.status(403).json({ status: 'error', message: 'Application ID mismatch' });
        }

        const app = await loadFullApplicationV2(req.tenantDb, req.params.id, {});
        if (!app) {
            return res.status(404).json({ status: 'error', message: 'Licence application not found' });
        }

        // D-2 fix: use statically imported helpers instead of dynamic import().
        // If middleware was NOT present, enforce assignment here as a fallback.
        if (!req.licenceApplication) {
            if (!hasFullAccessRole(req.user.role_id) && !isCaseworkerAssigned(app, req.user.userId)) {
                return res.status(403).json({ status: 'error', message: 'You are not assigned to this application' });
            }
        }

        return res.status(200).json({ status: 'success', data: serializeApplicationV2(app) });
    } catch (error) {
        logger.error({ err: error }, 'getLicenceApplicationV2Full failed');
        return res.status(500).json({ status: 'error', message: 'Failed to fetch application' });
    }
};

/**
 * Audit trail (assignment history + reviewer actions) for one application.
 * Authorisation (assigned caseworker or admin) is enforced by middleware.
 */
export const getLicenceApplicationAudit = async (req, res) => {
    try {
        const { id } = req.params;
        const trail = await getLicenceAuditTrail(req.tenantDb, id);
        res.status(200).json({ status: 'success', data: trail });
    } catch (error) {
        logger.error({ err: error }, 'Error fetching licence application audit trail');
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch audit trail',
            error: error.message
        });
    }
};
