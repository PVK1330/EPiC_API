import logger from '../utils/logger.js';

export function validateVisaRefusal(item, index = 0) {
  if (!item || typeof item !== 'object') {
    const err = new Error(`Visa refusal #${index + 1} must be an object.`);
    err.status = 400;
    throw err;
  }

  const refusalDateStr = item.refusalDate ? String(item.refusalDate).trim() : '';
  if (!refusalDateStr) {
    const err = new Error(`Refusal date is required for visa refusal #${index + 1}.`);
    err.status = 400;
    throw err;
  }

  const parsedDate = new Date(refusalDateStr);
  if (isNaN(parsedDate.getTime())) {
    const err = new Error('Refusal date is not a valid date.');
    err.status = 400;
    throw err;
  }

  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (parsedDate > today) {
    const err = new Error('Refusal date cannot be in the future.');
    err.status = 400;
    throw err;
  }

  const country = typeof (item.country || item.refusedVisaCountry) === 'string'
    ? (item.country || item.refusedVisaCountry).trim()
    : '';
  if (!country) {
    const err = new Error(`Country of refusal is required for visa refusal #${index + 1}.`);
    err.status = 400;
    throw err;
  }
  if (country.length > 100) {
    const err = new Error('Country of visa refusal must be 100 characters or fewer.');
    err.status = 400;
    throw err;
  }

  const visaType = typeof (item.visaType || item.refusedVisaType) === 'string'
    ? (item.visaType || item.refusedVisaType).trim()
    : '';
  if (!visaType) {
    const err = new Error(`Visa or application type is required for visa refusal #${index + 1}.`);
    err.status = 400;
    throw err;
  }
  if (visaType.length > 100) {
    const err = new Error('Visa / application type must be 100 characters or fewer.');
    err.status = 400;
    throw err;
  }

  const reason = typeof (item.reason || item.refusedVisaReason || item.refusedVisaDetails) === 'string'
    ? (item.reason || item.refusedVisaReason || item.refusedVisaDetails).trim()
    : '';
  if (!reason) {
    const err = new Error(`Reason for visa refusal is required for visa refusal #${index + 1}.`);
    err.status = 400;
    throw err;
  }

  const referenceNumber = typeof (item.referenceNumber || item.refusedVisaReference) === 'string'
    ? (item.referenceNumber || item.refusedVisaReference).trim()
    : '';
  if (referenceNumber.length > 100) {
    const err = new Error('Reference number must be 100 characters or fewer.');
    err.status = 400;
    throw err;
  }

  const details = typeof item.details === 'string' ? item.details.trim() : null;

  return {
    ...(item.id ? { id: Number(item.id) } : {}),
    refusalDate: parsedDate.toISOString().split('T')[0],
    country,
    visaType,
    reason,
    referenceNumber: referenceNumber || null,
    details: details || null,
  };
}

/**
 * Synchronize visa refusals for an application in candidate_visa_refusals table.
 * Enforces client isolation (only modifies refusals belonging to applicationId / userId).
 * Also synchronizes the legacy single-refusal columns on candidate_applications.
 */
export async function syncApplicationVisaRefusals(tenantDb, applicationId, userId, organisationId, visaRefusals, transaction) {
  if (!tenantDb?.CandidateVisaRefusal || !applicationId) return [];

  // If visaRefusals is not provided or null, do nothing
  if (!Array.isArray(visaRefusals)) return [];

  const validatedList = visaRefusals.map((item, idx) => validateVisaRefusal(item, idx));

  const existingRefusals = await tenantDb.CandidateVisaRefusal.findAll({
    where: { applicationId },
    transaction,
  });

  const existingMap = new Map();
  for (const r of existingRefusals) {
    existingMap.set(r.id, r);
  }

  const incomingIds = new Set();
  const resultRefusals = [];

  for (const item of validatedList) {
    const refusalData = {
      applicationId,
      userId,
      organisationId: organisationId || null,
      refusalDate: item.refusalDate,
      visaType: item.visaType,
      country: item.country,
      reason: item.reason,
      referenceNumber: item.referenceNumber || null,
      details: item.details || null,
    };

    if (item.id && existingMap.has(Number(item.id))) {
      // Update existing refusal belonging to THIS client application
      const existingRefusal = existingMap.get(Number(item.id));
      await existingRefusal.update(refusalData, { transaction });
      incomingIds.add(existingRefusal.id);
      resultRefusals.push(existingRefusal);
    } else {
      // Create new refusal record
      const created = await tenantDb.CandidateVisaRefusal.create(refusalData, { transaction });
      incomingIds.add(created.id);
      resultRefusals.push(created);
    }
  }

  // Remove any previous refusals for this application that are not in the incoming list
  for (const existingRefusal of existingRefusals) {
    if (!incomingIds.has(existingRefusal.id)) {
      await existingRefusal.destroy({ transaction });
    }
  }

  // Synchronize legacy columns on CandidateApplication for backward compatibility
  const application = await tenantDb.CandidateApplication.findByPk(applicationId, { transaction });
  if (application) {
    if (resultRefusals.length > 0) {
      const first = resultRefusals[0];
      await application.update({
        refusedVisa: 'Yes',
        refusedVisaDate: first.refusalDate,
        refusedVisaCountry: first.country,
        refusedVisaType: first.visaType,
        refusedVisaReason: first.reason,
        refusedVisaDetails: first.details || first.reason,
        refusedVisaReference: first.referenceNumber || null,
      }, { transaction, hooks: false });
    } else {
      await application.update({
        refusedVisa: 'No',
        refusedVisaDate: null,
        refusedVisaCountry: null,
        refusedVisaType: null,
        refusedVisaReason: null,
        refusedVisaDetails: null,
        refusedVisaReference: null,
      }, { transaction, hooks: false });
    }
  }

  return resultRefusals;
}

/**
 * Ensures visaRefusals array is populated on application JSON object,
 * including synthesized legacy refusal if candidate_visa_refusals is empty but refusedVisa = 'Yes'.
 * Supports either formatApplicationWithRefusals(appInstance) or formatApplicationWithRefusals(tenantDb, appInstance).
 */
export async function formatApplicationWithRefusals(tenantDbOrApp, maybeApp) {
  let tenantDb = null;
  let appInstance = null;

  if (maybeApp) {
    tenantDb = tenantDbOrApp;
    appInstance = maybeApp;
  } else {
    appInstance = tenantDbOrApp;
  }

  if (!appInstance) return null;
  const json = typeof appInstance.toJSON === 'function' ? appInstance.toJSON() : { ...appInstance };

  let list = Array.isArray(json.visaRefusals) ? [...json.visaRefusals] : [];

  if (list.length === 0 && tenantDb?.CandidateVisaRefusal && json.id) {
    const dbRefusals = await tenantDb.CandidateVisaRefusal.findAll({
      where: { applicationId: json.id },
      order: [['refusalDate', 'ASC']],
    });
    if (dbRefusals && dbRefusals.length > 0) {
      list = dbRefusals.map((r) => (typeof r.toJSON === 'function' ? r.toJSON() : r));
    }
  }

  if (list.length === 0 && json.refusedVisa === 'Yes' && json.refusedVisaDate) {
    list = [
      {
        id: null,
        applicationId: json.id,
        userId: json.userId,
        refusalDate: json.refusedVisaDate,
        country: json.refusedVisaCountry || 'Unknown',
        visaType: json.refusedVisaType || 'Other',
        reason: json.refusedVisaReason || json.refusedVisaDetails || 'Previous visa refusal',
        referenceNumber: json.refusedVisaReference || null,
        details: json.refusedVisaDetails || null,
      },
    ];
  }

  json.visaRefusals = list;
  return json;
}

