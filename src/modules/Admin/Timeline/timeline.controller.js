import logger from '../../../utils/logger.js';

export const getGlobalTimeline = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = parseInt(req.query.offset, 10) || 0;
    
    const timeline = await req.tenantDb.CaseTimeline.findAll({
      order: [['created_at', 'DESC']],
      limit,
      offset,
      include: [
        { model: req.tenantDb.User, as: 'performer', attributes: ['id', 'first_name', 'last_name', 'email'] },
        { model: req.tenantDb.Case, as: 'case', attributes: ['id', 'caseId'] }
      ]
    });
    
    res.status(200).json({ status: 'success', data: timeline });
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch global timeline');
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getCaseTimeline = async (req, res) => {
  try {
    const { id } = req.params;
    const timeline = await req.tenantDb.CaseTimeline.findAll({
      where: { caseId: id },
      order: [['created_at', 'DESC']],
      include: [
        { model: req.tenantDb.User, as: 'performer', attributes: ['id', 'first_name', 'last_name', 'email'] }
      ]
    });
    
    res.status(200).json({ status: 'success', data: timeline });
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch case timeline');
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getCandidateTimeline = async (req, res) => {
  try {
    const { id } = req.params;
    // Get cases for this candidate
    const cases = await req.tenantDb.Case.findAll({ where: { candidateId: id }, attributes: ['id'] });
    const caseIds = cases.map(c => c.id);
    
    const timeline = await req.tenantDb.CaseTimeline.findAll({
      where: { caseId: caseIds },
      order: [['created_at', 'DESC']],
      include: [
        { model: req.tenantDb.User, as: 'performer', attributes: ['id', 'first_name', 'last_name', 'email'] },
        { model: req.tenantDb.Case, as: 'case', attributes: ['id', 'caseId'] }
      ]
    });
    
    res.status(200).json({ status: 'success', data: timeline });
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch candidate timeline');
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getSponsorTimeline = async (req, res) => {
  try {
    const { id } = req.params;
    // Get cases for this sponsor
    const cases = await req.tenantDb.Case.findAll({ where: { sponsorId: id }, attributes: ['id'] });
    const caseIds = cases.map(c => c.id);
    
    const timeline = await req.tenantDb.CaseTimeline.findAll({
      where: { caseId: caseIds },
      order: [['created_at', 'DESC']],
      include: [
        { model: req.tenantDb.User, as: 'performer', attributes: ['id', 'first_name', 'last_name', 'email'] },
        { model: req.tenantDb.Case, as: 'case', attributes: ['id', 'caseId'] }
      ]
    });
    
    res.status(200).json({ status: 'success', data: timeline });
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch sponsor timeline');
    res.status(500).json({ status: 'error', message: error.message });
  }
};
