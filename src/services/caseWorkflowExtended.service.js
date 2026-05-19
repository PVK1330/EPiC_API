import { Op } from "sequelize";
import { resolveCaseStage } from "../constants/immigrationCaseProcess.js";
import { applyCaseStageChange } from "./caseStageAutomation.service.js";
import { recordTimelineEntry } from "./caseTimeline.service.js";
import {
  createWorkflowTask,
  getActiveAdminIds,
} from "./workflowTaskAutomation.service.js";

function parseCaseworkerIds(caseRecord) {
  const raw = caseRecord?.assignedcaseworkerId ?? caseRecord?.assignedCaseworkerId;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? [n] : [];
}

export function getWorkflowMeta(caseRecord) {
  const raw = caseRecord?.workflowMeta ?? caseRecord?.workflow_meta ?? {};
  return typeof raw === "object" && raw !== null ? { ...raw } : {};
}

async function saveWorkflowMeta(tenantDb, caseRecord, patch) {
  const next = { ...getWorkflowMeta(caseRecord), ...patch };
  await caseRecord.update({ workflowMeta: next });
  return next;
}

async function lockCandidateApplication(tenantDb, candidateId, locked) {
  if (!candidateId || !tenantDb.CandidateApplication) return;
  const app = await tenantDb.CandidateApplication.findOne({ where: { userId: candidateId } });
  if (!app) return;
  await app.update({
    isLocked: locked,
    ...(locked ? { status: "submitted" } : {}),
  });
}

/** Entering draft review: lock form until candidate approves or requests changes. */
export async function onEnterDraftApplicationReview({ tenantDb, caseRecord, performedBy }) {
  if (!caseRecord?.candidateId) return;
  await lockCandidateApplication(tenantDb, caseRecord.candidateId, true);
  await saveWorkflowMeta(tenantDb, caseRecord, {
    draftReview: { status: "pending", requestedAt: new Date().toISOString() },
  });
  await createWorkflowTask({
    tenantDb,
    caseRecord,
    assigneeId: caseRecord.candidateId,
    title: "Review your draft application — confirm or request changes",
    priority: "high",
    dueInDays: 5,
    createdBy: performedBy,
  });
}

/** Candidate Yes/No on draft application. */
export async function submitDraftReviewResponse({
  tenantDb,
  caseRecord,
  candidateId,
  approved,
}) {
  const stage = resolveCaseStage(caseRecord);
  if (stage !== "draft_application_review") {
    return { ok: false, status: 400, message: "Draft review is not active for your case" };
  }

  const meta = getWorkflowMeta(caseRecord);
  if (meta.draftReview?.status === "approved") {
    return { ok: false, status: 400, message: "You have already confirmed this draft" };
  }

  if (approved) {
    await saveWorkflowMeta(tenantDb, caseRecord, {
      draftReview: { status: "approved", respondedAt: new Date().toISOString() },
    });
    await lockCandidateApplication(tenantDb, candidateId, true);
    const cwIds = parseCaseworkerIds(caseRecord);
    for (const cwId of cwIds) {
      await createWorkflowTask({
        tenantDb,
        caseRecord,
        assigneeId: cwId,
        title: "Candidate approved draft application — proceed to CCL",
        priority: "medium",
        dueInDays: 3,
        createdBy: candidateId,
      });
    }
    await recordTimelineEntry({
      tenantDb,
      caseId: caseRecord.id,
      actionType: "case_updated",
      description: "Candidate confirmed draft application is correct",
      performedBy: candidateId,
      visibility: "public",
    });
    return { ok: true, draftReviewStatus: "approved", canEdit: false };
  }

  await saveWorkflowMeta(tenantDb, caseRecord, {
    draftReview: { status: "changes_requested", respondedAt: new Date().toISOString() },
  });
  await lockCandidateApplication(tenantDb, candidateId, false);
  const cwIds = parseCaseworkerIds(caseRecord);
  for (const cwId of cwIds) {
    await createWorkflowTask({
      tenantDb,
      caseRecord,
      assigneeId: cwId,
      title: "Candidate requested changes to draft application",
      priority: "high",
      dueInDays: 2,
      createdBy: candidateId,
    });
  }
  await recordTimelineEntry({
    tenantDb,
    caseId: caseRecord.id,
    actionType: "case_updated",
    description: "Candidate requested changes to the draft application",
    performedBy: candidateId,
    visibility: "public",
  });
  return { ok: true, draftReviewStatus: "changes_requested", canEdit: true };
}

export async function getDraftReviewState(tenantDb, caseRecord, candidateId) {
  const stage = resolveCaseStage(caseRecord);
  const meta = getWorkflowMeta(caseRecord);
  const app = await tenantDb.CandidateApplication?.findOne({
    where: { userId: candidateId },
    attributes: ["isLocked", "status"],
  });
  const inDraftReview = stage === "draft_application_review";
  const status = meta.draftReview?.status || (inDraftReview ? "pending" : null);
  const canEdit =
    inDraftReview &&
    (status === "changes_requested" || (!app?.isLocked && status !== "approved"));

  return {
    caseStage: stage,
    inDraftReview,
    draftReviewStatus: status,
    canEdit: Boolean(canEdit),
    isLocked: Boolean(app?.isLocked) && status !== "changes_requested",
    showDraftReviewPrompt: inDraftReview && status !== "approved",
  };
}

/** After CCL fees approved — caseworker submits on visa portal. */
export async function createVisaPortalSubmissionTasks({ tenantDb, caseRecord, createdBy }) {
  const cwIds = parseCaseworkerIds(caseRecord);
  for (const cwId of cwIds) {
    await createWorkflowTask({
      tenantDb,
      caseRecord,
      assigneeId: cwId,
      title: "Submit application form on the UK Visa Portal",
      priority: "high",
      dueInDays: 3,
      createdBy,
    });
  }
}

/** After application submitted — ask candidate availability + CW follow-up. */
export async function onEnterApplicationSubmitted({ tenantDb, caseRecord, performedBy }) {
  await saveWorkflowMeta(tenantDb, caseRecord, {
    biometricAvailability: { status: "awaiting_candidate" },
  });
  await createWorkflowTask({
    tenantDb,
    caseRecord,
    assigneeId: caseRecord.candidateId,
    title: "Provide biometrics availability (date, time, location)",
    priority: "high",
    dueInDays: 5,
    createdBy: performedBy,
  });
  const cwIds = parseCaseworkerIds(caseRecord);
  for (const cwId of cwIds) {
    await createWorkflowTask({
      tenantDb,
      caseRecord,
      assigneeId: cwId,
      title: "Request biometrics availability from candidate",
      priority: "high",
      dueInDays: 2,
      createdBy: performedBy,
    });
  }
}

export async function submitBiometricAvailability({
  tenantDb,
  caseRecord,
  candidateId,
  payload,
}) {
  const stage = resolveCaseStage(caseRecord);
  if (!["application_submitted", "biometrics_booked"].includes(stage)) {
    return {
      ok: false,
      status: 400,
      message: "Biometrics availability can only be submitted after application submission",
    };
  }

  const availability = {
    status: "submitted",
    preferredDate: payload.preferredDate || null,
    preferredTime: payload.preferredTime || null,
    location: payload.location || null,
    notes: payload.notes || null,
    submittedAt: new Date().toISOString(),
  };
  await saveWorkflowMeta(tenantDb, caseRecord, { biometricAvailability: availability });

  const cwIds = parseCaseworkerIds(caseRecord);
  const adminIds = await getActiveAdminIds(tenantDb);
  const assignees = [...new Set([...cwIds, ...adminIds])];

  for (const userId of assignees) {
    await createWorkflowTask({
      tenantDb,
      caseRecord,
      assigneeId: userId,
      title: `Book biometrics slot — candidate availability received`,
      priority: "high",
      dueInDays: 2,
      createdBy: candidateId,
    });
  }

  await recordTimelineEntry({
    tenantDb,
    caseId: caseRecord.id,
    actionType: "case_updated",
    description: `Candidate submitted biometrics availability: ${availability.location || "location TBC"}, ${availability.preferredDate || "date TBC"}`,
    performedBy: candidateId,
    metadata: availability,
    visibility: "internal",
  });

  return { ok: true, availability };
}

/** Staff books slot and notifies candidate — advances to biometrics_confirmation_sent. */
export async function confirmBiometricSlot({
  tenantDb,
  caseRecord,
  performedBy,
  organisationId,
  slot,
}) {
  const { date, time, location, instructions } = slot;
  if (!date || !location) {
    return { ok: false, status: 400, message: "Appointment date and location are required" };
  }

  const booked = {
    date,
    time: time || null,
    location,
    instructions: instructions || null,
    bookedBy: performedBy,
    sentToCandidateAt: new Date().toISOString(),
  };
  await saveWorkflowMeta(tenantDb, caseRecord, {
    biometricSlot: booked,
    biometricAvailability: {
      ...getWorkflowMeta(caseRecord).biometricAvailability,
      status: "booked",
    },
  });

  await caseRecord.update({ biometricsDate: date });

  await applyCaseStageChange({
    tenantDb,
    caseRecord,
    nextStageId: "biometrics_confirmation_sent",
    performedBy,
    reason: "Biometrics appointment booked and confirmation sent to candidate",
    sendEmail: true,
    organisationId,
  });

  await createWorkflowTask({
    tenantDb,
    caseRecord,
    assigneeId: caseRecord.candidateId,
    title: `Attend biometrics on ${date}${time ? ` at ${time}` : ""} — ${location}`,
    priority: "high",
    dueInDays: 7,
    createdBy: performedBy,
  });

  return { ok: true, slot: booked };
}

/** After biometrics confirmation — upload docs to visa portal. */
export async function onEnterBiometricsConfirmationSent({ tenantDb, caseRecord, performedBy }) {
  const cwIds = parseCaseworkerIds(caseRecord);
  for (const cwId of cwIds) {
    await createWorkflowTask({
      tenantDb,
      caseRecord,
      assigneeId: cwId,
      title: "Upload biometric documents to the UK Visa Portal",
      priority: "high",
      dueInDays: 2,
      createdBy: performedBy,
    });
  }
}

/** Awaiting decision — monitor visa portal inbox. */
export async function onEnterAwaitingDecision({ tenantDb, caseRecord, performedBy }) {
  const cwIds = parseCaseworkerIds(caseRecord);
  for (const cwId of cwIds) {
    await createWorkflowTask({
      tenantDb,
      caseRecord,
      assigneeId: cwId,
      title: "Check UK Visa Portal email and record Home Office reply",
      priority: "medium",
      dueInDays: 3,
      createdBy: performedBy,
    });
  }
}

export async function recordVisaPortalUpdate({
  tenantDb,
  caseRecord,
  performedBy,
  payload,
}) {
  const { portalStatus, replyFromPortal, notes } = payload;
  const entry = {
    portalStatus: portalStatus || null,
    replyFromPortal: replyFromPortal || null,
    notes: notes || null,
    updatedAt: new Date().toISOString(),
    updatedBy: performedBy,
  };
  await saveWorkflowMeta(tenantDb, caseRecord, { visaPortal: entry });

  await recordTimelineEntry({
    tenantDb,
    caseId: caseRecord.id,
    actionType: "case_updated",
    description: `Visa portal update: ${portalStatus || "status recorded"}`,
    performedBy,
    metadata: entry,
    visibility: "internal",
  });

  return { ok: true, visaPortal: entry };
}

export async function runStageEntryHooks({
  tenantDb,
  caseRecord,
  nextStage,
  performedBy,
  organisationId,
}) {
  switch (nextStage) {
    case "draft_application_review":
      await onEnterDraftApplicationReview({ tenantDb, caseRecord, performedBy });
      break;
    case "application_submitted":
      await onEnterApplicationSubmitted({ tenantDb, caseRecord, performedBy });
      break;
    case "biometrics_confirmation_sent":
      await onEnterBiometricsConfirmationSent({ tenantDb, caseRecord, performedBy });
      break;
    case "awaiting_decision":
      await onEnterAwaitingDecision({ tenantDb, caseRecord, performedBy });
      break;
    default:
      break;
  }
}
