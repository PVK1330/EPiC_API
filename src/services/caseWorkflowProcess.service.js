  import { Op } from "sequelize";
import { resolveCaseStage } from "../constants/immigrationCaseProcess.js";
import { applyCaseStageChange } from "./caseStageAutomation.service.js";
import { recordTimelineEntry } from "./caseTimeline.service.js";
import {
  createWorkflowTask,
  syncWorkflowTasksForStage,
} from "./workflowTaskAutomation.service.js";
import { notifyUser, NotificationTypes, NotificationPriority } from "./notification.service.js";

const EMPTY_STATE = {
  draftReview: { confirmed: null, confirmedAt: null },
  visaPortal: { submittedAt: null, reference: null, submittedBy: null },
  biometrics: {
    availability: null,
    bookedSlot: null,
    documentsUploadedAt: null,
    visaPortalReply: null,
  },
};

export function getWorkflowState(caseRecord) {
  const raw = caseRecord?.workflowState;
  if (!raw || typeof raw !== "object") {
    return JSON.parse(JSON.stringify(EMPTY_STATE));
  }
  return {
    ...EMPTY_STATE,
    ...raw,
    draftReview: { ...EMPTY_STATE.draftReview, ...(raw.draftReview || {}) },
    visaPortal: { ...EMPTY_STATE.visaPortal, ...(raw.visaPortal || {}) },
    biometrics: {
      ...EMPTY_STATE.biometrics,
      ...(raw.biometrics || {}),
    },
  };
}

export async function setWorkflowState(tenantDb, caseRecord, patch) {
  const current = getWorkflowState(caseRecord);
  const next = {
    ...current,
    ...patch,
    draftReview: { ...current.draftReview, ...(patch.draftReview || {}) },
    visaPortal: { ...current.visaPortal, ...(patch.visaPortal || {}) },
    biometrics: {
      ...current.biometrics,
      ...(patch.biometrics || {}),
    },
  };
  await caseRecord.update({ workflowState: next });
  caseRecord.workflowState = next;
  return next;
}

async function getActiveAdminIds(tenantDb) {
  const adminRole = await tenantDb.Role.findOne({
    where: { name: { [Op.iLike]: "admin" } },
    attributes: ["id"],
  });
  if (!adminRole) return [];
  const admins = await tenantDb.User.findAll({
    where: { role_id: adminRole.id, status: "active" },
    attributes: ["id"],
  });
  return admins.map((a) => a.id);
}

function parseCaseworkerIds(caseRecord) {
  const raw = caseRecord?.assignedcaseworkerId ?? caseRecord?.assignedCaseworkerId;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (typeof raw === "object" && raw !== null) {
    const ids = raw.ids ?? raw.caseworkers ?? Object.values(raw);
    if (Array.isArray(ids)) return ids.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? [n] : [];
}

/** Lock candidate application when entering draft review. */
export async function lockApplicationForDraftReview(tenantDb, caseRecord) {
  if (!caseRecord?.candidateId) return;
  const app = await tenantDb.CandidateApplication.findOne({
    where: { userId: caseRecord.candidateId },
  });
  if (!app) return;
  if (app.status !== "submitted") {
    await app.update({ status: "submitted", isLocked: true, submittedAt: app.submittedAt || new Date() });
  } else if (!app.isLocked) {
    await app.update({ isLocked: true });
  }
}

/** Unlock so candidate can edit after draft review "No". */
export async function unlockApplicationForRevision(tenantDb, caseRecord) {
  if (!caseRecord?.candidateId) return;
  const app = await tenantDb.CandidateApplication.findOne({
    where: { userId: caseRecord.candidateId },
  });
  if (app?.isLocked) {
    await app.update({ isLocked: false });
  }
}

/**
 * Candidate confirms or rejects draft application.
 * Yes → ccl_fee_proposal; No → unlock form, stay on draft_application_review.
 */
export async function submitDraftReviewDecision({
  tenantDb,
  caseRecord,
  confirmed,
  performedBy,
  organisationId = null,
}) {
  const stage = resolveCaseStage(caseRecord);
  if (stage !== "draft_application_review") {
    return { ok: false, status: 400, message: "Draft review is not active for this case" };
  }

  const state = getWorkflowState(caseRecord);
  if (state.draftReview.confirmed !== null) {
    return { ok: false, status: 400, message: "You have already responded to the draft review" };
  }

  const now = new Date().toISOString();
  await setWorkflowState(tenantDb, caseRecord, {
    draftReview: { confirmed: !!confirmed, confirmedAt: now },
  });

  if (confirmed) {
    await recordTimelineEntry({
      tenantDb,
      caseId: caseRecord.id,
      actionType: "draft_review_confirmed",
      description: "Candidate confirmed draft application",
      performedBy,
      visibility: "public",
    });
    await applyCaseStageChange({
      tenantDb,
      caseRecord,
      nextStageId: "ccl_fee_proposal",
      performedBy,
      reason: "Draft application confirmed by candidate",
      organisationId,
    });
    return { ok: true, nextStage: "ccl_fee_proposal" };
  }

  await unlockApplicationForRevision(tenantDb, caseRecord);
  await recordTimelineEntry({
    tenantDb,
    caseId: caseRecord.id,
    actionType: "draft_review_revision",
    description: "Candidate requested changes to draft application",
    performedBy,
    visibility: "public",
  });

  const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
  const caseworkerIds = parseCaseworkerIds(caseRecord);
  for (const cwId of caseworkerIds) {
    await createWorkflowTask({
      tenantDb,
      caseRecord,
      assigneeId: cwId,
      title: `Revise draft application after client feedback — ${caseLabel}`,
      createdBy: performedBy,
      priority: "high",
      dueInDays: 2,
      organisationId,
    });
  }

  return { ok: true, nextStage: "draft_application_review", unlocked: true };
}

/** Caseworker marks application submitted on visa portal. */
export async function recordVisaPortalSubmission({
  tenantDb,
  caseRecord,
  reference,
  performedBy,
  organisationId = null,
}) {
  const stage = resolveCaseStage(caseRecord);
  if (!["ccl_payment_received", "ccl_issued", "application_submitted"].includes(stage)) {
    return {
      ok: false,
      status: 400,
      message: "Application can only be marked submitted after CCL and payment are complete",
    };
  }

  const now = new Date().toISOString();
  await setWorkflowState(tenantDb, caseRecord, {
    visaPortal: { submittedAt: now, reference: reference || null, submittedBy: performedBy },
  });

  if (reference) {
    await caseRecord.update({ receiptNumber: reference });
  }

  await recordTimelineEntry({
    tenantDb,
    caseId: caseRecord.id,
    actionType: "application_submitted",
    description: reference
      ? `Application submitted on visa portal (ref: ${reference})`
      : "Application submitted on visa portal",
    performedBy,
    visibility: "public",
  });

  if (stage !== "application_submitted") {
    await applyCaseStageChange({
      tenantDb,
      caseRecord,
      nextStageId: "application_submitted",
      performedBy,
      reason: "Application submitted on visa portal",
      organisationId,
    });
  }

  return { ok: true, nextStage: "application_submitted" };
}

/** Candidate submits biometric availability preferences. */
export async function submitBiometricAvailability({
  tenantDb,
  caseRecord,
  preferredLocation,
  preferredDate,
  preferredTime,
  notes,
  performedBy,
  organisationId = null,
}) {
  const stage = resolveCaseStage(caseRecord);
  if (stage !== "application_submitted" && stage !== "biometrics_booked") {
    return {
      ok: false,
      status: 400,
      message: "Biometric availability can only be submitted after the application is submitted",
    };
  }

  if (!preferredLocation?.trim() || !preferredDate || !preferredTime?.trim()) {
    return {
      ok: false,
      status: 400,
      message: "Location, date, and time are required",
    };
  }

  const availability = {
    preferredLocation: preferredLocation.trim(),
    preferredDate,
    preferredTime: preferredTime.trim(),
    notes: notes?.trim() || null,
    submittedAt: new Date().toISOString(),
  };

  await setWorkflowState(tenantDb, caseRecord, {
    biometrics: { availability },
  });

  await recordTimelineEntry({
    tenantDb,
    caseId: caseRecord.id,
    actionType: "biometric_availability",
    description: `Candidate availability: ${preferredLocation}, ${preferredDate} ${preferredTime}`,
    performedBy,
    visibility: "internal",
    metadata: availability,
  });

  const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
  const adminIds = await getActiveAdminIds(tenantDb);
  const caseworkerIds = parseCaseworkerIds(caseRecord);

  for (const adminId of adminIds) {
    await createWorkflowTask({
      tenantDb,
      caseRecord,
      assigneeId: adminId,
      title: `Book biometrics slot — ${caseLabel}`,
      createdBy: performedBy,
      priority: "high",
      dueInDays: 2,
      organisationId,
    });
  }
  for (const cwId of caseworkerIds) {
    if (cwId === performedBy) continue;
    await createWorkflowTask({
      tenantDb,
      caseRecord,
      assigneeId: cwId,
      title: `Book biometrics slot — ${caseLabel}`,
      createdBy: performedBy,
      priority: "high",
      dueInDays: 2,
      organisationId,
    });
  }

  if (stage === "application_submitted") {
    await applyCaseStageChange({
      tenantDb,
      caseRecord,
      nextStageId: "biometrics_booked",
      performedBy,
      reason: "Candidate submitted biometric availability",
      organisationId,
      sendEmail: false,
    });
  }

  return { ok: true };
}

/** Caseworker books slot and sends confirmation to candidate. */
export async function sendBiometricSlotToCandidate({
  tenantDb,
  caseRecord,
  location,
  appointmentDate,
  appointmentTime,
  instructions,
  performedBy,
  organisationId = null,
}) {
  const stage = resolveCaseStage(caseRecord);
  if (!["biometrics_booked", "application_submitted"].includes(stage)) {
    return {
      ok: false,
      status: 400,
      message: "Book a slot only after the candidate has submitted availability",
    };
  }

  const state = getWorkflowState(caseRecord);
  if (!state.biometrics?.availability) {
    return {
      ok: false,
      status: 400,
      message: "Candidate has not submitted availability yet",
    };
  }

  if (!location?.trim() || !appointmentDate || !appointmentTime?.trim()) {
    return {
      ok: false,
      status: 400,
      message: "Location, date, and time are required for the booked slot",
    };
  }

  const bookedSlot = {
    location: location.trim(),
    appointmentDate,
    appointmentTime: appointmentTime.trim(),
    instructions: instructions?.trim() || null,
    sentToCandidateAt: new Date().toISOString(),
    bookedBy: performedBy,
  };

  await setWorkflowState(tenantDb, caseRecord, { biometrics: { bookedSlot } });
  await caseRecord.update({
    biometricsDate: appointmentDate,
  });

  await recordTimelineEntry({
    tenantDb,
    caseId: caseRecord.id,
    actionType: "biometric_slot_sent",
    description: `Biometrics appointment: ${location}, ${appointmentDate} ${appointmentTime}`,
    performedBy,
    visibility: "public",
    metadata: bookedSlot,
  });

  if (caseRecord.candidateId) {
    const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
    await createWorkflowTask({
      tenantDb,
      caseRecord,
      assigneeId: caseRecord.candidateId,
      title: `Attend biometrics appointment — ${caseLabel}`,
      createdBy: performedBy,
      priority: "high",
      dueInDays: 7,
      organisationId,
    });
    await notifyUser(tenantDb, caseRecord.candidateId, {
      tenantDb,
      type: NotificationTypes.INFO,
      priority: NotificationPriority.HIGH,
      title: "Biometrics appointment confirmed",
      message: `Your appointment is on ${appointmentDate} at ${appointmentTime}. Location: ${location}. Details are in your portal.`,
      actionType: "biometric_appointment",
      entityId: caseRecord.id,
      entityType: "case",
      metadata: { caseId: caseLabel, ...bookedSlot },
      sendEmail: true,
      organisationId,
    }).catch(() => {});
  }

  if (stage !== "biometrics_confirmation_sent") {
    await applyCaseStageChange({
      tenantDb,
      caseRecord,
      nextStageId: "biometrics_confirmation_sent",
      performedBy,
      reason: "Biometrics slot sent to candidate",
      organisationId,
    });
  }

  return { ok: true, nextStage: "biometrics_confirmation_sent" };
}

/** Caseworker confirms biometric documents uploaded to visa portal. */
export async function recordBiometricDocumentsUploaded({
  tenantDb,
  caseRecord,
  performedBy,
  organisationId = null,
}) {
  const stage = resolveCaseStage(caseRecord);
  if (!["biometrics_confirmation_sent", "biometrics_booked", "documents_uploaded"].includes(stage)) {
    return {
      ok: false,
      status: 400,
      message: "Upload confirmation is only available after biometrics confirmation is sent",
    };
  }

  const now = new Date().toISOString();
  await setWorkflowState(tenantDb, caseRecord, {
    biometrics: { documentsUploadedAt: now },
  });

  await recordTimelineEntry({
    tenantDb,
    caseId: caseRecord.id,
    actionType: "documents_uploaded",
    description: "Biometric documents uploaded to visa portal",
    performedBy,
    visibility: "internal",
  });

  if (stage !== "documents_uploaded") {
    await applyCaseStageChange({
      tenantDb,
      caseRecord,
      nextStageId: "documents_uploaded",
      performedBy,
      reason: "Biometric documents uploaded to visa portal",
      organisationId,
    });
  }

  return { ok: true, nextStage: "documents_uploaded" };
}

/** Caseworker records reply from visa portal email. */
export async function recordVisaPortalReply({
  tenantDb,
  caseRecord,
  replySummary,
  performedBy,
  organisationId = null,
}) {
  const stage = resolveCaseStage(caseRecord);
  if (!["documents_uploaded", "awaiting_decision"].includes(stage)) {
    return {
      ok: false,
      status: 400,
      message: "Record visa portal reply after biometric documents are uploaded",
    };
  }

  if (!replySummary?.trim()) {
    return { ok: false, status: 400, message: "Please describe the reply from the visa portal" };
  }

  const visaPortalReply = {
    summary: replySummary.trim(),
    recordedAt: new Date().toISOString(),
    recordedBy: performedBy,
  };

  await setWorkflowState(tenantDb, caseRecord, {
    biometrics: { visaPortalReply },
  });

  await recordTimelineEntry({
    tenantDb,
    caseId: caseRecord.id,
    actionType: "visa_portal_reply",
    description: `Visa portal reply recorded: ${replySummary.trim().slice(0, 200)}`,
    performedBy,
    visibility: "internal",
    metadata: visaPortalReply,
  });

  if (stage !== "awaiting_decision") {
    await applyCaseStageChange({
      tenantDb,
      caseRecord,
      nextStageId: "awaiting_decision",
      performedBy,
      reason: "Visa portal correspondence recorded — awaiting decision",
      organisationId,
    });
  }

  return { ok: true, nextStage: "awaiting_decision" };
}

/** Called when case enters draft_application_review — lock form and reset pending review if re-entering. */
export async function onEnterDraftApplicationReview(tenantDb, caseRecord) {
  await lockApplicationForDraftReview(tenantDb, caseRecord);
  const state = getWorkflowState(caseRecord);
  if (state.draftReview.confirmed === false) {
    return;
  }
  await setWorkflowState(tenantDb, caseRecord, {
    draftReview: { confirmed: null, confirmedAt: null },
  });
}
