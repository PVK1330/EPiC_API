import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import bcrypt from 'bcryptjs';
import { sendTransactionalEmail } from '../../../services/mail.service.js';
import { generateCredentialsTemplate, generateNotificationEmailTemplate } from '../../../utils/emailTemplates.js';
import { getOrganisationEmailBranding } from '../../../utils/emailBranding.js';
import crypto from 'crypto';
import { generateCaseId } from '../../../utils/case.utils.js';
import { notifyAdmins, createNotification, NotificationTypes, NotificationPriority } from '../../../services/notification.service.js';
import { ROLES } from '../../../middlewares/role.middleware.js';
import { pickLeastLoadedCaseworker, recordCaseAssignmentOutcome } from '../../../services/caseAssignment.service.js';
import * as sponsorshipNotify from '../../../services/sponsorshipNotification.service.js';
import logger from '../../../utils/logger.js';
import { toPublicImagePath } from '../../../utils/storagePath.util.js';

const REQUIRED_DOCUMENT_KEYS = ['passport', 'visaCopy', 'cosCopy', 'contract', 'payslips'];

const getDocumentKeyFromType = (documentType = '') => {
  const normalized = String(documentType || '').toLowerCase();
  if (normalized.includes('passport')) return 'passport';
  if (normalized.includes('visa')) return 'visaCopy';
  if (normalized.includes('cos') || normalized.includes('certificate of sponsorship')) return 'cosCopy';
  if (normalized.includes('contract')) return 'contract';
  if (normalized.includes('payslip') || normalized.includes('salary slip')) return 'payslips';
  return null;
};

const toUiDocumentStatus = (statuses = []) => {
  if (!statuses.length) return 'risk';
  if (statuses.includes('rejected') || statuses.includes('missing')) return 'risk';
  if (statuses.includes('under_review')) return 'partial';
  return 'complete';
};

/**
 * Add a new sponsored worker (Candidate)
 */
export const addSponsoredWorker = async (req, res) => {
  const transaction = await req.tenantDb.sequelize.transaction();
  try {
    const sponsorId = req.user.userId; // ID of the business user
    const {
      firstName, lastName, dob, gender, nationality, maritalStatus,
      passportNumber, passportIssueDate, passportExpiryDate, passportCountry,
      email, phone, address, city,
      jobTitle, department, startDate, salary,
      visaType, visaNumber, visaExpiryDate, cosNumber,
      socCode, contractType, workLocation, workingHours,
      previousVisa, notes
    } = req.body;

    // 1. Check if email already exists
    const existingUser = await req.tenantDb.User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ status: 'error', message: 'User with this email already exists' });
    }

    // 2. Generate temporary password
    const tempPassword = crypto.randomBytes(4).toString('hex'); // 8 characters
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    const organisationId = req.user?.organisation_id != null ? Number(req.user.organisation_id) : null;

    // 3. Create User (Candidate)
    const newUser = await req.tenantDb.User.create({
      first_name: firstName,
      last_name: lastName,
      email: email,
      password: hashedPassword,
      country_code: '+44', // Default for now
      mobile: phone,
      role_id: ROLES.CANDIDATE,
      is_otp_verified: true,
      is_email_verified: true,
      status: 'active',
      organisation_id: organisationId,
    }, { transaction });

    // 4. Create Candidate Application
    await req.tenantDb.CandidateApplication.create({
      userId: newUser.id,
      firstName,
      lastName,
      email,
      contactNumber: phone,
      gender,
      dob,
      nationality,
      relationshipStatus: maritalStatus,
      address,
      passportNumber,
      issueDate: passportIssueDate,
      expiryDate: passportExpiryDate,
      issuingAuthority: passportCountry,
      visaType,
      visaEndDate: visaExpiryDate,
      sponsored: 'Yes',
      status: 'submitted',
      submittedAt: new Date(),
      cosNumber,
      socCode,
      contractType,
      workLocation,
      workingHours,
      organisation_id: organisationId,
    }, { transaction });

    // 5. Create Case — auto-assign to the least-loaded caseworker (Option A);
    //    fall back to the unassigned queue when none are available (Option B).
    const caseId = await generateCaseId(req.tenantDb);
    const assignedCaseworker = await pickLeastLoadedCaseworker(req.tenantDb, { transaction });
    const newCase = await req.tenantDb.Case.create({
      caseId,
      candidateId: newUser.id,
      sponsorId: sponsorId,
      jobTitle,
      salaryOffered: salary,
      status: 'In Progress',
      caseStage: 'data_capture_initial_docs',
      assignedcaseworkerId: assignedCaseworker ? [assignedCaseworker.id] : null,
      targetSubmissionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      notes: notes,
      organisation_id: organisationId,
    }, { transaction });

    // 6. Update Sponsor Profile count
    const sponsorProfile = await req.tenantDb.SponsorProfile.findOne({ where: { userId: sponsorId } });
    if (sponsorProfile) {
      await sponsorProfile.increment('sponsored_workers', { by: 1, transaction });
    }

    // 7. Commit Transaction
    await transaction.commit();

    // 8. Send Email to Candidate
    res.status(201).json({
      status: 'success',
      message: 'Sponsored worker added successfully',
      data: {
        workerId: newUser.id,
        email: newUser.email,
        caseId: newCase.caseId,
        caseRowId: newCase.id,
        assignedCaseworkerId: assignedCaseworker ? assignedCaseworker.id : null,
        assignmentStatus: assignedCaseworker ? 'assigned' : 'unassigned_queue',
        tempPassword // Usually we don't return this, but for testing we can
      }
    });

    const loginUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    try {
      const branding = await getOrganisationEmailBranding(organisationId);
      await sendTransactionalEmail({
        organisationId,
        to: email,
        subject: `${branding.orgName} — Your Sponsored Worker Account`,
        html: generateCredentialsTemplate(email, tempPassword, loginUrl, branding.portalUrl, branding),
      });
    } catch (mailErr) {
      logger.error({ err: mailErr }, 'Failed to send credentials email');
    }

    try {
      const sponsorProfile = await req.tenantDb.SponsorProfile.findOne({ where: { userId: sponsorId } });
      const sponsorCompanyName = sponsorProfile?.companyName || 'Sponsor Company';
      await notifyAdmins(req.tenantDb, {
        type: NotificationTypes.INFO,
        priority: NotificationPriority.MEDIUM,
        title: 'New Sponsored Worker Added',
        message: `${firstName} ${lastName} has been added as a sponsored worker under ${sponsorCompanyName}. Case ${caseId} created.`,
        actionType: 'worker_added',
        entityId: newUser.id,
        entityType: 'user',
        metadata: { sponsorId, workerEmail: email, caseRef: caseId }
      });
    } catch (err) {
      logger.error({ err }, 'Failed to notify admins for sponsored worker add');
    }

    // Route the new immigration case: notify the assigned caseworker so review
    // can begin (or alert admins if it landed in the unassigned queue), and
    // write the assignment audit log.
    await recordCaseAssignmentOutcome({
      tenantDb: req.tenantDb,
      caseRecord: newCase,
      caseworker: assignedCaseworker,
      sponsorId,
      actorId: sponsorId,
      candidateName: `${firstName} ${lastName}`.trim(),
      req,
    });

    // Event 9 — Worker Added: sponsor confirmation (in-app + email) + audit.
    try {
      await sponsorshipNotify.workerAdded({
        tenantDb: req.tenantDb,
        sponsorId,
        workerName: `${firstName} ${lastName}`.trim(),
        caseId: newCase.caseId,
        req,
      });
    } catch (e) {
      logger.error({ err: e }, 'workerAdded notification failed');
    }

  } catch (err) {
    await transaction.rollback();
    logger.error({ err }, 'addSponsoredWorker error');
    if (err?.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({
        status: 'error',
        message: 'Email already exists. Please use another email address.',
      });
    }
    if (String(err?.message || '').toLowerCase().includes('islocked')) {
      return res.status(500).json({
        status: 'error',
        message: 'Candidate application schema mismatch detected. Please contact admin.',
        error: err.message,
      });
    }
    res.status(500).json({
      status: 'error',
      message: err?.message || 'Internal server error',
      error: err?.message,
    });
  }
};

/**
 * Get all sponsored workers for the business
 */
export const getSponsoredWorkers = async (req, res) => {
  try {
    const sponsorId = req.user.userId;

    const workers = await req.tenantDb.Case.findAll({
      where: { sponsorId },
      include: [
        {
          model: req.tenantDb.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email', 'mobile', 'profile_pic'],
          include: [
            {
              model: req.tenantDb.CandidateApplication,
              as: 'application',
              attributes: ['visaType', 'nationality', 'passportNumber', 'status']
            }
          ]
        }
      ],
      order: [['created_at', 'DESC']]
    });


    const transformed = workers.map((worker) => ({
      id: worker.id,
      caseId: worker.caseId,
      candidateId: worker.candidateId,
      candidate: {
        first_name: worker.candidate?.first_name,
        last_name: worker.candidate?.last_name,
        email: worker.candidate?.email,
        mobile: worker.candidate?.mobile,
        profile_pic: toPublicImagePath(worker.candidate?.profile_pic)
      },
      status: worker.status,
      jobTitle: worker.jobTitle,
      salaryOffered: worker.salaryOffered,
      visaType: worker.candidate?.application?.visaType || worker.application?.visaType || null,
      nationality: worker.candidate?.application?.nationality || null,
      created_at: worker.created_at
    }));


    res.status(200).json({
      status: 'success',
      data: transformed
    });
  } catch (err) {
    logger.error({ err }, 'getSponsoredWorkers error');
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: err.message
    });
  }
};

/**
 * Get sponsored workers in employee-record shape
 */
export const getEmployeeRecords = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const sponsorProfile = await req.tenantDb.SponsorProfile.findOne({ where: { userId: sponsorId } });
    if (!sponsorProfile) {
      return res.status(404).json({
        status: 'error',
        message: 'Business profile not found',
        data: null
      });
    }

    const profile = sponsorProfile.toJSON ? sponsorProfile.toJSON() : sponsorProfile;
    const level1UsersRaw = Array.isArray(profile.level1Users) ? profile.level1Users : [];

    const internalEmployees = [];

    if (profile.authorisingName || profile.authorisingEmail || profile.authorisingPhone) {
      internalEmployees.push({
        id: `ao-${profile.id}`,
        candidateId: null,
        name: profile.authorisingName || 'Authorising Officer',
        email: profile.authorisingEmail || '',
        phone: profile.authorisingPhone || '',
        nationality: profile.country || '-',
        visaType: 'Internal Staff',
        niNumber: '-',
        startDate: profile.createdAt,
        status: 'Active',
        caseStatus: null,
        role: profile.authorisingJobTitle || 'Authorising Officer',
        documents: {
          passport: 'partial',
          visaCopy: 'partial',
          cosCopy: 'partial',
          contract: 'partial',
          payslips: 'partial'
        },
        documentFiles: []
      });
    }

    if (profile.keyContactName || profile.keyContactEmail || profile.keyContactPhone) {
      internalEmployees.push({
        id: `kc-${profile.id}`,
        candidateId: null,
        name: profile.keyContactName || 'Key Contact',
        email: profile.keyContactEmail || '',
        phone: profile.keyContactPhone || '',
        nationality: profile.country || '-',
        visaType: 'Internal Staff',
        niNumber: '-',
        startDate: profile.createdAt,
        status: 'Active',
        caseStatus: null,
        role: profile.keyContactDepartment || 'Key Contact',
        documents: {
          passport: 'partial',
          visaCopy: 'partial',
          cosCopy: 'partial',
          contract: 'partial',
          payslips: 'partial'
        },
        documentFiles: []
      });
    }

    if (profile.hrName || profile.hrEmail || profile.hrPhone) {
      internalEmployees.push({
        id: `hr-${profile.id}`,
        candidateId: null,
        name: profile.hrName || 'HR Manager',
        email: profile.hrEmail || '',
        phone: profile.hrPhone || '',
        nationality: profile.country || '-',
        visaType: 'Internal Staff',
        niNumber: '-',
        startDate: profile.createdAt,
        status: 'Active',
        caseStatus: null,
        role: profile.hrJobTitle || 'HR Manager',
        documents: {
          passport: 'partial',
          visaCopy: 'partial',
          cosCopy: 'partial',
          contract: 'partial',
          payslips: 'partial'
        },
        documentFiles: []
      });
    }

    level1UsersRaw.forEach((user, idx) => {
      internalEmployees.push({
        id: `l1-${profile.id}-${idx + 1}`,
        candidateId: null,
        name: user?.name || `Level 1 User ${idx + 1}`,
        email: user?.email || '',
        phone: user?.phone || '',
        nationality: profile.country || '-',
        visaType: 'Internal Staff',
        niNumber: '-',
        startDate: profile.createdAt,
        status: 'Active',
        caseStatus: null,
        role: user?.jobTitle || user?.department || 'Level 1 User',
        documents: {
          passport: 'partial',
          visaCopy: 'partial',
          cosCopy: 'partial',
          contract: 'partial',
          payslips: 'partial'
        },
        documentFiles: []
      });
    });

    // --- 2. Add Sponsored Workers (Candidates) ---
    const workers = await req.tenantDb.Case.findAll({
      where: { sponsorId },
      include: [
        {
          model: req.tenantDb.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email', 'mobile']
        },
        {
          model: req.tenantDb.CandidateApplication,
          as: 'application',
          attributes: ['id', 'nationality', 'visaType', 'niNumber', 'startDate']
        }
      ]
    });

    const candidateIds = workers.map(w => w.candidateId);
    const documents = await req.tenantDb.Document.findAll({
      where: { userId: candidateIds }
    });

    const workerEmployees = workers.map(worker => {
      const workerDocs = documents.filter(d => d.userId === worker.candidateId);
      
      const docStatusMap = {
        passport: 'risk',
        visaCopy: 'risk',
        cosCopy: 'risk',
        contract: 'risk',
        payslips: 'risk'
      };

      REQUIRED_DOCUMENT_KEYS.forEach(key => {
        const matchingDocs = workerDocs.filter(d => getDocumentKeyFromType(d.documentType) === key);
        if (matchingDocs.length > 0) {
          const statuses = matchingDocs.map(d => d.status);
          docStatusMap[key] = toUiDocumentStatus(statuses);
        }
      });

      return {
        id: `sw-${worker.id}`,
        candidateId: worker.candidateId,
        name: `${worker.candidate?.first_name || ''} ${worker.candidate?.last_name || ''}`.trim() || 'Sponsored Worker',
        email: worker.candidate?.email || '',
        phone: worker.candidate?.mobile || '',
        nationality: worker.application?.nationality || '-',
        visaType: worker.application?.visaType || 'Sponsored',
        niNumber: worker.application?.niNumber || '-',
        startDate: worker.application?.startDate || worker.created_at,
        status: worker.status === 'Approved' ? 'Active' : 'In Progress',
        caseStatus: worker.status,
        role: worker.jobTitle || 'Sponsored Worker',
        documents: docStatusMap,
        documentFiles: workerDocs.map(d => ({ name: d.documentName, path: d.documentPath }))
      };
    });

    res.status(200).json({
      status: 'success',
      message: 'Employee records fetched successfully',
      data: [...internalEmployees, ...workerEmployees]
    });
  } catch (err) {
    logger.error({ err }, 'getEmployeeRecords error');
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      data: null
    });
  }
};

const sanitizeDownloadName = (name, fallback = 'document') => {
  const base = path.basename(String(name || fallback)).replace(/[/\\]/g, '_');
  // Strip characters that would break a Content-Disposition header
  return base.replace(/["\r\n]/g, '').trim() || fallback;
};

/**
 * Download a sponsored worker's documents.
 * If the worker has exactly one document we stream that single file; if there
 * are two or more we bundle them into a .zip. The sponsor may only download
 * documents for candidates who are their own sponsored workers.
 *
 * Endpoint: GET /api/business/workers/:candidateId/documents/download
 */
export const downloadWorkerDocuments = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const candidateId = Number(req.params.candidateId);
    if (!Number.isFinite(candidateId) || candidateId <= 0) {
      return res.status(400).json({ status: 'error', message: 'Invalid worker', data: null });
    }

    // Ownership check: the candidate must be a sponsored worker of this sponsor.
    const workerCase = await req.tenantDb.Case.findOne({
      where: { sponsorId, candidateId },
      include: [
        {
          model: req.tenantDb.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name']
        }
      ]
    });
    if (!workerCase) {
      return res.status(403).json({
        status: 'error',
        message: 'You do not have access to this worker\'s documents',
        data: null
      });
    }

    const documents = await req.tenantDb.Document.findAll({
      where: { userId: candidateId },
      order: [['uploadedAt', 'DESC']]
    });

    // Keep only documents whose file actually exists on disk.
    const pending = [];
    const usedNames = new Set();
    for (const doc of documents) {
      if (!doc.documentPath) continue;
      const absolutePath = path.resolve(doc.documentPath);
      const inPrivate = absolutePath.startsWith(path.resolve('storage/private'));
      const inUploads = absolutePath.startsWith(path.resolve('uploads'));
      if ((!inPrivate && !inUploads) || !fs.existsSync(absolutePath)) continue;

      let entryName = sanitizeDownloadName(doc.userFileName || doc.documentName);
      const ext = path.extname(entryName);
      const stem = path.basename(entryName, ext);
      let candidate = entryName;
      let n = 0;
      while (usedNames.has(candidate)) {
        n += 1;
        candidate = `${stem}_${doc.id}_${n}${ext || ''}`;
      }
      usedNames.add(candidate);
      pending.push({ absolutePath, name: candidate, mimeType: doc.mimeType });
    }

    if (!pending.length) {
      return res.status(404).json({
        status: 'error',
        message: 'No documents available for this worker',
        data: null
      });
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Single document → stream the file directly.
    if (pending.length === 1) {
      const file = pending[0];
      res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
      const stream = fs.createReadStream(file.absolutePath);
      stream.on('error', (err) => {
        logger.error({ err }, 'downloadWorkerDocuments single-file stream error');
        if (!res.headersSent) {
          res.status(500).json({ status: 'error', message: 'Failed to download document', data: null });
        }
      });
      return stream.pipe(res);
    }

    // Multiple documents → bundle into a zip.
    const workerName = `${workerCase.candidate?.first_name || ''} ${workerCase.candidate?.last_name || ''}`.trim() || 'Worker';
    const zipName = `${sanitizeDownloadName(workerName, 'Worker')}_Documents.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      logger.error({ err }, 'downloadWorkerDocuments ZIP archive error');
      if (!res.headersSent) {
        res.status(500).json({ status: 'error', message: 'Failed to create archive', data: null });
      }
    });
    archive.pipe(res);
    for (const item of pending) {
      archive.file(item.absolutePath, { name: item.name });
    }
    await archive.finalize();
  } catch (err) {
    logger.error({ err }, 'downloadWorkerDocuments error');
    if (!res.headersSent) {
      res.status(500).json({ status: 'error', message: 'Internal server error', data: null });
    }
  }
};

/**
 * Get worker details
 */
export const getSponsoredWorkerDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const sponsorId = req.user.userId;

    const workerCase = await req.tenantDb.Case.findOne({
      where: { candidateId: id, sponsorId },
      include: [
        {
          model: req.tenantDb.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email', 'mobile', 'profile_pic'],
          include: [
            {
              model: req.tenantDb.CandidateApplication,
              as: 'application',
              attributes: ['id', 'gender', 'dob', 'nationality', 'passportNumber', 'visaType', 'visaEndDate', 'address', 'cosNumber', 'socCode', 'contractType', 'workLocation', 'workingHours']
            }
          ]
        }
      ]
    });

    if (!workerCase) {
      return res.status(404).json({
        status: 'error',
        message: 'Worker not found or not associated with this sponsor'
      });
    }

    const casePlain = workerCase.toJSON ? workerCase.toJSON() : workerCase;
    const candidatePlain = casePlain.candidate || null;
    const application = candidatePlain?.application || null;
    const responseCase = {
      ...casePlain,
      candidate: candidatePlain
    };

    // Fetch documents and compute status map
    const documents = await req.tenantDb.Document.findAll({
      where: { userId: id }
    });

    const docStatusMap = {
      passport: 'risk',
      visaCopy: 'risk',
      cosCopy: 'risk',
      contract: 'risk',
      payslips: 'risk'
    };

    REQUIRED_DOCUMENT_KEYS.forEach(key => {
      const matchingDocs = documents.filter(d => getDocumentKeyFromType(d.documentType) === key);
      if (matchingDocs.length > 0) {
        const statuses = matchingDocs.map(d => d.status);
        docStatusMap[key] = toUiDocumentStatus(statuses);
      }
    });

    res.status(200).json({
      status: 'success',
      data: {
        case: responseCase,
        application,
        documents: docStatusMap,
        documentFiles: documents.map(d => ({ 
          id: d.id, 
          name: d.documentName, 
          type: d.documentType, 
          status: d.status, 
          path: d.documentPath,
          uploadedAt: d.createdAt 
        }))
      }
    });
  } catch (err) {
    logger.error({ err }, 'getSponsoredWorkerDetails error');
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: err.message
    });
  }
};
/**
 * Update worker details
 */
export const updateSponsoredWorker = async (req, res) => {
  const transaction = await req.tenantDb.sequelize.transaction();
  try {
    const { id } = req.params; // candidateId
    const sponsorId = req.user.userId;
    const updateData = req.body;

    const workerCase = await req.tenantDb.Case.findOne({ where: { candidateId: id, sponsorId } });
    if (!workerCase) {
      return res.status(404).json({ status: 'error', message: 'Worker case not found' });
    }

    // Update User
    await req.tenantDb.User.update({
      first_name: updateData.firstName,
      last_name: updateData.lastName,
      mobile: updateData.phone,
    }, { where: { id }, transaction });

    // Update Application
    await req.tenantDb.CandidateApplication.update({
      gender: updateData.gender,
      dob: updateData.dob,
      nationality: updateData.nationality,
      passportNumber: updateData.passportNumber,
      visaType: updateData.visaType,
      visaEndDate: updateData.visaExpiryDate,
      address: updateData.address,
      cosNumber: updateData.cosNumber,
      socCode: updateData.socCode,
      contractType: updateData.contractType,
      workLocation: updateData.workLocation,
      workingHours: updateData.workingHours
    }, { where: { userId: id }, transaction });

    // Update Case
    await req.tenantDb.Case.update({
      jobTitle: updateData.jobTitle,
      salaryOffered: updateData.salary,
      notes: updateData.notes
    }, { where: { candidateId: id, sponsorId }, transaction });

    await transaction.commit();
    res.status(200).json({ status: 'success', message: 'Worker updated successfully' });
  } catch (err) {
    await transaction.rollback();
    logger.error({ err }, 'updateSponsoredWorker error');
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};

/**
 * Delete sponsored worker
 */
export const deleteSponsoredWorker = async (req, res) => {
  const transaction = await req.tenantDb.sequelize.transaction();
  try {
    const { id } = req.params;
    const sponsorId = req.user.userId;

    const workerCase = await req.tenantDb.Case.findOne({ where: { candidateId: id, sponsorId } });
    if (!workerCase) {
      return res.status(404).json({ status: 'error', message: 'Worker case not found' });
    }

    // Soft delete Case
    await req.tenantDb.Case.destroy({ where: { candidateId: id, sponsorId }, transaction });
    
    // Deactivate User? Or just keep it as is. 
    // Usually we just remove the association for the sponsor's view.
    
    // Decrement Sponsor worker count
    const sponsorProfile = await req.tenantDb.SponsorProfile.findOne({ where: { userId: sponsorId } });
    if (sponsorProfile && (sponsorProfile.sponsored_workers || 0) > 0) {
      await sponsorProfile.decrement('sponsored_workers', { by: 1, transaction });
    }

    await transaction.commit();
    res.status(200).json({ status: 'success', message: 'Worker removed successfully' });
  } catch (err) {
    await transaction.rollback();
    logger.error({ err }, 'deleteSponsoredWorker error');
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};

/**
 * Update worker status (Approve/Reject with Note)
 */
export const updateWorkerStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const sponsorId = req.user.userId;
    const { status, note } = req.body;

    const workerCase = await req.tenantDb.Case.findOne({ where: { candidateId: id, sponsorId } });
    if (!workerCase) {
      return res.status(404).json({ status: 'error', message: 'Worker case not found' });
    }

    await req.tenantDb.Case.update({
      status: status, // Approved, Rejected, etc.
      notes: note ? `${workerCase.notes || ''}\n[${new Date().toLocaleDateString()}] ${status}: ${note}` : workerCase.notes
    }, { where: { candidateId: id, sponsorId } });

    const candidateIdNum = parseInt(id, 10);
    const candidate = await req.tenantDb.User.findByPk(candidateIdNum, {
      attributes: ['id', 'email', 'first_name', 'last_name']
    });
    const notifMsg = `Your case status has been updated to: ${status}.${note ? ' Note: ' + note : ''}`;

    res.status(200).json({ status: 'success', message: `Worker status updated to ${status}` });

    try {
      await createNotification({ tenantDb: req.tenantDb,
        userId: candidateIdNum,
        type: NotificationTypes.INFO,
        priority: NotificationPriority.HIGH,
        title: 'Case Status Updated',
        message: notifMsg,
        actionType: 'case_status_change',
        entityId: workerCase.id,
        entityType: 'case',
        sendEmail: false,
      });
    } catch (err) {
      logger.error({ err }, 'createNotification failed');
    }

    try {
      await notifyAdmins(req.tenantDb, {
        type: NotificationTypes.INFO,
        priority: NotificationPriority.LOW,
        title: 'Worker Status Updated',
        message: `${candidate?.first_name || ''} ${candidate?.last_name || ''} status moved to ${status}`,
        actionType: 'worker_status_update',
        entityId: workerCase.id,
        entityType: 'case'
      });
    } catch (err) {
      logger.error({ err }, 'notifyAdmins failed');
    }

    if (candidate?.email) {
      try {
        const organisationId = req.user?.organisation_id ?? null;
        const branding = await getOrganisationEmailBranding(organisationId);
        await sendTransactionalEmail({
          organisationId,
          to: candidate.email,
          subject: 'Your Case Status Has Been Updated',
          html: generateNotificationEmailTemplate({
            recipientName: candidate.first_name,
            title: 'Case Status Update',
            message: notifMsg,
            priority: NotificationPriority.HIGH,
            notificationType: NotificationTypes.INFO,
            actionUrl: `${process.env.FRONTEND_URL || '#'}/candidate/application-status`,
            branding,
          })
        });
      } catch (err) {
        logger.error({ err }, 'Email failed');
      }
    }

  } catch (err) {
    logger.error({ err }, 'updateWorkerStatus error');
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};

const toISODate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

export const createAbsenceRecord = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const {
      workerId, absenceType, startDate, endDate,
      totalWorkingDays, reportedToSms, notes
    } = req.body;

    if (!workerId || !absenceType || !startDate || !endDate) {
      return res.status(400).json({
        status: 'error',
        message: 'workerId, absenceType, startDate and endDate are required'
      });
    }

    const organisationId = req.user?.organisation_id != null ? Number(req.user.organisation_id) : null;
    const attendanceRecordPath = req.file ? req.file.path.replace(/\\/g, '/') : null;
    const days = totalWorkingDays !== undefined ? parseInt(totalWorkingDays, 10) : 0;

    const record = await req.tenantDb.AbsenceRecord.create({
      workerId: parseInt(workerId, 10),
      sponsorId,
      organisationId,
      absenceType,
      startDate: toISODate(startDate),
      endDate: toISODate(endDate),
      totalWorkingDays: days,
      attendanceRecordPath,
      reportedToSms: reportedToSms === true || reportedToSms === 'true',
      notes: notes || null,
    });

    return res.status(201).json({ status: 'success', data: record });
  } catch (err) {
    logger.error({ err }, 'createAbsenceRecord error');
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};

export const getAbsenceByWorker = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { workerId } = req.params;

    if (!workerId) {
      return res.status(400).json({ status: 'error', message: 'workerId is required' });
    }

    const records = await req.tenantDb.AbsenceRecord.findAll({
      where: { workerId: parseInt(workerId, 10), sponsorId },
      include: [
        {
          model: req.tenantDb.User,
          as: 'worker',
          attributes: ['id', 'first_name', 'last_name', 'email']
        }
      ],
      order: [['start_date', 'DESC']]
    });

    return res.status(200).json({ status: 'success', data: records });
  } catch (err) {
    logger.error({ err }, 'getAbsenceByWorker error');
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};

export const updateAbsenceRecord = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { id } = req.params;
    const {
      absenceType, startDate, endDate,
      totalWorkingDays, reportedToSms, notes
    } = req.body;

    const record = await req.tenantDb.AbsenceRecord.findOne({ where: { id, sponsorId } });
    if (!record) {
      return res.status(404).json({ status: 'error', message: 'Absence record not found' });
    }

    if (absenceType !== undefined) record.absenceType = absenceType;
    if (startDate !== undefined) record.startDate = toISODate(startDate);
    if (endDate !== undefined) record.endDate = toISODate(endDate);
    if (totalWorkingDays !== undefined) record.totalWorkingDays = parseInt(totalWorkingDays, 10);
    if (reportedToSms !== undefined) record.reportedToSms = reportedToSms === true || reportedToSms === 'true';
    if (notes !== undefined) record.notes = notes;
    if (req.file) record.attendanceRecordPath = req.file.path.replace(/\\/g, '/');

    await record.save();

    return res.status(200).json({ status: 'success', data: record });
  } catch (err) {
    logger.error({ err }, 'updateAbsenceRecord error');
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};

export const createSmsLog = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { eventType, dateSubmitted, smsReferenceNumber, notes } = req.body;

    if (!eventType) {
      return res.status(400).json({ status: 'error', message: 'eventType is required' });
    }

    const organisationId = req.user?.organisation_id != null ? Number(req.user.organisation_id) : null;
    const screenshotPath = req.file ? req.file.path.replace(/\\/g, '/') : null;

    const record = await req.tenantDb.SmsActivityLog.create({
      sponsorId,
      organisationId,
      eventType,
      dateSubmitted: dateSubmitted ? new Date(dateSubmitted) : new Date(),
      smsReferenceNumber: smsReferenceNumber || null,
      screenshotPath,
      submittedBy: sponsorId,
      notes: notes || null,
    });

    return res.status(201).json({ status: 'success', data: record });
  } catch (err) {
    logger.error({ err }, 'createSmsLog error');
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};

export const getSmsLogsBySponsor = async (req, res) => {
  try {
    const sponsorId = req.user.userId;

    const records = await req.tenantDb.SmsActivityLog.findAll({
      where: { sponsorId },
      include: [
        {
          model: req.tenantDb.User,
          as: 'submitter',
          attributes: ['id', 'first_name', 'last_name', 'email']
        }
      ],
      order: [['date_submitted', 'DESC']]
    });

    return res.status(200).json({ status: 'success', data: records });
  } catch (err) {
    logger.error({ err }, 'getSmsLogsBySponsor error');
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};
