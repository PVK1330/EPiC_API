import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import { Op } from 'sequelize';

import { notifyDocumentUploaded, notifyDocumentReviewed } from '../../../services/notification.service.js';
import {
  evaluateCaseStageAfterEvent,
  recordDocumentReviewTimeline,
} from '../../../services/caseStageAutomation.service.js';
import {
  buildDocumentLookupMap,
  findDocumentForChecklistItem,
  normalizeDocKey,
  resolveChecklistDocumentType,
} from '../../../utils/documentMatch.utils.js';
import { resolveCaseStage, getStageOrder } from '../../../constants/immigrationCaseProcess.js';
import { ROLES } from '../../../middlewares/role.middleware.js';

const DECISION_DOC_TYPES = ['Decision Letter', 'Approval Notice'];
const FINAL_DOC_TYPES = ['Visa Copy', 'BRP Information'];

async function assertCandidateMayDownloadDocument(req, document) {
  const roleId = Number(req.user?.role_id);
  if (roleId !== ROLES.CANDIDATE) return { ok: true };

  if (!document.caseId) return { ok: true };

  const caseRecord = await req.tenantDb.Case.findByPk(document.caseId, {
    attributes: ['id', 'caseStage', 'status', 'candidateId'],
  });
  if (!caseRecord) {
    return { ok: false, message: 'Case not found for this document' };
  }
  if (Number(caseRecord.candidateId) !== Number(req.user?.userId)) {
    return { ok: false, message: 'Access denied' };
  }

  const stage = resolveCaseStage(caseRecord);
  const order = getStageOrder(stage);
  const docType = document.documentType || '';

  if (DECISION_DOC_TYPES.includes(docType)) {
    if (order < getStageOrder('decision_communicated')) {
      return {
        ok: false,
        message: 'Decision documents are available after your decision has been communicated.',
      };
    }
    return { ok: true };
  }

  if (FINAL_DOC_TYPES.includes(docType)) {
    if (order < getStageOrder('case_closure')) {
      return {
        ok: false,
        message: 'Final documents are available after case closure.',
      };
    }
    return { ok: true };
  }

  return { ok: true };
}

const documentsColumnMetadataByDb = new Map();

const getDocumentAttributes = async (tenantDb) => {
  const dbKey = tenantDb?.sequelize?.config?.database || "default";
  if (!documentsColumnMetadataByDb.has(dbKey)) {
    documentsColumnMetadataByDb.set(
      dbKey,
      tenantDb.sequelize
        .getQueryInterface()
        .describeTable("documents")
        .catch(() => ({})),
    );
  }

  const columns = await documentsColumnMetadataByDb.get(dbKey);
  const hasNotesColumn = Boolean(columns?.notes);

  const attributes = [
    'id',
    'userId',
    'caseId',
    'documentType',
    'documentName',
    'userFileName',
    'documentPath',
    'documentCategory',
    'mimeType',
    'fileSize',
    'status',
    'expiryDate',
    'uploadedBy',
    'uploadedAt',
    'reviewedBy',
    'reviewedAt',
    'reviewNotes',
    'isRequired',
    'tags',
    'created_at',
    'updated_at'
  ];

  if (hasNotesColumn) {
    attributes.splice(12, 0, 'notes');
  }

  return { attributes, hasNotesColumn };
};

// Upload documents with system-generated document names
export const uploadDocuments = async (req, res) => {
  try {
    // Multer processes files and form fields differently
    const documentCategory = req.body?.documentCategory || 'general';
    let userId = req.body?.userId;

    // Candidates may only upload to their own account
    const roleId = Number(req.user?.role_id);
    if (roleId === 1) {
      userId = req.user.userId ?? req.user.id;
    }

    if (!userId) {
      return res.status(400).json({
        status: "error",
        message: "userId is required",
        data: null,
      });
    }
    const caseId = req.body?.caseId;
    const documentType = req.body?.documentType || 'General';
    const userFileName = req.body?.userFileName;
    const expiryDate = req.body?.expiryDate || null;
    const notes = req.body?.notes || null;
    let resolvedDocumentType = documentType || "General";

    const uploadedFiles = req.files;

    if (!uploadedFiles || uploadedFiles.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "No files uploaded",
        data: null,
      });
    }

    // Validate user exists
    const user = await req.tenantDb.User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
        data: null,
      });
    }

  // Validate case if provided - handle both numeric id and string caseId
    let numericCaseId = null;
    let caseRecord = null;

    if (caseId) {
      if (!isNaN(parseInt(caseId))) {
        caseRecord = await req.tenantDb.Case.findByPk(parseInt(caseId));
        if (caseRecord) numericCaseId = caseRecord.id;
      }
      if (!caseRecord) {
        caseRecord = await req.tenantDb.Case.findOne({ where: { caseId } });
        if (caseRecord) numericCaseId = caseRecord.id;
      }
      if (!caseRecord) {
        return res.status(404).json({
          status: "error",
          message: "Case not found",
          data: null,
        });
      }
    }

    // Candidates: always attach to their active case when possible
    if (roleId === 1 && !numericCaseId) {
      caseRecord = await req.tenantDb.Case.findOne({
        where: { candidateId: userId },
        order: [["created_at", "DESC"]],
      });
      if (caseRecord) numericCaseId = caseRecord.id;
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

      // Extract original file extension
      const lastDotIndex = originalName.lastIndexOf('.');
      const extension = lastDotIndex > 0 ? originalName.substring(lastDotIndex) : '.pdf';
      
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
      
      return `${prefix}-${dateStr}-${timeStr}-${identifier}${extension}`;
    };

    const { hasNotesColumn } = await getDocumentAttributes(req.tenantDb);

    if (numericCaseId && caseRecord?.visaTypeId && req.tenantDb.DocumentChecklist) {
      const checklistRows = await req.tenantDb.DocumentChecklist.findAll({
        where: { visaTypeId: caseRecord.visaTypeId },
      });
      resolvedDocumentType = resolveChecklistDocumentType(
        checklistRows.map((r) => r.get({ plain: true })),
        documentType,
        userFileName,
      );
    }

    let caseDocsForMatch = [];
    if (numericCaseId) {
      const docWhere = caseRecord?.candidateId
        ? {
            [Op.or]: [
              { caseId: numericCaseId },
              { userId: caseRecord.candidateId, caseId: null },
            ],
          }
        : { caseId: numericCaseId };
      caseDocsForMatch = await req.tenantDb.Document.findAll({
        where: docWhere,
        order: [["uploadedAt", "DESC"]],
      });
    }
    const caseDocLookup = buildDocumentLookupMap(caseDocsForMatch);

    for (const [index, file] of uploadedFiles.entries()) {
      const sourcePath = file.path;

      let targetDir;
      let urlPath;

      if (numericCaseId) {
        targetDir = path.join("uploads", "caseimages", String(numericCaseId));
        urlPath = `caseimages/${numericCaseId}`;
      } else {
        targetDir = path.join("uploads", "documents", userId.toString());
        urlPath = `documents/${userId}`;
      }

      const systemDocumentName = generateSystemDocumentName(
        file.originalname,
        resolvedDocumentType,
        index,
      );
      const targetPath = path.join(targetDir, systemDocumentName);

      fs.mkdirSync(targetDir, { recursive: true });
      fs.renameSync(sourcePath, targetPath);

      const uploadMeta = {
        documentName: systemDocumentName,
        userFileName: userFileName || file.originalname,
        documentPath: targetPath,
        documentCategory,
        mimeType: file.mimetype,
        fileSize: file.size,
        uploadedBy: req.user.userId ?? req.user.id,
        uploadedAt: new Date(),
        status: roleId === 1 ? "under_review" : "uploaded",
        expiryDate: expiryDate || null,
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: null,
      };

      if (hasNotesColumn) {
        uploadMeta.notes = notes || null;
      }

      let document = findDocumentForChecklistItem(
        { documentType: resolvedDocumentType, documentName: userFileName },
        caseDocLookup,
      );

      if (document) {
        if (document.documentPath && fs.existsSync(document.documentPath)) {
          try {
            fs.unlinkSync(document.documentPath);
          } catch {
            /* ignore stale file cleanup errors */
          }
        }
        await document.update({
          ...uploadMeta,
          caseId: numericCaseId || document.caseId,
        });
        document = await document.reload();
      } else if (numericCaseId) {
        const orphan = await req.tenantDb.Document.findOne({
          where: {
            userId,
            caseId: null,
            documentType: resolvedDocumentType,
          },
          order: [["uploadedAt", "DESC"]],
        });
        if (
          !orphan &&
          userFileName &&
          normalizeDocKey(userFileName) !== normalizeDocKey(documentType)
        ) {
          const byName = await req.tenantDb.Document.findOne({
            where: { userId, caseId: null, userFileName },
            order: [["uploadedAt", "DESC"]],
          });
          if (byName) document = byName;
        } else if (orphan) {
          document = orphan;
        }

        if (document) {
          if (document.documentPath && fs.existsSync(document.documentPath)) {
            try {
              fs.unlinkSync(document.documentPath);
            } catch {
              /* ignore */
            }
          }
          await document.update({ ...uploadMeta, caseId: numericCaseId });
          document = await document.reload();
        }
      }

      if (!document) {
        document = await req.tenantDb.Document.create({
          userId,
          caseId: numericCaseId || null,
          documentType: resolvedDocumentType,
          ...uploadMeta,
        });
      }

      caseDocLookup.set(normalizeDocKey(document.documentType), document);
      if (userFileName) {
        caseDocLookup.set(normalizeDocKey(userFileName), document);
      }

      uploadedDocuments.push({
        id: document.id,
        documentName: document.documentName,
        userFileName: document.userFileName,
        documentPath: document.documentPath,
        documentCategory: document.documentCategory,
        documentType: document.documentType,
        fileSize: document.fileSize,
        mimeType: document.mimeType,
        status: document.status,
        uploadedAt: document.uploadedAt,
        documentUrl: `${process.env.BASE_URL || 'http://localhost:5000'}/uploads/${urlPath}/${systemDocumentName}`
      });

      // Send document upload notifications
      try {
        const uploaderName = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || req.user.email || 'A user';
        let caseData = null;
        let caseworkers = [];
        
        if (numericCaseId) {
          caseData = await req.tenantDb.Case.findByPk(numericCaseId);
          if (caseData && caseData.assignedcaseworkerId) {
            caseworkers = Array.isArray(caseData.assignedcaseworkerId)
              ? caseData.assignedcaseworkerId
              : [caseData.assignedcaseworkerId];
          }
        }

        const docNotificationData = {
          id: document.id,
          fileName: file.originalname,
          caseId: caseData ? caseData.caseId : null,
          uploadedBy: uploaderName
        };

        // Notify assigned caseworkers
        for (const cwId of caseworkers) {
          if (cwId !== req.user.userId) {
            await notifyDocumentUploaded(req.tenantDb, cwId, docNotificationData);
          }
        }

        // Candidate upload: notify all admins for review
        if (roleId === 1) {
          const admins = await req.tenantDb.User.findAll({
            where: { role_id: 3, status: "active" },
            attributes: ["id"],
          });
          for (const admin of admins) {
            await notifyDocumentUploaded(req.tenantDb, admin.id, {
              ...docNotificationData,
              uploadedBy: uploaderName,
            });
          }
        }

        // If uploaded by staff for the candidate, notify the candidate
        if (userId !== req.user.userId && roleId !== 1) {
          await notifyDocumentUploaded(req.tenantDb, userId, docNotificationData);
        }
      } catch (notifErr) {
        console.error("Failed to send document upload notification:", notifErr);
      }
    }

    if (numericCaseId) {
      try {
        const caseForStage =
          caseRecord || (await req.tenantDb.Case.findByPk(numericCaseId));
        if (caseForStage) {
          await evaluateCaseStageAfterEvent({
            tenantDb: req.tenantDb,
            caseRecord: caseForStage,
            trigger: "document_uploaded",
            performedBy: req.user.userId ?? req.user.id,
            organisationId: req.user.organisation_id,
          });
        }
      } catch (stageErr) {
        console.error("evaluateCaseStageAfterEvent:", stageErr);
      }
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

    const { attributes } = await getDocumentAttributes(req.tenantDb);

    const documents = await req.tenantDb.Document.findAll({
      attributes,
      where: { userId },
      include: [
        {
          model: req.tenantDb.User,
          as: 'user',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: req.tenantDb.User,
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

    // Handle both numeric id and string caseId
    let caseRecord;
    let numericCaseId;

    // If caseId is a number (or numeric string), try findByPk first
    if (!isNaN(parseInt(caseId))) {
      caseRecord = await req.tenantDb.Case.findByPk(parseInt(caseId));
      if (caseRecord) {
        numericCaseId = caseRecord.id;
      }
    }

    // If not found by numeric id, try by string caseId
    if (!caseRecord) {
      caseRecord = await req.tenantDb.Case.findOne({ where: { caseId } });
      if (caseRecord) {
        numericCaseId = caseRecord.id;
      }
    }

    if (!caseRecord) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    const candidateId = caseRecord.candidateId;
    const scopeClause = candidateId
      ? {
          [Op.or]: [
            { caseId: numericCaseId },
            { userId: candidateId, caseId: null },
          ],
        }
      : { caseId: numericCaseId };

    const whereClause = {
      [Op.and]: [
        scopeClause,
        ...(status ? [{ status }] : []),
        ...(category ? [{ documentCategory: category }] : []),
      ],
    };

    const { attributes } = await getDocumentAttributes(req.tenantDb);

    const documents = await req.tenantDb.Document.findAndCountAll({
      attributes,
      where: whereClause,
      include: [
        {
          model: req.tenantDb.Case,
          as: 'case',
          attributes: ['id', 'caseId']
        },
        {
          model: req.tenantDb.User,
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
      // Use the stored documentPath directly - it contains the relative path from uploads/
      const relativePath = docData.documentPath
        .replace(/^uploads[\/\\]/, '')
        .replace(/\\/g, '/');
      docData.documentUrl = `${process.env.BASE_URL || 'http://localhost:5000'}/uploads/${relativePath}`;
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
    const { attributes } = await getDocumentAttributes(req.tenantDb);

    const document = await req.tenantDb.Document.findByPk(documentId, {
      attributes,
      include: [
        {
          model: req.tenantDb.User,
          as: 'user',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: req.tenantDb.User,
          as: 'uploader',
          attributes: ['id', 'first_name', 'last_name']
        },
        {
          model: req.tenantDb.Case,
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

    const docData = document.toJSON();
    // Use the stored documentPath directly - it contains the relative path from uploads/
    const relativePath = docData.documentPath
      .replace(/^uploads[\/\\]/, '')
      .replace(/\\/g, '/');
    docData.documentUrl = `${process.env.BASE_URL || 'http://localhost:5000'}/uploads/${relativePath}`;

    res.status(200).json({
      status: "success",
      message: "Document retrieved successfully",
      data: {
        document: docData
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

    const document = await req.tenantDb.Document.findByPk(documentId);
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

    const document = await req.tenantDb.Document.findByPk(documentId);
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
    const roleId = Number(req.user?.role_id);

    if (roleId === 1) {
      return res.status(403).json({
        status: "error",
        message: "Only caseworkers and administrators can review documents",
        data: null,
      });
    }

    const allowedStatuses = new Set(["approved", "rejected", "under_review", "uploaded"]);
    if (!status || !allowedStatuses.has(status)) {
      return res.status(400).json({
        status: "error",
        message: "status must be approved, rejected, under_review, or uploaded",
        data: null,
      });
    }

    const document = await req.tenantDb.Document.findByPk(documentId);
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

    let caseData = null;
    let stageAdvance = null;

    try {
      if (document.caseId) {
        caseData = await req.tenantDb.Case.findByPk(document.caseId);
      } else if (document.userId) {
        caseData = await req.tenantDb.Case.findOne({
          where: { candidateId: document.userId },
          order: [["created_at", "DESC"]],
        });
        if (caseData) {
          await document.update({ caseId: caseData.id });
        }
      }
      const docNotificationData = {
        id: document.id,
        fileName: document.userFileName || document.documentName,
        caseId: caseData ? caseData.caseId : null,
      };

      if (document.userId !== req.user.userId) {
        await notifyDocumentReviewed(req.tenantDb, document.userId, docNotificationData, status);
      }

      if (caseData) {
        await recordDocumentReviewTimeline({
          tenantDb: req.tenantDb,
          caseRecord: caseData,
          document,
          status,
          performedBy: req.user?.userId,
        });

        const trigger =
          status === "rejected" ? "document_rejected" : "document_reviewed";
        stageAdvance = await evaluateCaseStageAfterEvent({
          tenantDb: req.tenantDb,
          caseRecord: caseData,
          trigger,
          performedBy: req.user?.userId,
          organisationId: req.user?.organisation_id ?? null,
        });
        if (stageAdvance) {
          await caseData.reload();
        }
      }
    } catch (notifErr) {
      console.error("Failed post-review workflow:", notifErr);
    }

    res.status(200).json({
      status: "success",
      message: "Document status updated successfully",
      data: {
        document,
        case: caseData,
        stageAdvanced: Boolean(stageAdvance),
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

    const document = await req.tenantDb.Document.findByPk(documentId);
    if (!document) {
      return res.status(404).json({
        status: "error",
        message: "Document not found",
        data: null
      });
    }

    const access = await assertCandidateMayDownloadDocument(req, document);
    if (!access.ok) {
      return res.status(403).json({
        status: "error",
        message: access.message,
        data: null,
      });
    }

    // Resolve the absolute path from the relative path stored in database
    const absolutePath = path.resolve(document.documentPath);

    if (!document.documentPath || !fs.existsSync(absolutePath)) {
      return res.status(404).json({
        status: "error",
        message: "File not found on server",
        data: null
      });
    }

    const filename = path.basename(absolutePath);
    res.setHeader('Content-Disposition', `attachment; filename="${document.userFileName || document.documentName}"`);
    res.setHeader('Content-Type', document.mimeType || 'application/octet-stream');

    const fileStream = fs.createReadStream(absolutePath);
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

function sanitizeZipEntryName(name) {
  const base = path.basename(name || 'document').replace(/[/\\]/g, '_');
  return base || 'document';
}

export const downloadMyDocumentsBundle = async (req, res) => {
  try {
    const rawId = req.user?.userId;
    const userId = typeof rawId === 'string' ? Number(rawId) : rawId;
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid session',
        data: null,
      });
    }

    const { attributes } = await getDocumentAttributes(req.tenantDb);
    const documents = await req.tenantDb.Document.findAll({
      attributes,
      where: { userId },
      order: [['uploadedAt', 'DESC']],
    });

    if (!documents.length) {
      return res.status(404).json({
        status: 'error',
        message: 'No documents found',
        data: null,
      });
    }

    const pending = [];
    const usedNames = new Set();

    for (const doc of documents) {
      const absolutePath = path.resolve(doc.documentPath);
      if (!doc.documentPath || !fs.existsSync(absolutePath)) continue;

      let entryName = sanitizeZipEntryName(doc.userFileName || doc.documentName);
      const ext = path.extname(entryName);
      const stem = path.basename(entryName, ext);
      let candidate = entryName;
      let n = 0;
      while (usedNames.has(candidate)) {
        n += 1;
        candidate = `${stem}_${doc.id}_${n}${ext || ''}`;
      }
      usedNames.add(candidate);
      pending.push({ absolutePath, candidate });
    }

    if (!pending.length) {
      return res.status(404).json({
        status: 'error',
        message: 'No files available on server',
        data: null,
      });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="Supporting_Documents.zip"',
    );

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('ZIP archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          status: 'error',
          message: 'Failed to create archive',
          data: null,
          error: err.message,
        });
      }
    });

    archive.pipe(res);

    for (const item of pending) {
      archive.file(item.absolutePath, { name: item.candidate });
    }

    await archive.finalize();
  } catch (error) {
    console.error('downloadMyDocumentsBundle error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        status: 'error',
        message: 'Failed to bundle documents',
        data: null,
        error: error.message,
      });
    }
  }
};
