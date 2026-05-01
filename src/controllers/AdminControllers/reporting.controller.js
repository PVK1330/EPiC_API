import db from '../../models/index.js';
import { Op, fn, col, literal } from 'sequelize';
import { multiSheetXlsxBuffer, sendXlsxDownload } from '../../utils/excelExport.util.js';

const { Case, User, CasePayment, Task, Escalation, Document, Role, VisaType, SlaRule } = db;

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Evaluate Dynamic SLA Met
function isSlaMet(c, slaRules) {
  if (!c.created_at) return true;
  const endDate = c.submissionDate ? new Date(c.submissionDate) : (c.updated_at ? new Date(c.updated_at) : null);
  if (!endDate) return true;

  const start = new Date(c.created_at);
  const diffDays = (endDate - start) / (1000 * 60 * 60 * 24);

  const visaName = (c['visaType.name'] || c.visaType?.name || '').toLowerCase();
  
  // Default to 30 days if no rule matches
  let allowedDays = 30;
  
  if (slaRules && slaRules.length > 0) {
    // Attempt to match the visa name exactly, or partially
    const matchedRule = slaRules.find(r => 
      r.rule_type === 'Visa' && 
      (visaName === r.name.toLowerCase() || visaName.includes(r.name.toLowerCase()))
    );
    if (matchedRule) {
      allowedDays = matchedRule.days;
    }
  }

  return diffDays <= allowedDays;
}

// Date filter
function buildDateWhere(startDate, endDate, field = 'createdAt') {
  if (!startDate && !endDate) return {};
  const range = {};
  if (startDate) range[Op.gte] = new Date(startDate);
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    range[Op.lte] = end;
  }
  return { [field]: range };
}

// For Case and CasePayment (which use created_at as the column alias)
function buildCaseDateWhere(startDate, endDate) {
  return buildDateWhere(startDate, endDate, 'created_at');
}

// Role-based access filter
// Admins see all. Caseworkers see their assigned cases. 
// Sponsors see cases they sponsored. Candidates see their own cases.
function buildRoleWhere(user) {
  if (!user || !user.role_name) return { id: null }; // Fallback for safety
  
  const role = user.role_name.toLowerCase();
  
  if (role.includes('admin')) return {}; // Admin sees all
  
  if (role.includes('caseworker')) {
    // Caseworkers linked via assignedcaseworkerId array (JSONB)
    return { assignedcaseworkerId: { [Op.contains]: [user.userId] } };
  }
  
  if (role.includes('sponsor')) {
    // Sponsors linked via sponsorId
    return { sponsorId: user.userId };
  }
  
  if (role.includes('candidate')) {
    // Candidates linked via candidateId
    return { candidateId: user.userId };
  }
  
  // Default to nothing if role unknown
  return { id: null };
}

function momPct(current, last) {
  if (!last || last === 0) return null;
  return Math.round(((current - last) / last) * 100);
}

// ─── 1. Case Analytics ────────────────────────────────────────────────────────
export async function computeCaseAnalyticsData(req) {
  const { startDate, endDate } = req.query;
  const dateWhere = buildCaseDateWhere(startDate, endDate);
  const roleWhere = buildRoleWhere(req.user);

  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const slaRules = await SlaRule.findAll().catch(() => []);

  // Run all queries in parallel — each individually safe
  const [
    statusCounts,
    thisMonthCount,
    lastMonthCount,
    totalCases,
    byVisaTypeData,
    monthlyTrend,
    completedCasesStats
  ] = await Promise.all([
    // Status breakdown
    Case.findAll({
      where: { ...dateWhere, ...roleWhere },
      attributes: ['status', [fn('COUNT', col('Case.id')), 'count']],
      group: ['status'],
      raw: true,
    }).catch(() => []),

    // This month's cases
    Case.count({ where: { created_at: { [Op.gte]: thisMonthStart }, ...roleWhere } }).catch(() => 0),
    
    // Last month's cases
    Case.count({ where: { created_at: { [Op.between]: [lastMonthStart, lastMonthEnd] }, ...roleWhere } }).catch(() => 0),
    
    // Total
    Case.count({ where: { ...dateWhere, ...roleWhere } }).catch(() => 0),

    // By Visa Type (Dynamic Mapping)
    Case.findAll({
      where: { ...dateWhere, ...roleWhere },
      attributes: [
        [col('visaType.name'), 'name'],
        [fn('COUNT', col('Case.id')), 'count'],
      ],
      include: [{
        model: VisaType,
        as: 'visaType',
        attributes: [],
      }],
      group: ['visaType.id', 'visaType.name'],
      order: [[literal('"count"'), 'DESC']],
      raw: true,
    }).catch((err) => {
      console.error('VisaType Query Error:', err);
      return [];
    }),

    // Monthly trend (last 12 months)
    Case.findAll({
      where: { created_at: { [Op.gte]: twelveMonthsAgo }, ...dateWhere, ...roleWhere },
      attributes: [
        [fn('DATE_TRUNC', 'month', col('Case.created_at')), 'month'],
        [fn('COUNT', col('Case.id')), 'count'],
      ],
      group: [fn('DATE_TRUNC', 'month', col('Case.created_at'))],
      order: [[fn('DATE_TRUNC', 'month', col('Case.created_at')), 'ASC']],
      raw: true,
    }).catch(() => []),
    // Global SLA Stats for Completed Cases
    Case.findAll({
      where: { ...dateWhere, ...roleWhere, status: { [Op.in]: ['Completed', 'Closed', 'Approved'] } },
      attributes: ['created_at', 'updated_at', 'submissionDate'],
      include: [{ model: VisaType, as: 'visaType', attributes: ['name'] }],
      raw: true,
    }).catch(() => []),
  ]);

  // Calculate Global SLA Met Pct
  let globalSlaMetCount = 0;
  completedCasesStats.forEach(c => {
    if (isSlaMet(c, slaRules)) globalSlaMetCount++;
  });
  const globalSlaMetPct = completedCasesStats.length > 0 
    ? Math.round((globalSlaMetCount / completedCasesStats.length) * 100) 
    : 0;

  return {
    summary: {
      totalCases,
      thisMonth: thisMonthCount,
      lastMonth: lastMonthCount,
      momChangePct: momPct(thisMonthCount, lastMonthCount),
      slaMetPct: completedCasesStats.length > 0 ? globalSlaMetPct : null,
    },
    statusBreakdown: statusCounts.map(s => ({
      status: s.status || 'Unknown',
      count: parseInt(s.count),
    })),
    byVisaType: byVisaTypeData.map(v => ({
      name: v.name || 'Unknown',
      count: parseInt(v.count),
    })),
    monthlyTrend: monthlyTrend.map(m => ({
      month: m.month,
      count: parseInt(m.count),
    })),
  };
}

export const getCaseAnalytics = async (req, res) => {
  try {
    const data = await computeCaseAnalyticsData(req);
    res.status(200).json({
      status: 'success',
      message: 'Case analytics retrieved successfully',
      data,
    });
  } catch (error) {
    console.error('getCaseAnalytics Error:', error);
    res.status(500).json({ status: 'error', message: error.message, data: null });
  }
};

// ─── 2. Caseworker Workload Report ────────────────────────────────────────────
export async function computeWorkloadReportData(req) {
  const { startDate, endDate } = req.query;
  const dateWhere = buildCaseDateWhere(startDate, endDate);
  const slaRules = await SlaRule.findAll().catch(() => []);
  
  // Determine which caseworkers to fetch based on role
  const role = req.user?.role_name?.toLowerCase() || '';
  let userFilter = { name: { [Op.iLike]: '%caseworker%' } };
  
  if (!role.includes('admin')) {
    userFilter = { name: { [Op.iLike]: '%caseworker%' } };
  }

  // Fetch caseworker-role users
  const caseworkerUsers = await User.findAll({
    where: !role.includes('admin') ? { id: req.user.userId } : {},
    attributes: ['id', 'first_name', 'last_name', 'email'],
    include: [{
      model: Role,
      as: 'role',
      attributes: ['name'],
      where: userFilter,
      required: true,
    }],
  }).catch(() => []);

  const workloadData = await Promise.all(
    caseworkerUsers.map(async (cw) => {
      const whereWithDate = {
        assignedcaseworkerId: { [Op.contains]: [cw.id] },
        ...dateWhere,
      };

      const [total, active, completed, completedCaseStats] = await Promise.all([
        Case.count({ where: whereWithDate }).catch(() => 0),
        Case.count({
          where: { ...whereWithDate, status: { [Op.notIn]: ['Completed', 'Closed', 'Cancelled', 'Rejected', 'Approved'] } },
        }).catch(() => 0),
        Case.count({
          where: { ...whereWithDate, status: { [Op.in]: ['Completed', 'Closed', 'Approved'] } },
        }).catch(() => 0),
        Case.findAll({
          where: { ...whereWithDate, status: { [Op.in]: ['Completed', 'Closed', 'Approved'] } },
          attributes: ['created_at', 'updated_at', 'submissionDate'],
          include: [{ model: VisaType, as: 'visaType', attributes: ['name'] }],
          raw: true
        }).catch(() => [])
      ]);

      let slaMetCount = 0;
      completedCaseStats.forEach(c => {
        if (isSlaMet(c, slaRules)) slaMetCount++;
      });

      const slaTotalCount = completedCaseStats.length;
      const slaMetPct = slaTotalCount > 0 ? Math.round((slaMetCount / slaTotalCount) * 100) : 0;

      return {
        id: cw.id,
        name: `${cw.first_name} ${cw.last_name}`,
        email: cw.email,
        department: 'Casework',
        totalCases: total,
        activeCases: active,
        completedCases: completed,
        slaMetCount,
        slaTotalCount,
        slaMetPct,
      };
    })
  );

  workloadData.sort((a, b) => b.totalCases - a.totalCases);

  return { caseworkers: workloadData, total: workloadData.length };
}

export const getWorkloadReport = async (req, res) => {
  try {
    const data = await computeWorkloadReportData(req);
    res.status(200).json({
      status: 'success',
      message: 'Workload report retrieved successfully',
      data,
    });
  } catch (error) {
    console.error('getWorkloadReport Error:', error);
    res.status(500).json({ status: 'error', message: error.message, data: null });
  }
};

// ─── 3. Financial Report ──────────────────────────────────────────────────────
export async function computeFinancialReportData(req) {
  const { startDate, endDate } = req.query;
  const dateWhere = buildCaseDateWhere(startDate, endDate);
  const roleWhere = buildRoleWhere(req.user);
  
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
  twelveMonthsAgo.setDate(1);
  twelveMonthsAgo.setHours(0, 0, 0, 0);

  // Filter payments based on case access
  const paymentInclude = [{
    model: Case,
    attributes: [],
    where: roleWhere, // only payments for cases the user has access to
    required: true
  }];

  const [
    revenueResult,
    outstandingResult,
    monthlyRevenue,
    statusBreakdown,
    byVisaType,
    bySponsor
  ] = await Promise.all([
    // Completed payments
    CasePayment.findOne({
      where: { paymentStatus: 'completed', ...dateWhere },
      include: paymentInclude,
      attributes: [
        [fn('SUM', col('amount')), 'total'],
        [fn('COUNT', col('CasePayment.id')), 'count'],
      ],
      raw: true,
    }).catch(() => null),

    // Pending/outstanding
    CasePayment.findOne({
      where: { paymentStatus: { [Op.in]: ['pending'] }, ...dateWhere },
      include: paymentInclude,
      attributes: [[fn('SUM', col('amount')), 'total']],
      raw: true,
    }).catch(() => null),

    // Monthly revenue trend
    CasePayment.findAll({
      where: { created_at: { [Op.gte]: twelveMonthsAgo }, paymentStatus: 'completed' },
      include: paymentInclude,
      attributes: [
        [fn('DATE_TRUNC', 'month', col('CasePayment.created_at')), 'month'],
        [fn('SUM', col('amount')), 'total'],
        [fn('COUNT', col('CasePayment.id')), 'count'],
      ],
      group: [fn('DATE_TRUNC', 'month', col('CasePayment.created_at'))],
      order: [[fn('DATE_TRUNC', 'month', col('CasePayment.created_at')), 'ASC']],
      raw: true,
    }).catch(() => []),

    // Status breakdown
    CasePayment.findAll({
      where: dateWhere,
      include: paymentInclude,
      attributes: [
        'paymentStatus',
        [fn('COUNT', col('CasePayment.id')), 'count'],
        [fn('SUM', col('amount')), 'total'],
      ],
      group: ['paymentStatus'],
      raw: true,
    }).catch(() => []),

    // Revenue by Visa Type
    CasePayment.findAll({
      where: { paymentStatus: 'completed', ...dateWhere },
      attributes: [
        [col('Case.visaType.name'), 'name'],
        [fn('SUM', col('amount')), 'total'],
      ],
      include: [{
        model: Case,
        attributes: [],
        where: roleWhere,
        required: true,
        include: [{ model: VisaType, as: 'visaType', attributes: [] }]
      }],
      group: [col('Case.visaType.id'), col('Case.visaType.name')],
      order: [[literal('"total"'), 'DESC']],
      raw: true,
    }).catch(() => []),

    // Revenue by Sponsor
    CasePayment.findAll({
      where: { paymentStatus: 'completed', ...dateWhere },
      attributes: [
        [fn('CONCAT', col('Case.sponsor.first_name'), ' ', col('Case.sponsor.last_name')), 'name'],
        [fn('SUM', col('amount')), 'total'],
      ],
      include: [{
        model: Case,
        attributes: [],
        where: roleWhere,
        required: true,
        include: [{ model: User, as: 'sponsor', attributes: [] }]
      }],
      group: [col('Case.sponsor.id'), col('Case.sponsor.first_name'), col('Case.sponsor.last_name')],
      order: [[literal('"total"'), 'DESC']],
      raw: true,
    }).catch(() => []),
  ]);

  return {
    summary: {
      totalRevenue: parseFloat(revenueResult?.total || 0),
      totalPaid: parseInt(revenueResult?.count || 0),
      totalOutstanding: parseFloat(outstandingResult?.total || 0),
    },
    monthlyRevenue: monthlyRevenue.map(m => ({
      month: m.month,
      total: parseFloat(m.total || 0),
      count: parseInt(m.count || 0),
    })),
    statusBreakdown: statusBreakdown.map(s => ({
      status: s.paymentStatus,
      count: parseInt(s.count || 0),
      total: parseFloat(s.total || 0),
    })),
    byVisaType: byVisaType.map(v => ({
      name: v.name || 'Unknown',
      total: parseFloat(v.total || 0),
    })),
    bySponsor: bySponsor.map(s => ({
      name: s.name || 'Unknown',
      total: parseFloat(s.total || 0),
    })),
  };
}

export const getFinancialReport = async (req, res) => {
  try {
    const data = await computeFinancialReportData(req);
    res.status(200).json({
      status: 'success',
      message: 'Financial report retrieved successfully',
      data,
    });
  } catch (error) {
    console.error('getFinancialReport Error:', error);
    res.status(500).json({ status: 'error', message: error.message, data: null });
  }
};

// ─── 4. Detailed Financial Transactions ──────────────────────────────────────
export const getFinancialTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;
    const roleWhere = buildRoleWhere(req.user);

    const where = {};
    if (status && status !== 'all') where.paymentStatus = status;

    const { count, rows } = await CasePayment.findAndCountAll({
      where,
      include: [{
        model: Case,
        where: roleWhere,
        attributes: ['caseId', 'status'],
        include: [{ 
          model: User, 
          as: 'candidate', 
          attributes: ['first_name', 'last_name'] 
        }]
      }],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.status(200).json({
      status: 'success',
      data: {
        transactions: rows.map(r => ({
          id: r.payment_id || `#PAY-${r.id}`,
          client: r.Case?.candidate ? `${r.Case.candidate.first_name} ${r.Case.candidate.last_name}` : 'Unknown',
          caseId: r.Case?.caseId || 'N/A',
          amount: `£${parseFloat(r.amount).toLocaleString()}`,
          type: r.paymentMethod || 'Invoice',
          status: r.paymentStatus === 'completed' ? 'Paid' : (r.paymentStatus === 'pending' ? 'Pending' : 'Processed'),
          date: new Date(r.created_at).toISOString().split('T')[0]
        })),
        pagination: {
          total: count,
          page: parseInt(page),
          pages: Math.ceil(count / limit)
        }
      }
    });
  } catch (error) {
    console.error('getFinancialTransactions Error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ─── 5. Performance / KPI Report ─────────────────────────────────────────────
export async function computePerformanceReportData(req) {
  const { startDate, endDate } = req.query;
  const dateWhere = buildCaseDateWhere(startDate, endDate);
  const slaRules = await SlaRule.findAll().catch(() => []);
  
  const role = req.user?.role_name?.toLowerCase() || '';
  let userFilter = { name: { [Op.iLike]: '%caseworker%' } };
  
  if (!role.includes('admin')) {
    userFilter = { name: { [Op.iLike]: '%caseworker%' } };
  }

  const caseworkerUsers = await User.findAll({
    where: !role.includes('admin') ? { id: req.user.userId } : {},
    attributes: ['id', 'first_name', 'last_name', 'email', 'createdAt'],
    include: [{
      model: Role,
      as: 'role',
      attributes: ['name'],
      where: userFilter,
      required: true,
    }],
  }).catch(() => []);

  const performanceData = await Promise.all(
    caseworkerUsers.map(async (cw) => {
      const cwWhere = { assignedcaseworkerId: { [Op.contains]: [cw.id] } };
      
      const [
        totalCases,
        activeCases,
        completedCases,
        visaBreakdownRaw,
        recentCases,
        escalations,
        completedCaseStats,
        allCasesForTrend
      ] = await Promise.all([
        Case.count({ where: { ...cwWhere, ...dateWhere } }).catch(() => 0),
        Case.count({ where: { ...cwWhere, ...dateWhere, status: { [Op.notIn]: ['Completed', 'Closed', 'Cancelled', 'Rejected', 'Approved'] } } }).catch(() => 0),
        Case.count({ where: { ...cwWhere, ...dateWhere, status: { [Op.in]: ['Completed', 'Closed', 'Approved'] } } }).catch(() => 0),
        
        Case.findAll({
          where: { ...cwWhere, ...dateWhere },
          attributes: [
            [col('visaType.name'), 'type'],
            [fn('COUNT', col('Case.id')), 'count']
          ],
          include: [{ model: VisaType, as: 'visaType', attributes: [] }],
          group: ['visaType.id', 'visaType.name'],
          raw: true
        }).catch(() => []),

        Case.findAll({
          where: { ...cwWhere, ...dateWhere },
          attributes: ['id', 'caseId', 'status', 'created_at', 'updated_at', 'submissionDate'],
          include: [
            { model: VisaType, as: 'visaType', attributes: ['name'] },
            { model: User, as: 'candidate', attributes: ['first_name', 'last_name'] }
          ],
          order: [['created_at', 'DESC']],
          limit: 5
        }).catch(() => []),

        Escalation.count({ where: { assignedAdminId: cw.id } }).catch(() => 0),

        Case.findAll({
          where: { ...cwWhere, ...dateWhere, status: { [Op.in]: ['Completed', 'Closed', 'Approved'] } },
          attributes: ['created_at', 'updated_at', 'submissionDate'],
          include: [{ model: VisaType, as: 'visaType', attributes: ['name'] }],
          raw: true
        }).catch(() => []),

        Case.findAll({
          where: { ...cwWhere, status: { [Op.in]: ['Completed', 'Closed', 'Approved'] } },
          attributes: ['updated_at'],
          raw: true
        }).catch(() => [])
      ]);

      let totalDays = 0;
      let slaMetCount = 0;
      
      completedCaseStats.forEach(c => {
        if (c.created_at && c.updated_at) {
          const diffTime = Math.abs(new Date(c.updated_at) - new Date(c.created_at));
          totalDays += Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }
        if (isSlaMet(c, slaRules)) slaMetCount++;
      });

      const avgCompletionDays = completedCaseStats.length > 0 ? (totalDays / completedCaseStats.length).toFixed(1) : 0;
      const slaMetPct = completedCaseStats.length > 0 ? Math.round((slaMetCount / completedCaseStats.length) * 100) : 0;

      const monthlyTrend = Array(12).fill(0);
      const now = new Date();
      allCasesForTrend.forEach(c => {
        if (!c.updated_at) return;
        const d = new Date(c.updated_at);
        const monthDiff = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth();
        if (monthDiff >= 0 && monthDiff < 12) {
          monthlyTrend[11 - monthDiff]++;
        }
      });

      const clientSatisfaction = slaMetPct >= 90 ? 4.8 : slaMetPct >= 75 ? 4.2 : 3.5;

      return {
        id: `CW-${cw.id.toString().padStart(3, '0')}`,
        name: `${cw.first_name} ${cw.last_name}`,
        initials: `${cw.first_name?.[0] || ''}${cw.last_name?.[0] || ''}`.toUpperCase(),
        avatarBg: ['bg-blue-500','bg-green-500','bg-red-500','bg-purple-500','bg-amber-500'][cw.id % 5],
        department: 'Immigration',
        email: cw.email,
        joinDate: cw.createdAt ? new Date(cw.createdAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : 'Unknown',
        totalCases,
        activeCases,
        completedCases,
        slaMetPct,
        avgCompletionDays, 
        clientSatisfaction, 
        escalations,
        visaBreakdown: visaBreakdownRaw.map(v => ({ type: v.type || 'Unknown', count: parseInt(v.count) })),
        recentCases: recentCases.map(c => {
          let slaStatus = 'Met';
          const met = isSlaMet(c, slaRules);
          if (!met) {
            const isClosed = ['Completed', 'Closed', 'Approved'].includes(c.status);
            slaStatus = isClosed ? 'Breached' : 'Overdue';
          }
          
          return {
            id: c.caseId || `CS-${c.id}`,
            client: c.candidate ? `${c.candidate.first_name} ${c.candidate.last_name}` : 'Unknown Client',
            type: c.visaType?.name || 'Unknown',
            status: c.status,
            date: c.created_at ? new Date(c.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Unknown',
            sla: slaStatus 
          };
        }),
        monthlyTrend, 
      };
    })
  );

  return performanceData;
}

export const getPerformanceReport = async (req, res) => {
  try {
    const performanceData = await computePerformanceReportData(req);
    res.status(200).json({
      status: 'success',
      message: 'Performance report retrieved successfully',
      data: performanceData,
    });
  } catch (error) {
    console.error('getPerformanceReport Error:', error);
    res.status(500).json({ status: 'error', message: error.message, data: null });
  }
};

/** Multi-sheet workbook; reuses compute* payloads (same filters as JSON report APIs). */
export const exportReportingExcel = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const [cases, workload, financial, performance] = await Promise.all([
      computeCaseAnalyticsData(req).catch(() => null),
      computeWorkloadReportData(req).catch(() => null),
      computeFinancialReportData(req).catch(() => null),
      computePerformanceReportData(req).catch(() => null),
    ]);

    /** @type {{ name: string, columns: { key: string, header: string }[], rows: Record<string, unknown>[] }[]} */
    const sheets = [];

    sheets.push({
      name: 'Report_Info',
      columns: [
        { key: 'k', header: 'Key' },
        { key: 'v', header: 'Value' },
      ],
      rows: [
        { k: 'Generated_UTC', v: new Date().toISOString() },
        { k: 'StartDate', v: startDate || '' },
        { k: 'EndDate', v: endDate || '' },
      ],
    });

    if (cases?.summary) {
      sheets.push({
        name: 'Cases_Summary',
        columns: [
          { key: 'metric', header: 'Metric' },
          { key: 'value', header: 'Value' },
        ],
        rows: [
          { metric: 'TotalCases', value: cases.summary.totalCases },
          { metric: 'ThisMonth', value: cases.summary.thisMonth },
          { metric: 'LastMonth', value: cases.summary.lastMonth },
          {
            metric: 'MoM_ChangePct',
            value: cases.summary.momChangePct ?? '',
          },
          { metric: 'SLAMetPct', value: cases.summary.slaMetPct ?? '' },
        ],
      });
      sheets.push({
        name: 'Cases_Status',
        columns: [
          { key: 'status', header: 'Status' },
          { key: 'count', header: 'Count' },
        ],
        rows: (cases.statusBreakdown || []).map((s) => ({
          status: s.status,
          count: s.count,
        })),
      });
      sheets.push({
        name: 'Cases_ByVisa',
        columns: [
          { key: 'visaType', header: 'Visa Type' },
          { key: 'count', header: 'Count' },
        ],
        rows: (cases.byVisaType || []).map((v) => ({
          visaType: v.name,
          count: v.count,
        })),
      });
      sheets.push({
        name: 'Cases_MonthlyTrend',
        columns: [
          { key: 'month', header: 'Month' },
          { key: 'count', header: 'Count' },
        ],
        rows: (cases.monthlyTrend || []).map((m) => ({
          month:
            m.month instanceof Date ? m.month.toISOString() : String(m.month),
          count: m.count,
        })),
      });
    }

    if (workload?.caseworkers?.length) {
      sheets.push({
        name: 'Workload',
        columns: [
          { key: 'id', header: 'User ID' },
          { key: 'name', header: 'Name' },
          { key: 'email', header: 'Email' },
          { key: 'department', header: 'Department' },
          { key: 'totalCases', header: 'Total Cases' },
          { key: 'activeCases', header: 'Active' },
          { key: 'completedCases', header: 'Completed' },
          { key: 'slaMetCount', header: 'SLA Met Count' },
          { key: 'slaTotalCount', header: 'SLA Total' },
          { key: 'slaMetPct', header: 'SLA Met Pct' },
        ],
        rows: workload.caseworkers.map((w) => ({
          id: w.id,
          name: w.name,
          email: w.email,
          department: w.department,
          totalCases: w.totalCases,
          activeCases: w.activeCases,
          completedCases: w.completedCases,
          slaMetCount: w.slaMetCount,
          slaTotalCount: w.slaTotalCount,
          slaMetPct: w.slaMetPct,
        })),
      });
    }

    if (financial?.summary) {
      sheets.push({
        name: 'Finance_Summary',
        columns: [
          { key: 'metric', header: 'Metric' },
          { key: 'value', header: 'Value' },
        ],
        rows: [
          { metric: 'TotalRevenue', value: financial.summary.totalRevenue },
          { metric: 'TotalPaidRecords', value: financial.summary.totalPaid },
          {
            metric: 'TotalOutstanding',
            value: financial.summary.totalOutstanding,
          },
        ],
      });
      sheets.push({
        name: 'Finance_PaymentStatus',
        columns: [
          { key: 'status', header: 'Status' },
          { key: 'count', header: 'Count' },
          { key: 'total', header: 'Total Amount' },
        ],
        rows: (financial.statusBreakdown || []).map((s) => ({
          status: s.status,
          count: s.count,
          total: s.total,
        })),
      });
      sheets.push({
        name: 'Finance_ByVisa',
        columns: [
          { key: 'name', header: 'Visa Type' },
          { key: 'total', header: 'Revenue' },
        ],
        rows: financial.byVisaType || [],
      });
      sheets.push({
        name: 'Finance_BySponsor',
        columns: [
          { key: 'name', header: 'Sponsor' },
          { key: 'total', header: 'Revenue' },
        ],
        rows: financial.bySponsor || [],
      });
      sheets.push({
        name: 'Finance_Monthly',
        columns: [
          { key: 'month', header: 'Month' },
          { key: 'total', header: 'Total' },
          { key: 'count', header: 'Count' },
        ],
        rows: (financial.monthlyRevenue || []).map((m) => ({
          month:
            m.month instanceof Date ? m.month.toISOString() : String(m.month),
          total: m.total,
          count: m.count,
        })),
      });
    }

    if (Array.isArray(performance) && performance.length) {
      sheets.push({
        name: 'Performance_Team',
        columns: [
          { key: 'id', header: 'CW ID' },
          { key: 'name', header: 'Name' },
          { key: 'email', header: 'Email' },
          { key: 'department', header: 'Department' },
          { key: 'totalCases', header: 'Total Cases' },
          { key: 'activeCases', header: 'Active' },
          { key: 'completedCases', header: 'Completed' },
          { key: 'slaMetPct', header: 'SLA Met Pct' },
          { key: 'avgCompletionDays', header: 'Avg Days' },
          { key: 'clientSatisfaction', header: 'Satisfaction' },
          { key: 'escalations', header: 'Escalations' },
          { key: 'visaBreakdown', header: 'Visa Breakdown JSON' },
          { key: 'monthlyTrend', header: 'Monthly Trend JSON' },
        ],
        rows: performance.map((p) => ({
          id: p.id,
          name: p.name,
          email: p.email,
          department: p.department,
          totalCases: p.totalCases,
          activeCases: p.activeCases,
          completedCases: p.completedCases,
          slaMetPct: p.slaMetPct,
          avgCompletionDays: p.avgCompletionDays,
          clientSatisfaction: p.clientSatisfaction,
          escalations: p.escalations,
          visaBreakdown: JSON.stringify(p.visaBreakdown || []),
          monthlyTrend: JSON.stringify(p.monthlyTrend || []),
        })),
      });

      const recentFlat = [];
      for (const p of performance) {
        for (const c of p.recentCases || []) {
          recentFlat.push({
            caseworkerId: p.id,
            caseworkerName: p.name,
            caseId: c.id,
            client: c.client,
            visaType: c.type,
            status: c.status,
            date: c.date,
            sla: c.sla,
          });
        }
      }
      if (recentFlat.length) {
        sheets.push({
          name: 'Perf_RecentCases',
          columns: [
            { key: 'caseworkerId', header: 'CW ID' },
            { key: 'caseworkerName', header: 'Caseworker' },
            { key: 'caseId', header: 'Case ID' },
            { key: 'client', header: 'Client' },
            { key: 'visaType', header: 'Visa' },
            { key: 'status', header: 'Status' },
            { key: 'date', header: 'Date' },
            { key: 'sla', header: 'SLA' },
          ],
          rows: recentFlat,
        });
      }
    }

    const buffer = multiSheetXlsxBuffer(sheets);
    const day = new Date().toISOString().split('T')[0];
    sendXlsxDownload(res, buffer, `reports_${day}`);
  } catch (error) {
    console.error('exportReportingExcel Error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Export failed',
      data: null,
    });
  }
};

// ─── 6. Summary Dashboard KPIs ────────────────────────────────────────────────
export const getReportingSummary = async (req, res) => {
  try {
    const roleWhere = buildRoleWhere(req.user);
    const role = req.user?.role_name?.toLowerCase() || '';
    const userId = req.user?.userId;
    const isAdmin = role.includes('admin');
    
    const taskWhere = isAdmin ? {} : { assigned_to: userId };
    const escWhere = isAdmin ? {} : { assignedAdminId: userId };

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const paymentInclude = [{
      model: Case,
      attributes: [],
      where: roleWhere,
      required: true
    }];

    const [
      totalCases,
      thisMonthCases,
      lastMonthCases,
      totalUsers,
      totalPayment,
      pendingPayment,
      totalEscalations,
      openEscalations,
      totalTasks,
      completedTaskCount,
    ] = await Promise.all([
      Case.count({ where: roleWhere }).catch(() => 0),
      Case.count({ where: { created_at: { [Op.gte]: thisMonthStart }, ...roleWhere } }).catch(() => 0),
      Case.count({ where: { created_at: { [Op.between]: [lastMonthStart, lastMonthEnd] }, ...roleWhere } }).catch(() => 0),
      isAdmin ? User.count().catch(() => 0) : 0,
      CasePayment.findOne({
        where: { paymentStatus: 'completed' },
        include: paymentInclude,
        attributes: [[fn('SUM', col('amount')), 'total']],
        raw: true,
      }).catch(() => null),
      CasePayment.findOne({
        where: { paymentStatus: 'pending' },
        include: paymentInclude,
        attributes: [[fn('SUM', col('amount')), 'total']],
        raw: true,
      }).catch(() => null),
      Escalation.count({ where: escWhere }).catch(() => 0),
      Escalation.count({ where: { status: { [Op.in]: ['open', 'in_progress'] }, ...escWhere } }).catch(() => 0),
      Task.count({ where: taskWhere }).catch(() => 0),
      Task.count({ where: { status: 'completed', ...taskWhere } }).catch(() => 0),
    ]);

    res.status(200).json({
      status: 'success',
      message: 'Reporting summary retrieved successfully',
      data: {
        cases: {
          total: totalCases,
          thisMonth: thisMonthCases,
          lastMonth: lastMonthCases,
          momChangePct: momPct(thisMonthCases, lastMonthCases),
        },
        finance: {
          totalRevenue: parseFloat(totalPayment?.total || 0),
          outstanding:  parseFloat(pendingPayment?.total || 0),
        },
        escalations: {
          total: totalEscalations,
          open:  openEscalations,
        },
        tasks: {
          total: totalTasks,
          completed: completedTaskCount,
          completionRate: totalTasks > 0 ? Math.round((completedTaskCount / totalTasks) * 100) : null,
        },
        users: { total: totalUsers },
      },
    });
  } catch (error) {
    console.error('getReportingSummary Error:', error);
    res.status(500).json({ status: 'error', message: error.message, data: null });
  }
};
