import db from '../../models/index.js';
import { Op, fn, col, literal } from 'sequelize';

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
export const getCaseAnalytics = async (req, res) => {
  try {
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

    res.status(200).json({
      status: 'success',
      message: 'Case analytics retrieved successfully',
      data: {
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
      },
    });
  } catch (error) {
    console.error('getCaseAnalytics Error:', error);
    res.status(500).json({ status: 'error', message: error.message, data: null });
  }
};

// ─── 2. Caseworker Workload Report ────────────────────────────────────────────
// Note: This report mainly makes sense for Admins to view caseworkers.
// If a Caseworker views this, they might only see themselves.
export const getWorkloadReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const dateWhere = buildCaseDateWhere(startDate, endDate);
    const slaRules = await SlaRule.findAll().catch(() => []);
    
    // Determine which caseworkers to fetch based on role
    const role = req.user?.role_name?.toLowerCase() || '';
    let userFilter = { name: { [Op.iLike]: '%caseworker%' } };
    
    if (!role.includes('admin')) {
      // If not an admin, we only show their own workload data (if they are a caseworker)
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

    res.status(200).json({
      status: 'success',
      message: 'Workload report retrieved successfully',
      data: { caseworkers: workloadData, total: workloadData.length },
    });
  } catch (error) {
    console.error('getWorkloadReport Error:', error);
    res.status(500).json({ status: 'error', message: error.message, data: null });
  }
};

// ─── 3. Financial Report ──────────────────────────────────────────────────────
export const getFinancialReport = async (req, res) => {
  try {
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

    const [revenueResult, outstandingResult, monthlyRevenue, statusBreakdown] = await Promise.all([
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
    ]);

    res.status(200).json({
      status: 'success',
      message: 'Financial report retrieved successfully',
      data: {
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
      },
    });
  } catch (error) {
    console.error('getFinancialReport Error:', error);
    res.status(500).json({ status: 'error', message: error.message, data: null });
  }
};

// ─── 4. Performance / KPI Report ─────────────────────────────────────────────
export const getPerformanceReport = async (req, res) => {
  try {
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
        
        // Parallel queries per caseworker
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
          
          // Visa Breakdown
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

          // Recent cases
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

          // Escalations
          Escalation.count({ where: { assignedAdminId: cw.id } }).catch(() => 0),

          // Completed cases stats for SLA and Avg Days
          Case.findAll({
            where: { ...cwWhere, ...dateWhere, status: { [Op.in]: ['Completed', 'Closed', 'Approved'] } },
            attributes: ['created_at', 'updated_at', 'submissionDate'],
            include: [{ model: VisaType, as: 'visaType', attributes: ['name'] }],
            raw: true
          }).catch(() => []),

          // Last 12 months cases for Trend (using created_at or updated_at)
          Case.findAll({
            where: { ...cwWhere, status: { [Op.in]: ['Completed', 'Closed', 'Approved'] } },
            attributes: ['updated_at'],
            raw: true
          }).catch(() => [])
        ]);

        // Calculate Average Days and SLA
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

        // Calculate Monthly Trend array (12 months)
        const monthlyTrend = Array(12).fill(0);
        const now = new Date();
        allCasesForTrend.forEach(c => {
          if (!c.updated_at) return;
          const d = new Date(c.updated_at);
          const monthDiff = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth();
          if (monthDiff >= 0 && monthDiff < 12) {
            monthlyTrend[11 - monthDiff]++; // index 11 is current month, 0 is 11 months ago
          }
        });

        // Mock Satisfaction based on SLA
        const clientSatisfaction = slaMetPct >= 90 ? 4.8 : slaMetPct >= 75 ? 4.2 : 3.5;

        return {
          id: `CW-${cw.id.toString().padStart(3, '0')}`,
          name: `${cw.first_name} ${cw.last_name}`,
          initials: `${cw.first_name?.[0] || ''}${cw.last_name?.[0] || ''}`.toUpperCase(),
          avatarBg: ['bg-blue-500','bg-green-500','bg-red-500','bg-purple-500','bg-amber-500'][cw.id % 5],
          department: 'Immigration', // default
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

    res.status(200).json({
      status: 'success',
      message: 'Performance report retrieved successfully',
      data: performanceData
    });
  } catch (error) {
    console.error('getPerformanceReport Error:', error);
    res.status(500).json({ status: 'error', message: error.message, data: null });
  }
};

// ─── 5. Summary Dashboard KPIs ────────────────────────────────────────────────
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
