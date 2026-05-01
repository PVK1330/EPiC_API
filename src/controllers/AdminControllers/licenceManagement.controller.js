import db from "../../models/index.js";
const LicenceApplication = db.LicenceApplication;
const User = db.User;
import transporter from "../../config/mail.js";
import { generateNotificationEmailTemplate } from "../../utils/emailTemplate.js";
import { 
    notifyLicenceInfoRequested, 
    notifyLicenceStatusChanged, 
    notifyLicenceAssigned,
    createNotification, 
    NotificationTypes, 
    NotificationPriority 
} from "../../services/notification.service.js";
const { Op } = db.Sequelize;

export const getAllLicenceApplications = async (req, res) => {
    try {
        const { status, type } = req.query;
        const whereClause = {};
        if (status) whereClause.status = status;
        if (type) whereClause.type = type;

        const applications = await LicenceApplication.findAll({
            where: whereClause,
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'first_name', 'last_name', 'email']
                }
            ],
            order: [['createdAt', 'DESC']]
        });

        res.status(200).json({
            status: 'success',
            data: applications
        });
    } catch (error) {
        console.error('Error fetching all licence applications:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch licence applications',
            error: error.message
        });
    }
};

export const updateLicenceApplicationStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, adminNotes } = req.body;

        const application = await LicenceApplication.findByPk(id);

        if (!application) {
            return res.status(404).json({
                status: 'error',
                message: 'Licence application not found'
            });
        }

        application.status = status;
        if (adminNotes) application.adminNotes = adminNotes;
        await application.save();

        // If approved and it's a CoS request, update the sponsor's allocation
        if (status === 'Approved' && String(application.reason || '').startsWith('CoS Request:')) {
            try {
                const SponsorProfile = db.SponsorProfile;
                const profile = await SponsorProfile.findOne({ where: { userId: application.userId } });
                if (profile) {
                    const currentAlloc = parseInt(profile.cosAllocation) || 0;
                    const requestedAlloc = parseInt(application.cosAllocation) || 0;
                    profile.cosAllocation = currentAlloc + requestedAlloc;
                    await profile.save();
                }
            } catch (err) {
                console.error('Failed to update sponsor CoS allocation:', err);
            }
        }

        // Trigger Notification & Email
        try {
            await notifyLicenceStatusChanged(application.userId, application, status, adminNotes);
        } catch (notifyErr) {
            console.error('Failed to send status notification:', notifyErr);
        }

        res.status(200).json({
            status: 'success',
            message: `Licence application ${status.toLowerCase()} successfully`,
            data: application
        });
    } catch (error) {
        console.error('Error updating licence application status:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update licence application status',
            error: error.message
        });
    }
};

export const getAdminLicenceApplicationDetails = async (req, res) => {
    try {
        const { id } = req.params;

        const application = await LicenceApplication.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'first_name', 'last_name', 'email']
                }
            ]
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
        console.error('Error fetching licence application details for admin:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch licence application details',
            error: error.message
        });
    }
};

export const requestAdditionalInformation = async (req, res) => {
    try {
        const { id } = req.params;
        const { requestedDocuments, adminNotes } = req.body;

        const application = await LicenceApplication.findByPk(id);

        if (!application) {
            return res.status(404).json({
                status: 'error',
                message: 'Licence application not found'
            });
        }

        application.status = 'Information Requested';
        application.requestedDocuments = requestedDocuments; // Array of doc titles or instructions
        if (adminNotes) application.adminNotes = adminNotes;
        await application.save();

        // Trigger Notification & Email
        try {
            await notifyLicenceInfoRequested(application.userId, application);
        } catch (notifyErr) {
            console.error('Failed to send info request notification:', notifyErr);
        }

        res.status(200).json({
            status: 'success',
            message: 'Information request sent to business successfully',
            data: application
        });
    } catch (error) {
        console.error('Error requesting additional information:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to request information',
            error: error.message
        });
    }
};

export const assignCaseworker = async (req, res) => {
    try {
        const { id } = req.params;
        const { caseworkerIds } = req.body; // Array of IDs

        const application = await LicenceApplication.findByPk(id);

        if (!application) {
            return res.status(404).json({
                status: 'error',
                message: 'Licence application not found'
            });
        }

        application.assignedcaseworkerId = caseworkerIds;
        application.status = 'Under Review';
        await application.save();

        // Notify assigned caseworkers & Sponsor
        try {
            for (const cwId of caseworkerIds) {
                await notifyLicenceAssigned(cwId, application);
            }
            // Also notify the sponsor
            await notifyLicenceStatusChanged(application.userId, application, 'Assigned to Review');
        } catch (notifyErr) {
            console.error('Failed to send assignment notifications:', notifyErr);
        }

        res.status(200).json({
            status: 'success',
            message: 'Caseworkers assigned successfully',
            data: application
        });
    } catch (error) {
        console.error('Error assigning caseworker to licence:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to assign caseworker',
            error: error.message
        });
    }
};

export const deleteLicenceApplication = async (req, res) => {
    try {
        const { id } = req.params;
        const application = await LicenceApplication.findByPk(id);

        if (!application) {
            return res.status(404).json({
                status: 'error',
                message: 'Licence application not found'
            });
        }

        await application.destroy(); // Soft delete

        res.status(200).json({
            status: 'success',
            message: 'Licence application deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting licence application:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to delete licence application',
            error: error.message
        });
    }
};
export const updateLicenceApplicationByAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const application = await LicenceApplication.findByPk(id);

        if (!application) {
            return res.status(404).json({
                status: 'error',
                message: 'Licence application not found'
            });
        }

        const updateData = { ...req.body };
        
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
    } catch (error) {
        console.error('Error updating licence application by admin:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update licence application',
            error: error.message
        });
    }
};

export const getCosRequests = async (req, res) => {
    try {
        const whereClause = {
            reason: { [Op.iLike]: 'CoS Request:%' }
        };

        if (req.query.status) {
            whereClause.status = req.query.status;
        }

        const cosRequests = await LicenceApplication.findAll({
            where: whereClause,
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'first_name', 'last_name', 'email']
                }
            ],
            order: [['createdAt', 'DESC']]
        });

        res.status(200).json({
            status: 'success',
            message: 'CoS requests fetched successfully',
            data: cosRequests
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

export const assignCosRequestToCaseworker = async (req, res) => {
    try {
        const { id } = req.params;
        const { caseworkerIds, adminNotes } = req.body;

        if (!Array.isArray(caseworkerIds) || !caseworkerIds.length) {
            return res.status(400).json({
                status: 'error',
                message: 'caseworkerIds must be a non-empty array',
                data: null
            });
        }

        const cosRequest = await LicenceApplication.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'first_name', 'last_name', 'email']
                }
            ]
        });

        if (!cosRequest) {
            return res.status(404).json({
                status: 'error',
                message: 'CoS request not found',
                data: null
            });
        }

        if (!String(cosRequest.reason || '').startsWith('CoS Request:')) {
            return res.status(400).json({
                status: 'error',
                message: 'This licence application is not a CoS request',
                data: null
            });
        }

        const caseworkers = await User.findAll({
            where: {
                id: { [Op.in]: caseworkerIds },
                role_id: 2,
                status: 'active'
            },
            attributes: ['id', 'first_name', 'last_name', 'email']
        });

        if (!caseworkers.length) {
            return res.status(404).json({
                status: 'error',
                message: 'No valid active caseworkers found for provided IDs',
                data: null
            });
        }

        cosRequest.assignedcaseworkerId = caseworkers.map((cw) => cw.id);
        cosRequest.status = 'Under Review';
        if (adminNotes) {
            cosRequest.adminNotes = adminNotes;
        }
        await cosRequest.save();

        res.status(200).json({
            status: 'success',
            message: 'CoS request assigned to caseworker(s) successfully',
            data: cosRequest
        });

        try {
            for (const cw of caseworkers) {
                await notifyLicenceAssigned(cw.id, cosRequest);
                if (cw.email) {
                    await transporter.sendMail({
                        from: process.env.EMAIL_USER,
                        to: cw.email,
                        subject: `New CoS Request Assignment #LIC-${cosRequest.id}`,
                        html: generateNotificationEmailTemplate({
                            recipientName: `${cw.first_name || ''} ${cw.last_name || ''}`.trim() || cw.email,
                            title: 'New CoS Request Assigned',
                            message: `You have been assigned CoS request #LIC-${cosRequest.id} for ${cosRequest.companyName}.`,
                            priority: NotificationPriority.HIGH,
                            notificationType: NotificationTypes.LICENCE_ASSIGNED,
                            metadata: {
                                requestId: cosRequest.id,
                                company: cosRequest.companyName,
                                requestedAllocation: cosRequest.cosAllocation,
                                visaType: cosRequest.licenceType
                            }
                        })
                    });
                }
            }
        } catch (err) {
            console.error('Failed notifying assigned caseworker(s):', err);
        }

        try {
            await notifyLicenceStatusChanged(
                cosRequest.userId,
                cosRequest,
                'Under Review',
                adminNotes || 'Your CoS request has been assigned to a caseworker for review.'
            );

            if (cosRequest.user?.email) {
                await transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: cosRequest.user.email,
                    subject: `Your CoS Request #LIC-${cosRequest.id} is Under Review`,
                    html: generateNotificationEmailTemplate({
                        recipientName: `${cosRequest.user.first_name || ''} ${cosRequest.user.last_name || ''}`.trim() || cosRequest.user.email,
                        title: 'CoS Request Assigned',
                        message: `Your CoS request #LIC-${cosRequest.id} has been assigned to a caseworker and moved to Under Review.`,
                        priority: NotificationPriority.MEDIUM,
                        notificationType: NotificationTypes.INFO,
                        metadata: {
                            requestId: cosRequest.id,
                            company: cosRequest.companyName
                        }
                    })
                });
            }
        } catch (err) {
            console.error('Failed notifying sponsor for CoS assignment:', err);
        }
    } catch (error) {
        console.error('Error assigning CoS request to caseworker:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to assign CoS request',
            data: null
        });
    }
};
