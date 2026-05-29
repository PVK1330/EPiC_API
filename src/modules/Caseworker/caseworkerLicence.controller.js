import { Op } from 'sequelize';
import logger from '../../utils/logger.js';
import { 
    notifyLicenceStatusChanged, 
    notifyLicenceInfoRequested, 
    notifyAdmins, 
    NotificationTypes, 
    NotificationPriority 
} from '../../services/notification.service.js';

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

        res.status(200).json({
            status: 'success',
            data: applications
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

        const application = await req.tenantDb.LicenceApplication.findOne({
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

        // If approved and it's a CoS request, update the sponsor's allocation
        if (status === 'Approved' && String(application.reason || '').startsWith('CoS Request:')) {
            try {
                const profile = await req.tenantDb.SponsorProfile.findOne({ where: { userId: application.userId } });
                if (profile) {
                    const currentAlloc = parseInt(profile.cosAllocation || 0);
                    const requestedAlloc = parseInt(application.cosAllocation || 0);
                    profile.cosAllocation = currentAlloc + requestedAlloc;
                    await profile.save();
                    logger.info({ userId: application.userId, previousAlloc: currentAlloc, newAlloc: profile.cosAllocation }, 'Updated CoS Allocation');
                }
            } catch (err) {
                logger.error({ err }, 'Failed to update SponsorProfile CoS allocation');
            }
        }

        // Notify Sponsor
        try {
            if (status === 'Information Requested') {
                await notifyLicenceInfoRequested(application.userId, application);
            } else {
                await notifyLicenceStatusChanged(application.userId, application, status);
            }

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
