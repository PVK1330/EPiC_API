import { sendTransactionalEmail } from "./mail.service.js";
import {
  buildDataCaptureSheetAttachment,
  resolveDataCaptureTemplate,
} from "./dataCaptureSheet.service.js";

/** Workflow stage → email_templates.template_key */
export const STAGE_EMAIL_TEMPLATE = {
  data_capture_initial_docs: "data_capture_request",
  draft_application_review: "draft_application_review",
  client_care_letter: "ccl_issued",
  ccl_issued: "ccl_issued",
  biometrics_confirmation_sent: "biometrics_confirmation",
  decision_communicated: "decision_communicated",
  case_closure: "case_closure",
};

function interpolate(template, vars) {
  if (!template) return "";
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

function parseAssignedCaseworkerIds(caseRecord) {
  const raw = caseRecord?.assignedcaseworkerId ?? caseRecord?.assignedCaseworkerId;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  }
  if (typeof raw === "object" && raw !== null) {
    const ids = raw.ids ?? raw.caseworkers ?? Object.values(raw);
    if (Array.isArray(ids)) {
      return ids.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    }
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? [n] : [];
}

function fullName(user, fallback = "") {
  if (!user) return fallback;
  const name = `${user.first_name || ""} ${user.last_name || ""}`.trim();
  return name || fallback;
}

function formatBiometricsDate(caseRecord) {
  if (caseRecord.biometricsDate) {
    return new Date(caseRecord.biometricsDate).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  const ws =
    caseRecord?.workflowState && typeof caseRecord.workflowState === "object"
      ? caseRecord.workflowState
      : {};
  const bookedDate = ws?.biometrics?.bookedSlot?.appointmentDate;
  if (bookedDate) {
    return new Date(bookedDate).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  return "TBC";
}

async function loadCaseContext(tenantDb, caseRecord) {
  const candidate = caseRecord.candidateId
    ? await tenantDb.User.findByPk(caseRecord.candidateId, {
        attributes: ["id", "first_name", "last_name", "email"],
      })
    : null;
  const visaType = caseRecord.visaTypeId
    ? await tenantDb.VisaType.findByPk(caseRecord.visaTypeId, { attributes: ["id", "name"] })
    : null;

  const cwIds = parseAssignedCaseworkerIds(caseRecord);
  const caseworker = cwIds.length
    ? await tenantDb.User.findByPk(cwIds[0], {
        attributes: ["id", "first_name", "last_name", "email"],
      })
    : null;

  const sponsorUserId = caseRecord.sponsorId || caseRecord.businessId || null;
  const sponsor = sponsorUserId
    ? await tenantDb.User.findByPk(sponsorUserId, {
        attributes: ["id", "first_name", "last_name", "email"],
      })
    : null;

  return { candidate, visaType, caseworker, sponsor };
}

/**
 * Send tenant email template when a case enters a workflow stage (best-effort).
 */
export async function sendWorkflowStageEmail({
  tenantDb,
  caseRecord,
  stageId,
  organisationId = null,
  attachments = null,
  extraVars = null,
}) {
  const templateKey = STAGE_EMAIL_TEMPLATE[stageId];
  if (!templateKey || !tenantDb?.EmailTemplateSetting) return { sent: false };

  try {
    const row = await tenantDb.EmailTemplateSetting.findOne({
      where: { template_key: templateKey },
    });
    if (!row?.subject) return { sent: false, reason: "no_template" };

    const { candidate, visaType, caseworker, sponsor } = await loadCaseContext(
      tenantDb,
      caseRecord,
    );
    if (!candidate?.email) return { sent: false, reason: "no_email" };

    let mailAttachments = Array.isArray(attachments) ? [...attachments] : [];
    if (templateKey === "data_capture_request" && mailAttachments.length === 0) {
      const dcsTemplate = await resolveDataCaptureTemplate(
        tenantDb,
        caseRecord.visaTypeId,
      );
      if (dcsTemplate) {
        const sheet = buildDataCaptureSheetAttachment({
          template: dcsTemplate,
          caseRecord,
          candidate,
          visaTypeName: visaType?.name || "",
        });
        if (sheet) mailAttachments = [sheet];
      }
    }

    const portalBase =
      process.env.FRONTEND_URL?.split(",")[0]?.trim() || "http://localhost:5173";
    const portalRoot = portalBase.replace(/\/$/, "");

    const vars = {
      client_name: fullName(candidate, "Client"),
      case_ref: caseRecord.caseId || String(caseRecord.id),
      visa_type: visaType?.name || "your application",
      firm_name: process.env.FIRM_NAME || "VisaFlow",
      biometrics_date: formatBiometricsDate(caseRecord),
      amount:
        caseRecord.totalAmount != null
          ? `£${Number(caseRecord.totalAmount).toFixed(2)}`
          : "",
      caseworker_name: fullName(caseworker, "Your Caseworker"),
      employer_name: fullName(sponsor, "Employer"),
      portal_link: `${portalRoot}/candidate/dashboard`,
      data_capture_link: `${portalRoot}/candidate/data-capture-sheet`,
      ...(extraVars && typeof extraVars === "object" ? extraVars : {}),
    };

    const subject = interpolate(row.subject, vars);
    let body = interpolate(row.body || "", vars);

    if (templateKey === "data_capture_request") {
      const link = vars.data_capture_link;
      if (link && !body.includes(link)) {
        body += `\n\nAlternatively, you can complete the Data Capture Sheet online: ${link}`;
      }
    }

    const result = await sendTransactionalEmail({
      organisationId,
      to: candidate.email,
      subject,
      text: body,
      html:
        '<div style="font-family:sans-serif;line-height:1.6;white-space:pre-wrap">' +
        body.replace(/\n/g, "<br>") +
        "</div>",
      attachments: mailAttachments.length ? mailAttachments : null,
      failureContext: `workflow_email:${templateKey}`,
    });

    if (!result.sent) {
      return { sent: false, reason: result.reason || result.error };
    }

    return {
      sent: true,
      to: candidate.email,
      templateKey,
      usedSource: result.usedSource,
      attachmentIncluded: mailAttachments.length > 0,
      attachmentFilename: mailAttachments[0]?.filename || null,
    };
  } catch (err) {
    console.error("sendWorkflowStageEmail error:", err.message);
    return { sent: false, error: err.message };
  }
}
