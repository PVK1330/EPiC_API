/**
 * cclTags.service.js
 * The placeholder/tag system for dynamic Client Care Letters.
 *
 *  - getCclTagRegistry(): the catalogue of supported {{tags}} (drives both the
 *    admin editor's tag palette and template validation).
 *  - buildCclContext(): resolves a case/candidate/org into concrete tag values.
 *  - interpolateCclHtml(): replaces {{tags}} in a template body with those values.
 *
 * Text values are HTML-escaped (candidate-supplied data must never inject markup
 * into the letter). "block" tags (e.g. the installment table) emit trusted HTML
 * we build ourselves and are inserted raw.
 */

import logger from "../utils/logger.js";

// ── Tag catalogue ─────────────────────────────────────────────────────────────
export const CCL_TAGS = [
  // Organisation / branding
  { tag: "org_name", label: "Organisation name", group: "Organisation", type: "text", sample: "Elite Immigration Ltd" },
  { tag: "org_logo", label: "Organisation logo", group: "Organisation", type: "block", sample: "[logo]" },
  { tag: "org_address", label: "Organisation address", group: "Organisation", type: "text", sample: "1 High Street, London, EC1A 1AA" },
  { tag: "org_email", label: "Organisation email", group: "Organisation", type: "text", sample: "contact@example.com" },
  { tag: "org_phone", label: "Organisation phone", group: "Organisation", type: "text", sample: "+44 20 1234 5678" },

  // Candidate
  { tag: "candidate_name", label: "Candidate full name", group: "Candidate", type: "text", sample: "Jane Doe" },
  { tag: "candidate_first_name", label: "Candidate first name", group: "Candidate", type: "text", sample: "Jane" },
  { tag: "candidate_email", label: "Candidate email", group: "Candidate", type: "text", sample: "jane.doe@example.com" },
  { tag: "candidate_address", label: "Candidate address", group: "Candidate", type: "text", sample: "22 Park Lane, Manchester, M1 2AB" },
  { tag: "candidate_phone", label: "Candidate phone", group: "Candidate", type: "text", sample: "+44 7700 900123" },
  { tag: "candidate_dob", label: "Candidate date of birth", group: "Candidate", type: "text", sample: "14 March 1992" },
  { tag: "passport_number", label: "Passport number", group: "Candidate", type: "text", sample: "123456789" },
  { tag: "nationality", label: "Nationality", group: "Candidate", type: "text", sample: "Indian" },

  // Case
  { tag: "case_ref", label: "Case reference", group: "Case", type: "text", sample: "EPIC-2026-0042" },
  { tag: "visa_type", label: "Visa type", group: "Case", type: "text", sample: "Skilled Worker" },
  { tag: "petition_type", label: "Petition type", group: "Case", type: "text", sample: "Initial application" },
  { tag: "caseworker_name", label: "Caseworker name", group: "Case", type: "text", sample: "Alex Smith" },
  { tag: "date_today", label: "Today's date", group: "Case", type: "text", sample: "5 June 2026" },
  { tag: "date_issued", label: "CCL issue date", group: "Case", type: "text", sample: "5 June 2026" },

  // Fees
  { tag: "proposed_amount", label: "Proposed amount", group: "Fees", type: "text", sample: "£1,500.00" },
  { tag: "total_amount", label: "Total amount", group: "Fees", type: "text", sample: "£1,500.00" },
  { tag: "fee_amount", label: "CCL fee amount", group: "Fees", type: "text", sample: "£1,500.00" },
  { tag: "amount_in_words", label: "Amount in words", group: "Fees", type: "text", sample: "One thousand five hundred pounds" },
  { tag: "installment_plan", label: "Installment plan (table)", group: "Fees", type: "block", sample: "[installment table]" },
];

/** Returns the tag catalogue grouped for the editor palette. */
export function getCclTagRegistry() {
  const groups = {};
  for (const t of CCL_TAGS) {
    (groups[t.group] ||= []).push({
      tag: t.tag,
      token: `{{${t.tag}}}`,
      label: t.label,
      type: t.type,
      sample: t.sample,
    });
  }
  return { tags: CCL_TAGS, groups };
}

const BLOCK_TAGS = new Set(CCL_TAGS.filter((t) => t.type === "block").map((t) => t.tag));

// ── Formatting helpers ────────────────────────────────────────────────────────
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatGbp(amount) {
  const n = Number.parseFloat(amount);
  if (!Number.isFinite(n) || n < 0) return "£0.00";
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function threeDigitsToWords(n) {
  let out = "";
  if (n >= 100) {
    out += `${ONES[Math.floor(n / 100)]} hundred`;
    n %= 100;
    if (n) out += " and ";
  }
  if (n >= 20) {
    out += TENS[Math.floor(n / 10)];
    if (n % 10) out += `-${ONES[n % 10]}`;
  } else if (n > 0) {
    out += ONES[n];
  }
  return out.trim();
}

/** Converts a GBP amount to words, e.g. 1500.5 → "one thousand five hundred pounds and fifty pence". */
export function amountToWords(amount) {
  const n = Number.parseFloat(amount);
  if (!Number.isFinite(n) || n < 0) return "";
  let pounds = Math.floor(n);
  let pence = Math.round((n - pounds) * 100);
  // Rounding can push pence to 100 (e.g. 10.999) — roll it into the pounds so
  // the words stay consistent with the formatted figure (£11.00).
  if (pence >= 100) {
    pounds += Math.floor(pence / 100);
    pence %= 100;
  }

  let words;
  if (pounds === 0) {
    words = "zero";
  } else {
    const billions = Math.floor(pounds / 1_000_000_000);
    const millions = Math.floor((pounds % 1_000_000_000) / 1_000_000);
    const thousands = Math.floor((pounds % 1_000_000) / 1000);
    const rest = pounds % 1000;
    const parts = [];
    if (billions) parts.push(`${threeDigitsToWords(billions)} billion`);
    if (millions) parts.push(`${threeDigitsToWords(millions)} million`);
    if (thousands) parts.push(`${threeDigitsToWords(thousands)} thousand`);
    if (rest) parts.push(threeDigitsToWords(rest));
    words = parts.join(" ");
  }

  let result = `${words} ${pounds === 1 ? "pound" : "pounds"}`;
  if (pence > 0) {
    result += ` and ${threeDigitsToWords(pence)} ${pence === 1 ? "penny" : "pence"}`;
  }
  return result.charAt(0).toUpperCase() + result.slice(1);
}

/** Builds a trusted HTML table for an installment plan (block tag). */
export function renderInstallmentPlanHtml(installmentPlan) {
  const rows = Array.isArray(installmentPlan) ? installmentPlan : [];
  if (rows.length === 0) return "";
  const body = rows
    .map((r, i) => {
      const label = escapeHtml(r.label || `Instalment ${i + 1}`);
      const amount = escapeHtml(formatGbp(r.amount));
      const due = r.dueDate ? escapeHtml(formatDate(r.dueDate)) : "On issue";
      return `<tr><td>${label}</td><td>${amount}</td><td>${due}</td></tr>`;
    })
    .join("");
  return (
    `<table class="ccl-installments" border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">` +
    `<thead><tr><th>Instalment</th><th>Amount</th><th>Due</th></tr></thead>` +
    `<tbody>${body}</tbody></table>`
  );
}

function fullName(first, last, fallback = "") {
  const name = `${first || ""} ${last || ""}`.trim();
  return name || fallback;
}

// ── Context builder ───────────────────────────────────────────────────────────
/**
 * Resolve all tag values for a case. Returns a plain { tag: string } map ready
 * for interpolateCclHtml. Text values are HTML-escaped; block values are raw HTML.
 *
 * @param {object} args
 * @param {object} args.tenantDb      tenant Sequelize models
 * @param {object} args.caseRecord    the Case row
 * @param {object} [args.ccl]         the CaseCclRecord row (fees/dates)
 * @param {object} [args.organisation] platform Organisation row (name, logoUrl, …)
 * @returns {Promise<{ values: Record<string,string>, logoUrl: string|null }>}
 */
export async function buildCclContext({ tenantDb, caseRecord, ccl = null, organisation = null }) {
  const values = {};
  const set = (tag, raw) => {
    values[tag] = BLOCK_TAGS.has(tag) ? String(raw ?? "") : escapeHtml(raw);
  };

  // Candidate — prefer the richer CandidateApplication, fall back to User.
  let application = null;
  let candidateUser = null;
  try {
    if (caseRecord?.candidateId) {
      if (tenantDb?.CandidateApplication) {
        application = await tenantDb.CandidateApplication.findOne({
          where: { userId: caseRecord.candidateId },
          order: [["id", "DESC"]],
        });
      }
      if (tenantDb?.User) {
        candidateUser = await tenantDb.User.findByPk(caseRecord.candidateId, {
          attributes: ["id", "first_name", "last_name", "email"],
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, "buildCclContext: candidate load failed");
  }

  const firstName = application?.firstName || candidateUser?.first_name || "";
  const lastName = application?.lastName || candidateUser?.last_name || "";
  set("candidate_name", fullName(firstName, lastName, "the Client"));
  set("candidate_first_name", firstName || "Client");
  set("candidate_email", application?.email || candidateUser?.email || "");
  set("candidate_address", application?.address || "");
  set("candidate_phone", application?.contactNumber || "");
  set("candidate_dob", formatDate(application?.dob));
  set("passport_number", application?.passportNumber || "");
  set("nationality", application?.nationality || "");

  // Visa / petition
  let visaName = caseRecord?.visaType?.name || "";
  if (!visaName && caseRecord?.visaTypeId && tenantDb?.VisaType) {
    visaName = (await tenantDb.VisaType.findByPk(caseRecord.visaTypeId, { attributes: ["name"] }))?.name || "";
  }
  let petitionName = caseRecord?.petitionType?.name || "";
  if (!petitionName && caseRecord?.petitionTypeId && tenantDb?.PetitionType) {
    petitionName = (await tenantDb.PetitionType.findByPk(caseRecord.petitionTypeId, { attributes: ["name"] }))?.name || "";
  }
  set("visa_type", visaName || "your application");
  set("petition_type", petitionName || "");

  // Caseworker (first assigned)
  let caseworkerName = "";
  try {
    const raw = caseRecord?.assignedcaseworkerId ?? caseRecord?.assignedCaseworkerId;
    const ids = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
    const firstId = ids.map(Number).find((n) => Number.isFinite(n) && n > 0);
    if (firstId && tenantDb?.User) {
      const cw = await tenantDb.User.findByPk(firstId, { attributes: ["first_name", "last_name"] });
      caseworkerName = fullName(cw?.first_name, cw?.last_name, "");
    }
  } catch (err) {
    logger.warn({ err }, "buildCclContext: caseworker load failed");
  }
  set("caseworker_name", caseworkerName || "Your Caseworker");

  // Case + dates
  set("case_ref", caseRecord?.caseId || String(caseRecord?.id || ""));
  set("date_today", formatDate(new Date()));
  set("date_issued", formatDate(ccl?.issuedAt || new Date()));

  // Fees — pick the first POSITIVE value. A stored 0 must not win (using `??`
  // here meant a 0 totalAmount/feeAmount showed as "£0.00" on the letter even
  // when a real fee existed elsewhere).
  const installmentSum = Array.isArray(ccl?.installmentPlan)
    ? ccl.installmentPlan.reduce((s, r) => s + (Number.parseFloat(r.amount) || 0), 0)
    : 0;
  const pickAmount = (...vals) => {
    for (const v of vals) {
      const n = Number.parseFloat(v);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  };
  const fee = pickAmount(ccl?.feeAmount, caseRecord?.proposedAmount, caseRecord?.totalAmount, installmentSum);
  const total = pickAmount(caseRecord?.totalAmount, ccl?.feeAmount, caseRecord?.proposedAmount, installmentSum, fee);
  const proposed = pickAmount(caseRecord?.proposedAmount, ccl?.feeAmount, caseRecord?.totalAmount, fee);
  set("proposed_amount", formatGbp(proposed));
  set("total_amount", formatGbp(total));
  set("fee_amount", formatGbp(fee));
  set("amount_in_words", amountToWords(fee));
  set("installment_plan", renderInstallmentPlanHtml(ccl?.installmentPlan));

  // Organisation — the tenant Organisation row exposes name / primaryEmail /
  // country / logoUrl (not address/email/phone), so map those correctly.
  set("org_name", organisation?.name || "");
  set("org_address", organisation?.address || organisation?.company_address || organisation?.country || "");
  set("org_email", organisation?.primaryEmail || organisation?.email || organisation?.contact_email || "");
  set("org_phone", organisation?.phone || organisation?.contact_phone || "");
  // org_logo is rendered as the letterhead image by the generator (Phase 2),
  // not inline text — leave the inline value empty here.
  set("org_logo", "");

  return { values, logoUrl: organisation?.logoUrl || organisation?.logo_url || null };
}

// ── Interpolation ─────────────────────────────────────────────────────────────
/**
 * Replace every {{tag}} in the template with its value. Unknown/empty tags
 * resolve to an empty string. Values are pre-formatted/escaped by buildCclContext.
 */
export function interpolateCclHtml(html, values = {}) {
  if (!html) return "";
  return String(html).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const k = key.toLowerCase();
    return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : "";
  });
}
