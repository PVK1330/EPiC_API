import db from '../../models/index.js';

const Case = db.Case;
const User = db.User;
const VisaType = db.VisaType;

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

export default { getCaseTypeReport, getWorkloadReport };
