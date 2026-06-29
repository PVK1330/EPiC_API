import logger from '../../../utils/logger.js';
import path from 'path';
import fs from 'fs';
import {
  COMPLIANCE_STATUS,
  canSponsorEdit,
  canSponsorDelete,
  writeComplianceAudit,
  applyComplianceStatusChange,
} from '../../../services/complianceDocument.service.js';
import {
  notifyAdmins,
  NotificationTypes,
  NotificationPriority,
} from '../../../services/notification.service.js';
import { getPaginationParams, buildPaginationMeta } from '../../../utils/paginate.js';

const toISODate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const isTruthy = (v) => v === true || v === 'true' || v === '1' || v === 1;

export const getDocumentsBySponsor = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { status } = req.query;

    const where = { sponsorId };
    if (status && status !== 'All') {
      const normalized = String(status).toLowerCase().replace(/\s+/g, '_');
      where.status = normalized;
    }

    // Server-side pagination. Supports ?page & ?limit (via shared helper).
    const { page, limit, offset } = getPaginationParams(req.query);

    const { count, rows: documents } = await req.tenantDb.ComplianceDocument.findAndCountAll({
      where,
      include: [
        {
          model: req.tenantDb.User,
          as: 'reviewer',
          attributes: ['id', 'first_name', 'last_name', 'email'],
        },
      ],
      order: [['upload_date', 'DESC']],
      limit,
      offset,
    });

    return res.status(200).json({
      status: 'success',
      data: documents,
      pagination: buildPaginationMeta(count, page, limit),
    });
  } catch (error) {
    logger.error({ err: error }, 'getDocumentsBySponsor error');
    return res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
  }
};

export const uploadComplianceDocument = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { documentType, expiryDate, notes } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ status: 'error', message: 'No file uploaded' });
    }

    if (!documentType) {
      return res.status(400).json({ status: 'error', message: 'documentType is required' });
    }

    const targetDir = path.join('uploads', 'business', sponsorId.toString(), 'compliance');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const fileName = `${Date.now()}-${file.originalname}`;
    const targetPath = path.join(targetDir, fileName);

    fs.copyFileSync(file.path, targetPath);
    fs.unlinkSync(file.path);

    const organisationId = req.user?.organisation_id != null ? Number(req.user.organisation_id) : null;
    const documentPath = targetPath.replace(/\\/g, '/');

    // Sponsors create documents in an editable state only. They submit for
    // review (default) or keep a draft; they can NEVER set a review state.
    const initialStatus = isTruthy(req.body.saveAsDraft)
      ? COMPLIANCE_STATUS.DRAFT
      : COMPLIANCE_STATUS.SUBMITTED;

    const document = await req.tenantDb.ComplianceDocument.create({
      sponsorId,
      organisationId,
      documentType,
      documentPath,
      uploadDate: new Date(),
      expiryDate: toISODate(expiryDate),
      status: initialStatus,
      notes: notes || null,
    });

    // Record the initial status in the audit trail (best effort).
    try {
      await writeComplianceAudit({
        tenantDb: req.tenantDb,
        document,
        actorId: sponsorId,
        action: initialStatus === COMPLIANCE_STATUS.DRAFT ? 'create_draft' : 'submit',
        previousStatus: null,
        newStatus: initialStatus,
      });
    } catch (e) {
      logger.error({ err: e }, 'Failed to write compliance creation audit');
    }

    return res.status(201).json({
      status: 'success',
      message: 'Document uploaded successfully',
      data: document,
    });
  } catch (error) {
    logger.error({ err: error }, 'uploadComplianceDocument error');
    return res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
  }
};

/**
 * Sponsor metadata update.
 *
 * Sponsors may edit document DETAILS only (documentType, expiryDate, notes,
 * optional replacement file) and only while the document is still in an editable
 * state (draft / submitted / information_requested). They cannot touch status,
 * reviewedBy, reviewedAt or reviewNotes — the validation layer rejects those
 * fields and they are never read here. Updating a document that is in
 * `information_requested` re-submits it for review (a system transition, logged).
 */
export const updateDocumentMetadata = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { id } = req.params;

    const document = await req.tenantDb.ComplianceDocument.findOne({ where: { id, sponsorId } });
    if (!document) {
      return res.status(404).json({ status: 'error', message: 'Document not found' });
    }

    if (!canSponsorEdit(document.status)) {
      return res.status(403).json({
        status: 'error',
        message: `This document is '${document.status}' and can no longer be edited. Reviews are performed by Admin/Caseworker staff only.`,
      });
    }

    // Only sponsor-editable detail fields. Privileged fields are intentionally
    // ignored even if they somehow reach this point.
    const { documentType, expiryDate, notes } = req.body;
    if (documentType !== undefined) document.documentType = documentType;
    if (expiryDate !== undefined) document.expiryDate = toISODate(expiryDate);
    if (notes !== undefined) document.notes = notes;

    // Optional replacement file (e.g. when responding to an information request).
    if (req.file) {
      const targetDir = path.join('uploads', 'business', sponsorId.toString(), 'compliance');
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const fileName = `${Date.now()}-${req.file.originalname}`;
      const targetPath = path.join(targetDir, fileName);
      fs.copyFileSync(req.file.path, targetPath);
      fs.unlinkSync(req.file.path);

      const oldPath = document.documentPath;
      document.documentPath = targetPath.replace(/\\/g, '/');
      if (oldPath && fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch (e) {
          logger.error({ err: e }, 'Failed to remove replaced compliance file');
        }
      }
    }

    const wasInformationRequested = document.status === COMPLIANCE_STATUS.INFORMATION_REQUESTED;
    await document.save();

    // Responding to an information request re-submits the document for review.
    if (wasInformationRequested) {
      await applyComplianceStatusChange({
        tenantDb: req.tenantDb,
        document,
        newStatus: COMPLIANCE_STATUS.SUBMITTED,
        actorId: sponsorId,
        action: 'resubmit',
        notes: notes ?? null,
        isReviewAction: false,
        req,
      });

      try {
        await notifyAdmins(req.tenantDb, {
          type: NotificationTypes.INFO,
          priority: NotificationPriority.MEDIUM,
          title: 'Compliance document re-submitted',
          message: `A sponsor re-submitted "${document.documentType}" after an information request.`,
          actionType: 'compliance_resubmit',
          entityType: 'compliance_document',
          entityId: document.id,
        });
      } catch (e) {
        logger.error({ err: e }, 'Failed to notify admins of compliance resubmission');
      }
    }

    return res.status(200).json({ status: 'success', data: document });
  } catch (error) {
    if (error.code === 'INVALID_TRANSITION') {
      return res.status(409).json({ status: 'error', message: error.message });
    }
    logger.error({ err: error }, 'updateDocumentMetadata error');
    return res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
  }
};

// Compliance files live under uploads/business/<sponsorId>/compliance and are
// NOT served statically (the /uploads static mount was removed for security), so
// downloads must stream through this authenticated, sponsor-scoped route.
const COMPLIANCE_UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads', 'business');
const COMPLIANCE_INLINE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf',
]);

export const downloadComplianceDocument = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { id } = req.params;

    // Scope to the caller's own documents — a sponsor can never fetch another
    // sponsor's compliance file by guessing an id.
    const document = await req.tenantDb.ComplianceDocument.findOne({ where: { id, sponsorId } });
    if (!document || !document.documentPath) {
      return res.status(404).json({ status: 'error', message: 'Document not found' });
    }

    const absolute = path.resolve(String(document.documentPath));
    // Prefix check (root + sep) stops a crafted "../" path escaping the tree.
    if (absolute !== COMPLIANCE_UPLOAD_ROOT && !absolute.startsWith(COMPLIANCE_UPLOAD_ROOT + path.sep)) {
      return res.status(400).json({ status: 'error', message: 'Invalid document path' });
    }
    if (!fs.existsSync(absolute)) {
      return res.status(404).json({ status: 'error', message: 'File no longer exists' });
    }

    // Strip the leading "<timestamp>-" so the user gets the original filename.
    const rawName = path.basename(absolute);
    const friendlyName = rawName.replace(/^\d+-/, '') || rawName;
    const safeName = friendlyName.replace(/[^A-Za-z0-9._-]/g, '_');
    const ext = path.extname(absolute).toLowerCase();
    const disposition = COMPLIANCE_INLINE_EXTENSIONS.has(ext) ? 'inline' : 'attachment';

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"`);
    return res.sendFile(absolute, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ status: 'error', message: 'Error streaming file' });
      }
    });
  } catch (error) {
    logger.error({ err: error }, 'downloadComplianceDocument error');
    if (!res.headersSent) {
      res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
    }
  }
};

export const deleteComplianceDocument = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { id } = req.params;

    const document = await req.tenantDb.ComplianceDocument.findOne({ where: { id, sponsorId } });

    if (!document) {
      return res.status(404).json({ status: 'error', message: 'Document not found' });
    }

    // Documents in review or already approved are part of the compliance record
    // and cannot be removed by the sponsor.
    if (!canSponsorDelete(document.status)) {
      return res.status(403).json({
        status: 'error',
        message: `A document that is '${document.status}' cannot be deleted.`,
      });
    }

    if (document.documentPath && fs.existsSync(document.documentPath)) {
      try {
        fs.unlinkSync(document.documentPath);
      } catch (e) {
        logger.error({ err: e }, 'Error deleting compliance file');
      }
    }

    await document.destroy();

    return res.status(200).json({
      status: 'success',
      message: 'Document deleted successfully',
    });
  } catch (error) {
    logger.error({ err: error }, 'deleteComplianceDocument error');
    return res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
  }
};
