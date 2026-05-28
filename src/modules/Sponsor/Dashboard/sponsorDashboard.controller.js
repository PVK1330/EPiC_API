import logger from '../../../utils/logger.js';
import { Op } from 'sequelize';
import { mergeCaseWhere } from '../../../utils/tenantScope.js';
import { localDateStr } from '../../../utils/dateHelpers.js';

const INACTIVE = ['Cancelled', 'Closed', 'Rejected'];

const uid = (req) => {
  const n = Number(req.user?.userId);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};

export const getDashboard = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session' });

    const [profile, activeCases, totalCases, pendingLicences, overdueCount, recentCases, approvedLicence] =
      await Promise.all([
        req.tenantDb.SponsorProfile.findOne({ where: { userId } }),
        req.tenantDb.Case.count({ where: mergeCaseWhere(req, { sponsorId: userId, status: { [Op.notIn]: INACTIVE } }) }),
        req.tenantDb.Case.count({ where: mergeCaseWhere(req, { sponsorId: userId }) }),
        req.tenantDb.LicenceApplication.count({ where: { userId, status: 'Pending' } }),
        req.tenantDb.Case.count({ where: mergeCaseWhere(req, { sponsorId: userId, status: 'Overdue' }) }),
        req.tenantDb.Case.findAll({
          where: mergeCaseWhere(req, { sponsorId: userId }),
          include: [{ model: req.tenantDb.User, as: 'candidate', attributes: ['first_name', 'last_name', 'email'] }],
          order: [['created_at', 'DESC']],
          limit: 5
        }),
        req.tenantDb.LicenceApplication.findOne({ where: { userId, status: 'Approved' }, order: [['createdAt', 'DESC']] })
      ]);

    const cosTotal = parseInt(profile?.cosAllocation || approvedLicence?.cosAllocation || 0);
    const licenceExpiry = profile?.licenceExpiryDate || approvedLicence?.proposedStartDate;
    const daysRemaining = licenceExpiry
      ? Math.ceil((new Date(licenceExpiry) - new Date()) / 86400000)
      : null;

    res.status(200).json({
      status: 'success',
      data: {
        companyName: profile?.companyName,
        licenceStatus: profile?.licenceStatus || 'Pending',
        licenceRating: profile?.licenceRating,
        riskLevel: profile?.riskLevel || 'Low',
        stats: { activeCases, totalWorkers: totalCases, pendingLicenceApplications: pendingLicences, overdueCount },
        cos: { total: cosTotal, used: activeCases, available: cosTotal - activeCases },
        licenceExpiry: { date: licenceExpiry, daysRemaining, renewalDue: daysRemaining !== null && daysRemaining < 90 },
        recentCases: recentCases.map(c => ({
          id: c.id, caseId: c.caseId,
          candidateName: `${c.candidate?.first_name || ''} ${c.candidate?.last_name || ''}`.trim(),
          candidateEmail: c.candidate?.email,
          status: c.status, jobTitle: c.jobTitle, created_at: c.created_at
        }))
      }
    });
  } catch (err) {
    logger.error({ err }, 'getDashboard error');
    res.status(500).json({ status: 'error', message: 'Internal server error', error: err.message });
  }
};

export const getBusinessCases = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session' });
    const { page = 1, limit = 10, status } = req.query;
    const where = mergeCaseWhere(req, { sponsorId: userId });
    if (status) where.status = status;
    const { count, rows } = await req.tenantDb.Case.findAndCountAll({
      where,
      include: [{ model: req.tenantDb.User, as: 'candidate', attributes: ['id', 'first_name', 'last_name', 'email', 'profile_pic'] }],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit)
    });
    res.status(200).json({
      status: 'success',
      data: { cases: rows, total: count, page: parseInt(page), totalPages: Math.ceil(count / parseInt(limit)) }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Internal server error', error: err.message });
  }
};

export const getComplianceSummary = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session' });
    const [profile, cases] = await Promise.all([
      req.tenantDb.SponsorProfile.findOne({ where: { userId } }),
      req.tenantDb.Case.findAll({
        where: mergeCaseWhere(req, { sponsorId: userId }),
        include: [
          { model: req.tenantDb.User, as: 'candidate', attributes: ['id', 'first_name', 'last_name', 'email'] },
          { model: req.tenantDb.CandidateApplication, as: 'application', attributes: ['visaType', 'visaEndDate', 'nationality'] }
        ]
      })
    ]);
    const today = new Date();
    const workers = cases.map((c) => {
      const visaExpiry = c.application?.visaEndDate ?? null;
      const daysToExpiry = visaExpiry ? Math.ceil((new Date(visaExpiry) - today) / 86400000) : null;
      const riskFlag =
        daysToExpiry === null ? 'unknown' : daysToExpiry < 30 ? 'high' : daysToExpiry < 90 ? 'medium' : 'low';
      return {
        candidateName: `${c.candidate?.first_name || ''} ${c.candidate?.last_name || ''}`.trim(),
        nationality: c.application?.nationality || null,
        caseId: c.caseId,
        status: c.status,
        visaType: c.application?.visaType || null,
        visaExpiry,
        daysToExpiry,
        riskFlag
      };
    });
    const highRiskCount = workers.filter((w) => w.riskFlag === 'high').length;
    const mediumRiskCount = workers.filter((w) => w.riskFlag === 'medium').length;
    const expiringSoon =
      workers.filter((w) => w.daysToExpiry !== null && w.daysToExpiry <= 60 && w.daysToExpiry >= 0).length;
    const complianceScore = typeof profile?.riskPct === 'number' ? Math.max(0, 100 - profile.riskPct) : null;

    res.status(200).json({
      status: 'success',
      data: {
        complianceScore: complianceScore ?? 80,
        riskLevel: profile?.riskLevel || 'Low',
        licenceStatus: profile?.licenceStatus,
        licenceExpiryDate: profile?.licenceExpiryDate,
        highRiskCount,
        mediumRiskCount,
        totalWorkers: workers.length,
        expiringSoon,
        workers
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Internal server error', error: err.message });
  }
};

export const getBusinessDocuments = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session' });

    const [profile, licenceApps] = await Promise.all([
      req.tenantDb.SponsorProfile.findOne({ where: { userId } }),
      req.tenantDb.LicenceApplication.findAll({ where: { userId }, order: [['createdAt', 'DESC']] })
    ]);

    const docs = [];
    const profileFields = ['sponsorLetter', 'insuranceCertificate', 'hrPolicies', 'organisationalChart', 'recruitmentDocs'];
    profileFields.forEach((field) => {
      if (profile?.[field])
        docs.push({
          id: `profile_${field}`,
          name: field.replace(/([A-Z])/g, ' $1').trim(),
          path: profile[field],
          category: 'Company Document',
          status: 'Uploaded',
          source: 'profile',
          uploadDate: profile.updatedAt || new Date(),
        });
    });

    licenceApps.forEach((app) => {
      (app.documents || []).forEach((docPath, i) => {
        docs.push({
          id: `lic_${app.id}_${i}`,
          name: docPath.split('/').pop().replace(/-\d+\./g, '.'),
          path: docPath,
          category: `${app.type} Application`,
          applicationId: app.id,
          applicationStatus: app.status,
          status: app.status === 'Approved' ? 'Verified' : 'Pending',
          source: 'licence',
          docIndex: i,
          uploadDate: app.createdAt || app.updatedAt,
        });
      });
    });

    res.status(200).json({ status: 'success', data: docs });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Internal server error', error: err.message });
  }
};

export const getReportingObligations = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session' });

    const events = await req.tenantDb.WorkerEvent.findAll({
      where: { sponsorId: userId },
      include: [
        {
          model: req.tenantDb.User,
          as: 'worker',
          attributes: ['first_name', 'last_name', 'email']
        }
      ],
      order: [['deadlineDate', 'ASC']]
    });

    const transformed = events.map(e => {
      const today = new Date();
      const deadline = new Date(e.deadlineDate);
      const daysRemaining = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
      
      return {
        id: e.id,
        worker: `${e.worker?.first_name || ''} ${e.worker?.last_name || ''}`.trim(),
        eventType: e.eventType,
        eventDate: e.eventDate,
        reportedDate: e.reportedDate || '-',
        deadline: e.deadlineDate,
        status: e.status.charAt(0).toUpperCase() + e.status.slice(1),
        daysRemaining: daysRemaining,
        risk: daysRemaining < 0 ? 'high' : daysRemaining <= 3 ? 'medium' : 'low'
      };
    });

    res.status(200).json({
      status: 'success',
      data: transformed
    });
  } catch (err) {
    logger.error({ err }, 'getReportingObligations error');
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};

export const createReportingObligation = async (req, res) => {
  try {
    const sponsorId = uid(req);
    const { workerId, eventType, eventDate, description } = req.body;

    if (!workerId || !eventType || !eventDate) {
      return res.status(400).json({ status: 'error', message: 'Missing required fields' });
    }

    // Calculate deadline: 10 days after event date
    const eventD = new Date(eventDate);
    const deadlineD = new Date(eventD);
    deadlineD.setDate(deadlineD.getDate() + 10);

    const newEvent = await req.tenantDb.WorkerEvent.create({
      sponsorId,
      workerId,
      eventType,
      eventDate,
      deadlineDate: localDateStr(deadlineD),
      description,
      status: 'pending'
    });

    res.status(201).json({
      status: 'success',
      message: 'Event reported successfully',
      data: newEvent
    });
  } catch (err) {
    logger.error({ err }, 'createReportingObligation error');
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};

export const updateReportingObligation = async (req, res) => {
  try {
    const sponsorId = uid(req);
    const { id } = req.params;
    const { status, reportedDate } = req.body;

    const event = await req.tenantDb.WorkerEvent.findOne({ where: { id, sponsorId } });
    if (!event) return res.status(404).json({ status: 'error', message: 'Event not found' });

    await event.update({
      status: status || event.status,
      reportedDate: reportedDate || event.reportedDate || localDateStr()
    });

    res.status(200).json({
      status: 'success',
      message: 'Reporting obligation updated',
      data: event
    });
  } catch (err) {
    logger.error({ err }, 'updateReportingObligation error');
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};

export const getBusinessPayments = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session' });

    const sponsorCases = await req.tenantDb.Case.findAll({
      where: mergeCaseWhere(req, { sponsorId: userId }),
      attributes: ['id', 'caseId']
    });
    const caseIds = sponsorCases.map((c) => c.id);

    if (!caseIds.length) {
      return res.status(200).json({
        status: 'success',
        data: {
          summary: { totalFee: 0, totalPaid: 0, outstanding: 0 },
          payments: []
        }
      });
    }

    const payments = await req.tenantDb.CasePayment.findAll({
      where: { caseId: { [Op.in]: caseIds } },
      include: [
        {
          model: req.tenantDb.Case,
          attributes: ['caseId', 'status'],
          include: [{ model: req.tenantDb.User, as: 'candidate', attributes: ['first_name', 'last_name'] }]
        }
      ],
      order: [['created_at', 'DESC']]
    });

    const totalFee = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const totalPaid = payments
      .filter((p) => p.paymentStatus === 'completed')
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    res.status(200).json({
      status: 'success',
      data: {
        summary: {
          totalFee,
          totalPaid,
          outstanding: Math.max(totalFee - totalPaid, 0)
        },
        payments
      }
    });
  } catch (err) {
    logger.error({ err }, 'getBusinessPayments error');
    res.status(500).json({ status: 'error', message: 'Internal server error', error: err.message });
  }
};
