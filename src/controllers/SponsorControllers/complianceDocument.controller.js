import db from '../../models/index.js';
import path from 'path';
import fs from 'fs';

const { Document, User } = db;

export const getComplianceDocuments = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { status } = req.query;

        // 1. Fetch from Document model (manual uploads)
        const where = { 
            userId,
            documentCategory: 'business'
        };
        if (status && status !== 'All') {
            if (status === 'Valid') where.status = 'approved';
            else if (status === 'Under Review') where.status = 'under_review';
        }

        const documents = await Document.findAll({
            where,
            order: [['created_at', 'DESC']]
        }).catch(err => {
            console.error('Document.findAll error:', err);
            return [];
        });

        // 2. Fetch from SponsorProfile and LicenceApplications (integrated docs)
        const [profile, licenceApps] = await Promise.all([
            db.SponsorProfile.findOne({ where: { userId } }).catch(() => null),
            db.LicenceApplication.findAll({ where: { userId } }).catch(() => [])
        ]);

        const mappedDocs = [];
        
        // Map Document model docs
        if (Array.isArray(documents)) {
            documents.forEach(doc => {
                const pathStr = doc.documentPath || '';
                const relativePath = pathStr.replace(/^uploads[\/\\]/, '').replace(/\\/g, '/');
                mappedDocs.push({
                    id: doc.id,
                    name: doc.userFileName || doc.documentName || 'Unnamed Document',
                    type: doc.documentType || 'General',
                    uploadDate: doc.created_at ? new Date(doc.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
                    expiry: doc.expiryDate ? new Date(doc.expiryDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '-',
                    status: doc.status === 'approved' ? 'Approved' : doc.status === 'under_review' ? 'Under Review' : 'Pending',
                    reviewedBy: 'Admin',
                    fileSize: doc.fileSize ? (doc.fileSize / (1024 * 1024)).toFixed(1) + ' MB' : '—',
                    path: pathStr ? `/uploads/${relativePath}` : '#',
                    source: 'compliance'
                });
            });
        }

        // Map Profile docs
        const profileFields = ['sponsorLetter', 'insuranceCertificate', 'hrPolicies', 'organisationalChart', 'recruitmentDocs'];
        profileFields.forEach((field) => {
            if (profile?.[field]) {
                mappedDocs.push({
                    id: `profile_${field}`,
                    name: field.replace(/([A-Z])/g, ' $1').trim(),
                    type: 'Company Document',
                    uploadDate: profile.updatedAt ? new Date(profile.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
                    expiry: '-',
                    status: 'Approved',
                    reviewedBy: 'System',
                    fileSize: '—',
                    path: profile[field],
                    source: 'profile'
                });
            }
        });

        // Map Licence docs
        if (Array.isArray(licenceApps)) {
            licenceApps.forEach((app) => {
                let appDocs = [];
                try {
                    appDocs = Array.isArray(app.documents) ? app.documents : JSON.parse(app.documents || '[]');
                } catch (e) {
                    appDocs = [];
                }

                if (Array.isArray(appDocs)) {
                    appDocs.forEach((docPath, i) => {
                        if (!docPath) return;
                        mappedDocs.push({
                            id: `lic_${app.id}_${i}`,
                            name: String(docPath).split('/').pop().replace(/-\d+\./g, '.'),
                            type: `${app.type || 'Licence'} Document`,
                            uploadDate: app.createdAt ? new Date(app.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
                            expiry: '-',
                            status: app.status === 'Approved' ? 'Approved' : 'Under Review',
                            reviewedBy: 'Caseworker',
                            fileSize: '—',
                            path: docPath,
                            source: 'licence'
                        });
                    });
                }
            });
        }

        res.status(200).json({
            status: 'success',
            data: mappedDocs
        });
    } catch (error) {
        console.error('Error fetching compliance documents:', error);
        res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
    }
};

export const uploadComplianceDocument = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { documentName, documentType, expiryDate } = req.body;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ status: 'error', message: 'No file uploaded' });
        }

        const targetDir = path.join('uploads', 'business', userId.toString(), 'compliance');
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const fileName = `${Date.now()}-${file.originalname}`;
        const targetPath = path.join(targetDir, fileName);
        
        // Use copy + unlink instead of rename for cross-drive compatibility
        fs.copyFileSync(file.path, targetPath);
        fs.unlinkSync(file.path);

        const document = await Document.create({
            userId,
            documentType: documentType || 'General',
            documentName: fileName,
            userFileName: documentName || file.originalname,
            documentPath: targetPath,
            documentCategory: 'business',
            mimeType: file.mimetype,
            fileSize: file.size,
            status: 'under_review',
            expiryDate: expiryDate || null,
            uploadedBy: userId,
            uploadedAt: new Date()
        });

        res.status(201).json({
            status: 'success',
            message: 'Document uploaded successfully',
            data: document
        });
    } catch (error) {
        console.error('Error uploading compliance document:', error);
        res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
    }
};

export const deleteComplianceDocument = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;

        const document = await Document.findOne({ where: { id, userId } });

        if (!document) {
            return res.status(404).json({ status: 'error', message: 'Document not found' });
        }

        if (document.documentPath && fs.existsSync(document.documentPath)) {
            try {
                fs.unlinkSync(document.documentPath);
            } catch (e) {
                console.error('Error deleting file:', e);
            }
        }

        await document.destroy();

        res.status(200).json({
            status: 'success',
            message: 'Document deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting compliance document:', error);
        res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
    }
};
