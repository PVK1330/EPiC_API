import { Op } from 'sequelize';
import logger from '../../../utils/logger.js';
import { rowsToXlsxBuffer, sendXlsxDownload } from '../../../utils/excelExport.util.js';
import { buildCaseworkerAssignmentWhere } from '../../../utils/caseworkerScope.js';
import { getPaginationParams, buildPaginationMeta } from '../../../utils/paginate.js';


/**
 * Get performance metrics for a caseworker
 */
export const getCaseworkerPerformance = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        message: 'User not authenticated' 
      });
    }
    const { startDate, endDate } = req.query;

    // Default to current month if no dates provided
    const now = new Date();
    const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const start = startDate ? new Date(startDate) : defaultStart;
    const end = endDate ? new Date(endDate) : defaultEnd;

    // Build where clause for caseworker JSONB array (injection-safe — BUG-001)
    const caseworkerWhereClause = buildCaseworkerAssignmentWhere(
      req.tenantDb.sequelize,
      userId,
    );

    const caseWhere = { ...caseworkerWhereClause };
    // Only apply date filter to overall stats if explicitly requested
    if (req.query.startDate || req.query.endDate) {
      caseWhere.created_at = {
        [Op.between]: [start, end],
      };
    }

    // Get cases assigned to the caseworker
    const assignedCases = await req.tenantDb.Case.findAll({
      where: caseWhere,
    });

    const caseIds = assignedCases.map(c => c.id);

    // Get completed cases
    const completedCases = assignedCases.filter(c => 
      ['Completed', 'Approved', 'Closed'].includes(c.status)
    );

    // Get overdue cases
    const overdueCases = assignedCases.filter(c => {
      const targetDate = new Date(c.targetSubmissionDate);
      return targetDate < now && !['Completed', 'Approved', 'Closed'].includes(c.status);
    });

    // Calculate average completion time (in days)
    let avgCompletionTime = 0;
    if (completedCases.length > 0) {
      const completionTimes = completedCases.map(c => {
        const created = new Date(c.created_at);
        const updated = new Date(c.updated_at);
        return Math.ceil((updated - created) / (1000 * 60 * 60 * 24));
      });
      avgCompletionTime = Math.round(
        completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
      );
    }

    // Calculate SLA compliance (cases completed before target date)
    let slaCompliantCases = 0;
    completedCases.forEach(c => {
      const targetDate = new Date(c.targetSubmissionDate);
      const completedDate = new Date(c.updated_at);
      if (completedDate <= targetDate) {
        slaCompliantCases++;
      }
    });
    const slaRate = completedCases.length > 0 
      ? Math.round((slaCompliantCases / completedCases.length) * 100) 
      : 0;

    // Get timeline stats
    const timelineStats = await req.tenantDb.CaseTimeline.findAll({
      where: {
        caseId: { [Op.in]: caseIds },
        actionDate: { [Op.between]: [start, end] },
      },
      attributes: [
        'actionType',
        [req.tenantDb.sequelize.fn('COUNT', req.tenantDb.sequelize.col('id')), 'count'],
      ],
      group: ['actionType'],
      raw: true,
    });

    // Get task completion stats
    const tasks = await req.tenantDb.Task.findAll({
      where: {
        assigned_to: userId,
        created_at: { [Op.between]: [start, end] },
      },
    });
    const completedTasks = tasks.filter(t => t.status === 'completed').length;
    const taskCompletionRate = tasks.length > 0 
      ? Math.round((completedTasks / tasks.length) * 100) 
      : 0;

    // Get document review stats
    const reviewedDocuments = await req.tenantDb.Document.findAll({
      where: {
        reviewedBy: userId,
        updated_at: { [Op.between]: [start, end] },
      },
    });
    const approvedDocs = reviewedDocuments.filter(d => d.status === 'approved').length;
    const docAccuracy = reviewedDocuments.length > 0 
      ? Math.round((approvedDocs / reviewedDocuments.length) * 100) 
      : 0;

    // Calculate overall performance score
    const weights = {
      slaRate: 0.3,
      completionRate: 0.25,
      taskCompletionRate: 0.2,
      docAccuracy: 0.15,
      avgCompletionTime: 0.1,
    };

    const completionRate = assignedCases.length > 0 
      ? Math.round((completedCases.length / assignedCases.length) * 100) 
      : 0;

    const avgCompletionScore = avgCompletionTime > 0 
      ? Math.max(0, 100 - (avgCompletionTime * 2)) // Deduct 2 points per day
      : 100;

    const overallScore = Math.round(
      (slaRate * weights.slaRate) +
      (completionRate * weights.completionRate) +
      (taskCompletionRate * weights.taskCompletionRate) +
      (docAccuracy * weights.docAccuracy) +
      (avgCompletionScore * weights.avgCompletionTime)
    );

    // Get monthly trend (last 6 months)
    const monthlyTrend = [];
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      
      const monthCases = await req.tenantDb.Case.findAll({
        where: {
          ...caseworkerWhereClause,
          created_at: { [Op.between]: [monthStart, monthEnd] },
        },
      });

      const monthCompleted = monthCases.filter(c => 
        ['Completed', 'Approved', 'Closed'].includes(c.status)
      ).length;

      monthlyTrend.push({
        month: monthStart.toLocaleString('en-US', { month: 'short' }).toUpperCase(),
        year: monthStart.getFullYear(),
        score: monthCases.length > 0 
          ? Math.round((monthCompleted / monthCases.length) * 100) 
          : 0,
      });
    }

    res.json({
      success: true,
      data: {
        overall: {
          score: overallScore,
          slaRate,
          completionRate,
          overdueRate: assignedCases.length > 0 
            ? Math.round((overdueCases.length / assignedCases.length) * 100) 
            : 0,
        },
        cases: {
          assigned: assignedCases.length,
          completed: completedCases.length,
          overdue: overdueCases.length,
          avgCompletionTime,
        },
        tasks: {
          total: tasks.length,
          completed: completedTasks,
          completionRate: taskCompletionRate,
        },
        documents: {
          reviewed: reviewedDocuments.length,
          approved: approvedDocs,
          accuracy: docAccuracy,
        },
        timelineStats,
        monthlyTrend,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching caseworker performance');
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch performance metrics' 
    });
  }
};

/**
 * Get activity log for a caseworker
 */
export const getCaseworkerActivityLog = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        message: 'User not authenticated' 
      });
    }
    // Server-side pagination. Supports ?page & ?limit (via shared helper);
    // also honours a legacy explicit ?offset for backwards compatibility.
    const { page, limit, offset: pageOffset } = getPaginationParams(req.query);
    const rawOffset = Number.parseInt(req.query.offset, 10);
    const offset = Number.isNaN(rawOffset) || rawOffset < 0 ? pageOffset : rawOffset;

    const { count, rows: timeline } = await req.tenantDb.CaseTimeline.findAndCountAll({
      where: {
        performedBy: userId,
      },
      include: [
        {
          model: req.tenantDb.Case,
          as: 'case',
          attributes: ['id', 'caseId'],
        },
      ],
      order: [['actionDate', 'DESC']],
      limit,
      offset,
    });

    res.json({
      success: true,
      data: timeline,
      pagination: buildPaginationMeta(count, page, limit),
    });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching activity log');
    res.status(500).json({
      success: false,
      message: 'Failed to fetch activity log'
    });
  }
};

/**
 * Export caseworker performance data as CSV
 */
export const exportCaseworkerPerformance = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }
    const { startDate, endDate } = req.query;

    // Default to current month if no dates provided
    const now = new Date();
    const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const start = startDate ? new Date(startDate) : defaultStart;
    const end = endDate ? new Date(endDate) : defaultEnd;

    // Build where clause for caseworker JSONB array (injection-safe — BUG-001)
    const caseworkerWhereClause = buildCaseworkerAssignmentWhere(
      req.tenantDb.sequelize,
      userId,
    );

    const caseWhere = { ...caseworkerWhereClause };
    // Only apply date filter to overall stats if explicitly requested
    if (req.query.startDate || req.query.endDate) {
      caseWhere.created_at = {
        [Op.between]: [start, end],
      };
    }

    // Get cases assigned to the caseworker
    const assignedCases = await req.tenantDb.Case.findAll({
      where: caseWhere,
      include: [
        {
          model: req.tenantDb.User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name'],
        },
        {
          model: req.tenantDb.User,
          as: 'sponsor',
          attributes: ['id', 'first_name', 'last_name'],
        },
        {
          model: req.tenantDb.VisaType,
          as: 'visaType',
          attributes: ['id', 'name'],
        },
      ],
    });

    const caseIds = assignedCases.map(c => c.id);

    // Get completed cases
    const completedCases = assignedCases.filter(c =>
      ['Completed', 'Approved', 'Closed'].includes(c.status)
    );

    // Get overdue cases
    const overdueCases = assignedCases.filter(c => {
      const targetDate = new Date(c.targetSubmissionDate);
      return targetDate < now && !['Completed', 'Approved', 'Closed'].includes(c.status);
    });

    // Calculate average completion time (in days)
    let avgCompletionTime = 0;
    if (completedCases.length > 0) {
      const completionTimes = completedCases.map(c => {
        const created = new Date(c.created_at);
        const updated = new Date(c.updated_at);
        return Math.ceil((updated - created) / (1000 * 60 * 60 * 24));
      });
      avgCompletionTime = Math.round(
        completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
      );
    }

    // Calculate SLA compliance (cases completed before target date)
    let slaCompliantCases = 0;
    completedCases.forEach(c => {
      const targetDate = new Date(c.targetSubmissionDate);
      const completedDate = new Date(c.updated_at);
      if (completedDate <= targetDate) {
        slaCompliantCases++;
      }
    });
    const slaRate = completedCases.length > 0
      ? Math.round((slaCompliantCases / completedCases.length) * 100)
      : 0;

    // Get task completion stats
    const tasks = await req.tenantDb.Task.findAll({
      where: {
        assigned_to: userId,
        created_at: { [Op.between]: [start, end] },
      },
    });
    const completedTasks = tasks.filter(t => t.status === 'completed').length;
    const taskCompletionRate = tasks.length > 0
      ? Math.round((completedTasks / tasks.length) * 100)
      : 0;

    // Get document review stats
    const reviewedDocuments = await req.tenantDb.Document.findAll({
      where: {
        reviewedBy: userId,
        updated_at: { [Op.between]: [start, end] },
      },
    });
    const approvedDocs = reviewedDocuments.filter(d => d.status === 'approved').length;
    const docAccuracy = reviewedDocuments.length > 0
      ? Math.round((approvedDocs / reviewedDocuments.length) * 100)
      : 0;

    // Calculate overall performance score
    const weights = {
      slaRate: 0.3,
      completionRate: 0.25,
      taskCompletionRate: 0.2,
      docAccuracy: 0.15,
      avgCompletionTime: 0.1,
    };

    const completionRate = assignedCases.length > 0
      ? Math.round((completedCases.length / assignedCases.length) * 100)
      : 0;

    const avgCompletionScore = avgCompletionTime > 0
      ? Math.max(0, 100 - (avgCompletionTime * 2))
      : 100;

    const overallScore = Math.round(
      (slaRate * weights.slaRate) +
      (completionRate * weights.completionRate) +
      (taskCompletionRate * weights.taskCompletionRate) +
      (docAccuracy * weights.docAccuracy) +
      (avgCompletionScore * weights.avgCompletionTime)
    );

    const period = `${start.toLocaleDateString('en-GB')} - ${end.toLocaleDateString('en-GB')}`;

    const summaryColumns = [
      { key: 'metric', header: 'Metric' },
      { key: 'value',  header: 'Value' },
      { key: 'period', header: 'Period' },
    ];
    const summaryRows = [
      { metric: 'Overall Performance Score',  value: overallScore,              period },
      { metric: 'SLA Compliance Rate',        value: `${slaRate}%`,             period },
      { metric: 'Case Completion Rate',       value: `${completionRate}%`,      period },
      { metric: 'Task Completion Rate',       value: `${taskCompletionRate}%`,  period },
      { metric: 'Document Accuracy',          value: `${docAccuracy}%`,         period },
      { metric: 'Average Completion Time',    value: `${avgCompletionTime} days`, period },
      { metric: 'Total Cases Assigned',       value: assignedCases.length,      period },
      { metric: 'Cases Completed',            value: completedCases.length,     period },
      { metric: 'Overdue Cases',              value: overdueCases.length,       period },
      { metric: 'Total Tasks',                value: tasks.length,              period },
      { metric: 'Completed Tasks',            value: completedTasks,            period },
      { metric: 'Documents Reviewed',         value: reviewedDocuments.length,  period },
      { metric: 'Documents Approved',         value: approvedDocs,              period },
    ];

    const caseColumns = [
      { key: 'caseId',     header: 'Case ID' },
      { key: 'candidate',  header: 'Candidate' },
      { key: 'sponsor',    header: 'Sponsor' },
      { key: 'visaType',   header: 'Visa Type' },
      { key: 'status',     header: 'Status' },
      { key: 'priority',   header: 'Priority' },
      { key: 'target',     header: 'Target Date' },
      { key: 'createdAt',  header: 'Created At' },
    ];
    const caseRows = assignedCases.map((c) => ({
      caseId:    c.caseId || '',
      candidate: c.candidate ? `${c.candidate.first_name} ${c.candidate.last_name}` : '',
      sponsor:   c.sponsor   ? `${c.sponsor.first_name} ${c.sponsor.last_name}` : '',
      visaType:  c.visaType?.name || '',
      status:    c.status || '',
      priority:  c.priority || '',
      target:    c.targetSubmissionDate ? new Date(c.targetSubmissionDate).toLocaleDateString('en-GB') : '',
      createdAt: c.created_at ? new Date(c.created_at).toLocaleDateString('en-GB') : '',
    }));

    const { multiSheetXlsxBuffer } = await import('../../../utils/excelExport.util.js');
    const buf = multiSheetXlsxBuffer([
      { name: 'Performance Summary', columns: summaryColumns, rows: summaryRows },
      { name: 'Assigned Cases',      columns: caseColumns,   rows: caseRows },
    ]);

    const date = new Date().toISOString().slice(0, 10);
    sendXlsxDownload(res, buf, `caseworker_performance_${date}.xlsx`);
  } catch (error) {
    logger.error({ err: error }, 'Error exporting caseworker performance');
    res.status(500).json({
      success: false,
      message: 'Failed to export performance data'
    });
  }
};
