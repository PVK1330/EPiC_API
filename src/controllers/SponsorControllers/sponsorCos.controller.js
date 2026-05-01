import db from '../../models/index.js';
import { Op } from 'sequelize';
import transporter from '../../config/mail.js';
import { generateNotificationEmailTemplate } from '../../utils/emailTemplate.js';
import { notifyAdmins, createNotification, NotificationTypes, NotificationPriority } from '../../services/notification.service.js';

const { User, Case, SponsorProfile, LicenceApplication } = db;
const INACTIVE = ['Cancelled', 'Closed', 'Rejected'];
const uid = (req) => { const n = Number(req.user?.userId); return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null; };

export const getCosSummary = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session' });

    const [approvedApps, activeCases, profile] = await Promise.all([
      LicenceApplication.findAll({ where: { userId, status: 'Approved' } }),
      Case.findAll({
        where: { sponsorId: userId, status: { [Op.notIn]: INACTIVE } },
        include: [{ model: db.CandidateApplication, as: 'application', attributes: ['visaType'] }]
      }),
      SponsorProfile.findOne({ where: { userId } })
    ]);

    const totalAllocated = approvedApps.reduce((s, a) => s + parseInt(a.cosAllocation || 0), 0);

    const byMap = {};
    activeCases.forEach(c => {
      const vt = c.application?.visaType || 'Unknown';
      if (!byMap[vt]) byMap[vt] = { visaType: vt, allocated: 0, used: 0 };
      byMap[vt].used++;
    });
    approvedApps.forEach(a => {
      const vt = a.licenceType || 'Skilled Worker';
      if (!byMap[vt]) byMap[vt] = { visaType: vt, allocated: 0, used: 0 };
      byMap[vt].allocated += parseInt(a.cosAllocation || 0);
      if (!byMap[vt].expiryDate) byMap[vt].expiryDate = a.proposedStartDate;
      if (!byMap[vt].allocationDate) byMap[vt].allocationDate = a.createdAt;
    });

    res.status(200).json({
      status: 'success',
      data: {
        summary: { total: totalAllocated, used: activeCases.length, remaining: totalAllocated - activeCases.length },
        byVisaType: Object.values(byMap).map(i => ({ ...i, remaining: i.allocated - i.used })),
        licenceRating: profile?.licenceRating,
        riskLevel: profile?.riskLevel
      }
    });
  } catch (err) {
    console.error('getCosSummary error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error', error: err.message });
  }
};

export const requestCosAllocation = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session' });
    const { visaType, requestedAmount, reason } = req.body;
    if (!visaType || !requestedAmount || !reason)
      return res.status(400).json({ status: 'error', message: 'visaType, requestedAmount, and reason are required' });

    const [profile, user] = await Promise.all([
      SponsorProfile.findOne({ where: { userId } }),
      User.findByPk(userId)
    ]);

    const app = await LicenceApplication.create({
      userId, type: 'Renewal', status: 'Pending',
      cosAllocation: parseInt(requestedAmount),
      licenceType: visaType,
      reason: `CoS Allocation Request: ${reason}`,
      companyName: profile?.companyName || `${user.first_name} ${user.last_name}`,
      contactName: profile?.keyContactName || `${user.first_name} ${user.last_name}`,
      contactEmail: profile?.keyContactEmail || user.email,
      contactPhone: profile?.keyContactPhone || user.mobile || '',
      registrationNumber: profile?.registrationNumber || 'N/A',
      industry: profile?.industrySector || 'N/A'
    });

    res.status(201).json({ status: 'success', message: 'CoS allocation request submitted', data: app });

    const company = profile?.companyName || user.email;
    try { await notifyAdmins({ type: NotificationTypes.INFO, priority: NotificationPriority.HIGH, title: `CoS Request: ${company}`, message: `${company} requested ${requestedAmount} CoS slots for ${visaType}. Reason: ${reason}`, actionType: 'cos_request', entityId: app.id, entityType: 'licence_application' }); } catch (e) { console.error(e); }
    try { await createNotification({ userId, type: NotificationTypes.INFO, priority: NotificationPriority.MEDIUM, title: 'CoS Request Submitted', message: `Your request for ${requestedAmount} CoS slots (${visaType}) is under review.` }); } catch (e) { console.error(e); }
    if (process.env.ADMIN_EMAIL) {
      try {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: process.env.ADMIN_EMAIL,
          subject: `CoS Request — ${company}`,
          html: generateNotificationEmailTemplate({
            recipientName: 'Admin',
            title: 'New CoS Allocation Request',
            message: `${company} has requested ${requestedAmount} CoS for ${visaType}.\n\nReason: ${reason}`,
            priority: NotificationPriority.HIGH,
            notificationType: NotificationTypes.INFO,
            actionUrl: `${process.env.FRONTEND_URL || ''}/admin/licence-requests`,
            metadata: { applicationId: app.id },
          }),
        });
      } catch (e) {
        console.error(e);
      }
    }
  } catch (err) {
    console.error('requestCosAllocation error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error', error: err.message });
  }
};
