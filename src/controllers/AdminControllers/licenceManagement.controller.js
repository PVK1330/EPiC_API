import db from "../../models/index.js";
const LicenceApplication = db.LicenceApplication;
const User = db.User;
import { 
    notifyLicenceInfoRequested, 
    notifyLicenceStatusChanged, 
    notifyLicenceAssigned,
    createNotification, 
    NotificationTypes, 
    NotificationPriority 
} from "../../services/notification.service.js";

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
