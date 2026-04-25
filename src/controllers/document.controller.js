import db from '../models/index.js';
import path from 'path';
import fs from 'fs';

const { Document, User, Case } = db;

// Upload documents with system-generated document names
export const uploadDocuments = async (req, res) => {
  try {
    // Multer processes files and form fields differently
    const documentCategory = req.body?.documentCategory || 'general';
    const userId = req.body?.userId;
    const caseId = req.body?.caseId;
    const documentType = req.body?.documentType || 'General';
    const userFileName = req.body?.userFileName;
    const uploadedFiles = req.files;

    if (!uploadedFiles || uploadedFiles.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "No files uploaded",
        data: null,
      });
    }

    // Validate user exists
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
        data: null,
      });
    }

    // Validate case if provided
    if (caseId) {
      const caseExists = await Case.findByPk(caseId);
      if (!caseExists) {
        return res.status(404).json({
          status: "error",
          message: "Case not found",
          data: null,
        });
      }
    }

    const uploadedDocuments = [];

    // Generate system document name
    const generateSystemDocumentName = (originalName, documentType, index) => {
      // Validate input parameters
      if (!originalName || typeof originalName !== 'string') {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
        const timeStr = now.toISOString().split('T')[1].split('.')[0].replace(/:/g, '');
        return `DOC-${dateStr}-${timeStr}-${index.toString().padStart(4, '0')}.pdf`;
      }
      
      const now = new Date();
      const isoString = now.toISOString();
      const dateStr = isoString.split('T')[0].replace(/-/g, '');
      const timeStr = isoString.split('T')[1].split('.')[0].replace(/:/g, '');
      
      // Generate unique identifier
      const identifier = index.toString().padStart(4, '0');
      
      // Determine prefix based on document type
      const prefixes = {
        'General': 'DOC',
        'Passport': 'PAS',
        'Visa': 'VISA',
        'Education': 'EDU',
        'Work': 'WRK',
        'Contract': 'CTR',
        'Medical': 'MED',
        'Financial': 'FIN',
        'Other': 'OTH'
      };
      
      const prefix = prefixes[documentType] || 'DOC';
      
      return `${prefix}-${dateStr}-${timeStr}-${identifier}.pdf`;
    };

    for (const [index, file] of uploadedFiles.entries()) {
      // Move file from temp to correct directory structure
      const sourcePath = file.path;
      const targetDir = path.join('uploads', documentCategory, userId.toString());
      
      // Generate system document name
      const systemDocumentName = generateSystemDocumentName(file.originalname, documentType, index);
      const targetPath = path.join(targetDir, systemDocumentName);
      
      // Create target directory if it doesn't exist
      fs.mkdirSync(targetDir, { recursive: true });
      
      // Move file to correct location
      fs.renameSync(sourcePath, targetPath);
      
      // Create document record with system-generated name
      const document = await Document.create({
        userId,
        caseId: caseId || null,
        documentType: documentType || 'General',
        documentName: systemDocumentName,
        userFileName: userFileName || file.originalname, // Keep user's preferred name
        documentPath: targetPath,
        documentCategory,
        mimeType: file.mimetype,
        fileSize: file.size,
        uploadedBy: req.user.userId,
        uploadedAt: new Date(),
        status: 'uploaded'
      });

      uploadedDocuments.push({
        id: document.id,
        documentName: document.documentName,
        documentPath: document.documentPath,
        documentCategory: document.documentCategory,
        fileSize: document.fileSize,
        mimeType: document.mimeType,
        documentUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/uploads/${documentCategory}/${userId}/${systemDocumentName}` 
      });
    }

    res.status(201).json({
      status: "success",
      message: `${uploadedFiles.length} documents uploaded successfully`,
      data: {
        documents: uploadedDocuments
      }
    });

  } catch (error) {
    console.error('Document upload error:', error);
    res.status(500).json({
      status: "error",
      message: "Failed to upload documents",
      data: null,
      error: error.message
    });
  }
};

// Get user documents by category
export const getUserDocumentsByCategory = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const documents = await Document.findAll({
      where: { userId },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: User,
          as: 'uploader',
          attributes: ['id', 'first_name', 'last_name', 'email']
        }
      ],
      order: [['uploadedAt', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit)
    });

    res.status(200).json({
      status: "success",
      message: "Documents retrieved successfully",
      data: {
        documents,
        pagination: {
          total: documents.length,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(documents.length / limit),
        },
      },
    });
  } catch (error) {
    console.error('Get user documents error:', error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get case documents
export const getCaseDocuments = async (req, res) => {
  try {
    const { caseId } = req.params;
    const { page = 1, limit = 10, status, category } = req.query;

    const whereClause = { caseId };

    if (status) whereClause.status = status;
    if (category) whereClause.documentCategory = category;

    const documents = await Document.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Case,
          as: 'case',
          attributes: ['id', 'caseId']
        },
        {
          model: User,
          as: 'uploader',
          attributes: ['id', 'first_name', 'last_name', 'email']
        }
      ],
      order: [['uploadedAt', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit)
    });

    // Add documentUrl to each document
    const documentsWithUrls = documents.rows.map(doc => {
      const docData = doc.toJSON();
      const filename = docData.documentPath.split('\\').pop().split('/').pop();
      docData.documentUrl = `${process.env.BASE_URL}`;
      return docData;
    });

    res.status(200).json({
      status: "success",
      message: "Case documents retrieved successfully",
      data: {
        documents: documentsWithUrls,
        pagination: {
          total: documents.count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(documents.count / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get case documents error:', error);
    res.status(500).json({
      status: "error",
      message: "Failed to retrieve case documents",
      data: null,
      error: error.message
    });
  }
};

// Get document by ID
export const getDocumentById = async (req, res) => {
  try {
    const { documentId } = req.params;

    const document = await Document.findByPk(documentId, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: User,
          as: 'uploader',
          attributes: ['id', 'first_name', 'last_name']
        },
        {
          model: Case,
          as: 'case',
          attributes: ['id', 'caseId']
        }
      ]
    });

    if (!document) {
      return res.status(404).json({
        status: "error",
        message: "Document not found",
        data: null
      });
    }

    res.status(200).json({
      status: "success",
      message: "Document retrieved successfully",
      data: {
        document: {
          ...document.toJSON(),
          documentUrl: `${process.env.BASE_URL}`
        }
      }
    });

  } catch (error) {
    console.error('Get document error:', error);
    res.status(500).json({
      status: "error",
      message: "Failed to retrieve document",
      data: null,
      error: error.message
    });
  }
};

// Update document
export const updateDocument = async (req, res) => {
  try {
    const { documentId } = req.params;
    const { documentType, documentCategory, expiryDate, tags } = req.body;

    const document = await Document.findByPk(documentId);
    if (!document) {
      return res.status(404).json({
        status: "error",
        message: "Document not found",
        data: null
      });
    }

    await document.update({
      documentType: documentType || document.documentType,
      documentCategory: documentCategory || document.documentCategory,
      expiryDate: expiryDate || document.expiryDate,
      tags: tags || document.tags
    });

    res.status(200).json({
      status: "success",
      message: "Document updated successfully",
      data: {
        document
      }
    });

  } catch (error) {
    console.error('Update document error:', error);
    res.status(500).json({
      status: "error",
      message: "Failed to update document",
      data: null,
      error: error.message
    });
  }
};

// Delete document
export const deleteDocument = async (req, res) => {
  try {
    const { documentId } = req.params;

    const document = await Document.findByPk(documentId);
    if (!document) {
      return res.status(404).json({
        status: "error",
        message: "Document not found",
        data: null
      });
    }

    // Delete file from filesystem
    if (document.documentPath && fs.existsSync(document.documentPath)) {
      fs.unlinkSync(document.documentPath);
    }

    // Delete database record
    await document.destroy();

    res.status(200).json({
      status: "success",
      message: "Document deleted successfully",
      data: null
    });

  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({
      status: "error",
      message: "Failed to delete document",
      data: null,
      error: error.message
    });
  }
};

// Update document status
export const updateDocumentStatus = async (req, res) => {
  try {
    const { documentId } = req.params;
    const { status, reviewNotes } = req.body;

    const document = await Document.findByPk(documentId);
    if (!document) {
      return res.status(404).json({
        status: "error",
        message: "Document not found",
        data: null
      });
    }

    await document.update({
      status,
      reviewNotes,
      reviewedBy: req.user.userId,
      reviewedAt: new Date()
    });

    res.status(200).json({
      status: "success",
      message: "Document status updated successfully",
      data: {
        document
      }
    });

  } catch (error) {
    console.error('Update document status error:', error);
    res.status(500).json({
      status: "error",
      message: "Failed to update document status",
      data: null,
      error: error.message
    });
  }
};

// Download document
export const downloadDocument = async (req, res) => {
  try {
    const { documentId } = req.params;

    const document = await Document.findByPk(documentId);
    if (!document) {
      return res.status(404).json({
        status: "error",
        message: "Document not found",
        data: null
      });
    }

    if (!document.documentPath || !fs.existsSync(document.documentPath)) {
      return res.status(404).json({
        status: "error",
        message: "File not found on server",
        data: null
      });
    }

    const filename = path.basename(document.documentPath);
    res.setHeader('Content-Disposition', `attachment; filename="${document.documentName}"`);
    res.setHeader('Content-Type', document.mimeType || 'application/octet-stream');

    const fileStream = fs.createReadStream(document.documentPath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Download document error:', error);
    res.status(500).json({
      status: "error",
      message: "Failed to download document",
      data: null,
      error: error.message
    });
  }
};
