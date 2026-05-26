import path from 'path';
import fs from 'fs';

const toISODate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

export const getDocumentsBySponsor = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { status } = req.query;

    const where = { sponsorId };
    if (status && status !== 'All') {
      const normalized = String(status).toLowerCase().replace(/\s+/g, '_');
      where.status = normalized;
    }

    const documents = await req.tenantDb.ComplianceDocument.findAll({
      where,
      include: [
        {
          model: req.tenantDb.User,
          as: 'reviewer',
          attributes: ['id', 'first_name', 'last_name', 'email'],
        },
      ],
      order: [['upload_date', 'DESC']],
    });

    return res.status(200).json({ status: 'success', data: documents });
  } catch (error) {
    console.error('getDocumentsBySponsor error:', error);
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

    const document = await req.tenantDb.ComplianceDocument.create({
      sponsorId,
      organisationId,
      documentType,
      documentPath,
      uploadDate: new Date(),
      expiryDate: toISODate(expiryDate),
      status: 'under_review',
      notes: notes || null,
    });

    return res.status(201).json({
      status: 'success',
      message: 'Document uploaded successfully',
      data: document,
    });
  } catch (error) {
    console.error('uploadComplianceDocument error:', error);
    return res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
  }
};

export const updateDocumentMetadata = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { id } = req.params;
    const {
      documentType,
      expiryDate,
      lastReviewedDate,
      reviewedBy,
      status,
      notes,
    } = req.body;

    const document = await req.tenantDb.ComplianceDocument.findOne({ where: { id, sponsorId } });
    if (!document) {
      return res.status(404).json({ status: 'error', message: 'Document not found' });
    }

    if (documentType !== undefined) document.documentType = documentType;
    if (expiryDate !== undefined) document.expiryDate = toISODate(expiryDate);
    if (lastReviewedDate !== undefined) document.lastReviewedDate = toISODate(lastReviewedDate);
    if (reviewedBy !== undefined) document.reviewedBy = reviewedBy ? parseInt(reviewedBy, 10) : null;
    if (status !== undefined) document.status = status;
    if (notes !== undefined) document.notes = notes;

    await document.save();

    return res.status(200).json({ status: 'success', data: document });
  } catch (error) {
    console.error('updateDocumentMetadata error:', error);
    return res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
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

    if (document.documentPath && fs.existsSync(document.documentPath)) {
      try {
        fs.unlinkSync(document.documentPath);
      } catch (e) {
        console.error('Error deleting file:', e);
      }
    }

    await document.destroy();

    return res.status(200).json({
      status: 'success',
      message: 'Document deleted successfully',
    });
  } catch (error) {
    console.error('deleteComplianceDocument error:', error);
    return res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
  }
};
