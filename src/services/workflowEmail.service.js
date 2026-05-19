import { sendTransactionalEmail } from "./mail.service.js";

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

async function loadCaseContext(tenantDb, caseRecord) {
  const candidate = caseRecord.candidateId
    ? await tenantDb.User.findByPk(caseRecord.candidateId, {
        attributes: ["id", "first_name", "last_name", "email"],
      })
    : null;
  const visaType = caseRecord.visaTypeId
    ? await tenantDb.VisaType.findByPk(caseRecord.visaTypeId, { attributes: ["id", "name"] })
    : null;
  return { candidate, visaType };
}

/**
 * Send tenant email template when a case enters a workflow stage (best-effort).
 */
export async function sendWorkflowStageEmail({
  tenantDb,
  caseRecord,
  stageId,
  organisationId = null,
}) {
  const templateKey = STAGE_EMAIL_TEMPLATE[stageId];
  if (!templateKey || !tenantDb?.EmailTemplateSetting) return { sent: false };

  try {
    const row = await tenantDb.EmailTemplateSetting.findOne({
      where: { template_key: templateKey },
    });
    if (!row?.subject) return { sent: false, reason: "no_template" };

    const { candidate, visaType } = await loadCaseContext(tenantDb, caseRecord);
    if (!candidate?.email) return { sent: false, reason: "no_email" };

    const vars = {
      client_name: `${candidate.first_name || ""} ${candidate.last_name || ""}`.trim() || "Client",
      case_ref: caseRecord.caseId || String(caseRecord.id),
      visa_type: visaType?.name || "your application",
      firm_name: process.env.FIRM_NAME || "VisaFlow",
      biometrics_date: caseRecord.biometricsDate
        ? new Date(caseRecord.biometricsDate).toLocaleDateString("en-GB")
        : "TBC",
      amount:
        caseRecord.totalAmount != null
          ? `£${Number(caseRecord.totalAmount).toFixed(2)}`
          : "",
    };

    const subject = interpolate(row.subject, vars);
    const body = interpolate(row.body || "", vars);

    const result = await sendTransactionalEmail({
      organisationId,
      to: candidate.email,
      subject,
      text: body,
      html: '<div style="font-family:sans-serif;line-height:1.6;white-space:pre-wrap">' + body + '</div>',
    });

    if (!result.sent) {
      return { sent: false, reason: result.reason || result.error };
    }

    return { sent: true, to: candidate.email, templateKey, usedSource: result.usedSource };
  } catch (err) {
    console.error("sendWorkflowStageEmail error:", err.message);
    return { sent: false, error: err.message };
  }
}
