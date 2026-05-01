import db from "../../models/index.js";
const LicenceApplication = db.LicenceApplication;
const SponsorProfile = db.SponsorProfile;
const Case = db.Case;
const User = db.User;
import transporter from "../../config/mail.js";
import { generateNotificationEmailTemplate } from "../../utils/emailTemplate.js";
import { notifyAdmins, notifyUser, NotificationTypes, NotificationPriority } from "../../services/notification.service.js";
const { Op } = db.Sequelize;

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

        const application = await LicenceApplication.create(applicationData);

        res.status(201).json({
            status: 'success',
            message: 'Licence application submitted successfully',
            data: application
        });

        // Notify Admins
        try {
            await notifyAdmins({
                type: NotificationTypes.INFO,
                priority: NotificationPriority.HIGH,
                title: `New Licence Application: ${application.companyName}`,
                message: `${application.contactName} from ${application.companyName} has submitted a new ${application.type} licence application.`,
                actionType: 'new_licence_application',
                entityId: application.id,
                entityType: 'licence_application',
                metadata: {
                    company: application.companyName,
                    type: application.type,
                    submittedAt: new Date().toLocaleString()
                }
            });
        } catch (err) {
            console.error('Failed to notify admins of new application:', err);
        }
    } catch (error) {
        console.error('Error submitting licence application:', error);
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
        const applications = await LicenceApplication.findAll({
            where: { userId },
            order: [['createdAt', 'DESC']]
        });

        res.status(200).json({
            status: 'success',
            data: applications
        });
    } catch (error) {
        console.error('Error fetching my licence applications:', error);
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

        const application = await LicenceApplication.findOne({
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
        console.error('Error fetching licence application details:', error);
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

        const application = await LicenceApplication.findOne({
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

        await application.update(updateData);

        res.status(200).json({
            status: 'success',
            message: 'Licence application updated successfully',
            data: application
        });

        // Notify Admins / Assigned Caseworker
        try {
            await notifyAdmins({
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
            console.error('Failed to notify admins of update:', err);
        }
    } catch (error) {
        console.error('Error updating licence application:', error);
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

        const application = await LicenceApplication.findOne({
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
        console.error('Error deleting my licence application:', error);
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
        const existingApp = await LicenceApplication.findOne({
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

        const newApplication = await LicenceApplication.create(renewalData);

        res.status(201).json({
            status: 'success',
            message: 'Renewal application submitted successfully',
            data: newApplication
        });

        // Notify Admins
        try {
            await notifyAdmins({
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
            console.error('Failed to notify admins of renewal:', err);
        }
    } catch (error) {
        console.error('Error in quick renewal:', error);
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
        const applications = await LicenceApplication.findAll({
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
        console.error('Error fetching licence documents:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch licence documents',
            error: error.message
        });
    }
};

export const getLicenceSummary = async (req, res) => {
    try {
        const userId = req.user.userId;

        const latestApproved = await LicenceApplication.findOne({
            where: { userId, status: 'Approved' },
            order: [['createdAt', 'DESC']]
        });

        const sponsorProfile = await SponsorProfile.findOne({
            where: { userId }
        });

        const usedCos = await Case.count({
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
        console.error('Error fetching licence summary:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch licence summary',
            data: null
        });
    }
};

export const requestMoreCos = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { requestedAmount, visaType, reason } = req.body;

        if (!requestedAmount || !visaType || !reason) {
            return res.status(400).json({
                status: 'error',
                message: 'requestedAmount, visaType and reason are required',
                data: null
            });
        }

        const user = await User.findByPk(userId, {
            attributes: ['id', 'first_name', 'last_name', 'email'],
            include: [{ model: SponsorProfile, as: 'sponsorProfile' }]
        });

        const sponsorProfile = user?.sponsorProfile;
        const companyName = sponsorProfile?.companyName || `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Sponsor';
        const contactName = `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Sponsor User';
        const contactEmail = user?.email || req.user.email || process.env.ADMIN_EMAIL;

        const newApplication = await LicenceApplication.create({
            userId,
            type: 'Renewal',
            status: 'Pending',
            reason: `CoS Request: ${reason}`,
            cosAllocation: String(requestedAmount),
            companyName: companyName || 'N/A',
            registrationNumber: sponsorProfile?.registrationNumber || `REQ-${Date.now()}`,
            industry: sponsorProfile?.industrySector || 'N/A',
            licenceType: visaType,
            contactName,
            contactEmail,
            contactPhone: sponsorProfile?.authorisingPhone || 'N/A'
        });

        res.status(201).json({
            status: 'success',
            message: 'CoS allocation request submitted',
            data: newApplication
        });

        try {
            await notifyAdmins({
                type: NotificationTypes.INFO,
                priority: NotificationPriority.HIGH,
                title: 'CoS Allocation Request',
                message: `${companyName} requested ${requestedAmount} CoS for ${visaType}.`,
                actionType: 'cos_request',
                entityId: newApplication.id,
                entityType: 'licence_application',
                metadata: { requestedAmount, visaType, reason, companyName }
            });
        } catch (err) {
            console.error('Failed to notify admins for CoS request:', err);
        }

        try {
            if (process.env.ADMIN_EMAIL) {
                await transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: process.env.ADMIN_EMAIL,
                    subject: 'CoS Allocation Request Submitted',
                    html: generateNotificationEmailTemplate({
                        recipientName: 'Admin',
                        title: 'CoS Allocation Request',
                        message: `${companyName} has requested ${requestedAmount} CoS for ${visaType}.`,
                        priority: NotificationPriority.HIGH,
                        notificationType: NotificationTypes.INFO,
                        metadata: { applicationId: newApplication.id, reason }
                    })
                });
            }
        } catch (e) {
            console.error('Email failed:', e);
        }
    } catch (error) {
        console.error('Error requesting more CoS:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to submit CoS allocation request',
            data: null
        });
    }
};


export const getCosSummary = async (req, res) => {
    try {
        const userId = req.user.userId;

        const sponsorProfile = await SponsorProfile.findOne({ where: { userId } });
        const approvedApps = await LicenceApplication.findAll({
            where: { userId, status: 'Approved' },
            order: [['createdAt', 'DESC']]
        });

        const cosRequestApps = await LicenceApplication.findAll({
            where: {
                userId,
                reason: { [Op.iLike]: 'CoS Request:%' }
            },
            order: [['createdAt', 'DESC']]
        });

        // Compute total allocated across approved apps (actual allocation)
        const totalAllocated = approvedApps.reduce((acc, app) => acc + (parseInt(app.cosAllocation, 10) || 0), 0);

        // Count total used CoS (active cases)
        const cosUsed = await Case.count({
            where: {
                sponsorId: userId,
                status: { [Op.notIn]: ['Rejected', 'Cancelled', 'Closed'] }
            }
        });

        const activeCases = await Case.findAll({
            where: {
                sponsorId: userId,
                status: { [Op.notIn]: ['Rejected', 'Cancelled', 'Closed'] }
            },
            include: [{
                model: db.VisaType,
                as: 'visaType',
                attributes: ['name']
            }],
            attributes: ['id']
        });

        const sourceApps = approvedApps.length ? approvedApps : cosRequestApps;
        const allocationSummary = {};
        sourceApps.forEach(app => {
            const vType = app.licenceType || 'General';
            if (!allocationSummary[vType]) {
                allocationSummary[vType] = {
                    visaType: vType,
                    allocated: 0,
                    used: 0,
                    remaining: 0,
                    expiryDate: sponsorProfile?.licenceExpiryDate || null,
                    allocationDate: app.createdAt,
                    lastUsed: null
                };
            }
            allocationSummary[vType].allocated += (parseInt(app.cosAllocation, 10) || 0);
            if (app.createdAt > allocationSummary[vType].allocationDate) {
                allocationSummary[vType].allocationDate = app.createdAt;
            }
        });

        for (const activeCase of activeCases) {
            const vName = activeCase?.visaType?.name || 'General';
            if (!allocationSummary[vName]) {
                allocationSummary[vName] = {
                    visaType: vName,
                    allocated: 0,
                    used: 0,
                    remaining: 0,
                    expiryDate: sponsorProfile?.licenceExpiryDate || null,
                    allocationDate: null,
                    lastUsed: null
                };
            }
            allocationSummary[vName].used += 1;
        }

        const finalByVisaType = Object.values(allocationSummary).map((item) => {
            item.remaining = Math.max(item.allocated - item.used, 0);
            const latestForType = activeCases
                .filter((c) => (c?.visaType?.name || 'General') === item.visaType)
                .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
            item.lastUsed = latestForType ? new Date(latestForType.updatedAt).toLocaleDateString() : 'N/A';
            item.expiryDate = item.expiryDate ? new Date(item.expiryDate).toLocaleDateString() : 'N/A';
            return item;
        });

        res.status(200).json({
            status: 'success',
            message: 'CoS summary fetched successfully',
            data: {
                summary: {
                    total: totalAllocated,
                    used: cosUsed,
                    remaining: Math.max(totalAllocated - cosUsed, 0)
                },
                byVisaType: finalByVisaType
            }
        });
    } catch (error) {
        console.error('Error fetching CoS summary:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch CoS summary',
            data: null
        });
    }
};

export const requestCosAllocation = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { visaType, requestedAmount, reason } = req.body;

        if (!visaType || !requestedAmount || !reason) {
            return res.status(400).json({
                status: 'error',
                message: 'visaType, requestedAmount and reason are required',
                data: null
            });
        }

        const user = await User.findByPk(userId, {
            include: [{ model: SponsorProfile, as: 'sponsorProfile' }]
        });
        const sponsorProfile = user?.sponsorProfile;
        const companyName = sponsorProfile?.companyName || `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Sponsor';
        const contactName = `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Sponsor User';
        const contactEmail = user?.email || req.user.email || process.env.ADMIN_EMAIL;

        await LicenceApplication.create({
            userId,
            type: 'Renewal',
            status: 'Pending',
            cosAllocation: String(requestedAmount),
            reason: `CoS Request: ${reason}`,
            licenceType: visaType,
            companyName: companyName || 'N/A',
            registrationNumber: sponsorProfile?.registrationNumber || `COS-${Date.now()}`,
            industry: sponsorProfile?.industrySector || 'N/A',
            contactName,
            contactEmail,
            contactPhone: sponsorProfile?.authorisingPhone || 'N/A'
        });

        res.status(201).json({
            status: 'success',
            message: 'CoS request submitted',
            data: null
        });

        try {
            await notifyAdmins({
                type: NotificationTypes.INFO,
                priority: NotificationPriority.HIGH,
                title: 'CoS Allocation Request',
                message: `${companyName} has requested ${requestedAmount} CoS for ${visaType}.`,
                actionType: 'cos_request',
                entityType: 'licence_application',
                metadata: { visaType, requestedAmount, reason, companyName }
            });
        } catch (err) {
            console.error('Failed to notify admins for CoS allocation:', err);
        }

        try {
            if (process.env.ADMIN_EMAIL) {
                await transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: process.env.ADMIN_EMAIL,
                    subject: 'New CoS Allocation Request',
                    html: generateNotificationEmailTemplate({
                        recipientName: 'Admin',
                        title: 'CoS Allocation Request',
                        message: `${companyName} has requested ${requestedAmount} CoS for ${visaType}.`,
                        priority: NotificationPriority.HIGH,
                        notificationType: NotificationTypes.INFO
                    })
                });
            }

            if (contactEmail) {
                await transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: contactEmail,
                    subject: 'Your CoS Request Has Been Submitted',
                    html: generateNotificationEmailTemplate({
                        recipientName: contactName,
                        title: 'CoS Request Submitted',
                        message: `Your request for ${requestedAmount} CoS under ${visaType} has been submitted successfully.`,
                        priority: NotificationPriority.MEDIUM,
                        notificationType: NotificationTypes.SUCCESS
                    })
                });
            }
        } catch (e) {
            console.error('Email failed:', e);
        }
    } catch (error) {
        console.error('Error requesting CoS allocation:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to submit CoS request',
            data: null
        });
    }
};

export const getCosRequests = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { status } = req.query;

        const whereClause = {
            userId,
            reason: { [Op.iLike]: 'CoS Request:%' }
        };

        if (status) {
            whereClause.status = status;
        }

        const requests = await LicenceApplication.findAll({
            where: whereClause,
            attributes: [
                'id',
                'status',
                'licenceType',
                'cosAllocation',
                'reason',
                'assignedcaseworkerId',
                'adminNotes',
                'createdAt',
                'updatedAt'
            ],
            order: [['createdAt', 'DESC']]
        });

        res.status(200).json({
            status: 'success',
            message: 'CoS requests fetched successfully',
            data: requests
        });
    } catch (error) {
        console.error('Error fetching CoS requests:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch CoS requests',
            data: null
        });
    }
};

export const updateCosRequest = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;
        const { visaType, requestedAmount, reason } = req.body;

        const request = await LicenceApplication.findOne({
            where: {
                id,
                userId,
                reason: { [Op.iLike]: 'CoS Request:%' }
            }
        });

        if (!request) {
            return res.status(404).json({
                status: 'error',
                message: 'CoS request not found',
                data: null
            });
        }

        if (!['Pending', 'Under Review'].includes(request.status)) {
            return res.status(400).json({
                status: 'error',
                message: 'Only pending or under-review CoS requests can be edited',
                data: null
            });
        }

        const updatePayload = {};
        if (visaType) updatePayload.licenceType = visaType;
        if (requestedAmount !== undefined) updatePayload.cosAllocation = String(requestedAmount);
        if (reason) updatePayload.reason = `CoS Request: ${reason}`;

        await request.update(updatePayload);

        res.status(200).json({
            status: 'success',
            message: 'CoS request updated successfully',
            data: request
        });

        try {
            await notifyAdmins({
                type: NotificationTypes.INFO,
                priority: NotificationPriority.MEDIUM,
                title: `CoS Request Updated #LIC-${request.id}`,
                message: `${request.companyName} updated a CoS request.`,
                actionType: 'cos_request_updated',
                entityId: request.id,
                entityType: 'licence_application'
            });
        } catch (notifyErr) {
            console.error('Failed to notify admins about CoS request update:', notifyErr);
        }
    } catch (error) {
        console.error('Error updating CoS request:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update CoS request',
            data: null
        });
    }
};

export const deleteCosRequest = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;

        const request = await LicenceApplication.findOne({
            where: {
                id,
                userId,
                reason: { [Op.iLike]: 'CoS Request:%' }
            }
        });

        if (!request) {
            return res.status(404).json({
                status: 'error',
                message: 'CoS request not found',
                data: null
            });
        }

        if (!['Pending', 'Under Review'].includes(request.status)) {
            return res.status(400).json({
                status: 'error',
                message: 'Only pending or under-review CoS requests can be deleted',
                data: null
            });
        }

        await request.destroy();

        res.status(200).json({
            status: 'success',
            message: 'CoS request deleted successfully',
            data: null
        });
    } catch (error) {
        console.error('Error deleting CoS request:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to delete CoS request',
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

        const application = await LicenceApplication.findOne({ where: { id: applicationId, userId } });
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
            const user = await User.findByPk(userId);
            await notifyAdmins({
                type: NotificationTypes.INFO,
                priority: NotificationPriority.MEDIUM,
                title: 'Licence Document Uploaded',
                message: `${application.companyName} has uploaded ${newPaths.length} new document(s) for application #LIC-${applicationId}`,
                actionType: 'document_uploaded',
                entityId: applicationId,
                entityType: 'licence_application'
            });

            if (user?.email) {
                await transporter.sendMail({
                    from: process.env.EMAIL_USER,
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
            console.error('Post-upload actions failed:', e);
        }
    } catch (error) {
        console.error('Error uploading licence document:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

export const deleteLicenceDocument = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { applicationId, docIndex } = req.params;

        const application = await LicenceApplication.findOne({ where: { id: applicationId, userId } });
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
            await notifyAdmins({
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
                await notifyUser(caseworkerId, {
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
            console.error('Failed to send document delete notifications:', notifyErr);
        }
    } catch (error) {
        console.error('Error deleting licence document:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};
