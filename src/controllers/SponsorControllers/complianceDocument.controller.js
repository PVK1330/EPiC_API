import db from '../../models/index.js';
import path from 'path';
import fs from 'fs';

const { Document, User } = db;

export const getComplianceDocuments = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { search, type, status } = req.query;

        const where = { 
            userId,
            documentCategory: 'business'
        };

        if (status && status !== 'All') {
            // Map frontend status to backend status if necessary
            // Frontend: Valid, Under Review, Expiring Soon
            // Backend: approved, under_review, uploaded, etc.
            if (status === 'Valid') where.status = 'approved';
            else if (status === 'Under Review') where.status = 'under_review';
        }

        const documents = await Document.findAll({
            where,
            order: [['created_at', 'DESC']]
        });

        const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
        
        const mappedDocs = documents.map(doc => {
            const relativePath = doc.documentPath.replace(/^uploads[\/\\]/, '').replace(/\\/g, '/');
            return {
                id: doc.id,
                name: doc.userFileName || doc.documentName,
                type: doc.documentType,
                uploadDate: new Date(doc.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
                expiry: doc.expiryDate ? new Date(doc.expiryDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '-',
                status: doc.status === 'approved' ? 'Approved' : doc.status === 'under_review' ? 'Under Review' : 'Pending',
                reviewedBy: 'Admin', // Placeholder or fetch from associations
                fileSize: (doc.fileSize / (1024 * 1024)).toFixed(1) + ' MB',
                url: `${baseUrl}/uploads/${relativePath}`
            };
        });

        res.status(200).json({
            status: 'success',
            data: mappedDocs
        });
    } catch (error) {
        console.error('Error fetching compliance documents:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
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
        
        fs.renameSync(file.path, targetPath);

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
        res.status(500).json({ status: 'error', message: 'Internal server error' });
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

        if (fs.existsSync(document.documentPath)) {
            fs.unlinkSync(document.documentPath);
        }

        await document.destroy();

        res.status(200).json({
            status: 'success',
            message: 'Document deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting compliance document:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};
