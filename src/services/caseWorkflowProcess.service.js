import { Op } from "sequelize";
import {
  resolveCaseStage,
  getStageOrder,
} from "../constants/immigrationCaseProcess.js";
import { applyCaseStageChange } from "./caseStageAutomation.service.js";
import { recordTimelineEntry } from "./caseTimeline.service.js";
import {
  createWorkflowTask,
  syncWorkflowTasksForStage,
} from "./workflowTaskAutomation.service.js";
import {
  notifyUser,
  NotificationTypes,
  NotificationPriority,
} from "./notification.service.js";
import { sendWorkflowStageEmail } from "./workflowEmail.service.js";

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
  const nextMeta = { ...(caseRecord.workflowMeta || {}), ...patch };
  await caseRecord.update({ workflowState: next, workflowMeta: nextMeta });
  caseRecord.workflowState = next;
  caseRecord.workflowMeta = nextMeta;
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
  const raw =
    caseRecord?.assignedcaseworkerId ?? caseRecord?.assignedCaseworkerId;
  if (!raw) return [];
  if (Array.isArray(raw))
    return raw.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (typeof raw === "object" && raw !== null) {
    const ids = raw.ids ?? raw.caseworkers ?? Object.values(raw);
    if (Array.isArray(ids))
      return ids.map(Number).filter((n) => Number.isFinite(n) && n > 0);
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
    await app.update({
      status: "submitted",
      isLocked: true,
      submittedAt: app.submittedAt || new Date(),
    });
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
    return {
      ok: false,
      status: 400,
      message: "Draft review is not active for this case",
    };
  }

  const state = getWorkflowState(caseRecord);
  if (state.draftReview.confirmed !== null) {
    return {
      ok: false,
      status: 400,
      message: "You have already responded to the draft review",
    };
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
  if (
    ![
      "client_care_letter",
      "ccl_payment_received",
      "ccl_issued",
      "application_submitted",
    ].includes(stage)
  ) {
    return {
      ok: false,
      status: 400,
      message:
        "Application can only be marked submitted after CCL and payment are complete",
    };
  }

  if (stage === "client_care_letter") {
    const ccl = await tenantDb.CaseCclRecord?.findOne({
      where: { caseId: caseRecord.id },
    });
    const cclOk = ccl && (ccl.status === "signed" || ccl.status === "accepted");
    const paid =
      caseRecord.amountStatus === "paid" ||
      (Number(caseRecord.totalAmount) > 0 &&
        Number(caseRecord.paidAmount) >= Number(caseRecord.totalAmount));
    if (!cclOk || !paid) {
      return {
        ok: false,
        status: 400,
        message:
          "Application can only be marked submitted after CCL and payment are complete",
      };
    }
  }

  const now = new Date().toISOString();
  await setWorkflowState(tenantDb, caseRecord, {
    visaPortal: {
      submittedAt: now,
      reference: reference || null,
      submittedBy: performedBy,
    },
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
  candidateTimezone = "UTC",
  performedBy,
  organisationId = null,
}) {
  if (!tenantDb || !caseRecord) {
    return {
      ok: false,
      status: 400,
      message: "Case record not found",
    };
  }

  const ws = getWorkflowState(caseRecord);
  let stage = resolveCaseStage(caseRecord);
  const visaPortalSubmitted = Boolean(ws?.visaPortal?.submittedAt);

  const pastBiometricsPhase = [
    "biometrics_confirmation_sent",
    "documents_uploaded",
    "awaiting_decision",
    "decision_communicated",
    "case_closure",
  ].includes(stage || "");

  if (pastBiometricsPhase) {
    return {
      ok: false,
      status: 400,
      message:
        "Biometric availability is no longer required — your case has already moved past this step.",
    };
  }

  if (!["application_submitted", "biometrics_booked"].includes(stage || "")) {
    if (visaPortalSubmitted) {
      try {
        await applyCaseStageChange({
          tenantDb,
          caseRecord,
          nextStageId: "application_submitted",
          performedBy,
          reason:
            "Sync stage with recorded visa portal submission before biometric availability",
          organisationId,
          sendEmail: false,
        });
        await caseRecord.reload();
        stage = resolveCaseStage(caseRecord);
      } catch (stageErr) {
        console.error("Stage sync error:", stageErr);
      }
    }
  }

  if (!["application_submitted", "biometrics_booked"].includes(stage || "")) {
    return {
      ok: false,
      status: 400,
      message:
        "Your caseworker must confirm that your application was submitted on the visa portal before you can send biometrics availability. If they have already done this, refresh the page and try again.",
    };
  }

  const location = String(preferredLocation || "").trim();
  const date = preferredDate ? String(preferredDate).trim() : null;
  const time = String(preferredTime || "").trim();

  if (!location || !date || !time) {
    return {
      ok: false,
      status: 400,
      message: "Location, date, and time are required",
    };
  }

  const availability = {
    preferredLocation: location,
    preferredDate: date,
    preferredTime: time,
    preferredTimezone: String(candidateTimezone || "UTC").trim(),
    notes: String(notes || "").trim() || null,
    submittedAt: new Date().toISOString(),
  };

  try {
    await setWorkflowState(tenantDb, caseRecord, {
      biometrics: { availability },
    });
  } catch (dbErr) {
    console.error("Failed to save biometric availability to database:", dbErr);
    return {
      ok: false,
      status: 500,
      message: "Failed to save biometric availability",
    };
  }

  try {
    await recordTimelineEntry({
      tenantDb,
      caseId: caseRecord.id,
      actionType: "biometric_availability",
      description: `Candidate availability: ${location}, ${date} ${time} (${availability.preferredTimezone})`,
      performedBy,
      visibility: "internal",
      metadata: availability,
    });
  } catch (timelineErr) {
    console.error(
      "Failed to record timeline entry for biometric availability:",
      timelineErr,
    );
  }

  const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
  const adminIds = await getActiveAdminIds(tenantDb).catch(() => []);
  const caseworkerIds = parseCaseworkerIds(caseRecord);

  for (const adminId of adminIds) {
    try {
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
    } catch (taskErr) {
      console.error(
        "Failed to create biometrics task for admin:",
        adminId,
        taskErr,
      );
    }
  }
  for (const cwId of caseworkerIds) {
    if (cwId === performedBy) continue;
    try {
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
    } catch (taskErr) {
      console.error(
        "Failed to create biometrics task for caseworker:",
        cwId,
        taskErr,
      );
    }
  }

  if (caseRecord.candidateId) {
    try {
      await notifyUser(tenantDb, caseRecord.candidateId, {
        tenantDb,
        type: NotificationTypes.SUCCESS,
        priority: NotificationPriority.HIGH,
        title: "Biometrics availability received",
        message: `Thank you — we recorded your preference for ${location} on ${date} at ${time}. Your caseworker will book your appointment and confirm the details.`,
        actionType: "biometric_availability_submitted",
        entityId: caseRecord.id,
        entityType: "case",
        metadata: { caseId: caseRecord.caseId || caseLabel },
        sendEmail: true,
        organisationId,
      }).catch(() => {});
    } catch (notifErr) {
      console.error(
        "Failed to send biometrics availability notification:",
        notifErr,
      );
    }
  }

  if (stage === "application_submitted") {
    try {
      await applyCaseStageChange({
        tenantDb,
        caseRecord,
        nextStageId: "biometrics_booked",
        performedBy,
        reason: "Candidate submitted biometric availability",
        organisationId,
        sendEmail: false,
      });
    } catch (stageErr) {
      console.error(
        "Stage change error after biometric availability:",
        stageErr,
      );
    }
  }

  return { ok: true };
}

/**
 * Admin/caseworker books biometrics when moving to biometrics_booked (no prior availability required).
 */
export async function bookBiometricDirect({
  tenantDb,
  caseRecord,
  location,
  appointmentDate,
  appointmentDay,
  appointmentTime,
  instructions,
  performedBy,
  organisationId = null,
}) {
  if (!location?.trim() || !appointmentDate || !appointmentTime?.trim()) {
    return {
      ok: false,
      status: 400,
      message:
        "Location, date, and time are required for the biometric appointment",
    };
  }

  const bookedSlot = {
    location: location.trim(),
    appointmentDate,
    appointmentDay: appointmentDay?.trim() || null,
    appointmentTime: appointmentTime.trim(),
    instructions: instructions?.trim() || null,
    sentToCandidateAt: new Date().toISOString(),
    bookedBy: performedBy,
  };

  await setWorkflowState(tenantDb, caseRecord, { biometrics: { bookedSlot } });
  await caseRecord.update({
    biometricsDate: appointmentDate,
    biometricLocation: location.trim(),
    biometricTime: appointmentTime.trim(),
    biometricDay: appointmentDay?.trim() || null,
  });

  await recordTimelineEntry({
    tenantDb,
    caseId: caseRecord.id,
    actionType: "biometric_slot_sent",
    description:
      `Biometrics booked: ${location}, ${appointmentDay || ""} ${appointmentDate} ${appointmentTime}`.trim(),
    performedBy,
    visibility: "public",
    metadata: bookedSlot,
  });

  const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
  if (caseRecord.candidateId) {
    await createWorkflowTask({
      tenantDb,
      caseRecord,
      assigneeId: caseRecord.candidateId,
      title: `Attend biometrics — ${caseLabel}`,
      createdBy: performedBy,
      priority: "high",
      dueInDays: 7,
      organisationId,
    });
    await notifyUser(tenantDb, caseRecord.candidateId, {
      tenantDb,
      type: NotificationTypes.INFO,
      priority: NotificationPriority.HIGH,
      title: "Biometrics appointment booked",
      message: `Your biometrics appointment is scheduled for ${appointmentDay ? `${appointmentDay}, ` : ""}${appointmentDate} at ${appointmentTime}. Location: ${location.trim()}.`,
      actionType: "biometric_appointment",
      entityId: caseRecord.id,
      entityType: "case",
      metadata: { caseId: caseLabel, ...bookedSlot },
      sendEmail: true,
      organisationId,
    }).catch(() => {});
  }

  const stage = resolveCaseStage(caseRecord);
  if (stage !== "biometrics_booked") {
    await applyCaseStageChange({
      tenantDb,
      caseRecord,
      nextStageId: "biometrics_booked",
      performedBy,
      reason: "Biometrics appointment booked",
      organisationId,
      sendEmail: false,
    });
  }

  await caseRecord.reload();
  const dayLabel = appointmentDay?.trim() || "";
  const dateLabel = appointmentDate
    ? new Date(appointmentDate).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";
  await sendWorkflowStageEmail({
    tenantDb,
    caseRecord,
    stageId: "biometrics_booked",
    organisationId,
    extraVars: {
      biometrics_location: location.trim(),
      biometrics_day: dayLabel,
      biometrics_time: appointmentTime.trim(),
      biometrics_date: dateLabel,
      appointment_instructions: instructions?.trim() || "",
    },
  }).catch((err) => console.error("biometrics_booked email:", err));

  return { ok: true, nextStage: "biometrics_booked", bookedSlot };
}

/** True when staff have booked an appointment (workflow state or case columns). */
export function hasBiometricAppointmentBooked(caseRecord, ws = null) {
  const state = ws ?? getWorkflowState(caseRecord);
  if (state.biometrics?.bookedSlot) return true;
  if (caseRecord?.biometricLocation?.trim()) return true;
  if (caseRecord?.biometricsDate) return true;
  return false;
}

function effectiveBiometricBookedSlot(caseRecord, ws) {
  if (ws.biometrics?.bookedSlot) return ws.biometrics.bookedSlot;
  if (!hasBiometricAppointmentBooked(caseRecord, ws)) return null;
  return {
    location: caseRecord.biometricLocation?.trim() || "Biometrics centre",
    appointmentDate: caseRecord.biometricsDate,
    appointmentDay: caseRecord.biometricDay?.trim() || null,
    appointmentTime: caseRecord.biometricTime?.trim() || null,
    hydratedFromCase: true,
  };
}

async function completePendingBiometricAttendTasks(
  tenantDb,
  caseRecord,
  candidateId,
) {
  if (!candidateId || !caseRecord?.id) return;
  await tenantDb.Task.update(
    { status: "completed" },
    {
      where: {
        case_id: caseRecord.id,
        assigned_to: candidateId,
        status: "pending",
        title: { [Op.iLike]: "%attend biometrics%" },
      },
    },
  );
}

async function syncCandidateApplicationAfterBiometrics(tenantDb, caseRecord) {
  const candidateId = caseRecord.candidateId;
  if (!candidateId || !tenantDb.CandidateApplication) return;
  const app = await tenantDb.CandidateApplication.findOne({
    where: { userId: candidateId },
  });
  if (!app) return;
  if (app.status === "submitted") {
    await app.update({ status: "under_review" });
  }
}

/** Candidate confirms they attended the biometrics appointment. */
export async function markBiometricAttendedByCandidate({
  tenantDb,
  caseRecord,
  performedBy,
  organisationId = null,
}) {
  await caseRecord.reload();

  const ws = getWorkflowState(caseRecord);
  const stage = resolveCaseStage(caseRecord);
  const awaitingOrder = getStageOrder("awaiting_decision");

  if (getStageOrder(stage) >= awaitingOrder) {
    return { ok: true, nextStage: stage, alreadyDone: true };
  }

  if (!hasBiometricAppointmentBooked(caseRecord, ws)) {
    return {
      ok: false,
      status: 400,
      message: "No biometrics appointment is booked for this case yet",
    };
  }

  const bookedSlot = effectiveBiometricBookedSlot(caseRecord, ws);
  const biometricsPatch = {
    ...ws.biometrics,
    attendedAt: new Date().toISOString(),
    attendedBy: performedBy,
  };
  if (bookedSlot && !ws.biometrics?.bookedSlot) {
    biometricsPatch.bookedSlot = bookedSlot;
  }

  await setWorkflowState(tenantDb, caseRecord, { biometrics: biometricsPatch });

  await recordTimelineEntry({
    tenantDb,
    caseId: caseRecord.id,
    actionType: "biometric_attended",
    description: "Candidate confirmed biometrics attendance",
    performedBy,
    visibility: "public",
  });

  await applyCaseStageChange({
    tenantDb,
    caseRecord,
    nextStageId: "awaiting_decision",
    performedBy,
    reason: "Candidate attended biometrics — awaiting decision",
    organisationId,
    sendEmail: false,
  });

  await completePendingBiometricAttendTasks(tenantDb, caseRecord, performedBy);
  await syncCandidateApplicationAfterBiometrics(tenantDb, caseRecord);

  const caseLabel = caseRecord.caseId || `#${caseRecord.id}`;
  const notifyIds = new Set([
    ...(await getActiveAdminIds(tenantDb)),
    ...parseCaseworkerIds(caseRecord),
  ]);

  for (const uid of notifyIds) {
    if (uid === performedBy) continue;
    await notifyUser(tenantDb, uid, {
      tenantDb,
      type: NotificationTypes.CASE_STATUS_CHANGED,
      priority: NotificationPriority.HIGH,
      title: `Biometrics attended — ${caseLabel}`,
      message: `The candidate has confirmed they attended their biometrics appointment. Case is now awaiting decision.`,
      actionType: "biometric_attended",
      entityId: caseRecord.id,
      entityType: "case",
      metadata: { caseId: caseLabel },
      sendEmail: true,
      organisationId,
    }).catch(() => {});
  }

  return { ok: true, nextStage: "awaiting_decision" };
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
      message:
        "Book a slot only after the candidate has submitted availability",
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
  if (
    ![
      "biometrics_confirmation_sent",
      "biometrics_booked",
      "documents_uploaded",
    ].includes(stage)
  ) {
    return {
      ok: false,
      status: 400,
      message:
        "Upload confirmation is only available after biometrics confirmation is sent",
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
      message:
        "Record visa portal reply after biometric documents are uploaded",
    };
  }

  if (!replySummary?.trim()) {
    return {
      ok: false,
      status: 400,
      message: "Please describe the reply from the visa portal",
    };
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
