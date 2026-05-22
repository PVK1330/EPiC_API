import { Op } from 'sequelize';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PdfPrinter = require('pdfmake');

/** Run a dashboard query without failing the whole endpoint when a table/model is missing. */
async function safeDashboardQuery(promise, fallback, label = 'query') {
  try {
    return await promise;
  } catch (err) {
    console.warn(`Dashboard ${label} skipped:`, err.message);
    return fallback;
  }
}

// Get Dashboard Statistics
export const getDashboardStats = async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
        data: null
      });
    }

    const { filter = 'all' } = req.query;
    let dateWhere = {};
    
    if (filter === 'this_month') {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      dateWhere = { created_at: { [Op.gte]: firstDay } };
    } else if (filter === 'this_week') {
      const now = new Date();
      const firstDay = new Date(now.setDate(now.getDate() - now.getDay()));
      dateWhere = { created_at: { [Op.gte]: firstDay } };
    }

    // Get user counts by role (Users aren't usually filtered by date, but keeping structure)
    const totalAdmins = await req.tenantDb.User.count({ where: { role_id: 3 } });
    const totalCaseworkers = await req.tenantDb.User.count({ where: { role_id: 2 } });
    const totalCandidates = await req.tenantDb.User.count({ where: { role_id: 1 } });
    const totalSponsors = await req.tenantDb.User.count({ where: { role_id: 4 } });

    // Get case statistics
    const totalCases = await req.tenantDb.Case.count({ where: { ...dateWhere } });
    const activeCases = await req.tenantDb.Case.count({ where: { status: { [Op.ne]: 'Completed' }, ...dateWhere } });
    const completedCases = await req.tenantDb.Case.count({ where: { status: 'Completed', ...dateWhere } });
    const pendingCases = await req.tenantDb.Case.count({ where: { status: 'Pending', ...dateWhere } });

    // Get task statistics
    const totalTasks = await req.tenantDb.Task.count({ where: { ...dateWhere } });
    const completedTasks = await req.tenantDb.Task.count({ where: { status: 'completed', ...dateWhere } });
    const pendingTasks = await req.tenantDb.Task.count({ where: { status: 'pending', ...dateWhere } });
    const inProgressTasks = await req.tenantDb.Task.count({ where: { status: 'in-progress', ...dateWhere } });

    // Get document statistics
    const totalDocuments = await req.tenantDb.Document.count({ where: { ...dateWhere } });

    // Get recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentCases = await req.tenantDb.Case.count({
      where: { created_at: { [Op.gte]: sevenDaysAgo } }
    });

    const recentNotes = await safeDashboardQuery(
      req.tenantDb.CaseNote.count({
        where: { created_at: { [Op.gte]: sevenDaysAgo } }
      }),
      0,
      'recentNotes count'
    );

    const recentTasks = await safeDashboardQuery(
      req.tenantDb.Task.count({
        where: { created_at: { [Op.gte]: sevenDaysAgo } }
      }),
      0,
      'recentTasks count'
    );

    // Get top active escalations
    const escalations = await safeDashboardQuery(
      req.tenantDb.Escalation.findAll({
        where: { status: { [Op.in]: ['Open', 'In Progress', 'Monitoring', 'Chasing'] } },
        limit: 5,
        order: [
          [req.tenantDb.sequelize.literal("CASE WHEN severity = 'Critical' THEN 1 WHEN severity = 'High' THEN 2 WHEN severity = 'Medium' THEN 3 ELSE 4 END"), 'ASC'],
          ['created_at', 'DESC']
        ]
      }),
      [],
      'escalations'
    );

    // Get team workload (caseworkers)
    const caseworkers = await req.tenantDb.User.findAll({
      where: { role_id: 2 }, // Assuming role_id 2 is Caseworker
      attributes: ['id', 'first_name', 'last_name']
    });

    // For each caseworker, count active cases they are assigned to
    const teamWorkload = await Promise.all(caseworkers.map(async (cw) => {
      const activeCasesCount = await req.tenantDb.Case.count({
        where: {
          status: { [Op.notIn]: ['Completed', 'Approved', 'Rejected', 'Closed', 'Cancelled'] },
          assignedcaseworkerId: { [Op.contains]: [cw.id] }
        }
      });
      
      return {
        name: `${cw.first_name} ${cw.last_name}`,
        cases: activeCasesCount,
        pct: Math.min(Math.round((activeCasesCount / 20) * 100), 100), // Assuming 20 is max capacity for 100%
        bar: activeCasesCount > 15 ? "bg-red-500" : activeCasesCount > 10 ? "bg-yellow-500" : "bg-green-500"
      };
    }));

    // Get case status breakdown
    const caseStatusBreakdown = await req.tenantDb.Case.findAll({
      where: { ...dateWhere },
      attributes: [
        'status',
        [req.tenantDb.sequelize.fn('COUNT', '*'), 'count']
      ],
      group: ['status'],
      raw: true
    });

    // Get task priority breakdown
    const taskPriorityBreakdown = await req.tenantDb.Task.findAll({
      where: { ...dateWhere },
      attributes: [
        'priority',
        [req.tenantDb.sequelize.fn('COUNT', '*'), 'count']
      ],
      group: ['priority'],
      raw: true
    });

    // Calculate Expiry Alerts (within 30 days)
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    
    const [visaExpiryAlerts, sponsorExpiryAlerts] = await Promise.all([
      req.tenantDb.CandidateApplication.count({
        where: {
          visaEndDate: {
            [Op.and]: [
              { [Op.gte]: new Date() },
              { [Op.lte]: thirtyDaysFromNow }
            ]
          }
        }
      }).catch(() => 0),
      req.tenantDb.SponsorProfile.count({
        where: {
          licenceExpiryDate: {
            [Op.and]: [
              { [Op.gte]: new Date() },
              { [Op.lte]: thirtyDaysFromNow }
            ]
          }
        }
      }).catch(() => 0)
    ]);

    // Get financial statistics
    const { CasePayment, VisaType } = req.tenantDb;
    
    const [totalRevenue, totalOutstanding, outstandingSponsors] = await Promise.all([
      req.tenantDb.CasePayment.findOne({
        where: { paymentStatus: 'completed' },
        attributes: [[req.tenantDb.sequelize.fn('SUM', req.tenantDb.sequelize.col('amount')), 'total']],
        raw: true
      }).catch(() => ({ total: 0 })),
      req.tenantDb.CasePayment.findOne({
        where: { paymentStatus: 'pending' },
        attributes: [[req.tenantDb.sequelize.fn('SUM', req.tenantDb.sequelize.col('amount')), 'total']],
        raw: true
      }).catch(() => ({ total: 0 })),
      req.tenantDb.CasePayment.findAll({
        where: { paymentStatus: 'pending' },
        attributes: [
          [req.tenantDb.sequelize.fn('CONCAT', req.tenantDb.sequelize.col('Case.sponsor.first_name'), ' ', req.tenantDb.sequelize.col('Case.sponsor.last_name')), 'name'],
          [req.tenantDb.sequelize.fn('SUM', req.tenantDb.sequelize.col('amount')), 'total']
        ],
        include: [{
          model: req.tenantDb.Case,
          attributes: [],
          include: [{ model: req.tenantDb.User, as: 'sponsor', attributes: [] }]
        }],
        group: [req.tenantDb.sequelize.col('Case.sponsor.id'), req.tenantDb.sequelize.col('Case.sponsor.first_name'), req.tenantDb.sequelize.col('Case.sponsor.last_name')],
        order: [[req.tenantDb.sequelize.literal('"total"'), 'DESC']],
        limit: 3,
        raw: true
      }).catch(() => [])
    ]);

    res.status(200).json({
      status: "success",
      message: "Dashboard statistics retrieved successfully",
      data: {
        userStats: {
          totalAdmins,
          totalCaseworkers,
          totalCandidates,
          totalSponsors,
          totalUsers: totalAdmins + totalCaseworkers + totalCandidates + totalSponsors
        },
        caseStats: {
          totalCases,
          activeCases,
          completedCases,
          pendingCases,
          visaExpiryAlerts,
          sponsorExpiryAlerts,
          completionRate: totalCases > 0 ? Math.round((completedCases / totalCases) * 100) : 0
        },
        taskStats: {
          totalTasks,
          completedTasks,
          pendingTasks,
          inProgressTasks,
          completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
        },
        documentStats: {
          totalDocuments
        },
        financeStats: {
          totalRevenue: parseFloat(totalRevenue?.total || 0),
          totalOutstanding: parseFloat(totalOutstanding?.total || 0),
          outstandingSponsors: (outstandingSponsors || []).map(s => ({
            name: s.name || 'Unknown',
            amount: parseFloat(s.total || 0)
          }))
        },
        recentActivity: {
          recentCases,
          recentNotes,
          recentTasks,
          period: "Last 7 days"
        },
        escalations,
        teamWorkload,
        breakdowns: {
          caseStatusBreakdown,
          taskPriorityBreakdown
        }
      }
    });

  } catch (error) {
    console.error("Get Dashboard Stats Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get Recent Cases
export const getRecentCases = async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
        data: null
      });
    }

    const { limit = 10, page = 1 } = req.query;
    const offset = (page - 1) * limit;

    const { count, rows: cases } = await req.tenantDb.Case.findAndCountAll({
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "DESC"]],
      include: [
        {
          model: req.tenantDb.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email']
        }
      ],
      distinct: true,
      subQuery: false,
    });

    res.status(200).json({
      status: "success",
      message: "Recent cases retrieved successfully",
      data: {
        cases,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(count / limit),
          totalItems: count,
          itemsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error("Get Recent Cases Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get Recent Tasks
export const getRecentTasks = async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
        data: null
      });
    }

    const { limit = 10, page = 1, status } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = {};
    if (status) {
      whereClause.status = status;
    }

    const { count, rows: tasks } = await req.tenantDb.Task.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "DESC"]],
      include: [
        {
          model: req.tenantDb.User,
          as: 'assignee',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: req.tenantDb.Case,
          as: 'case',
          attributes: ['id', 'caseId']
        }
      ]
    });

    res.status(200).json({
      status: "success",
      message: "Recent tasks retrieved successfully",
      data: {
        tasks,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(count / limit),
          totalItems: count,
          itemsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error("Get Recent Tasks Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get Recent Activities
export const getRecentActivities = async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
        data: null
      });
    }

    const { limit = 20 } = req.query;

    // Get recent case notes (optional — table may not exist on all tenants)
    const recentNotes = await safeDashboardQuery(
      req.tenantDb.CaseNote.findAll({
        limit: Math.ceil(parseInt(limit) / 3),
        order: [["created_at", "DESC"]],
        subQuery: false,
        attributes: ['id', 'caseId', 'noteType', 'title', 'content', 'authorId', 'created_at'],
        include: [
          {
            model: req.tenantDb.User,
            as: 'author',
            attributes: ['id', 'first_name', 'last_name']
          },
          {
            model: req.tenantDb.Case,
            as: 'case',
            attributes: ['id', 'caseId'],
            required: false
          }
        ]
      }),
      [],
      'recent case notes'
    );

    // Get recent tasks
    const recentTasks = await req.tenantDb.Task.findAll({
      limit: Math.ceil(parseInt(limit) / 3),
      order: [["created_at", "DESC"]],
      include: [
        {
          model: req.tenantDb.User,
          as: 'assignee',
          attributes: ['id', 'first_name', 'last_name']
        },
        {
          model: req.tenantDb.Case,
          as: 'case',
          attributes: ['id', 'caseId']
        }
      ]
    });

    // Get recent cases
    const recentCases = await req.tenantDb.Case.findAll({
      limit: Math.ceil(parseInt(limit) / 3),
      order: [["created_at", "DESC"]],
      include: [
        {
          model: req.tenantDb.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name']
        }
      ]
    });

    // Combine and sort all activities by date
    const activities = [
      ...recentNotes.map(note => ({
        type: 'case_note',
        id: note.id,
        title: `Case Note: ${note.title || 'Untitled'}`,
        description: note.content?.substring(0, 100) + '...',
        createdAt: note.created_at,
        user: note.author,
        relatedCase: note.case
      })),
      ...recentTasks.map(task => ({
        type: 'task',
        id: task.id,
        title: `Task: ${task.title}`,
        description: task.title?.substring(0, 100) + '...',
        createdAt: task.created_at,
        user: task.assignee,
        relatedCase: task.case
      })),
      ...recentCases.map(case_ => ({
        type: 'case',
        id: case_.id,
        title: `Case: ${case_.caseId || 'New Case'}`,
        description: case_.notes?.substring(0, 100) + '...',
        createdAt: case_.created_at,
        user: case_.candidate,
        relatedCase: case_
      }))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, parseInt(limit));

    res.status(200).json({
      status: "success",
      message: "Recent activities retrieved successfully",
      data: {
        activities
      }
    });

  } catch (error) {
    console.error("Get Recent Activities Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get Quick Actions Data
export const getQuickActions = async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
        data: null
      });
    }

    // Get pending tasks for current user
    const myPendingTasks = await req.tenantDb.Task.count({
      where: { 
        assigned_to: userId,
        status: { [Op.in]: ['pending', 'in-progress'] }
      }
    });

    // Get cases assigned to current user
    const myCases = await req.tenantDb.Case.count({
      where: {
        [Op.or]: [
          { assignedToId: userId },
          { assignedcaseworkerId: { [Op.contains]: [userId] } }
        ]
      }
    });

    // Get overdue tasks
    const overdueTasks = await req.tenantDb.Task.count({
      where: {
        dueDate: { [Op.lt]: new Date() },
        status: { [Op.ne]: 'completed' }
      }
    });

    // Get cases needing attention (pending or overdue)
    const casesNeedingAttention = await req.tenantDb.Case.count({
      where: {
        status: { [Op.in]: ['Pending', 'On Hold'] }
      }
    });

    res.status(200).json({
      status: "success",
      message: "Quick actions data retrieved successfully",
      data: {
        myPendingTasks,
        myCases,
        overdueTasks,
        casesNeedingAttention,
        actions: [
          {
            title: "Create New Case",
            description: "Add a new case to the system",
            icon: "plus-circle",
            route: "/cases/new"
          },
          {
            title: "View My Tasks",
            description: `You have ${myPendingTasks} pending tasks`,
            icon: "check-square",
            route: "/tasks?assignedTo=me"
          },
          {
            title: "Overdue Tasks",
            description: `${overdueTasks} tasks need immediate attention`,
            icon: "alert-circle",
            route: "/tasks?status=overdue"
          },
          {
            title: "Cases Needing Attention",
            description: `${casesNeedingAttention} cases require action`,
            icon: "eye",
            route: "/cases?status=pending"
          }
        ]
      }
    });

  } catch (error) {
    console.error("Get Quick Actions Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Export Dashboard Snapshot
export const exportDashboardSnapshot = async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ status: "error", message: "Authentication required" });
    }

    // Fetch essential stats for CSV
    const totalCases = await req.tenantDb.Case.count();
    const activeCases = await req.tenantDb.Case.count({ where: { status: { [Op.ne]: 'Completed' } } });
    const completedCases = await req.tenantDb.Case.count({ where: { status: 'Completed' } });
    const totalTasks = await req.tenantDb.Task.count();
    const totalUsers = await req.tenantDb.User.count();

    const caseStatusBreakdown = await req.tenantDb.Case.findAll({
      attributes: ['status', [req.tenantDb.sequelize.fn('COUNT', '*'), 'count']],
      group: ['status'],
      raw: true
    });

    // Generate CSV Content
    let csv = "EPiC Dashboard Snapshot Report\n";
    csv += `Generated On: ${new Date().toLocaleString()}\n\n`;
    
    csv += "--- Summary KPI ---\n";
    csv += `Total Cases,${totalCases}\n`;
    csv += `Active Cases,${activeCases}\n`;
    csv += `Completed Cases,${completedCases}\n`;
    csv += `Total Tasks,${totalTasks}\n`;
    csv += `Total Users,${totalUsers}\n\n`;

    csv += "--- Case Status Breakdown ---\n";
    csv += "Status,Count\n";
    caseStatusBreakdown.forEach(s => {
      csv += `${s.status},${s.count}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="dashboard_snapshot.csv"');
    res.status(200).send(csv);

  } catch (error) {
    console.error("Export Dashboard Error:", error);
    res.status(500).json({ status: "error", message: "Failed to export dashboard snapshot" });
  }
};

// Export Dashboard PDF (Professional Report)
export const exportDashboardPDF = async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ status: "error", message: "Authentication required" });
    }

    // 1. Fetch all necessary data (reuse stats logic)
    const totalCases = await req.tenantDb.Case.count();
    const activeCases = await req.tenantDb.Case.count({ where: { status: { [Op.ne]: 'Completed' } } });
    const completedCases = await req.tenantDb.Case.count({ where: { status: 'Completed' } });
    const totalTasks = await req.tenantDb.Task.count();
    const pendingTasks = await req.tenantDb.Task.count({ where: { status: { [Op.ne]: 'completed' } } });
    
    const caseStatusBreakdown = await req.tenantDb.Case.findAll({
      attributes: ['status', [req.tenantDb.sequelize.fn('COUNT', '*'), 'count']],
      group: ['status'],
      raw: true
    });

    const escalations = await req.tenantDb.Escalation.findAll({
      where: { status: { [Op.in]: ['Open', 'In Progress', 'Monitoring', 'Chasing'] } },
      limit: 10,
      order: [['created_at', 'DESC']]
    });

    const caseworkers = await req.tenantDb.User.findAll({
      where: { role_id: 2 },
      attributes: ['id', 'first_name', 'last_name']
    });

    const teamWorkload = await Promise.all(caseworkers.map(async (cw) => {
      const count = await req.tenantDb.Case.count({
        where: {
          status: { [Op.notIn]: ['Completed', 'Approved', 'Rejected', 'Closed', 'Cancelled'] },
          assignedcaseworkerId: { [Op.contains]: [cw.id] }
        }
      });
      return { name: `${cw.first_name} ${cw.last_name}`, count };
    }));

    // 2. Define PDF structure (Standard Fonts - no files needed)
    const fonts = {
      Helvetica: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique'
      }
    };

    const printer = new PdfPrinter(fonts);
    
    const docDefinition = {
      pageSize: 'A4',
      pageOrientation: 'landscape',
      pageMargins: [40, 60, 40, 60],
      header: (currentPage, pageCount) => {
        return {
          columns: [
            { text: 'EPiC CASE CRM', style: 'brand', margin: [40, 20, 0, 0] },
            { text: `Confidential Dashboard Report`, style: 'reportType', alignment: 'right', margin: [0, 20, 40, 0] }
          ]
        };
      },
      footer: (currentPage, pageCount) => {
        return {
          columns: [
            { text: `Generated: ${new Date().toLocaleDateString()}`, margin: [40, 0] },
            { text: `Page ${currentPage} of ${pageCount}`, alignment: 'right', margin: [0, 0, 40, 0] }
          ],
          style: 'footer'
        };
      },
      content: [
        { text: 'Dashboard Overview', style: 'header' },
        { text: `Time Range: ${new Date().toLocaleDateString()} - Snapshot`, style: 'subheader' },
        { canvas: [{ type: 'line', x1: 0, y1: 5, x2: 760, y2: 5, lineWidth: 1, lineColor: '#e2e8f0' }] },
        { text: '\n' },
        
        // KPI Summary (4 Cards)
        {
          columns: [
            {
              width: '*',
              stack: [
                { text: 'TOTAL CASES', style: 'kpiLabel' },
                { text: totalCases.toString(), style: 'kpiValue' }
              ]
            },
            {
              width: '*',
              stack: [
                { text: 'ACTIVE CASES', style: 'kpiLabel' },
                { text: activeCases.toString(), style: 'kpiValue', color: '#f97316' }
              ]
            },
            {
              width: '*',
              stack: [
                { text: 'COMPLETED', style: 'kpiLabel' },
                { text: completedCases.toString(), style: 'kpiValue', color: '#10b981' }
              ]
            },
            {
              width: '*',
              stack: [
                { text: 'PENDING TASKS', style: 'kpiLabel' },
                { text: pendingTasks.toString(), style: 'kpiValue', color: '#ef4444' }
              ]
            }
          ]
        },
        { text: '\n' },
        { canvas: [{ type: 'line', x1: 0, y1: 5, x2: 760, y2: 5, lineWidth: 1, lineColor: '#e2e8f0' }] },
        { text: '\n' },

        // Main Data Tables
        {
          columns: [
            {
              width: '48%',
              stack: [
                { text: 'Case Status Distribution', style: 'sectionHeader' },
                {
                  table: {
                    headerRows: 1,
                    widths: ['*', 'auto'],
                    body: [
                      [
                        { text: 'Status', style: 'tableHeader' }, 
                        { text: 'Count', style: 'tableHeader', alignment: 'right' }
                      ],
                      ...caseStatusBreakdown.map(s => [
                        { text: s.status, style: 'tableCell' }, 
                        { text: s.count.toString(), style: 'tableCell', alignment: 'right' }
                      ])
                    ]
                  },
                  layout: {
                    hLineWidth: (i, node) => (i === 0 || i === node.table.body.length) ? 0 : 0.5,
                    vLineWidth: () => 0,
                    hLineColor: () => '#f1f5f9',
                    paddingTop: () => 8,
                    paddingBottom: () => 8,
                  }
                }
              ]
            },
            { width: '4%', text: '' },
            {
              width: '48%',
              stack: [
                { text: 'Team Active Workload', style: 'sectionHeader' },
                {
                  table: {
                    headerRows: 1,
                    widths: ['*', 'auto'],
                    body: [
                      [
                        { text: 'Caseworker', style: 'tableHeader' }, 
                        { text: 'Active Cases', style: 'tableHeader', alignment: 'right' }
                      ],
                      ...teamWorkload.map(tw => [
                        { text: tw.name, style: 'tableCell' }, 
                        { text: tw.count.toString(), style: 'tableCell', alignment: 'right' }
                      ])
                    ]
                  },
                  layout: {
                    hLineWidth: (i, node) => (i === 0 || i === node.table.body.length) ? 0 : 0.5,
                    vLineWidth: () => 0,
                    hLineColor: () => '#f1f5f9',
                    paddingTop: () => 8,
                    paddingBottom: () => 8,
                  }
                }
              ]
            }
          ]
        },
        
        { text: '\n\n' },
        { text: 'Critical Escalations', style: 'sectionHeader' },
        {
          table: {
            headerRows: 1,
            widths: ['auto', '*', 'auto', 'auto', 'auto'],
            body: [
              [
                { text: 'Case ID', style: 'tableHeader' },
                { text: 'Trigger / Candidate', style: 'tableHeader' },
                { text: 'Severity', style: 'tableHeader' },
                { text: 'Status', style: 'tableHeader' },
                { text: 'Created', style: 'tableHeader' }
              ],
              ...escalations.map(e => [
                { text: e.caseId, style: 'tableCell', bold: true },
                { text: e.triggerType || 'Issue', style: 'tableCell' },
                { text: e.severity, style: 'tableCell', color: (e.severity === 'Critical' || e.severity === 'High') ? '#ef4444' : '#f59e0b' },
                { text: e.status, style: 'tableCell' },
                { text: new Date(e.created_at).toLocaleDateString(), style: 'tableCell' }
              ])
            ]
          },
          layout: 'lightHorizontalLines'
        }
      ],
      styles: {
        brand: { fontSize: 16, bold: true, color: '#3b82f6' },
        reportType: { fontSize: 10, color: '#94a3b8', bold: true },
        header: { fontSize: 24, bold: true, color: '#1e293b', marginTop: 10 },
        subheader: { fontSize: 11, color: '#64748b', marginBottom: 10 },
        kpiLabel: { fontSize: 9, bold: true, color: '#94a3b8', marginBottom: 2 },
        kpiValue: { fontSize: 28, bold: true, color: '#1e293b' },
        sectionHeader: { fontSize: 14, bold: true, color: '#0f172a', marginTop: 15, marginBottom: 10 },
        tableHeader: { bold: true, fontSize: 10, color: '#475569', fillWeight: 1, fillColor: '#f8fafc' },
        tableCell: { fontSize: 10, margin: [0, 2] },
        footer: { fontSize: 9, color: '#94a3b8', marginTop: 10 }
      },
      defaultStyle: { font: 'Helvetica' }
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="dashboard_report.pdf"');
    
    pdfDoc.pipe(res);
    pdfDoc.end();

  } catch (error) {
    console.error("Export PDF Full Error:", error);
    res.status(500).json({ 
      status: "error", 
      message: "Failed to generate dashboard PDF",
      error: error.message
    });
  }
};

/** Due within 48 hours and overdue cases/tasks for admin & caseworker dashboards */
export const getDueOverdueTasks = async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    const roleId = Number(req.user?.role_id);
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const todayStr = now.toISOString().split("T")[0];
    const in48hStr = in48h.toISOString().split("T")[0];

    const caseWhere = {
      deleted_at: null,
      status: { [Op.notIn]: ["Completed", "Closed", "Cancelled", "Approved"] },
    };

    if (roleId === 2 && userId) {
      caseWhere[Op.or] = [
        req.tenantDb.sequelize.literal(
          `"assignedcaseworkerId"::jsonb @> '${JSON.stringify([Number(userId)])}'::jsonb`,
        ),
        req.tenantDb.sequelize.literal(
          `"assignedcaseworkerId"::jsonb ? '${Number(userId)}'`,
        ),
      ];
    }

    const cases = await req.tenantDb.Case.findAll({
      where: caseWhere,
      attributes: [
        "id",
        "caseId",
        "targetSubmissionDate",
        "status",
        "caseStage",
        "priority",
        "candidateId",
        "assignedcaseworkerId",
      ],
      include: [
        {
          model: req.tenantDb.User,
          as: "candidate",
          attributes: ["first_name", "last_name"],
          required: false,
        },
      ],
      order: [["targetSubmissionDate", "ASC"]],
      limit: 100,
    });

    const dueCases = [];
    const overdueCases = [];
    for (const c of cases) {
      const raw = c.targetSubmissionDate;
      if (!raw) continue;
      const d = new Date(raw);
      const cwRaw = c.assignedcaseworkerId;
      const cwCount = Array.isArray(cwRaw)
        ? cwRaw.length
        : cwRaw
          ? 1
          : 0;
      const row = {
        id: c.id,
        caseId: c.caseId,
        targetSubmissionDate: raw,
        status: c.status,
        caseStage: c.caseStage,
        priority: c.priority,
        candidateName: c.candidate
          ? `${c.candidate.first_name || ""} ${c.candidate.last_name || ""}`.trim()
          : "Unknown",
        type: "case",
        needsAssignment: cwCount === 0,
        actionLink:
          cwCount === 0
            ? `/admin/assign?caseId=${encodeURIComponent(c.caseId || "")}`
            : `/admin/cases/${encodeURIComponent(c.caseId || "")}`,
      };
      if (d < new Date(todayStr)) {
        overdueCases.push(row);
      } else if (raw <= in48hStr) {
        dueCases.push(row);
      }
    }

    const taskWhere = {
      status: { [Op.notIn]: ["completed", "done", "cancelled"] },
    };
    if (roleId === 2 && userId) {
      taskWhere.assigned_to = userId;
    }

    const tasks = await safeDashboardQuery(
      req.tenantDb.Task.findAll({
        where: taskWhere,
        attributes: ["id", "title", "due_date", "status", "priority", "case_id"],
        include: [
          {
            model: req.tenantDb.Case,
            as: "case",
            attributes: ["caseId"],
            required: false,
          },
        ],
        order: [["due_date", "ASC"]],
        limit: 100,
      }),
      [],
      "dueOverdue tasks",
    );

    const rolePrefix = roleId === 2 ? "caseworker" : "admin";

    const resolveTaskActionLink = (taskRow) => {
      const title = String(taskRow.title || "").toLowerCase();
      const ref = taskRow.caseId;
      if (title.includes("assign caseworker") || title.includes("review enquiry")) {
        return ref ? `/admin/assign?caseId=${encodeURIComponent(ref)}` : "/admin/assign";
      }
      if (title.includes("data capture")) {
        return ref ? `/admin/cases/${encodeURIComponent(ref)}` : `/${rolePrefix}/cases`;
      }
      if (title.includes("ccl") || title.includes("client care")) {
        return ref ? `/admin/cases/${encodeURIComponent(ref)}` : `/${rolePrefix}/cases`;
      }
      if (title.includes("biometric")) {
        return ref ? `/admin/cases/${encodeURIComponent(ref)}` : `/${rolePrefix}/cases`;
      }
      return ref
        ? `/${rolePrefix}/cases/${encodeURIComponent(ref)}`
        : `/${rolePrefix}/cases`;
    };

    const dueTasks = [];
    const overdueTasks = [];
    for (const t of tasks) {
      if (!t.due_date) continue;
      const d = new Date(t.due_date);
      const caseRef = t.case?.caseId || null;
      const row = {
        id: t.id,
        title: t.title,
        dueDate: t.due_date,
        status: t.status,
        priority: t.priority,
        caseId: caseRef,
        type: "task",
        actionLink: resolveTaskActionLink({ title: t.title, caseId: caseRef }),
      };
      if (d < now) {
        overdueTasks.push(row);
      } else if (d <= in48h) {
        dueTasks.push(row);
      }
    }

    res.status(200).json({
      status: "success",
      message: "Due and overdue items retrieved",
      data: {
        dueCases: dueCases.slice(0, 10),
        overdueCases: overdueCases.slice(0, 10),
        dueTasks: dueTasks.slice(0, 10),
        overdueTasks: overdueTasks.slice(0, 10),
        counts: {
          dueCases: dueCases.length,
          overdueCases: overdueCases.length,
          dueTasks: dueTasks.length,
          overdueTasks: overdueTasks.length,
        },
      },
    });
  } catch (error) {
    console.error("getDueOverdueTasks:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to load due and overdue items",
      error: error.message,
    });
  }
};

export default {
  getDashboardStats,
  getRecentCases,
  getRecentTasks,
  getRecentActivities,
  getQuickActions,
  getDueOverdueTasks,
  exportDashboardSnapshot,
  exportDashboardPDF
};
