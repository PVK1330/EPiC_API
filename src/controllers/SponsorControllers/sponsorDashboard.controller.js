import db from '../../models/index.js';
import { Op } from 'sequelize';

const { User, Case, SponsorProfile, LicenceApplication, CasePayment } = db;
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
        SponsorProfile.findOne({ where: { userId } }),
        Case.count({ where: { sponsorId: userId, status: { [Op.notIn]: INACTIVE } } }),
        Case.count({ where: { sponsorId: userId } }),
        LicenceApplication.count({ where: { userId, status: 'Pending' } }),
        Case.count({ where: { sponsorId: userId, status: 'Overdue' } }),
        Case.findAll({
          where: { sponsorId: userId },
          include: [{ model: User, as: 'candidate', attributes: ['first_name', 'last_name', 'email'] }],
          order: [['created_at', 'DESC']],
          limit: 5
        }),
        LicenceApplication.findOne({ where: { userId, status: 'Approved' }, order: [['createdAt', 'DESC']] })
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
    console.error('getDashboard error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error', error: err.message });
  }
};

export const getBusinessCases = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session' });
    const { page = 1, limit = 10, status } = req.query;
    const where = { sponsorId: userId };
    if (status) where.status = status;
    const { count, rows } = await Case.findAndCountAll({
      where,
      include: [{ model: User, as: 'candidate', attributes: ['id', 'first_name', 'last_name', 'email', 'profile_pic'] }],
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
      SponsorProfile.findOne({ where: { userId } }),
      Case.findAll({
        where: { sponsorId: userId },
        include: [
          { model: User, as: 'candidate', attributes: ['id', 'first_name', 'last_name', 'email'] },
          { model: db.CandidateApplication, as: 'application', attributes: ['visaType', 'visaEndDate', 'nationality'] }
        ]
      })
    ]);
    const today = new Date();
    const workers = cases.map(c => {
      const visaExpiry = c.candidate?.application?.visaEndDate;
      const daysToExpiry = visaExpiry ? Math.ceil((new Date(visaExpiry) - today) / 86400000) : null;
      const riskFlag = daysToExpiry === null ? 'unknown' : daysToExpiry < 30 ? 'high' : daysToExpiry < 90 ? 'medium' : 'low';
      return {
        candidateName: `${c.candidate?.first_name || ''} ${c.candidate?.last_name || ''}`.trim(),
        caseId: c.caseId, status: c.status,
        visaType: c.candidate?.application?.visaType,
        visaExpiry, daysToExpiry, riskFlag
      };
    });
    res.status(200).json({
      status: 'success',
      data: {
        complianceScore: profile?.riskPct || 80,
        riskLevel: profile?.riskLevel || 'Low',
        licenceStatus: profile?.licenceStatus,
        licenceExpiryDate: profile?.licenceExpiryDate,
        highRiskCount: workers.filter(w => w.riskFlag === 'high').length,
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
    const docs = await db.Document.findAll({ where: { userId } });
    res.status(200).json({ status: 'success', data: docs });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};

export const getBusinessPayments = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session' });

    const sponsorCases = await Case.findAll({
      where: { sponsorId: userId },
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

    const payments = await CasePayment.findAll({
      where: { caseId: { [Op.in]: caseIds } },
      include: [
        {
          model: Case,
          attributes: ['caseId', 'status'],
          include: [{ model: User, as: 'candidate', attributes: ['first_name', 'last_name'] }]
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
    console.error('getBusinessPayments error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error', error: err.message });
  }
};
