import { Op } from 'sequelize';
import logger from '../../../utils/logger.js';
import { sendTransactionalEmail } from '../../../services/mail.service.js';
import { generateNotificationEmailTemplate } from '../../../utils/emailTemplates.js';
import { notifyAdmins, notifyUser, NotificationTypes, NotificationPriority } from '../../../services/notification.service.js';
import { validateTransition, WORKFLOW_TYPES } from '../../../services/workflowEngine.service.js';
import * as sponsorshipNotify from '../../../services/sponsorshipNotification.service.js';

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
        const applicationData = {
            ...req.body,
            userId,
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
            error: error.message
        });
    }
};

export const getMyLicenceApplications = async (req, res) => {
    try {
        const userId = req.user.userId;
        const applications = await req.tenantDb.LicenceApplication.findAll({
            where: { userId },
            order: [['createdAt', 'DESC']]
        });

        res.status(200).json({
            status: 'success',
            data: applications
        });
    } catch (error) {
        logger.error({ err: error }, 'Error fetching my licence applications');
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch licence applications',
            error: error.message
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
            error: error.message
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

        const updateData = { ...req.body };

        // If updating from Information Requested, move back to Pending for re-review
        if (application.status === 'Information Requested') {
            updateData.status = 'Pending';
        }
        
        // Handle new documents
        if (req.files && req.files.length > 0) {
            const newDocs = req.files.map(file => file.path);
            const existingDocs = application.documents || [];
            updateData.documents = [...existingDocs, ...newDocs];
        }

        // Sanitize date fields
        if (updateData.proposedStartDate === '' || updateData.proposedStartDate === 'Invalid date') {
            updateData.proposedStartDate = null;
        }

        if (updateData.status && updateData.status !== application.status) {
            const validation = validateTransition(WORKFLOW_TYPES.LICENCE, application.status, updateData.status);
            if (!validation.valid) {
                return res.status(400).json({
                    status: 'error',
                    message: `Invalid state transition: ${validation.message}`
                });
            }
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
            error: error.message
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
            error: error.message
        });
    }
};
export const renewLicenceApplication = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;

        // Find the existing application
        const existingApp = await req.tenantDb.LicenceApplication.findOne({
            where: { id, userId }
        });

        if (!existingApp) {
            return res.status(404).json({
                status: 'error',
                message: 'Existing licence application not found'
            });
        }

        // Create a new application copying the company details
        const renewalData = {
            userId,
            companyName: existingApp.companyName,
            tradingName: existingApp.tradingName,
            registrationNumber: existingApp.registrationNumber,
            industry: existingApp.industry,
            contactName: existingApp.contactName,
            contactEmail: existingApp.contactEmail,
            contactPhone: existingApp.contactPhone,
            licenceType: existingApp.licenceType,
            type: 'Renewal', // Set type to Renewal
            status: 'Pending',
            cosAllocation: existingApp.cosAllocation,
            reason: `Quick Renewal based on application #LIC-${existingApp.id}`,
            documents: existingApp.documents || [] // Copy existing documents
        };

        const newApplication = await req.tenantDb.LicenceApplication.create(renewalData);

        res.status(201).json({
            status: 'success',
            message: 'Renewal application submitted successfully',
            data: newApplication
        });

        // Notify Admins
        try {
            await notifyAdmins(req.tenantDb, {
                type: NotificationTypes.INFO,
                priority: NotificationPriority.HIGH,
                title: `Licence Renewal Request: ${newApplication.companyName}`,
                message: `${newApplication.contactName} has submitted a quick renewal for application #LIC-${existingApp.id}.`,
                actionType: 'licence_renewal',
                entityId: newApplication.id,
                entityType: 'licence_application',
                metadata: {
                    originalAppId: existingApp.id,
                    newAppId: newApplication.id,
                    company: newApplication.companyName,
                    type: 'Renewal'
                }
            });
        } catch (err) {
            logger.error({ err }, 'Failed to notify admins of renewal');
        }
    } catch (error) {
        logger.error({ err: error }, 'Error in quick renewal');
        res.status(500).json({
            status: 'error',
            message: 'Failed to process renewal',
            error: error.message
        });
    }
};

export const getLicenceDocuments = async (req, res) => {
    try {
        const userId = req.user.userId;

        // Find all applications for this user
        const applications = await req.tenantDb.LicenceApplication.findAll({
            where: { userId },
            order: [['createdAt', 'DESC']]
        });

        const allDocuments = [];
        let docIdCounter = 1;

        applications.forEach(app => {
            if (app.documents && Array.isArray(app.documents)) {
                app.documents.forEach(docPath => {
                    // Extract filename from path
                    const filename = docPath.split('\\').pop().split('/').pop();
                    
                    const status = app.status === 'Approved' ? 'Verified' : 
                                  app.status === 'Rejected' ? 'Rejected' : 
                                  app.status === 'Information Requested' ? 'Action Required' : 'Pending';
                    
                    allDocuments.push({
                        id: docIdCounter++,
                        name: filename || "Unnamed Document",
                        path: docPath,
                        uploadDate: app.createdAt,
                        expiryDate: "N/A",
                        status: status,
                        category: `${app.type} Evidence`,
                        size: "N/A",
                        applicationId: app.id,
                        applicationType: app.type
                    });
                });
            }
        });

        res.status(200).json({
            status: 'success',
            data: allDocuments
        });
    } catch (error) {
        logger.error({ err: error }, 'Error fetching licence documents');
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch licence documents',
            error: error.message
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
                    available: availableCos
                },
                cos: {
                    total: totalAllocation,
                    used: usedCos,
                    available: availableCos
                },
                expiryDate,
                renewalDue,
                daysRemaining: expiryDate
                    ? Math.ceil((new Date(expiryDate) - new Date()) / 86400000)
                    : null
            }
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
                await sendTransactionalEmail({
                    organisationId: req.user?.organisation_id ?? null,
                    to: user.email,
                    subject: 'Document Upload Confirmation',
                    html: generateNotificationEmailTemplate({
                        recipientName: user.first_name,
                        title: 'Documents Received',
                        message: `Your ${newPaths.length} document(s) for application #LIC-${applicationId} have been uploaded successfully.`,
                        actionUrl: `${process.env.FRONTEND_URL || '#'}/business/licence/documents`,
                        actionText: 'View Documents'
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
