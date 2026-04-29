import db from "../../models/index.js";
const LicenceApplication = db.LicenceApplication;
import { Op } from "sequelize";
import { 
    notifyLicenceStatusChanged, 
    notifyLicenceInfoRequested, 
    notifyAdmins, 
    NotificationTypes, 
    NotificationPriority 
} from "../../services/notification.service.js";

export const getAssignedLicenceApplications = async (req, res) => {
    try {
        const caseworkerId = req.user.userId;
        
        // Find applications where caseworkerId array contains this caseworkerId
        const applications = await LicenceApplication.findAll({
            where: {
                assignedcaseworkerId: {
                    [Op.contains]: [caseworkerId]
                }
            },
            order: [['createdAt', 'DESC']]
        });

        res.status(200).json({
            status: 'success',
            data: applications
        });
    } catch (error) {
        console.error('Error fetching assigned licence applications:', error);
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

        const application = await LicenceApplication.findOne({
            where: {
                id,
                assignedcaseworkerId: {
                    [Op.contains]: [caseworkerId]
                }
            }
        });

        if (!application) {
            return res.status(404).json({
                status: 'error',
                message: 'Licence application not found or not assigned to you'
            });
        }

        application.status = status;
        if (adminNotes) {
            application.adminNotes = adminNotes;
        }
        await application.save();

        // Notify Sponsor
        try {
            if (status === 'Information Requested') {
                await notifyLicenceInfoRequested(application.userId, application);
            } else {
                await notifyLicenceStatusChanged(application.userId, application, status);
            }

            // Notify Admins about caseworker decision
            await notifyAdmins({
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
            console.error('Failed to send caseworker decision notifications:', notifyErr);
        }

        res.status(200).json({
            status: 'success',
            message: `Licence application status updated to ${status}`,
            data: application
        });
    } catch (error) {
        console.error('Error updating licence review status:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update status',
            error: error.message
        });
    }
};
