import logger from '../../../utils/logger.js';
import { Op } from 'sequelize';
import { mergeCaseWhere } from '../../../utils/tenantScope.js';
import { toPublicImagePath } from '../../../utils/storagePath.util.js';
import { computeSponsorPayables } from '../Payments/sponsorPayment.controller.js';

const INACTIVE = ['Cancelled', 'Closed', 'Rejected'];

const uid = (req) => {
  const n = Number(req.user?.userId);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};

/** Resolve a count query to a number, tolerating a missing model or a query error. */
const safeCount = (p) => (p && typeof p.then === 'function' ? p.then((n) => n || 0).catch(() => 0) : Promise.resolve(0));

/**
 * Count compliance submissions where the reviewer has asked this sponsor to act
 * (status "Information Requested"). Spans Right To Work, Worker Events and
 * Change Requests (title-case `reviewStatus`) plus Compliance Documents
 * (lowercase `status`). These are the sponsor's outstanding compliance alerts.
 */
async function countSponsorComplianceAlerts(tenantDb, userId) {
  const needsAction = ['Information Requested'];
  const counts = await Promise.all([
    safeCount(tenantDb.RightToWorkRecord?.count({ where: { sponsorId: userId, reviewStatus: { [Op.in]: needsAction } } })),
    safeCount(tenantDb.WorkerEvent?.count({ where: { sponsorId: userId, reviewStatus: { [Op.in]: needsAction } } })),
    safeCount(tenantDb.SponsorChangeRequest?.count({ where: { sponsorId: userId, reviewStatus: { [Op.in]: needsAction } } })),
    safeCount(tenantDb.ComplianceDocument?.count({ where: { sponsorId: userId, status: 'information_requested' } })),
  ]);
  return counts.reduce((sum, n) => sum + (n || 0), 0);
}

export const getDashboard = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session' });

    const [profile, activeCases, totalCases, pendingLicences, overdueCount, recentCases, approvedLicence, pendingCosRequests, complianceAlerts] =
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
        req.tenantDb.LicenceApplication.findOne({ where: { userId, status: 'Approved' }, order: [['createdAt', 'DESC']] }),
        // Sponsor's own CoS requests still awaiting a reviewer decision.
        safeCount(req.tenantDb.CosRequest?.count({ where: { sponsorId: userId, status: { [Op.in]: ['Pending', 'Under Review'] } } })),
        // Compliance submissions where the reviewer requested more info / action.
        countSponsorComplianceAlerts(req.tenantDb, userId)
      ]);

    const cosTotal = parseInt(profile?.cosAllocation || approvedLicence?.cosAllocation || 0);
    const licenceExpiry = profile?.licenceExpiryDate || approvedLicence?.proposedStartDate;
    const daysRemaining = licenceExpiry
      ? Math.ceil((new Date(licenceExpiry) - new Date()) / 86400000)
      : null;

    // Phase 4 — Licence Activation: a sponsor can only request CoS / sponsor
    // workers once their licence is Active. Surface this so the portal can
    // enable/disable those actions.
    const licenceActive = profile?.licenceStatus === 'Active';

    res.status(200).json({
      status: 'success',
      data: {
        companyName: profile?.companyName,
        licenceStatus: profile?.licenceStatus || 'Pending',
        licenceActive,
        licenceNumber: profile?.sponsorLicenceNumber || null,
        licenceIssueDate: profile?.licenceIssueDate || null,
        canRequestCos: licenceActive,
        canSponsorWorkers: licenceActive,
        licenceRating: profile?.licenceRating,
        riskLevel: profile?.riskLevel || 'Low',
        stats: { activeCases, totalWorkers: totalCases, pendingLicenceApplications: pendingLicences, overdueCount },
        pendingCosRequests,
        complianceAlerts,
        cos: { total: cosTotal, used: activeCases, available: Math.max(cosTotal - activeCases, 0) },
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
    rows.forEach((c) => {
      if (c.candidate && 'profile_pic' in c.candidate) {
        c.candidate.profile_pic = toPublicImagePath(c.candidate.profile_pic);
      }
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

export const getBusinessPayments = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session' });

    const sponsorCases = await req.tenantDb.Case.findAll({
      where: mergeCaseWhere(req, { sponsorId: userId }),
      attributes: ['id', 'caseId']
    });
    const caseIds = sponsorCases.map((c) => c.id);

    // Outstanding payables (licence fee / ISC / case balances) the sponsor can
    // pay online, plus the sponsor's licence-fee/ISC ledger. Case-fee payments
    // remain in case_payments (the `payments` list) — the single source of truth
    // for case balances, also consumed by Invoices/Reports.
    const [payables, sponsorPayments, payments] = await Promise.all([
      computeSponsorPayables(req).catch((err) => {
        logger.warn({ err }, 'computeSponsorPayables failed');
        return [];
      }),
      req.tenantDb.SponsorPayment.findAll({
        where: { sponsorUserId: userId },
        order: [['created_at', 'DESC']],
      }).catch(() => []),
      caseIds.length
        ? req.tenantDb.CasePayment.findAll({
            where: { caseId: { [Op.in]: caseIds } },
            include: [
              {
                model: req.tenantDb.Case,
                attributes: ['caseId', 'status'],
                include: [{ model: req.tenantDb.User, as: 'candidate', attributes: ['first_name', 'last_name'] }],
              },
            ],
            order: [['created_at', 'DESC']],
          })
        : Promise.resolve([]),
    ]);

    const totalFee = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const totalPaid = payments
      .filter((p) => p.paymentStatus === 'completed')
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const outstandingPayables = payables.reduce((sum, p) => sum + Number(p.amount || 0), 0);

    res.status(200).json({
      status: 'success',
      data: {
        summary: {
          totalFee,
          totalPaid,
          outstanding: Math.max(totalFee - totalPaid, 0),
          outstandingPayables,
        },
        payments,
        sponsorPayments,
        payables,
      }
    });
  } catch (err) {
    logger.error({ err }, 'getBusinessPayments error');
    res.status(500).json({ status: 'error', message: 'Internal server error', error: err.message });
  }
};
