import db from '../../models/index.js';
import { Op } from 'sequelize';
import PDFDocument from 'pdfkit';

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
      return { type: name, count, percentage };
    });

    return res.status(200).json({
      status: 'success',
      message: 'Case type report',
      data: {
        cases: result,
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
    // Get all caseworkers (role_id = 3)
    const users = await User.findAll({
      where: { role_id: 3 },
      attributes: ['id', 'first_name', 'last_name', 'email'],
      raw: true,
    });

    // Get all cases
    const allCases = await Case.findAll({
      attributes: ['id', 'assignedcaseworkerId', 'status', 'targetSubmissionDate', 'created_at'],
      raw: true,
    });

    const report = users.map(user => {
      // Filter cases assigned to this caseworker
      const userCases = allCases.filter(c => {
        let arr = [];
        try {
          arr = Array.isArray(c.assignedcaseworkerId) ? c.assignedcaseworkerId : (c.assignedcaseworkerId ? JSON.parse(c.assignedcaseworkerId) : []);
        } catch (e) {
          try { arr = JSON.parse(c.assignedcaseworkerId); } catch (e2) { arr = []; }
        }
        return arr.includes(user.id);
      });

      const activeCases = userCases.filter(c => c.status !== 'Completed').length;
      const completedCases = userCases.filter(c => c.status === 'Completed').length;
      const overdueCases = userCases.filter(c => {
        const isOverdue = c.targetSubmissionDate && new Date(c.targetSubmissionDate) < new Date() && c.status !== 'Completed';
        return isOverdue;
      }).length;

      const workloadPercentage = userCases.length > 0
        ? Math.round((completedCases / userCases.length) * 100)
        : 0;

      const healthStatus = workloadPercentage >= 80 ? 'healthy' : workloadPercentage >= 60 ? 'moderate' : 'stressed';

      return {
        caseworker_id: user.id,
        caseworker_name: `${user.first_name} ${user.last_name}`.trim(),
        email: user.email,
        active_cases: activeCases,
        overdue: overdueCases,
        tasks_pending: activeCases,
        workload_percentage: workloadPercentage,
        health_status: healthStatus,
        health_color: healthStatus === 'healthy' ? 'green' : healthStatus === 'moderate' ? 'amber' : 'red',
      };
    });

    return res.status(200).json({
      status: 'success',
      message: 'Workload report',
      data: { caseworkers: report },
    });
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
      visa_type: r.visaTypeId ? (visaMap[r.visaTypeId] || `Unknown (${r.visaTypeId})`) : 'Unspecified',
      total_amount: parseFloat(r.total_amount) || 0,
    }));

    return res.status(200).json({
      status: 'success',
      message: 'Revenue by visa type',
      data: { revenue: result },
    });
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
      sponsor_name: r.sponsorId ? (sponsorMap[r.sponsorId] || `User ${r.sponsorId}`) : 'Unspecified',
      total_amount: parseFloat(r.total_amount) || 0,
    }));

    return res.status(200).json({
      status: 'success',
      message: 'Revenue by sponsor',
      data: { revenue: result },
    });
  } catch (err) {
    console.error('getRevenueBySponsor error', err);
    return res.status(500).json({ status: 'error', message: 'Failed to generate revenue by sponsor', data: null, error: err.message });
  }
};

// GET /api/workload/caseworkers - Get all caseworkers with summary stats
export const getAllCaseworkersReport = async (req, res) => {
  try {
    const users = await User.findAll({
      where: { role_id: 2 }, // Caseworker role
      attributes: ['id', 'first_name', 'last_name','email'],
      raw: true,
    });

    // Get all cases to calculate assignments
    const allCases = await Case.findAll({
      attributes: ['id', 'assignedcaseworkerId', 'status', 'targetSubmissionDate', 'created_at'],
      raw: true,
    });

    const caseworkersData = users.map((user) => {
      // Filter cases assigned to this caseworker
      const userCases = allCases.filter(c => {
        let arr = [];
        try {
          arr = Array.isArray(c.assignedcaseworkerId) ? c.assignedcaseworkerId : (c.assignedcaseworkerId ? JSON.parse(c.assignedcaseworkerId) : []);
        } catch (e) {
          try { arr = JSON.parse(c.assignedcaseworkerId); } catch (e2) { arr = []; }
        }
        return arr.includes(user.id);
      });

      const activeCases = userCases.filter(c => c.status !== 'Completed').length;
      const completedCases = userCases.filter(c => c.status === 'Completed').length;
      const totalCases = userCases.length;
      
      const workloadPercentage = totalCases > 0
        ? Math.round((completedCases / totalCases) * 100)
        : 0;

      const healthStatus = workloadPercentage >= 80 ? 'healthy' : workloadPercentage >= 60 ? 'moderate' : 'stressed';

      return {
        caseworker_id: user.id,
        id: user.id,
        name: `${user.first_name} ${user.last_name}`.trim(),
        email: user.email,
        department: 'General',
        active_cases: activeCases,
        completed_cases: completedCases,
        workload_percentage: workloadPercentage,
        health_status: healthStatus,
        initials: `${user.first_name.charAt(0)}${user.last_name.charAt(0)}`.toUpperCase(),
      };
    });

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
      attributes: ['id', 'first_name', 'last_name', 'email',],
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
      where: Object.keys(dateFilter).length > 0 ? { created_at: dateFilter } : {},
      include: [
        {
          model: VisaType,
          as: 'visaType',
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
        try { arr = JSON.parse(c.assignedcaseworkerId); } catch (e2) { arr = []; }
      }
      return arr.includes(parseInt(id));
    });

    // Calculate stats
    const totalCases = cases.length;
    const completedCases = cases.filter(c => c.status === 'Completed').length;
    const inProgressCases = cases.filter(c => c.status === 'In Progress').length;
    const pendingCases = cases.filter(c => c.status === 'Pending').length;

    const slaMetPct = totalCases > 0 ? Math.round((completedCases / totalCases) * 100) : 0;

    const avgCompletionDays = totalCases > 0 
      ? Math.round(cases.reduce((acc, c) => {
          const days = c.targetSubmissionDate ? 
            Math.floor((new Date(c.targetSubmissionDate) - new Date(c.created_at)) / (1000 * 60 * 60 * 24)) : 0;
          return acc + days;
        }, 0) / totalCases)
      : 0;

    // Cases by visa type
    const casesByVisaTypeRaw = {};
    cases.forEach(c => {
      const visaType = c['visaType.name'] || 'Unspecified';
      casesByVisaTypeRaw[visaType] = (casesByVisaTypeRaw[visaType] || 0) + 1;
    });

    const visaBreakdown = Object.entries(casesByVisaTypeRaw).map(([type, count]) => ({
      type,
      count,
      percentage: totalCases > 0 ? Math.round((count / totalCases) * 100) : 0,
    }));

    // Recent cases (last 10)
    const recentCases = cases.slice(0, 10).map(c => ({
      id: c.id,
      caseId: c.caseId || `Case-${c.id}`,
      client: 'Client N/A',
      type: c['visaType.name'] || 'Unspecified',
      status: c.status,
      date: c.created_at ? new Date(c.created_at).toLocaleDateString('en-GB') : 'N/A',
      sla: c.status === 'Completed' ? 'Met' : (c.targetSubmissionDate && new Date(c.targetSubmissionDate) < new Date() ? 'Breached' : 'On Track'),
    }));

    // 12-month trend - generate data for last 12 months
    const monthlyTrend = [];
    for (let i = 11; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const month = date.toISOString().substring(0, 7);
      const count = cases.filter(c => new Date(c.created_at).toISOString().substring(0, 7) === month).length;
      monthlyTrend.push(count);
    }

    // Avatar color based on performance
    const avatarColors = ['bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-amber-500', 'bg-red-500'];
    const avatarBg = avatarColors[parseInt(id) % avatarColors.length];

    // Calculate client satisfaction (mock data based on completion rate)
    const clientSatisfaction = (slaMetPct / 20) + 1; // Scale 1-5

    return res.status(200).json({
      status: 'success',
      message: 'Caseworker performance report',
      data: {
        id: user.id,
        name: `${user.first_name} ${user.last_name}`.trim(),
        initials: `${user.first_name.charAt(0)}${user.last_name.charAt(0)}`.toUpperCase(),
        email: user.email,
        department: 'General',
        joinDate: new Date(user.created_at).toLocaleDateString('en-GB'),
        avatarBg,
        
        // Performance metrics
        totalCases,
        completedCases,
        slaMetPct,
        avgCompletionDays,
        escalations: Math.floor(Math.random() * 3), // Mock escalation count
        clientSatisfaction: Math.min(5, Math.max(1, clientSatisfaction)),
        
        // Breakdowns and trends
        visaBreakdown,
        recentCases,
        monthlyTrend,
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

    // Generate PDF using PDFKit
    const pdf = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="caseworker_report_${id}_${Date.now()}.pdf"`);
    pdf.pipe(res);

    // Add content to PDF
    pdf.fontSize(20).font('Helvetica-Bold').text('Caseworker Performance Report', { align: 'center' });
    pdf.moveDown(0.5);
    pdf.fontSize(10).font('Helvetica').text(`Generated: ${new Date().toLocaleDateString()}`, { align: 'center' });
    pdf.moveDown(1);

    // User Info
    pdf.fontSize(12).font('Helvetica-Bold').text('Caseworker Information');
    pdf.fontSize(10).font('Helvetica');
    pdf.text(`Name: ${user.first_name} ${user.last_name}`);
    pdf.text(`Email: ${user.email}`);
    pdf.moveDown(0.5);

    // Performance Metrics
    pdf.fontSize(12).font('Helvetica-Bold').text('Performance Metrics');
    pdf.fontSize(10).font('Helvetica');
    pdf.text(`Total Cases: ${totalCases}`);
    pdf.text(`Completed Cases: ${completedCases}`);
    pdf.text(`In Progress: ${inProgressCases}`);
    pdf.text(`Pending: ${pendingCases}`);
    pdf.text(`Case Completion Rate: ${totalCases > 0 ? Math.round((completedCases / totalCases) * 100) : 0}%`);
    pdf.moveDown(0.5);

    // Recent Cases Table
    pdf.fontSize(12).font('Helvetica-Bold').text('Recent Cases');
    pdf.fontSize(9).font('Helvetica');
    pdf.moveDown(0.3);
    
    const tableTop = pdf.y;
    const col1 = 50;
    const col2 = 150;
    const col3 = 300;
    const rowHeight = 20;

    // Table header
    pdf.font('Helvetica-Bold');
    pdf.text('Case ID', col1, tableTop);
    pdf.text('Status', col2, tableTop);
    pdf.text('Created Date', col3, tableTop);
    
    // Table rows
    pdf.font('Helvetica');
    cases.slice(0, 10).forEach((c, i) => {
      const y = tableTop + ((i + 1) * rowHeight);
      pdf.text(c.caseId || `Case-${c.id}`, col1, y);
      pdf.text(c.status, col2, y);
      pdf.text(new Date(c.created_at).toLocaleDateString(), col3, y);
    });

    pdf.moveDown(2);
    pdf.fontSize(9).font('Helvetica').text('This is an auto-generated report. For more information, please contact the administrator.', { align: 'center' });
    
    pdf.end();

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

// GET /api/workload/reports/export-pdf - Export combined PDF report
export const exportCombinedPDFReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Validate dates
    if (!startDate || !endDate) {
      return res.status(400).json({
        status: 'error',
        message: 'startDate and endDate are required',
        data: null,
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999); // Include the entire end date

    const dateFilter = {
      [Op.between]: [start, end],
    };

    // ===== FETCH DATA FOR ALL REPORTS =====

    // 1. CASE REPORT DATA
    const totalCases = await Case.count({
      where: { created_at: dateFilter },
    });

    const casesByVisaTypeRaw = await Case.findAll({
      attributes: [
        'visaTypeId',
        [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'count'],
      ],
      where: { created_at: dateFilter },
      group: ['visaTypeId'],
      raw: true,
    });

    const visaTypeIds = casesByVisaTypeRaw.map(r => r.visaTypeId).filter(Boolean);
    const visaTypes = visaTypeIds.length > 0 ? await VisaType.findAll({ where: { id: visaTypeIds }, raw: true }) : [];
    const visaTypeMap = {};
    visaTypes.forEach(v => (visaTypeMap[v.id] = v.name));

    const caseReport = casesByVisaTypeRaw.map(r => {
      const count = parseInt(r.count, 10);
      const percentage = totalCases > 0 ? Math.round((count / totalCases) * 10000) / 100 : 0;
      return {
        visaType: r.visaTypeId ? (visaTypeMap[r.visaTypeId] || `Unknown (${r.visaTypeId})`) : 'Unspecified',
        count,
        percentage,
      };
    }).sort((a, b) => b.count - a.count);

    const casesForWorkload = await Case.findAll({
      attributes: ['id', 'assignedcaseworkerId', 'status'],
      where: { created_at: dateFilter },
      raw: true,
    });

    const workloadData = {};
    casesForWorkload.forEach(c => {
      let arr = [];
      try {
        arr = Array.isArray(c.assignedcaseworkerId) ? c.assignedcaseworkerId : (c.assignedcaseworkerId ? JSON.parse(c.assignedcaseworkerId) : []);
      } catch (e) {
        try { arr = JSON.parse(c.assignedcaseworkerId); } catch (e2) { arr = []; }
      }
      arr.forEach(userId => {
        if (!userId) return;
        if (!workloadData[userId]) {
          workloadData[userId] = { total: 0, active: 0, completed: 0 };
        }
        workloadData[userId].total += 1;
        if (c.status === 'Completed') {
          workloadData[userId].completed += 1;
        } else if (c.status === 'In Progress' || c.status === 'Pending') {
          workloadData[userId].active += 1;
        }
      });
    });

    const userIds = Object.keys(workloadData).map(id => parseInt(id, 10));
    const users = userIds.length > 0 ? await User.findAll({ where: { id: userIds }, attributes: ['id', 'first_name', 'last_name'], raw: true }) : [];
    const userMap = {};
    users.forEach(u => { userMap[u.id] = `${u.first_name} ${u.last_name}`.trim(); });

    const workloadReport = Object.entries(workloadData).map(([userId, data]) => ({
      caseworker: userMap[userId] || `User ${userId}`,
      totalCases: data.total,
      activeCases: data.active,
      completedCases: data.completed,
    })).sort((a, b) => b.totalCases - a.totalCases);

    const revenueByVisaType = await CasePayment.findAll({
      attributes: [
        [db.Sequelize.col('Case.visaTypeId'), 'visaTypeId'],
        [db.Sequelize.fn('SUM', db.Sequelize.col('amount')), 'total_amount'],
      ],
      where: { paymentStatus: 'completed', amount: { [Op.ne]: null }, created_at: dateFilter },
      include: [{ model: Case, attributes: [] }],
      group: ['Case.visaTypeId'],
      raw: true,
    });

    const visaTypeIdsFinance = revenueByVisaType.map(r => r.visaTypeId).filter(Boolean);
    const visaTypesFinance = visaTypeIdsFinance.length > 0 ? await VisaType.findAll({ where: { id: visaTypeIdsFinance }, raw: true }) : [];
    const visaMapFinance = {};
    visaTypesFinance.forEach(v => (visaMapFinance[v.id] = v.name));

    const financialReportByVisa = revenueByVisaType.map(r => ({
      visaType: r.visaTypeId ? (visaMapFinance[r.visaTypeId] || `Unknown (${r.visaTypeId})`) : 'Unspecified',
      revenue: parseFloat(r.total_amount) || 0,
    })).sort((a, b) => b.revenue - a.revenue);

    const revenueBySponsor = await CasePayment.findAll({
      attributes: [
        [db.Sequelize.col('Case.sponsorId'), 'sponsorId'],
        [db.Sequelize.fn('SUM', db.Sequelize.col('amount')), 'total_amount'],
      ],
      where: { paymentStatus: 'completed', amount: { [Op.ne]: null }, created_at: dateFilter },
      include: [{ model: Case, attributes: [] }],
      group: ['Case.sponsorId'],
      raw: true,
    });

    const sponsorIds = revenueBySponsor.map(r => r.sponsorId).filter(Boolean);
    const sponsors = sponsorIds.length > 0 ? await User.findAll({ where: { id: sponsorIds }, attributes: ['id', 'first_name', 'last_name'], raw: true }) : [];
    const sponsorMap = {};
    sponsors.forEach(s => (sponsorMap[s.id] = `${s.first_name} ${s.last_name}`.trim()));

    const financialReportBySponsor = revenueBySponsor.map(r => ({
      sponsor: r.sponsorId ? (sponsorMap[r.sponsorId] || `User ${r.sponsorId}`) : 'Unspecified',
      revenue: parseFloat(r.total_amount) || 0,
    })).sort((a, b) => b.revenue - a.revenue).slice(0, 5); // Top 5 sponsors
    

    const totalRevenueData = await CasePayment.findAll({
      attributes: [
        [db.Sequelize.fn('SUM', db.Sequelize.col('amount')), 'total_amount'],
      ],
      where: { paymentStatus: 'completed', amount: { [Op.ne]: null }, created_at: dateFilter },
      raw: true,
    });
    const totalRevenue = parseFloat(totalRevenueData[0]?.total_amount) || 0;

    const casesForPerformance = await Case.findAll({
      attributes: ['id', 'assignedcaseworkerId', 'status', 'targetSubmissionDate', 'created_at'],
      where: { created_at: dateFilter },
      raw: true,
    });

    const performanceData = {};
    casesForPerformance.forEach(c => {
      let arr = [];
      try {
        arr = Array.isArray(c.assignedcaseworkerId) ? c.assignedcaseworkerId : (c.assignedcaseworkerId ? JSON.parse(c.assignedcaseworkerId) : []);
      } catch (e) {
        try { arr = JSON.parse(c.assignedcaseworkerId); } catch (e2) { arr = []; }
      }
      arr.forEach(userId => {
        if (!userId) return;
        if (!performanceData[userId]) {
          performanceData[userId] = { total: 0, completed: 0, avgDays: 0, daysCounts: 0 };
        }
        performanceData[userId].total += 1;
        if (c.status === 'Completed') {
          performanceData[userId].completed += 1;
        }
        if (c.targetSubmissionDate) {
          const days = Math.floor((new Date(c.targetSubmissionDate) - new Date(c.created_at)) / (1000 * 60 * 60 * 24));
          performanceData[userId].avgDays += days;
          performanceData[userId].daysCounts += 1;
        }
      });
    });

    const performanceUserIds = Object.keys(performanceData).map(id => parseInt(id, 10));
    const performanceUsers = performanceUserIds.length > 0 ? await User.findAll({ where: { id: performanceUserIds }, attributes: ['id', 'first_name', 'last_name'], raw: true }) : [];
    const performanceUserMap = {};
    performanceUsers.forEach(u => { performanceUserMap[u.id] = `${u.first_name} ${u.last_name}`.trim(); });

    const performanceReport = Object.entries(performanceData).map(([userId, data]) => ({
      caseworker: performanceUserMap[userId] || `User ${userId}`,
      totalCases: data.total,
      completedCases: data.completed,
      successRate: data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0,
      avgSLADays: data.daysCounts > 0 ? Math.round(data.avgDays / data.daysCounts) : 0,
    })).sort((a, b) => b.successRate - a.successRate);

    // ===== GENERATE PDF =====
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      bufferPages: true,
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="System_Reports_${startDate}_${endDate}.pdf"`);

    // Pipe the document to the response
    doc.pipe(res);

    // Define colors
    const primaryColor = '#0066cc';
    const secondaryColor = '#f5f5f5';
    const textColor = '#333333';
    const lightGray = '#999999';

    // Title page
    doc.fontSize(28).font('Helvetica-Bold').text('System Reports', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica').fillColor(lightGray).text(`Date Range: ${startDate} to ${endDate}`, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(10).text(`Generated on: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, { align: 'center' });
    doc.moveDown(1);

    const boxX = 50;
    const boxY = doc.y;
    doc.rect(boxX, boxY, 495, 60).stroke(primaryColor);
    doc.fontSize(11).fillColor(textColor).font('Helvetica-Bold');
    doc.text('Report Summary', boxX + 10, boxY + 10);
    doc.fontSize(9).font('Helvetica').fillColor(lightGray);
    doc.text(`Total Cases: ${totalCases}`, boxX + 10, boxY + 30);
    doc.text(`Total Revenue: $${totalRevenue.toFixed(2)}`, boxX + 250, boxY + 30);
    doc.moveDown(5);

    // Page break after title
    doc.addPage();

    // 1. CASE REPORT
    doc.fontSize(16).font('Helvetica-Bold').fillColor(primaryColor).text('1. Case Report');
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica').fillColor(lightGray).text(`Total Cases: ${totalCases}`);
    doc.moveDown(0.5);

    // Case table
    const tableHeaderY = doc.y;
    const colWidths = [150, 120, 100];
    const tableX = 50;

    doc.rect(tableX, tableHeaderY, colWidths[0], 25).fill(primaryColor);
    doc.fontSize(10).font('Helvetica-Bold').fillColor('white');
    doc.text('Visa Type', tableX + 5, tableHeaderY + 6);
    doc.rect(tableX + colWidths[0], tableHeaderY, colWidths[1], 25).fill(primaryColor);
    doc.text('Count', tableX + colWidths[0] + 5, tableHeaderY + 6);
    doc.rect(tableX + colWidths[0] + colWidths[1], tableHeaderY, colWidths[2], 25).fill(primaryColor);
    doc.text('Percentage', tableX + colWidths[0] + colWidths[1] + 5, tableHeaderY + 6);

    let tableY = tableHeaderY + 25;
    let rowColor = false;

    caseReport.forEach((row, index) => {
      if (rowColor) {
        doc.rect(tableX, tableY, colWidths[0] + colWidths[1] + colWidths[2], 20).fill(secondaryColor);
      }
      doc.fontSize(9).font('Helvetica').fillColor(textColor);
      doc.text(row.visaType.substring(0, 25), tableX + 5, tableY + 5);
      doc.text(row.count.toString(), tableX + colWidths[0] + 5, tableY + 5);
      doc.text(`${row.percentage}%`, tableX + colWidths[0] + colWidths[1] + 5, tableY + 5);
      tableY += 20;
      rowColor = !rowColor;
    });

    doc.moveDown(2);

    // 2. WORKLOAD REPORT
    if (doc.y > 700) doc.addPage();
    doc.fontSize(16).font('Helvetica-Bold').fillColor(primaryColor).text('2. Workload Report');
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica').fillColor(lightGray).text(`Active Caseworkers: ${workloadReport.length}`);
    doc.moveDown(0.5);

    // Workload table
    const workloadHeaderY = doc.y;
    const workloadColWidths = [130, 90, 90, 90];

    doc.rect(tableX, workloadHeaderY, workloadColWidths[0], 25).fill(primaryColor);
    doc.fontSize(10).font('Helvetica-Bold').fillColor('white');
    doc.text('Caseworker', tableX + 5, workloadHeaderY + 6);
    doc.rect(tableX + workloadColWidths[0], workloadHeaderY, workloadColWidths[1], 25).fill(primaryColor);
    doc.text('Total', tableX + workloadColWidths[0] + 5, workloadHeaderY + 6);
    doc.rect(tableX + workloadColWidths[0] + workloadColWidths[1], workloadHeaderY, workloadColWidths[2], 25).fill(primaryColor);
    doc.text('Active', tableX + workloadColWidths[0] + workloadColWidths[1] + 5, workloadHeaderY + 6);
    doc.rect(tableX + workloadColWidths[0] + workloadColWidths[1] + workloadColWidths[2], workloadHeaderY, workloadColWidths[3], 25).fill(primaryColor);
    doc.text('Completed', tableX + workloadColWidths[0] + workloadColWidths[1] + workloadColWidths[2] + 5, workloadHeaderY + 6);

    let workloadY = workloadHeaderY + 25;
    rowColor = false;

    workloadReport.slice(0, 8).forEach((row, index) => {
      if (rowColor) {
        doc.rect(tableX, workloadY, workloadColWidths[0] + workloadColWidths[1] + workloadColWidths[2] + workloadColWidths[3], 20).fill(secondaryColor);
      }
      doc.fontSize(9).font('Helvetica').fillColor(textColor);
      doc.text(row.caseworker.substring(0, 18), tableX + 5, workloadY + 5);
      doc.text(row.totalCases.toString(), tableX + workloadColWidths[0] + 5, workloadY + 5);
      doc.text(row.activeCases.toString(), tableX + workloadColWidths[0] + workloadColWidths[1] + 5, workloadY + 5);
      doc.text(row.completedCases.toString(), tableX + workloadColWidths[0] + workloadColWidths[1] + workloadColWidths[2] + 5, workloadY + 5);
      workloadY += 20;
      rowColor = !rowColor;
    });

    doc.moveDown(2);

    // 3. FINANCIAL REPORT
    if (doc.y > 650) doc.addPage();
    doc.fontSize(16).font('Helvetica-Bold').fillColor(primaryColor).text('3. Financial Report');
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica').fillColor(lightGray).text(`Total Revenue: $${totalRevenue.toFixed(2)}`);
    doc.moveDown(0.5);

    // Revenue by Visa Type
    doc.fontSize(11).font('Helvetica-Bold').fillColor(textColor).text('Revenue by Visa Type');
    doc.moveDown(0.3);

    const revenueVisaHeaderY = doc.y;
    const revenueColWidths = [250, 150];

    doc.rect(tableX, revenueVisaHeaderY, revenueColWidths[0], 25).fill(primaryColor);
    doc.fontSize(10).font('Helvetica-Bold').fillColor('white');
    doc.text('Visa Type', tableX + 5, revenueVisaHeaderY + 6);
    doc.rect(tableX + revenueColWidths[0], revenueVisaHeaderY, revenueColWidths[1], 25).fill(primaryColor);
    doc.text('Revenue', tableX + revenueColWidths[0] + 5, revenueVisaHeaderY + 6);

    let revenueY = revenueVisaHeaderY + 25;
    rowColor = false;

    financialReportByVisa.forEach((row, index) => {
      if (rowColor) {
        doc.rect(tableX, revenueY, revenueColWidths[0] + revenueColWidths[1], 20).fill(secondaryColor);
      }
      doc.fontSize(9).font('Helvetica').fillColor(textColor);
      doc.text(row.visaType.substring(0, 30), tableX + 5, revenueY + 5);
      doc.text(`$${row.revenue.toFixed(2)}`, tableX + revenueColWidths[0] + 5, revenueY + 5);
      revenueY += 20;
      rowColor = !rowColor;
    });

    doc.moveDown(1.5);

    // Revenue by Sponsor
    doc.fontSize(11).font('Helvetica-Bold').fillColor(textColor).text('Top Sponsors by Revenue');
    doc.moveDown(0.3);

    const sponsorHeaderY = doc.y;
    doc.rect(tableX, sponsorHeaderY, revenueColWidths[0], 25).fill(primaryColor);
    doc.fontSize(10).font('Helvetica-Bold').fillColor('white');
    doc.text('Sponsor', tableX + 5, sponsorHeaderY + 6);
    doc.rect(tableX + revenueColWidths[0], sponsorHeaderY, revenueColWidths[1], 25).fill(primaryColor);
    doc.text('Revenue', tableX + revenueColWidths[0] + 5, sponsorHeaderY + 6);

    let sponsorY = sponsorHeaderY + 25;
    rowColor = false;

    financialReportBySponsor.forEach((row, index) => {
      if (rowColor) {
        doc.rect(tableX, sponsorY, revenueColWidths[0] + revenueColWidths[1], 20).fill(secondaryColor);
      }
      doc.fontSize(9).font('Helvetica').fillColor(textColor);
      doc.text(row.sponsor.substring(0, 30), tableX + 5, sponsorY + 5);
      doc.text(`$${row.revenue.toFixed(2)}`, tableX + revenueColWidths[0] + 5, sponsorY + 5);
      sponsorY += 20;
      rowColor = !rowColor;
    });

    doc.moveDown(2);

    // 4. CASEWORKER PERFORMANCE REPORT
    if (doc.y > 650) doc.addPage();
    doc.fontSize(16).font('Helvetica-Bold').fillColor(primaryColor).text('4. Caseworker Performance Report');
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica').fillColor(lightGray).text(`Total Caseworkers: ${performanceReport.length}`);
    doc.moveDown(0.5);

    // Performance table
    const perfHeaderY = doc.y;
    const perfColWidths = [120, 80, 80, 90, 90];

    doc.rect(tableX, perfHeaderY, perfColWidths[0], 25).fill(primaryColor);
    doc.fontSize(10).font('Helvetica-Bold').fillColor('white');
    doc.text('Caseworker', tableX + 5, perfHeaderY + 6);
    doc.rect(tableX + perfColWidths[0], perfHeaderY, perfColWidths[1], 25).fill(primaryColor);
    doc.text('Cases', tableX + perfColWidths[0] + 5, perfHeaderY + 6);
    doc.rect(tableX + perfColWidths[0] + perfColWidths[1], perfHeaderY, perfColWidths[2], 25).fill(primaryColor);
    doc.text('Complete', tableX + perfColWidths[0] + perfColWidths[1] + 5, perfHeaderY + 6);
    doc.rect(tableX + perfColWidths[0] + perfColWidths[1] + perfColWidths[2], perfHeaderY, perfColWidths[3], 25).fill(primaryColor);
    doc.text('Success %', tableX + perfColWidths[0] + perfColWidths[1] + perfColWidths[2] + 5, perfHeaderY + 6);
    doc.rect(tableX + perfColWidths[0] + perfColWidths[1] + perfColWidths[2] + perfColWidths[3], perfHeaderY, perfColWidths[4], 25).fill(primaryColor);
    doc.text('Avg SLA Days', tableX + perfColWidths[0] + perfColWidths[1] + perfColWidths[2] + perfColWidths[3] + 5, perfHeaderY + 6);

    let perfY = perfHeaderY + 25;
    rowColor = false;

    performanceReport.slice(0, 10).forEach((row, index) => {
      if (rowColor) {
        doc.rect(tableX, perfY, perfColWidths[0] + perfColWidths[1] + perfColWidths[2] + perfColWidths[3] + perfColWidths[4], 20).fill(secondaryColor);
      }
      doc.fontSize(9).font('Helvetica').fillColor(textColor);
      doc.text(row.caseworker.substring(0, 15), tableX + 5, perfY + 5);
      doc.text(row.totalCases.toString(), tableX + perfColWidths[0] + 5, perfY + 5);
      doc.text(row.completedCases.toString(), tableX + perfColWidths[0] + perfColWidths[1] + 5, perfY + 5);
      doc.text(`${row.successRate}%`, tableX + perfColWidths[0] + perfColWidths[1] + perfColWidths[2] + 5, perfY + 5);
      doc.text(row.avgSLADays.toString(), tableX + perfColWidths[0] + perfColWidths[1] + perfColWidths[2] + perfColWidths[3] + 5, perfY + 5);
      perfY += 20;
      rowColor = !rowColor;
    });

    doc.moveDown(3);

    // Footer
    doc.fontSize(9).fillColor(lightGray).text('_'.repeat(80), { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(8).text('This is an auto-generated report. For more information, please contact the administrator.', { align: 'center' });
    doc.text(`Report ID: ${Date.now()}`, { align: 'center' });

    // Finalize PDF
    doc.end();
  } catch (err) {
    console.error('exportCombinedPDFReport error', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to generate PDF report',
      data: null,
      error: err.message,
    });
  }
};

export default { getCaseTypeReport, getWorkloadReport, getRevenueByVisaType, getRevenueBySponsor, getAllCaseworkersReport, getCaseworkerPerformanceReport, getCaseworkerReportPDF, filterCaseworkers, exportCombinedPDFReport };
