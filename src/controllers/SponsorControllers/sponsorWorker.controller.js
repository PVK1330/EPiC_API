import bcrypt from 'bcryptjs';
import db from '../../models/index.js';
import transporter from '../../config/mail.js';
import { generateCredentialsTemplate, generateNotificationEmailTemplate } from '../../utils/emailTemplate.js';
import crypto from 'crypto';
import { generateCaseId } from '../../utils/case.utils.js';
import { notifyAdmins, createNotification, NotificationTypes, NotificationPriority } from '../../services/notification.service.js';

const User = db.User;
const Case = db.Case;
const CandidateApplication = db.CandidateApplication;
const SponsorProfile = db.SponsorProfile;
const Document = db.Document;

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
  const transaction = await db.sequelize.transaction();
  try {
    const sponsorId = req.user.userId; // ID of the business user
    const {
      firstName, lastName, dob, gender, nationality, maritalStatus,
      passportNumber, passportIssueDate, passportExpiryDate, passportCountry,
      email, phone, address, city,
      jobTitle, department, startDate, salary,
      visaType, visaNumber, visaExpiryDate, cosNumber,
      previousVisa, notes
    } = req.body;

    // 1. Check if email already exists
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ status: 'error', message: 'User with this email already exists' });
    }

    // 2. Generate temporary password
    const tempPassword = crypto.randomBytes(4).toString('hex'); // 8 characters
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    // 3. Create User (Candidate role_id = 3)
    const newUser = await User.create({
      first_name: firstName,
      last_name: lastName,
      email: email,
      password: hashedPassword,
      country_code: '+44', // Default for now
      mobile: phone,
      role_id: 3,
      is_otp_verified: true,
      is_email_verified: true,
      status: 'active'
    }, { transaction });

    // 4. Create Candidate Application
    await CandidateApplication.create({
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
      submittedAt: new Date()
    }, { transaction });

    // 5. Create Case
    const caseId = await generateCaseId();
    await Case.create({
      caseId,
      candidateId: newUser.id,
      sponsorId: sponsorId,
      jobTitle,
      salaryOffered: salary,
      status: 'In Progress',
      caseStage: 'Initial',
      targetSubmissionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      notes: notes
    }, { transaction });

    // 6. Update Sponsor Profile count
    const sponsorProfile = await SponsorProfile.findOne({ where: { userId: sponsorId } });
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
        tempPassword // Usually we don't return this, but for testing we can
      }
    });

    const loginUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    try {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Elite Pic - Your Sponsored Worker Account",
        html: generateCredentialsTemplate(email, tempPassword, loginUrl),
      });
    } catch (mailErr) {
      console.error('Failed to send credentials email:', mailErr);
    }

    try {
      const sponsorProfile = await SponsorProfile.findOne({ where: { userId: sponsorId } });
      const sponsorCompanyName = sponsorProfile?.companyName || 'Sponsor Company';
      await notifyAdmins({
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
      console.error('Failed to notify admins for sponsored worker add:', err);
    }

  } catch (err) {
    await transaction.rollback();
    console.error('addSponsoredWorker error:', err);
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

    const workers = await Case.findAll({
      where: { sponsorId },
      include: [
        {
          model: User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email', 'mobile', 'profile_pic'],
          include: [
            {
              model: db.CandidateApplication,
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
        profile_pic: worker.candidate?.profile_pic
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
    console.error('getSponsoredWorkers error:', err);
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
    const sponsorProfile = await SponsorProfile.findOne({ where: { userId: sponsorId } });
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
        startDate: sponsorProfile.createdAt,
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
        startDate: sponsorProfile.createdAt,
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
        startDate: sponsorProfile.createdAt,
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
        startDate: sponsorProfile.createdAt,
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
    const workers = await Case.findAll({
      where: { sponsorId },
      include: [
        {
          model: User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email', 'mobile']
        },
        {
          model: CandidateApplication,
          as: 'application',
          attributes: ['id', 'nationality', 'visaType', 'niNumber', 'startDate']
        }
      ]
    });

    const candidateIds = workers.map(w => w.candidateId);
    const documents = await Document.findAll({
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
    console.error('getEmployeeRecords error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      data: null
    });
  }
};

/**
 * Get worker details
 */
export const getSponsoredWorkerDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const sponsorId = req.user.userId;

    const workerCase = await Case.findOne({
      where: { candidateId: id, sponsorId },
      include: [
        {
          model: User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email', 'mobile', 'profile_pic'],
          include: [
            {
              model: db.CandidateApplication,
              as: 'application',
              attributes: ['id', 'gender', 'dob', 'nationality', 'passportNumber', 'visaType', 'visaEndDate', 'address']
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
    const documents = await Document.findAll({
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
    console.error('getSponsoredWorkerDetails error:', err);
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
  const transaction = await db.sequelize.transaction();
  try {
    const { id } = req.params; // candidateId
    const sponsorId = req.user.userId;
    const updateData = req.body;

    const workerCase = await Case.findOne({ where: { candidateId: id, sponsorId } });
    if (!workerCase) {
      return res.status(404).json({ status: 'error', message: 'Worker case not found' });
    }

    // Update User
    await User.update({
      first_name: updateData.firstName,
      last_name: updateData.lastName,
      mobile: updateData.phone,
    }, { where: { id }, transaction });

    // Update Application
    await CandidateApplication.update({
      gender: updateData.gender,
      dob: updateData.dob,
      nationality: updateData.nationality,
      passportNumber: updateData.passportNumber,
      visaType: updateData.visaType,
      visaEndDate: updateData.visaExpiryDate,
      address: updateData.address
    }, { where: { userId: id }, transaction });

    // Update Case
    await Case.update({
      jobTitle: updateData.jobTitle,
      salaryOffered: updateData.salary,
      notes: updateData.notes
    }, { where: { candidateId: id, sponsorId }, transaction });

    await transaction.commit();
    res.status(200).json({ status: 'success', message: 'Worker updated successfully' });
  } catch (err) {
    await transaction.rollback();
    console.error('updateSponsoredWorker error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};

/**
 * Delete sponsored worker
 */
export const deleteSponsoredWorker = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { id } = req.params;
    const sponsorId = req.user.userId;

    const workerCase = await Case.findOne({ where: { candidateId: id, sponsorId } });
    if (!workerCase) {
      return res.status(404).json({ status: 'error', message: 'Worker case not found' });
    }

    // Soft delete Case
    await Case.destroy({ where: { candidateId: id, sponsorId }, transaction });
    
    // Deactivate User? Or just keep it as is. 
    // Usually we just remove the association for the sponsor's view.
    
    // Decrement Sponsor worker count
    const sponsorProfile = await SponsorProfile.findOne({ where: { userId: sponsorId } });
    if (sponsorProfile && sponsorProfile.sponsored_workers > 0) {
      await sponsorProfile.decrement('sponsored_workers', { by: 1, transaction });
    }

    await transaction.commit();
    res.status(200).json({ status: 'success', message: 'Worker removed successfully' });
  } catch (err) {
    await transaction.rollback();
    console.error('deleteSponsoredWorker error:', err);
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

    const workerCase = await Case.findOne({ where: { candidateId: id, sponsorId } });
    if (!workerCase) {
      return res.status(404).json({ status: 'error', message: 'Worker case not found' });
    }

    await Case.update({
      status: status, // Approved, Rejected, etc.
      notes: note ? `${workerCase.notes || ''}\n[${new Date().toLocaleDateString()}] ${status}: ${note}` : workerCase.notes
    }, { where: { candidateId: id, sponsorId } });

    const candidateIdNum = parseInt(id, 10);
    const candidate = await User.findByPk(candidateIdNum, {
      attributes: ['id', 'email', 'first_name', 'last_name']
    });
    const notifMsg = `Your case status has been updated to: ${status}.${note ? ' Note: ' + note : ''}`;

    res.status(200).json({ status: 'success', message: `Worker status updated to ${status}` });

    try {
      await createNotification({
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
      console.error('createNotification failed:', err);
    }

    try {
      await notifyAdmins({
        type: NotificationTypes.INFO,
        priority: NotificationPriority.LOW,
        title: 'Worker Status Updated',
        message: `${candidate?.first_name || ''} ${candidate?.last_name || ''} status moved to ${status}`,
        actionType: 'worker_status_update',
        entityId: workerCase.id,
        entityType: 'case'
      });
    } catch (err) {
      console.error('notifyAdmins failed:', err);
    }

    if (candidate?.email) {
      try {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: candidate.email,
          subject: 'Your Case Status Has Been Updated',
          html: generateNotificationEmailTemplate({
            recipientName: candidate.first_name,
            title: 'Case Status Update',
            message: notifMsg,
            priority: NotificationPriority.HIGH,
            notificationType: NotificationTypes.INFO,
            actionUrl: `${process.env.FRONTEND_URL || '#'}/candidate/application-status`,
          })
        });
      } catch (err) {
        console.error('Email failed:', err);
      }
    }

  } catch (err) {
    console.error('updateWorkerStatus error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};
