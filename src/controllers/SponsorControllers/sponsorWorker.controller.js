import bcrypt from 'bcryptjs';
import db from '../../models/index.js';
import transporter from '../../config/mail.js';
import { generateCredentialsTemplate } from '../../utils/emailTemplate.js';
import crypto from 'crypto';
import { generateCaseId } from '../../utils/case.utils.js';

const User = db.User;
const Case = db.Case;
const CandidateApplication = db.CandidateApplication;
const SponsorProfile = db.SponsorProfile;

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
      // Don't fail the whole request if mail fails
    }

    res.status(201).json({
      status: 'success',
      message: 'Sponsored worker added successfully',
      data: {
        workerId: newUser.id,
        email: newUser.email,
        tempPassword // Usually we don't return this, but for testing we can
      }
    });

  } catch (err) {
    await transaction.rollback();
    console.error('addSponsoredWorker error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: err.message
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
          attributes: ['id', 'first_name', 'last_name', 'email', 'mobile', 'profile_pic']
        }
      ],
      order: [['created_at', 'DESC']]
    });

    res.status(200).json({
      status: 'success',
      data: workers
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
              as: 'application'
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

    res.status(200).json({
      status: 'success',
      data: {
        case: workerCase,
        application: workerCase.candidate?.application || null
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

    res.status(200).json({ status: 'success', message: `Worker status updated to ${status}` });
  } catch (err) {
    console.error('updateWorkerStatus error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};
