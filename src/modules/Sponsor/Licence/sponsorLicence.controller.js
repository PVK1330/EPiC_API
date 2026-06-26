import { Op } from 'sequelize';
import logger from '../../../utils/logger.js';
import { sendTransactionalEmail } from '../../../services/mail.service.js';
import { generateNotificationEmailTemplate } from '../../../utils/emailTemplates.js';
import { getOrganisationEmailBranding } from '../../../utils/emailBranding.js';
import { notifyAdmins, notifyUser, NotificationTypes, NotificationPriority } from '../../../services/notification.service.js';
import { validateTransition, WORKFLOW_TYPES } from '../../../services/workflowEngine.service.js';
import * as sponsorshipNotify from '../../../services/sponsorshipNotification.service.js';
import { resolveLicenceDocumentPaths } from '../../../utils/licenceDocuments.util.js';
import { recordLicenceAudit } from '../../../services/licenceAssignment.service.js';
import { getPaginationParams, buildPaginationMeta } from '../../../utils/paginate.js';

/**
 * Notification matrix for Licence Documents (Sponsor side)
 * - document_uploaded: Admins (+ sponsor email confirmation)
 * - document_deleted: Admins, assigned Caseworker(s)
 */
const extractCaseworkerIds = (assignedcaseworkerId) => {
    if (!Array.isArray(assignedcaseworkerId)) return [];
    return assignedcaseworkerId
        .map((entry) => {
            if (typeof entry === 'number') return entry;
            if (entry && typeof entry === 'object') {
                return entry.id || entry.userId || entry.caseworkerId || null;
            }
            return null;
        })
        .filter((id) => Number.isInteger(id));
};

export const submitLicenceApplication = async (req, res) => {
    try {
        const userId = req.user.userId;
        // req.body has been stripped to sponsorSubmitLicenceSchema whitelist by validate().
        // Server-side fields are set after the spread so they cannot be overridden.
        const applicationData = {
            ...req.body,
            userId,
            organisationId: req.user.organisation_id ? Number(req.user.organisation_id) : null,
            status: 'Pending',
            documents: req.files ? req.files.map(file => file.path) : []
        };

        // Sanitize date fields
        if (applicationData.proposedStartDate === '' || applicationData.proposedStartDate === 'Invalid date') {
            applicationData.proposedStartDate = null;
        }

        // Sanitize numeric fields: empty strings are invalid for numeric/decimal columns
        if (applicationData.estimatedAnnualCost === '' || applicationData.estimatedAnnualCost === undefined) {
            applicationData.estimatedAnnualCost = null;
        }

        const application = await req.tenantDb.LicenceApplication.create(applicationData);

        res.status(201).json({
            status: 'success',
            message: 'Licence application submitted successfully',
            data: application
        });

        // Event 2 — Licence Submitted: sponsor confirmation (in-app + email),
        // admin in-app, and audit log (centralized).
        try {
            await sponsorshipNotify.licenceSubmitted({ tenantDb: req.tenantDb, application, req });
        } catch (err) {
            logger.error({ err }, 'Failed to emit licence submitted notifications');
        }
    } catch (error) {
        logger.error({ err: error }, 'Error submitting licence application');
        res.status(500).json({
            status: 'error',
            message: 'Failed to submit licence application',
        });
    }
};

export const getMyLicenceApplications = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { page, limit, offset } = getPaginationParams(req.query);

        const { count, rows: applications } = await req.tenantDb.LicenceApplication.findAndCountAll({
            where: { userId },
            order: [['createdAt', 'DESC']],
            limit,
            offset
        });

        // V2-aware: surface the real uploaded evidence. V2 applications keep their
        // documents in licence_appendix_documents (file_path), not the legacy JSON
        // array — merge both so the documents section is never empty for V2 apps.
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
            pagination: buildPaginationMeta(count, page, limit)
        });
    } catch (error) {
        logger.error({ err: error }, 'Error fetching my licence applications');
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch licence applications',
        });
    }
};

export const getLicenceApplicationDetails = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;

        const application = await req.tenantDb.LicenceApplication.findOne({
            where: { id, userId }
        });

        if (!application) {
            return res.status(404).json({
                status: 'error',
                message: 'Licence application not found'
            });
        }

        res.status(200).json({
            status: 'success',
            data: application
        });
    } catch (error) {
        logger.error({ err: error }, 'Error fetching licence application details');
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch licence application details',
        });
    }
};
export const updateLicenceApplication = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;

        const application = await req.tenantDb.LicenceApplication.findOne({
            where: { id, userId }
        });

        if (!application) {
            return res.status(404).json({
                status: 'error',
                message: 'Licence application not found or unauthorized'
            });
        }

        if (application.status !== 'Pending' && application.status !== 'Information Requested') {
            return res.status(400).json({
                status: 'error',
                message: 'Only pending or information requested applications can be updated'
            });
        }

        // req.body has been stripped to sponsorUpdateLicenceSchema whitelist by
        // validate() — status, assignedcaseworkerId, userId, cosAllocation, etc.
        // are not present here.  The date transform in the schema normalises
        // "" / "Invalid date" → null so no manual sanitisation is needed.
        const updateData = { ...req.body };

        // When a sponsor updates their application while in 'Information Requested',
        // re-queue it for caseworker review via the FSM (ISSUE-007).
        // 'Information Requested → Under Review' is valid in the matrix;
        // 'Information Requested → Pending' is NOT — and was the prior bug.
        if (application.status === 'Information Requested') {
            const transitionCheck = validateTransition(
                WORKFLOW_TYPES.LICENCE,
                'Information Requested',
                'Under Review',
            );
            if (transitionCheck.valid) {
                updateData.status = 'Under Review';
            } else {
                logger.error({ applicationId: application.id, message: transitionCheck.message },
                    'sponsorLicence: unexpected FSM rejection for Information Requested → Under Review');
            }
        }

        // Handle new documents via the file upload (separate from field data).
        if (req.files && req.files.length > 0) {
            const newDocs = req.files.map(file => file.path);
            const existingDocs = application.documents || [];
            updateData.documents = [...existingDocs, ...newDocs];
        }

        await application.update(updateData);

        res.status(200).json({
            status: 'success',
            message: 'Licence application updated successfully',
            data: application
        });

        // Notify Admins / Assigned Caseworker
        try {
            await notifyAdmins(req.tenantDb, {
                type: NotificationTypes.INFO,
                priority: NotificationPriority.MEDIUM,
                title: `Licence Application Updated: ${application.companyName}`,
                message: `An update has been submitted for application #LIC-${application.id}.`,
                actionType: 'licence_update',
                entityId: application.id,
                entityType: 'licence_application',
                metadata: {
                    applicationId: application.id,
                    company: application.companyName,
                    updatedAt: new Date().toLocaleString()
                }
            });
        } catch (err) {
            logger.error({ err }, 'Failed to notify admins of update');
        }
    } catch (error) {
        logger.error({ err: error }, 'Error updating licence application');
        res.status(500).json({
            status: 'error',
            message: 'Failed to update licence application',
        });
    }
};

export const deleteMyLicenceApplication = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;

        const application = await req.tenantDb.LicenceApplication.findOne({
            where: { id, userId }
        });

        if (!application) {
            return res.status(404).json({
                status: 'error',
                message: 'Licence application not found or not owned by you'
            });
        }

        // Only allow deleting if not approved/rejected
        if (application.status === 'Approved' || application.status === 'Rejected') {
            return res.status(400).json({
                status: 'error',
                message: 'Cannot delete an approved or rejected application'
            });
        }

        await application.destroy(); // Soft delete

        res.status(200).json({
            status: 'success',
            message: 'Licence application deleted successfully'
        });
    } catch (error) {
        logger.error({ err: error }, 'Error deleting my licence application');
        res.status(500).json({
            status: 'error',
            message: 'Failed to delete licence application',
        });
    }
};
/** Days before expiry at which renewal applications are accepted. */
const RENEWAL_ELIGIBILITY_DAYS = 90;

/** Statuses that block a second renewal submission (one-in-flight rule). */
const RENEWAL_IN_PROGRESS_STATUSES = [
    'Pending', 'Under Review', 'Information Requested',
    'Government Processing', 'Decision Pending',
];

export const renewLicenceApplication = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;
        const { renewalType = 'Standard Renewal', reason = '', notes = '' } = req.body;

        // 1) Verify the source application belongs to this sponsor and is Approved.
        const existingApp = await req.tenantDb.LicenceApplication.findOne({
            where: { id, userId },
        });
        if (!existingApp) {
            return res.status(404).json({ status: 'error', message: 'Licence application not found.' });
        }
        if (existingApp.status !== 'Approved') {
            return res.status(400).json({
                status: 'error',
                message: 'You can only renew an approved licence application.',
            });
        }

        // 2) One-in-flight guard — prevent duplicate pending renewals.
        const inFlight = await req.tenantDb.LicenceApplication.findOne({
            where: { userId, type: 'Renewal', status: { [Op.in]: RENEWAL_IN_PROGRESS_STATUSES } },
            attributes: ['id', 'status'],
            order: [['createdAt', 'DESC']],
        });
        if (inFlight) {
            return res.status(409).json({
                status: 'error',
                message: `A renewal application (#LIC-${inFlight.id}) is already in progress. Please wait for it to be resolved before submitting another.`,
                data: { existingRenewalId: inFlight.id, existingRenewalStatus: inFlight.status },
            });
        }

        // 3) Eligibility window: only allow within RENEWAL_ELIGIBILITY_DAYS of expiry (or already expired).
        const profile = await req.tenantDb.SponsorProfile.findOne({ where: { userId } });
        if (profile?.licenceExpiryDate) {
            const daysRemaining = Math.ceil(
                (new Date(profile.licenceExpiryDate) - new Date()) / 86400000
            );
            if (daysRemaining > RENEWAL_ELIGIBILITY_DAYS) {
                return res.status(400).json({
                    status: 'error',
                    message: `Renewal applications open ${RENEWAL_ELIGIBILITY_DAYS} days before expiry. Your licence expires in ${daysRemaining} days.`,
                    data: { daysRemaining, eligibleFromDays: RENEWAL_ELIGIBILITY_DAYS },
                });
            }
        }

        // 4) Build and persist the renewal application.
        const renewalReason = [
            `${renewalType}`,
            reason ? reason : null,
            notes ? `Notes: ${notes}` : null,
            `Original application: #LIC-${existingApp.id}`,
        ].filter(Boolean).join(' — ');

        const newApplication = await req.tenantDb.LicenceApplication.create({
            userId,
            organisationId: existingApp.organisationId ?? (req.user.organisation_id ? Number(req.user.organisation_id) : null),
            companyName: existingApp.companyName,
            tradingName: existingApp.tradingName,
            registrationNumber: existingApp.registrationNumber,
            industry: existingApp.industry,
            contactName: existingApp.contactName,
            contactEmail: existingApp.contactEmail,
            contactPhone: existingApp.contactPhone,
            licenceType: existingApp.licenceType,
            type: 'Renewal',
            status: 'Pending',
            cosAllocation: existingApp.cosAllocation,
            reason: renewalReason,
            documents: existingApp.documents || [],
        });

        // 5) Audit trail.
        recordLicenceAudit({
            tenantDb: req.tenantDb,
            application: newApplication,
            actorId: userId,
            action: 'renewal_submitted',
            previousStatus: null,
            newStatus: 'Pending',
            notes: `Renewal submitted by sponsor. Type: ${renewalType}. Original: #LIC-${existingApp.id}.`,
            req,
        }).catch((err) => logger.error({ err }, 'Failed to record renewal audit'));

        // Respond before firing notifications (don't block the client).
        res.status(201).json({
            status: 'success',
            message: 'Renewal application submitted successfully',
            data: newApplication,
        });

        // 6) Notify sponsor — in-app confirmation.
        notifyUser(req.tenantDb, userId, {
            type: NotificationTypes.SUCCESS,
            priority: NotificationPriority.HIGH,
            title: 'Renewal Application Submitted',
            message: `Your licence renewal (#LIC-${newApplication.id}) is now pending review. You will be notified when a decision is made.`,
            category: 'licence',
            entityType: 'licence_application',
            entityId: newApplication.id,
            actionType: 'licence_renewal_submitted',
            sendEmail: false,
        }).catch((err) => logger.error({ err }, 'Failed to send sponsor renewal notification'));

        // 7) Notify admins.
        notifyAdmins(req.tenantDb, {
            type: NotificationTypes.INFO,
            priority: NotificationPriority.HIGH,
            title: `Licence Renewal: ${newApplication.companyName}`,
            message: `${newApplication.contactName} submitted a ${renewalType} for ${newApplication.companyName} (#LIC-${newApplication.id}). Original: #LIC-${existingApp.id}.`,
            actionType: 'licence_renewal',
            entityId: newApplication.id,
            entityType: 'licence_application',
        }).catch((err) => logger.error({ err }, 'Failed to notify admins of renewal'));

        // 8) Transactional confirmation email to sponsor.
        const recipientEmail =
            profile?.keyContactEmail ||
            profile?.authorisingEmail ||
            existingApp.contactEmail ||
            null;
        if (recipientEmail) {
            const branding = await getOrganisationEmailBranding(profile?.organisation_id ?? null);
            sendTransactionalEmail({
                organisationId: profile?.organisation_id ?? null,
                to: recipientEmail,
                subject: `Renewal application received — ${newApplication.companyName}`,
                html: generateNotificationEmailTemplate({
                    recipientName: newApplication.companyName || 'Sponsor',
                    title: 'Licence Renewal Submitted',
                    message:
                        `Your sponsor licence renewal application has been received and is pending review.\n\n` +
                        `Reference: #LIC-${newApplication.id}\n` +
                        `Type: ${renewalType}\n` +
                        `Status: Pending Review\n\n` +
                        `You will be notified by email and in-app once a decision has been made.`,
                    priority: NotificationPriority.HIGH,
                    notificationType: NotificationTypes.SUCCESS,
                    actionUrl: `${process.env.FRONTEND_URL || ''}/business/licence-process`,
                    branding,
                }),
            }).catch((err) => logger.error({ err }, 'Failed to send renewal confirmation email'));
        }

    } catch (error) {
        logger.error({ err: error }, 'Error processing licence renewal');
        res.status(500).json({
            status: 'error',
            message: 'Failed to process renewal',
        });
    }
};

export const getLicenceDocuments = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { page, limit, offset } = getPaginationParams(req.query);

        // Find this user's applications (paginated). Documents are flattened
        // per application, so pagination is applied to the underlying
        // application rows and the meta reports the total application count.
        const { count, rows: applications } = await req.tenantDb.LicenceApplication.findAndCountAll({
            where: { userId },
            order: [['createdAt', 'DESC']],
            limit,
            offset
        });

        const allDocuments = [];
        let docIdCounter = 1;

        for (const app of applications) {
            const docPaths = await resolveLicenceDocumentPaths(req.tenantDb, app);

            let appendixDocs = [];
            if (req.tenantDb.LicenceAppendixDocument) {
                appendixDocs = await req.tenantDb.LicenceAppendixDocument.findAll({
                    where: { licenceApplicationId: app.id }
                });
            }

            for (const docPath of docPaths) {
                const filename = docPath.split('\\').pop().split('/').pop();
                
                const normalizedPath = docPath.replace(/\\/g, '/').toLowerCase();
                const matchedAppDoc = appendixDocs.find(ad => 
                    ad.filePath && ad.filePath.replace(/\\/g, '/').toLowerCase() === normalizedPath
                );

                let docStatus = 'Pending';
                if (matchedAppDoc) {
                    if (matchedAppDoc.verificationStatus === 'Verified') {
                        docStatus = 'Verified';
                    } else if (matchedAppDoc.verificationStatus === 'Rejected') {
                        docStatus = 'Rejected';
                    } else {
                        docStatus = 'Pending';
                    }
                } else {
                    docStatus = app.status === 'Approved' ? 'Verified' :
                                app.status === 'Rejected' ? 'Rejected' :
                                app.status === 'Information Requested' ? 'Action Required' : 'Pending';
                }

                // Prefer the human-readable document name from the appendix
                // checklist (e.g. "Certificate of Incorporation") over the raw
                // uploaded file/image name. Fall back to the filename for legacy
                // V1 evidence that has no appendix record.
                const documentName = matchedAppDoc?.documentName?.trim() || filename || 'Unnamed Document';

                allDocuments.push({
                    id: docIdCounter++,
                    name: documentName,
                    fileName: filename || null,
                    path: docPath,
                    uploadDate: app.createdAt,
                    expiryDate: 'N/A',
                    status: docStatus,
                    category: `${app.type} Evidence`,
                    size: 'N/A',
                    applicationId: app.id,
                    applicationType: app.type
                });
            }
        }

        res.status(200).json({
            status: 'success',
            data: allDocuments,
            pagination: buildPaginationMeta(count, page, limit)
        });
    } catch (error) {
        logger.error({ err: error }, 'Error fetching licence documents');
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch licence documents',
        });
    }
};

export const getLicenceSummary = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({
                status: 'error',
                message: 'Authentication required',
                data: null
            });
        }

        const latestApproved = await req.tenantDb.LicenceApplication.findOne({
            where: { userId, status: 'Approved' },
            order: [['createdAt', 'DESC']]
        });

        const sponsorProfile = await req.tenantDb.SponsorProfile.findOne({
            where: { userId }
        });

        const usedCos = await req.tenantDb.Case.count({
            where: {
                sponsorId: userId,
                status: { [Op.notIn]: ['Rejected', 'Cancelled', 'Closed'] }
            }
        });

        const totalAllocation = latestApproved ? (parseInt(latestApproved.cosAllocation, 10) || 0) : (sponsorProfile?.cosAllocation || 0);
        const availableCos = Math.max(totalAllocation - usedCos, 0);
        const expiryDate = sponsorProfile?.licenceExpiryDate || null;
        const renewalDue = expiryDate ? new Date(expiryDate) : null;
        const daysRemaining = expiryDate
            ? Math.ceil((new Date(expiryDate) - new Date()) / 86400000)
            : null;
        const renewalEligible = daysRemaining !== null && daysRemaining <= 90;

        // Check for an in-progress renewal so the frontend can show its status.
        const pendingRenewal = await req.tenantDb.LicenceApplication.findOne({
            where: {
                userId,
                type: 'Renewal',
                status: { [Op.in]: ['Pending', 'Under Review', 'Information Requested', 'Government Processing', 'Decision Pending'] },
            },
            attributes: ['id', 'status', 'createdAt'],
            order: [['createdAt', 'DESC']],
        });

        res.status(200).json({
            status: 'success',
            message: 'Licence summary fetched successfully',
            data: {
                licenceId: latestApproved ? `LIC-2026-${latestApproved.id}` : null,
                licenceNumber: sponsorProfile?.sponsorLicenceNumber || null,
                status: sponsorProfile?.licenceStatus || latestApproved?.status || 'Pending',
                licenceType: latestApproved?.licenceType || null,
                licenceRating: sponsorProfile?.licenceRating || null,
                cosAllocation: {
                    total: totalAllocation,
                    used: usedCos,
                    available: availableCos,
                },
                cos: {
                    total: totalAllocation,
                    used: usedCos,
                    available: availableCos,
                },
                expiryDate,
                renewalDue,
                daysRemaining,
                renewalEligible,
                pendingRenewal: pendingRenewal
                    ? { id: pendingRenewal.id, status: pendingRenewal.status, submittedAt: pendingRenewal.createdAt }
                    : null,
            },
        });
    } catch (error) {
        logger.error({ err: error }, 'Error fetching licence summary');
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch licence summary',
            data: null
        });
    }
};

// BUG-07 fix: statuses that allow sponsor document mutations.
const LICENCE_MUTABLE_STATUSES = ['Draft', 'Pending', 'Information Requested'];

export const uploadLicenceDocument = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { applicationId, documentType, notes } = req.body;

        if (!applicationId) {
            return res.status(400).json({ status: 'error', message: 'applicationId is required' });
        }

        const application = await req.tenantDb.LicenceApplication.findOne({ where: { id: applicationId, userId } });
        if (!application) {
            return res.status(404).json({ status: 'error', message: 'Licence application not found' });
        }

        // BUG-07 fix: block uploads on terminal/approved applications.
        if (!LICENCE_MUTABLE_STATUSES.includes(application.status)) {
            return res.status(400).json({
                status: 'error',
                message: `Documents cannot be uploaded to an application with status: ${application.status}`,
            });
        }

        const newPaths = (req.files || []).map(f => f.path.replace(/\\/g, '/'));
        const existing = Array.isArray(application.documents) ? application.documents : [];
        const updatedDocs = [...existing, ...newPaths];

        await application.update({ documents: updatedDocs });

        res.json({ 
            status: 'success', 
            message: `${newPaths.length} document(s) uploaded`, 
            data: updatedDocs 
        });

        // After response:
        try {
            const user = await req.tenantDb.User.findByPk(userId);
            await notifyAdmins(req.tenantDb, {
                type: NotificationTypes.INFO,
                priority: NotificationPriority.MEDIUM,
                title: 'Licence Document Uploaded',
                message: `${application.companyName} has uploaded ${newPaths.length} new document(s) for application #LIC-${applicationId}`,
                actionType: 'document_uploaded',
                entityId: applicationId,
                entityType: 'licence_application'
            });

            if (user?.email) {
                const branding = await getOrganisationEmailBranding(req.user?.organisation_id ?? null);
                await sendTransactionalEmail({
                    organisationId: req.user?.organisation_id ?? null,
                    to: user.email,
                    subject: 'Document Upload Confirmation',
                    html: generateNotificationEmailTemplate({
                        recipientName: user.first_name,
                        title: 'Documents Received',
                        message: `Your ${newPaths.length} document(s) for application #LIC-${applicationId} have been uploaded successfully.`,
                        actionUrl: `${process.env.FRONTEND_URL || '#'}/business/licence/documents`,
                        actionText: 'View Documents',
                        branding
                    })
                });
            }
        } catch (e) {
            logger.error({ err: e }, 'Post-upload actions failed');
        }
    } catch (error) {
        logger.error({ err: error }, 'Error uploading licence document');
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

export const deleteLicenceDocument = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { applicationId, docIndex } = req.params;

        const application = await req.tenantDb.LicenceApplication.findOne({ where: { id: applicationId, userId } });
        if (!application) {
            return res.status(404).json({ status: 'error', message: 'Licence application not found' });
        }

        // BUG-04 fix: mirror the same status gate as uploadLicenceDocument.
        // Prevents post-approval document tampering on Approved/Granted/Government
        // Processing applications.
        if (!LICENCE_MUTABLE_STATUSES.includes(application.status)) {
            return res.status(400).json({
                status: 'error',
                message: `Documents cannot be deleted from an application with status: ${application.status}`,
            });
        }

        const docs = [...(application.documents || [])];
        const index = parseInt(docIndex);
        
        if (isNaN(index) || index < 0 || index >= docs.length) {
            return res.status(400).json({ status: 'error', message: 'Invalid document index' });
        }

        const removedPath = docs[index];
        docs.splice(index, 1);
        await application.update({ documents: docs });

        res.json({ status: 'success', message: 'Document removed', data: docs });

        try {
            await notifyAdmins(req.tenantDb, {
                type: NotificationTypes.INFO,
                priority: NotificationPriority.MEDIUM,
                title: 'Licence Document Deleted',
                message: `${application.companyName} removed a document from application #LIC-${applicationId}.`,
                actionType: 'document_deleted',
                entityId: Number(applicationId),
                entityType: 'licence_application',
                metadata: { removedPath }
            });

            const caseworkerIds = extractCaseworkerIds(application.assignedcaseworkerId);
            for (const caseworkerId of caseworkerIds) {
                await notifyUser(req.tenantDb, caseworkerId, {
                    type: NotificationTypes.INFO,
                    priority: NotificationPriority.MEDIUM,
                    title: `Document Removed: LIC-${applicationId}`,
                    message: `${application.companyName} removed a document from application #LIC-${applicationId}.`,
                    actionType: 'document_deleted',
                    entityId: Number(applicationId),
                    entityType: 'licence_application',
                    metadata: { removedPath },
                    sendEmail: true
                });
            }
        } catch (notifyErr) {
            logger.error({ err: notifyErr }, 'Failed to send document delete notifications');
        }
    } catch (error) {
        logger.error({ err: error }, 'Error deleting licence document');
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};
