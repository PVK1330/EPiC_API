import { sendTransactionalEmail } from "./mail.service.js";
import {
  buildDataCaptureSheetAttachment,
  resolveDataCaptureTemplate,
} from "./dataCaptureSheet.service.js";
import { wrapEpicEmail } from "../utils/epicEmailLayout.js";
import logger from "../utils/logger.js";

/** Workflow stage → email_templates.template_key */
export const STAGE_EMAIL_TEMPLATE = {
  data_capture_initial_docs: "data_capture_request",
  draft_application_review: "draft_application_review",
  client_care_letter: "ccl_issued",
  ccl_issued: "ccl_issued",
  biometrics_booked: "biometrics_confirmation",
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

    let bodyHtml = "";

    if (templateKey === "biometrics_confirmation") {
      const loc = vars.biometrics_location;
      const day = vars.biometrics_day;
      const time = vars.biometrics_time;
      const date = vars.biometrics_date || vars.biometrics_date;
      const instructions = vars.appointment_instructions;

      // Build styled appointment card for email
      const dateDisplay = [day, date].filter(Boolean).join(", ") || "TBC";

      const appointmentRows = [
        { icon: "📍", label: "Location", value: loc || "TBC" },
        { icon: "📅", label: "Date", value: dateDisplay },
        { icon: "🕐", label: "Time", value: time || "TBC" },
      ];

      const appointmentTableRows = appointmentRows
        .map(
          (row) => `
          <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid #f1f5f9; width: 110px; color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; vertical-align: top;">
              ${row.icon} &nbsp;${row.label}
            </td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #f1f5f9; color: #0f172a; font-size: 14px; font-weight: 700; vertical-align: top;">
              ${row.value}
            </td>
          </tr>`
        )
        .join("");

      const instructionsHtml = instructions
        ? `<div style="margin-top: 20px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 16px;">
             <p style="margin: 0 0 6px 0; font-size: 12px; font-weight: 700; color: #92400e; text-transform: uppercase; letter-spacing: 0.5px;">⚠️ &nbsp;Instructions</p>
             <p style="margin: 0; font-size: 14px; color: #78350f; line-height: 1.6;">${instructions}</p>
           </div>`
        : "";

      bodyHtml = `
        <p style="font-size: 15px; color: #475569; line-height: 1.6; margin: 0 0 24px 0;">
          Dear ${vars.client_name},<br><br>
          Your biometrics appointment has been confirmed for case <strong>${vars.case_ref}</strong>. Please find your appointment details below.
        </p>

        <div style="border: 2px solid #dbeafe; border-radius: 12px; overflow: hidden; margin-bottom: 24px;">
          <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 14px 16px;">
            <p style="margin: 0; color: #ffffff; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">
              📋 &nbsp;Biometrics Appointment Details
            </p>
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #ffffff;">
            ${appointmentTableRows}
          </table>
        </div>

        ${instructionsHtml}

        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 16px; margin-top: 20px;">
          <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: 700; color: #166534;">✅ &nbsp;What you need to do</p>
          <ul style="margin: 0; padding-left: 20px; color: #15803d; font-size: 13px; line-height: 1.8;">
            <li>Attend your appointment at the location above on time</li>
            <li>Bring your valid passport and any relevant travel documents</li>
            <li>Bring a printed copy of this confirmation email or have it ready on your phone</li>
            <li>Arrive at least 15 minutes before your scheduled appointment</li>
          </ul>
        </div>

        <p style="font-size: 14px; color: #64748b; margin-top: 24px; line-height: 1.6;">
          If you have any questions or need to reschedule, please contact your caseworker <strong>${vars.caseworker_name}</strong> immediately.
        </p>
      `;

      // Ensure plain text fallback also contains full details
      if (loc && !body.includes(loc)) {
        body += `\n\nAppointment Details:\nLocation: ${loc}\nDate: ${dateDisplay}\nTime: ${time || "TBC"}`;
        if (instructions) body += `\n\nInstructions: ${instructions}`;
      }
    } else {
      bodyHtml = body.replace(/\n/g, "<br>");
    }

    const result = await sendTransactionalEmail({
      organisationId,
      to: candidate.email,
      subject,
      text: body,
      html: wrapEpicEmail({
        pageTitle: subject,
        badge:
          templateKey === "biometrics_confirmation"
            ? "Biometrics Appointment Confirmed"
            : "",
        title: subject,
        messageHtml: "",
        bodyHtml,
        ctaUrl: vars.portal_link,
        ctaLabel: "View Your Case in Portal",
      }),
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
    logger.error({ err }, "sendWorkflowStageEmail error");
    return { sent: false, error: err.message };
  }
}
