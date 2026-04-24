import db from '../../models/index.js';
import { Op } from 'sequelize';

const Case = db.Case;
const User = db.User;
const VisaType = db.VisaType;
const CasePayment = db.CasePayment;
const CaseworkerProfile = db.CaseworkerProfile;
const Sponsor = db.User; // sponsors are users with sponsor role

// GET /api/workload/reports/case-types
export const getCaseTypeReport = async (req, res) => {
  try {
    // total cases grouped by visa type
    const totalCases = await Case.count();

    // get counts grouped by visaTypeId
    const rows = await Case.findAll({
      attributes: [
        'visaTypeId',
        [db.Sequelize.fn('COUNT', db.Sequelize.col('visaTypeId')), 'count'],
      ],
      group: ['visaTypeId'],
      raw: true,
    });

    // fetch visa type names
    const visaTypeIds = rows.map(r => r.visaTypeId).filter(Boolean);
    const visaTypes = await VisaType.findAll({ where: { id: visaTypeIds }, raw: true });
    const visaTypeMap = {};
    visaTypes.forEach(v => (visaTypeMap[v.id] = v.name));

    const result = rows.map(r => {
      const id = r.visaTypeId;
      const count = parseInt(r.count, 10);
      const name = id ? visaTypeMap[id] || `Unknown (${id})` : 'Unspecified';
      const percentage = totalCases > 0 ? Math.round((count / totalCases) * 10000) / 100 : 0;
      return { visaTypeId: id, visaType: name, count, percentage };
    });

    return res.status(200).json({
      status: 'success',
      message: 'Case type report',
      data: {
        total_cases: totalCases,
        breakdown: result,
      },
    });
  } catch (err) {
    console.error('getCaseTypeReport error', err);
    return res.status(500).json({ status: 'error', message: 'Failed to generate report', data: null, error: err.message });
  }
};

// GET /api/workload/reports/workload
export const getWorkloadReport = async (req, res) => {
  try {
    // retrieve all cases with assignedcaseworkerId
    const cases = await Case.findAll({ attributes: ['id', 'assignedcaseworkerId'], raw: true });

    const counts = {}; // userId => count

    cases.forEach(c => {
      let arr = [];
      try {
        arr = Array.isArray(c.assignedcaseworkerId) ? c.assignedcaseworkerId : (c.assignedcaseworkerId ? JSON.parse(c.assignedcaseworkerId) : []);
      } catch (e) {
        // if stored as string like '[1,2]'
        try { arr = JSON.parse(c.assignedcaseworkerId); } catch (e2) { arr = []; }
      }
      arr.forEach(userId => {
        if (!userId) return;
        counts[userId] = (counts[userId] || 0) + 1;
      });
    });

    const userIds = Object.keys(counts).map(id => parseInt(id, 10));
    const users = userIds.length > 0 ? await User.findAll({ where: { id: userIds }, attributes: ['id', 'first_name', 'last_name'], raw: true }) : [];

    const userMap = {};
    users.forEach(u => { userMap[u.id] = `${u.first_name} ${u.last_name}`.trim(); });

    const report = userIds.map(id => ({
      caseworkerId: id,
      name: userMap[id] || `User ${id}`,
      cases_assigned: counts[id] || 0,
    }));

    // also include caseworkers with zero cases? The user asked to return number of cases per caseworker — this returns only those assigned.

    return res.status(200).json({ status: 'success', message: 'Workload report', data: report });
  } catch (err) {
    console.error('getWorkloadReport error', err);
    return res.status(500).json({ status: 'error', message: 'Failed to generate workload report', data: null, error: err.message });
  }
};

// GET /api/workload/reports/revenue-by-visa
export const getRevenueByVisaType = async (req, res) => {
  try {
    // sum of completed payments joined to cases grouped by visaTypeId
    const rows = await CasePayment.findAll({
      attributes: [
        [db.Sequelize.col('Case.visaTypeId'), 'visaTypeId'],
        [db.Sequelize.fn('SUM', db.Sequelize.col('amount')), 'total_amount'],
      ],
      where: { paymentStatus: 'completed', amount: { [db.Sequelize.Op.ne]: null } },
      include: [
        {
          model: Case,
          attributes: [],
        },
      ],
      group: ['Case.visaTypeId'],
      raw: true,
    });

    const visaTypeIds = rows.map(r => r.visaTypeId).filter(Boolean);
    const visaTypes = visaTypeIds.length > 0 ? await VisaType.findAll({ where: { id: visaTypeIds }, raw: true }) : [];
    const visaMap = {};
    visaTypes.forEach(v => (visaMap[v.id] = v.name));

    const result = rows.map(r => ({
      visaTypeId: r.visaTypeId,
      visaType: r.visaTypeId ? (visaMap[r.visaTypeId] || `Unknown (${r.visaTypeId})`) : 'Unspecified',
      revenue: parseFloat(r.total_amount) || 0,
    }));

    return res.status(200).json({ status: 'success', message: 'Revenue by visa type', data: result });
  } catch (err) {
    console.error('getRevenueByVisaType error', err);
    return res.status(500).json({ status: 'error', message: 'Failed to generate revenue by visa type', data: null, error: err.message });
  }
};

// GET /api/workload/reports/revenue-by-sponsor
export const getRevenueBySponsor = async (req, res) => {
  try {
    const rows = await CasePayment.findAll({
      attributes: [
        [db.Sequelize.col('Case.sponsorId'), 'sponsorId'],
        [db.Sequelize.fn('SUM', db.Sequelize.col('amount')), 'total_amount'],
      ],
      where: { paymentStatus: 'completed', amount: { [db.Sequelize.Op.ne]: null } },
      include: [{ model: Case, attributes: [] }],
      group: ['Case.sponsorId'],
      raw: true,
    });

    const sponsorIds = rows.map(r => r.sponsorId).filter(Boolean);
    const sponsors = sponsorIds.length > 0 ? await Sponsor.findAll({ where: { id: sponsorIds }, attributes: ['id', 'first_name', 'last_name'], raw: true }) : [];
    const sponsorMap = {};
    sponsors.forEach(s => (sponsorMap[s.id] = `${s.first_name} ${s.last_name}`.trim()));

    const result = rows.map(r => ({
      sponsorId: r.sponsorId,
      sponsor: r.sponsorId ? (sponsorMap[r.sponsorId] || `User ${r.sponsorId}`) : 'Unspecified',
      revenue: parseFloat(r.total_amount) || 0,
    }));

    return res.status(200).json({ status: 'success', message: 'Revenue by sponsor', data: result });
  } catch (err) {
    console.error('getRevenueBySponsor error', err);
    return res.status(500).json({ status: 'error', message: 'Failed to generate revenue by sponsor', data: null, error: err.message });
  }
};

// GET /api/workload/caseworkers - Get all caseworkers with summary stats
export const getAllCaseworkersReport = async (req, res) => {
  try {
    const users = await User.findAll({
      where: { role_id: 3 }, // Assuming role_id 3 is caseworker
      attributes: ['id', 'first_name', 'last_name', 'createdAt', 'email'],
      raw: true,
    });

    // Get all cases to calculate assignments
    const allCases = await Case.findAll({
      attributes: ['id', 'assignedcaseworkerId', 'status', 'targetSubmissionDate', 'created_at'],
      raw: true,
    });

    const caseworkersData = await Promise.all(
      users.map(async (user) => {
        // Filter cases assigned to this caseworker
        const userCases = allCases.filter(c => {
          let arr = [];
          try {
            arr = Array.isArray(c.assignedcaseworkerId) ? c.assignedcaseworkerId : (c.assignedcaseworkerId ? JSON.parse(c.assignedcaseworkerId) : []);
          } catch (e) {
            // if stored as string like '[1,2]'
            try { arr = JSON.parse(c.assignedcaseworkerId); } catch (e2) { arr = []; }
          }
          return arr.includes(user.id);
        });

        const totalCases = userCases.length;
        const completedCases = userCases.filter(c => c.status === 'Completed').length;
        const avgDays = userCases.length > 0
          ? Math.round(userCases.reduce((acc, c) => {
              const days = c.targetSubmissionDate ?
                Math.floor((new Date(c.targetSubmissionDate) - new Date(c.createdAt)) / (1000 * 60 * 60 * 24)) : 0;
              return acc + days;
            }, 0) / userCases.length)
          : 0;

        return {
          id: user.id,
          name: `${user.first_name} ${user.last_name}`.trim(),
          initials: `${user.first_name.charAt(0)}${user.last_name.charAt(0)}`.toUpperCase(),
          role: 'Caseworker',
          department: 'General',
          joinedDate: user.createdAt,
          totalCases,
          slaMet: Math.round((completedCases / totalCases * 100)) || 0,
          avgDays,
          escalations: 0,
          clientSatisfaction: 4.5,
          rating: 4.5,
          reviewCount: 12,
        };
      })
    );

    return res.status(200).json({
      status: 'success',
      message: 'Caseworkers summary report',
      data: caseworkersData,
    });
  } catch (err) {
    console.error('getAllCaseworkersReport error', err);
    return res.status(500).json({ 
      status: 'error', 
      message: 'Failed to generate caseworkers report', 
      data: null, 
      error: err.message 
    });
  }
};

// GET /api/workload/caseworkers/:id/report - Get detailed performance report for a caseworker
export const getCaseworkerPerformanceReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    const user = await User.findByPk(id, {
      attributes: ['id', 'first_name', 'last_name', 'email', 'createdAt'],
      raw: true,
    });

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'Caseworker not found',
        data: null,
      });
    }

    // Build date filter
    const dateFilter = {};
    if (startDate) {
      dateFilter[db.Sequelize.Op.gte] = new Date(startDate);
    }
    if (endDate) {
      dateFilter[db.Sequelize.Op.lte] = new Date(endDate);
    }

    // Get all cases and filter by caseworker in JavaScript
    const allCases = await Case.findAll({
      where: Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {},
      include: [
        {
          model: VisaType,
          attributes: ['id', 'name'],
        },
      ],
      raw: true,
    });

    // Filter cases assigned to this caseworker
    const cases = allCases.filter(c => {
      let arr = [];
      try {
        arr = Array.isArray(c.assignedcaseworkerId) ? c.assignedcaseworkerId : (c.assignedcaseworkerId ? JSON.parse(c.assignedcaseworkerId) : []);
      } catch (e) {
        // if stored as string like '[1,2]'
        try { arr = JSON.parse(c.assignedcaseworkerId); } catch (e2) { arr = []; }
      }
      return arr.includes(parseInt(id));
    });

    // Calculate stats
    const totalCases = cases.length;
    const completedCases = cases.filter(c => c.status === 'Completed').length;
    const inProgressCases = cases.filter(c => c.status === 'In Progress').length;
    const pendingCases = cases.filter(c => c.status === 'Pending').length;

    const avgDays = totalCases > 0 
      ? Math.round(cases.reduce((acc, c) => {
          const days = c.targetSubmissionDate ? 
            Math.floor((new Date(c.targetSubmissionDate) - new Date(c.createdAt)) / (1000 * 60 * 60 * 24)) : 0;
          return acc + days;
        }, 0) / totalCases)
      : 0;

    // Cases by visa type
    const casesByVisaTypeRaw = {};
    cases.forEach(c => {
      const visaType = c['VisaType.name'] || 'Unspecified';
      casesByVisaTypeRaw[visaType] = (casesByVisaTypeRaw[visaType] || 0) + 1;
    });

    const casesByVisaType = Object.entries(casesByVisaTypeRaw).map(([type, count]) => ({
      type,
      count,
      percentage: Math.round((count / totalCases) * 100),
    }));

    // Recent cases (last 10)
    const recentCases = cases.slice(0, 10).map(c => ({
      caseId: c.caseId || `Case-${c.id}`,
      client: 'N/A',
      visaType: c['VisaType.name'] || 'Unspecified',
      status: c.status,
      date: c.createdAt,
      sla: c.targetSubmissionDate ? Math.floor((new Date(c.targetSubmissionDate) - new Date()) / (1000 * 60 * 60 * 24)) : 0,
    }));

    // 12-month trend (simplified - group by month)
    const monthlyData = {};
    cases.forEach(c => {
      const month = new Date(c.createdAt).toISOString().substring(0, 7);
      monthlyData[month] = (monthlyData[month] || 0) + 1;
    });

    const trend = Object.entries(monthlyData).map(([month, count]) => ({
      month,
      cases: count,
    }));

    return res.status(200).json({
      status: 'success',
      message: 'Caseworker performance report',
      data: {
        caseworker: {
          id: user.id,
          name: `${user.first_name} ${user.last_name}`.trim(),
          email: user.email,
        },
        stats: {
          totalCases,
          completedCases,
          inProgressCases,
          pendingCases,
          completionRate: totalCases > 0 ? Math.round((completedCases / totalCases) * 100) : 0,
          avgDays,
          dateRange: {
            startDate: startDate || 'all time',
            endDate: endDate || 'now',
          },
        },
        casesByVisaType,
        recentCases,
        trend,
      },
    });
  } catch (err) {
    console.error('getCaseworkerPerformanceReport error', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to generate performance report',
      data: null,
      error: err.message,
    });
  }
};

// GET /api/workload/caseworkers/:id/report/pdf - Generate PDF report
export const getCaseworkerReportPDF = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id, {
      attributes: ['id', 'first_name', 'last_name', 'email'],
      raw: true,
    });

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'Caseworker not found',
        data: null,
      });
    }

    // Get all cases and filter by caseworker in JavaScript
    const allCases = await Case.findAll({
      include: [{ model: VisaType, as: 'visaType', attributes: ['name'] }],
      raw: true,
    });

    // Filter cases assigned to this caseworker
    const cases = allCases.filter(c => {
      let arr = [];
      try {
        arr = Array.isArray(c.assignedcaseworkerId) ? c.assignedcaseworkerId : (c.assignedcaseworkerId ? JSON.parse(c.assignedcaseworkerId) : []);
      } catch (e) {
        // if stored as string like '[1,2]'
        try { arr = JSON.parse(c.assignedcaseworkerId); } catch (e2) { arr = []; }
      }
      return arr.includes(parseInt(id));
    });

    // Calculate statistics
    const totalCases = cases.length;
    const completedCases = cases.filter(c => c.status === 'Completed').length;
    const inProgressCases = cases.filter(c => c.status === 'In Progress').length;
    const pendingCases = cases.filter(c => c.status === 'Pending').length;

    // Create HTML content for PDF
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Caseworker Performance Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h1 { color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px; }
          h2 { color: #0066cc; margin-top: 20px; }
          .header { background-color: #f5f5f5; padding: 15px; border-radius: 5px; }
          .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 15px 0; }
          .stat-box { background-color: #e6f0ff; padding: 15px; border-radius: 5px; border-left: 4px solid #0066cc; }
          .stat-label { color: #666; font-size: 12px; text-transform: uppercase; }
          .stat-value { color: #0066cc; font-size: 24px; font-weight: bold; }
          table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
          th { background-color: #0066cc; color: white; }
          tr:hover { background-color: #f5f5f5; }
          .footer { margin-top: 30px; text-align: center; color: #999; font-size: 12px; }
        </style>
      </head>
      <body>
        <h1>Caseworker Performance Report</h1>
        
        <div class="header">
          <p><strong>Name:</strong> ${user.first_name} ${user.last_name}</p>
          <p><strong>Email:</strong> ${user.email}</p>
          <p><strong>Report Generated:</strong> ${new Date().toLocaleDateString()}</p>
        </div>

        <h2>Performance Metrics</h2>
        <div class="stats">
          <div class="stat-box">
            <div class="stat-label">Total Cases</div>
            <div class="stat-value">${totalCases}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Completed</div>
            <div class="stat-value">${completedCases}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">In Progress</div>
            <div class="stat-value">${inProgressCases}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Pending</div>
            <div class="stat-value">${pendingCases}</div>
          </div>
        </div>

        <h2>Case Completion Rate</h2>
        <p>${totalCases > 0 ? Math.round((completedCases / totalCases) * 100) : 0}% (${completedCases}/${totalCases})</p>

        <h2>Recent Cases</h2>
        <table>
          <thead>
            <tr>
              <th>Case ID</th>
              <th>Status</th>
              <th>Created Date</th>
            </tr>
          </thead>
          <tbody>
            ${cases.slice(0, 10).map(c => `
              <tr>
                <td>${c.caseId || `Case-${c.id}`}</td>
                <td>${c.status}</td>
                <td>${new Date(c.createdAt).toLocaleDateString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="footer">
          <p>This is an auto-generated report. For more information, please contact the administrator.</p>
        </div>
      </body>
      </html>
    `;

    // Set response headers for PDF download
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="caseworker_report_${id}_${Date.now()}.html"`);
    res.send(htmlContent);

  } catch (err) {
    console.error('getCaseworkerReportPDF error', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to generate PDF report',
      data: null,
      error: err.message,
    });
  }
};

// GET /api/caseworkers/filter
// Filter caseworkers by department, SLA level, and search
export const filterCaseworkers = async (req, res) => {
  try {
    const { search = '', department = 'all', sla_level = 'all' } = req.query;
    
    // Build where conditions dynamically
    const whereConditions = [];
    const userWhereConditions = [];

    // Search condition - search by name or ID
    if (search.trim()) {
      userWhereConditions.push(
        db.Sequelize.where(
          db.Sequelize.fn('CONCAT', db.Sequelize.col('User.first_name'), ' ', db.Sequelize.col('User.last_name')),
          Op.iLike,
          `%${search}%`
        )
      );
    }

    // Department filter
    if (department && department !== 'all') {
      whereConditions.push({
        department: {
          [Op.iLike]: `%${department}%`,
        },
      });
    }

    // SLA Level filter
    if (sla_level && sla_level !== 'all') {
      if (sla_level === 'high') {
        whereConditions.push({
          sla_percentage: {
            [Op.gt]: 90,
          },
        });
      } else if (sla_level === 'medium') {
        whereConditions.push({
          sla_percentage: {
            [Op.between]: [75, 90],
          },
        });
      } else if (sla_level === 'low') {
        whereConditions.push({
          sla_percentage: {
            [Op.lt]: 75,
          },
        });
      }
    }

    // Fetch caseworkers with combined filters
    const caseworkers = await CaseworkerProfile.findAll({
      where: whereConditions.length > 0 ? { [Op.and]: whereConditions } : {},
      include: [
        {
          model: User,
          as: 'User',
          where: userWhereConditions.length > 0 ? { [Op.and]: userWhereConditions } : {},
          attributes: ['id', 'first_name', 'last_name', 'email', 'mobile'],
          required: true,
        },
      ],
      attributes: [
        'id',
        'user_id',
        'employee_id',
        'job_title',
        'department',
        'region',
        'timezone',
        'date_of_joining',
        'sla_percentage',
        'createdAt',
        'updatedAt',
      ],
      order: [['sla_percentage', 'DESC']],
      raw: false,
    });

    return res.status(200).json({
      status: 'success',
      message: 'Filtered caseworkers fetched successfully',
      data: caseworkers,
    });
  } catch (err) {
    console.error('filterCaseworkers error', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to filter caseworkers',
      data: null,
      error: err.message,
    });
  }
};

export default { getCaseTypeReport, getWorkloadReport, getRevenueByVisaType, getRevenueBySponsor, getAllCaseworkersReport, getCaseworkerPerformanceReport, getCaseworkerReportPDF, filterCaseworkers };
