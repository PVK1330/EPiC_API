import { Op } from 'sequelize';
import logger from '../../utils/logger.js';
import {
    notifyAdmins,
    NotificationTypes,
    NotificationPriority
} from '../../services/notification.service.js';
import { activateSponsorLicence, isCosRequestApplication } from '../../services/licenceActivation.service.js';
import { recordLicenceAudit, statusToAuditAction, getLicenceAuditTrail } from '../../services/licenceAssignment.service.js';
import * as sponsorshipNotify from '../../services/sponsorshipNotification.service.js';
import { loadFullApplication as loadFullApplicationV2, serializeApplication as serializeApplicationV2 } from '../../services/licenceApplicationV2.service.js';
import { ensureStageTasks } from '../../services/licenceStageTask.service.js';
import { resolveLicenceDocumentPaths } from '../../utils/licenceDocuments.util.js';
import { validateTransition, WORKFLOW_TYPES } from '../../services/workflowEngine.service.js';

export const getAssignedLicenceApplications = async (req, res) => {
    try {
        const caseworkerId = req.user.userId;
        
        // Find applications where caseworkerId array contains this caseworkerId
        const applications = await req.tenantDb.LicenceApplication.findAll({
            where: {
                assignedcaseworkerId: {
                    [Op.contains]: [caseworkerId]
                }
            },
            order: [['createdAt', 'DESC']]
        });

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
            data
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

        // On approval, activate the sponsor licence (Phase 4 — Licence
        // Activation). CoS top-ups are owned by the dedicated CoS request
        // workflow (cosRequest.service); the isCosRequestApplication guard keeps
        // any pre-migration "CoS Request:" licence row from activating a licence.
        if (status === 'Approved' && !isCosRequestApplication(application)) {
            try {
                await activateSponsorLicence({
                    tenantDb: req.tenantDb,
                    application,
                    approvedByUserId: caseworkerId,
                    req,
                });
            } catch (err) {
                logger.error({ err }, 'Failed to activate sponsor licence');
            }
        }

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
 * Assignment is enforced by the ensureAssignedCaseworker middleware on the route.
 */
export const getLicenceApplicationV2Full = async (req, res) => {
    try {
        const app = await loadFullApplicationV2(req.tenantDb, req.params.id, {});
        if (!app) {
            return res.status(404).json({ status: 'error', message: 'Licence application not found' });
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
