import { Op } from 'sequelize';

import logger from '../../../utils/logger.js';
import { sendTransactionalEmail } from '../../../services/mail.service.js';
import { generateNotificationEmailTemplate } from '../../../utils/emailTemplates.js';
import { notifyAdmins, createNotification, NotificationTypes, NotificationPriority } from '../../../services/notification.service.js';
import { rowsToXlsxBuffer, sendXlsxDownload } from '../../../utils/excelExport.util.js';
import catchAsync from '../../../utils/catchAsync.js';
import apiResponse from '../../../utils/apiResponse.js';

const INACTIVE = ['Cancelled', 'Closed', 'Rejected'];
const uid = (req) => { const n = Number(req.user?.userId); return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null; };

export const getCosSummary = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session' });

    const [approvedApps, activeCases, profile] = await Promise.all([
      req.tenantDb.LicenceApplication.findAll({ where: { userId, status: 'Approved' } }),
      req.tenantDb.Case.findAll({
        where: { sponsorId: userId, status: { [Op.notIn]: INACTIVE } },
        include: [{ model: req.tenantDb.CandidateApplication, as: 'application', attributes: ['visaType'] }]
      }),
      req.tenantDb.SponsorProfile.findOne({ where: { userId } })
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
    logger.error({ err }, 'getCosSummary error');
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
      req.tenantDb.SponsorProfile.findOne({ where: { userId } }),
      req.tenantDb.User.findByPk(userId)
    ]);

    const organisationId = req.user?.organisation_id != null ? Number(req.user.organisation_id) : null;
    const app = await req.tenantDb.LicenceApplication.create({
      userId, type: 'Renewal', status: 'Pending',
      cosAllocation: parseInt(requestedAmount),
      licenceType: visaType,
      reason: `CoS Allocation Request: ${reason}`,
      companyName: profile?.companyName || `${user.first_name} ${user.last_name}`,
      contactName: profile?.keyContactName || `${user.first_name} ${user.last_name}`,
      contactEmail: profile?.keyContactEmail || user.email,
      contactPhone: profile?.keyContactPhone || user.mobile || '',
      registrationNumber: profile?.registrationNumber || 'N/A',
      industry: profile?.industrySector || 'N/A',
      organisation_id: organisationId,
    });

    res.status(201).json({ status: 'success', message: 'CoS allocation request submitted', data: app });

    const company = profile?.companyName || user.email;
    try { await notifyAdmins(req.tenantDb, { type: NotificationTypes.INFO, priority: NotificationPriority.HIGH, title: `CoS Request: ${company}`, message: `${company} requested ${requestedAmount} CoS slots for ${visaType}. Reason: ${reason}`, actionType: 'cos_request', entityId: app.id, entityType: 'licence_application' }); } catch (e) { logger.error({ err: e }, 'Failed to notify admins for CoS request'); }
    try { await createNotification({ tenantDb: req.tenantDb, userId, type: NotificationTypes.INFO, priority: NotificationPriority.MEDIUM, title: 'CoS Request Submitted', message: `Your request for ${requestedAmount} CoS slots (${visaType}) is under review.` }); } catch (e) { logger.error({ err: e }, 'Failed to create CoS notification'); }
    if (process.env.ADMIN_EMAIL) {
      try {
        await sendTransactionalEmail({
            organisationId: req.user?.organisation_id ?? null,
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
        logger.error({ err: e }, 'Failed to send CoS admin email');
      }
    }
  } catch (err) {
    logger.error({ err }, 'requestCosAllocation error');
    res.status(500).json({ status: 'error', message: 'Internal server error', error: err.message });
  }
};

export const getCosRequests = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session' });

    const requests = await req.tenantDb.LicenceApplication.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']]
    });

    res.status(200).json({ status: 'success', data: requests });
  } catch (err) {
    logger.error({ err }, 'getCosRequests error');
    res.status(500).json({ status: 'error', message: 'Internal server error', error: err.message });
  }
};

export const updateCosRequest = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session' });
    const { id } = req.params;
    const { visaType, requestedAmount, reason } = req.body;

    const app = await req.tenantDb.LicenceApplication.findOne({ where: { id, userId } });
    if (!app) return res.status(404).json({ status: 'error', message: 'Request not found' });
    if (!['Pending', 'Under Review'].includes(app.status))
      return res.status(400).json({ status: 'error', message: 'Cannot edit approved or rejected requests' });

    if (visaType) app.licenceType = visaType;
    if (requestedAmount) app.cosAllocation = parseInt(requestedAmount);
    if (reason) app.reason = `CoS Request: ${reason}`;
    await app.save();

    res.status(200).json({ status: 'success', message: 'Request updated', data: app });
  } catch (err) {
    logger.error({ err }, 'updateCosRequest error');
    res.status(500).json({ status: 'error', message: 'Internal server error', error: err.message });
  }
};

export const deleteCosRequest = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session' });
    const { id } = req.params;

    const app = await req.tenantDb.LicenceApplication.findOne({ where: { id, userId } });
    if (!app) return res.status(404).json({ status: 'error', message: 'Request not found' });
    if (!['Pending', 'Under Review'].includes(app.status))
      return res.status(400).json({ status: 'error', message: 'Cannot delete approved or rejected requests' });

    await app.destroy();
    res.status(200).json({ status: 'success', message: 'Request deleted' });
  } catch (err) {
    logger.error({ err }, 'deleteCosRequest error');
    res.status(500).json({ status: 'error', message: 'Internal server error', error: err.message });
  }
};

export const exportCosSummary = catchAsync(async (req, res) => {
  const userId = uid(req);
  if (!userId) return apiResponse(res, 401, 'error', 'Invalid session');

  const [approvedApps, activeCases] = await Promise.all([
    req.tenantDb.LicenceApplication.findAll({ where: { userId, status: 'Approved' } }),
    req.tenantDb.Case.findAll({
      where: { sponsorId: userId, status: { [Op.notIn]: INACTIVE } },
      include: [{ model: req.tenantDb.CandidateApplication, as: 'application', attributes: ['visaType'] }]
    })
  ]);

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
    if (!byMap[vt].lastUsed) byMap[vt].lastUsed = a.createdAt;
  });

  const rows = Object.values(byMap).map(i => ({
    visaType: i.visaType,
    allocated: i.allocated,
    used: i.used,
    remaining: i.allocated - i.used,
    expiryDate: i.expiryDate ? new Date(i.expiryDate).toLocaleDateString('en-GB') : 'N/A',
    lastUsed: i.lastUsed ? new Date(i.lastUsed).toLocaleDateString('en-GB') : 'N/A'
  }));

  const columns = [
    { key: 'visaType', header: 'Visa Type' },
    { key: 'allocated', header: 'Allocated' },
    { key: 'used', header: 'Used' },
    { key: 'remaining', header: 'Remaining' },
    { key: 'expiryDate', header: 'Expiry Date' },
    { key: 'lastUsed', header: 'Last Used' }
  ];

  const buffer = rowsToXlsxBuffer(rows, columns);
  const filename = `cos_summary_${new Date().toISOString().split('T')[0]}.xlsx`;
  sendXlsxDownload(res, buffer, filename);
});

export const exportCosRequests = catchAsync(async (req, res) => {
  const userId = uid(req);
  if (!userId) return apiResponse(res, 401, 'error', 'Invalid session');

  const requests = await req.tenantDb.LicenceApplication.findAll({
    where: { userId },
    order: [['createdAt', 'DESC']]
  });

  const rows = requests.map(r => ({
    id: r.id,
    licenceType: r.licenceType || 'N/A',
    cosAllocation: r.cosAllocation || 0,
    status: r.status || 'Pending',
    reason: (r.reason || '').replace('CoS Request: ', '').replace('CoS Allocation Request: ', ''),
    createdAt: new Date(r.createdAt).toLocaleDateString('en-GB'),
    updatedAt: new Date(r.updatedAt).toLocaleDateString('en-GB')
  }));

  const columns = [
    { key: 'id', header: 'Request ID' },
    { key: 'licenceType', header: 'Visa Type' },
    { key: 'cosAllocation', header: 'Requested Amount' },
    { key: 'status', header: 'Status' },
    { key: 'reason', header: 'Reason' },
    { key: 'createdAt', header: 'Created Date' },
    { key: 'updatedAt', header: 'Updated Date' }
  ];

  const buffer = rowsToXlsxBuffer(rows, columns);
  const filename = `cos_requests_${new Date().toISOString().split('T')[0]}.xlsx`;
  sendXlsxDownload(res, buffer, filename);
});
