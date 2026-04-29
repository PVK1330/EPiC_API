import db from "../../models/index.js";
const LicenceApplication = db.LicenceApplication;
import { notifyAdmins, NotificationTypes, NotificationPriority } from "../../services/notification.service.js";

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
