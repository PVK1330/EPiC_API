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
  { tag: "candidate_name", label: "Client full name", group: "Client", type: "text", sample: "Jane Doe" },
  { tag: "candidate_first_name", label: "Client first name", group: "Client", type: "text", sample: "Jane" },
  { tag: "candidate_email", label: "Client email", group: "Client", type: "text", sample: "jane.doe@example.com" },
  { tag: "candidate_address", label: "Client address", group: "Client", type: "text", sample: "22 Park Lane, Manchester, M1 2AB" },
  { tag: "candidate_phone", label: "Client phone", group: "Client", type: "text", sample: "+44 7700 900123" },
  { tag: "candidate_dob", label: "Client date of birth", group: "Client", type: "text", sample: "14 March 1992" },
  { tag: "passport_number", label: "Passport number", group: "Client", type: "text", sample: "123456789" },
  { tag: "nationality", label: "Nationality", group: "Client", type: "text", sample: "Indian" },
  { tag: "current_visa_type", label: "Current visa type", group: "Client", type: "text", sample: "Skilled Worker" },
  { tag: "current_visa_expiry", label: "Current visa expiry", group: "Client", type: "text", sample: "15 August 2026" },

  // Case
  { tag: "case_ref", label: "Case reference", group: "Case", type: "text", sample: "EPIC-2026-0042" },
  { tag: "visa_type", label: "Visa type", group: "Case", type: "text", sample: "Skilled Worker" },
  { tag: "petition_type", label: "Petition type", group: "Case", type: "text", sample: "Initial application" },
  { tag: "caseworker_name", label: "Primary Caseworker name", group: "Case", type: "text", sample: "Alex Smith" },
  { tag: "caseworker_email", label: "Primary Caseworker email", group: "Case", type: "text", sample: "alex.smith@example.com" },
  { tag: "caseworker_phone", label: "Primary Caseworker phone", group: "Case", type: "text", sample: "+44 20 1234 5678" },
  { tag: "second_caseworker_name", label: "Second Caseworker name", group: "Case", type: "text", sample: "Sarah Connor" },
  { tag: "second_caseworker_email", label: "Second Caseworker email", group: "Case", type: "text", sample: "sarah.connor@example.com" },
  { tag: "caseworkers_all", label: "All caseworkers", group: "Case", type: "text", sample: "Alex Smith and Sarah Connor" },
  { tag: "sponsor_name", label: "Sponsor name", group: "Case", type: "text", sample: "Acme Corp Ltd" },
  { tag: "sponsor_licence", label: "Sponsor licence number", group: "Case", type: "text", sample: "123456789" },
  { tag: "sponsor_statement", label: "Sponsor relationship statement", group: "Case", type: "text", sample: "under the sponsorship of Acme Corp Ltd" },
  { tag: "sponsor_instruction_clause", label: "Sponsor / private client clause", group: "Case", type: "text", sample: "You instructed Elite PIC to manage your application..." },
  { tag: "is_private_client", label: "Private client (Yes/No)", group: "Case", type: "text", sample: "Yes" },
  { tag: "date_today", label: "Today's date", group: "Case", type: "text", sample: "5 June 2026" },
  { tag: "date_issued", label: "CCL issue date", group: "Case", type: "text", sample: "5 June 2026" },
  { tag: "appendix_a", label: "Appendix A (Immigration history)", group: "Case", type: "block", sample: "[appendix A table]" },

  // Fees
  { tag: "proposed_amount", label: "Proposed amount", group: "Fees", type: "text", sample: "£1,500.00" },
  { tag: "total_amount", label: "Total amount", group: "Fees", type: "text", sample: "£1,500.00" },
  { tag: "fee_amount", label: "CCL fee amount", group: "Fees", type: "text", sample: "£1,500.00" },
  { tag: "amount_in_words", label: "Amount in words", group: "Fees", type: "text", sample: "One thousand five hundred pounds" },
  { tag: "installment_plan", label: "Installment plan (table)", group: "Fees", type: "block", sample: "[installment table]" },
  { tag: "fee_section", label: "Dynamic fee breakdown table", group: "Fees", type: "block", sample: "[fee schedule table]" },
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
  // Backward compatibility alias for Candidate group while preserving Client terminology
  if (groups["Client"] && !groups["Candidate"]) {
    groups["Candidate"] = groups["Client"];
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

/** Builds dynamic Appendix A immigration history table from stored application data. */
export function renderAppendixAHtml(application, caseRecord) {
  const brp = escapeHtml(application?.brpNumber || "Not provided");
  const currentVisa = escapeHtml(application?.visaType || caseRecord?.visaType?.name || "Current route");
  const expiry = application?.visaEndDate ? escapeHtml(formatDate(application.visaEndDate)) : "Not provided";
  const entry = application?.entryDate ? escapeHtml(formatDate(application.entryDate)) : "Not recorded";
  const passport = escapeHtml(application?.passportNumber || "On file");
  const nationality = escapeHtml(application?.nationality || "Not specified");

  let travelSummary = "No recent international travel recorded";
  if (Array.isArray(application?.travelHistory) && application.travelHistory.length > 0) {
    const trips = application.travelHistory
      .map((t) => {
        const dest = t.country || t.countryVisited || "Overseas";
        const dates = [t.entryDate ? formatDate(t.entryDate) : "", t.leaveDate ? formatDate(t.leaveDate) : ""]
          .filter(Boolean)
          .join(" – ");
        return dates ? `${dest} (${dates})` : dest;
      })
      .filter(Boolean);
    if (trips.length > 0) travelSummary = trips.join("; ");
  } else if (application?.countryVisited) {
    const dates = [application.entryDate ? formatDate(application.entryDate) : "", application.leaveDate ? formatDate(application.leaveDate) : ""]
      .filter(Boolean)
      .join(" – ");
    travelSummary = dates ? `${application.countryVisited} (${dates})` : application.countryVisited;
  }

  const refusalStatus = application?.refusedVisa === "Yes"
    ? `Visa refusal recorded (${escapeHtml(application.refusedVisaCountry || "UK")}${application.refusedVisaDate ? " on " + formatDate(application.refusedVisaDate) : ""})`
    : "No adverse immigration history or visa refusals recorded";

  return `
<div class="ccl-appendix-a">
  <p><strong>Appendix (A) – Immigration History</strong></p>
  <p>Immigration history related to your stay in the UK and application for UK immigration:</p>
  <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;margin-top:8px;margin-bottom:12px;">
    <tbody>
      <tr>
        <td style="width:30%;background-color:#f8f9fa;font-weight:bold;">Current Status / BRP</td>
        <td style="width:70%;">
          <strong>BRP / Reference:</strong> ${brp}<br/>
          <strong>Current Visa Category:</strong> ${currentVisa}<br/>
          <strong>Expiry Date:</strong> ${expiry}
        </td>
      </tr>
      <tr>
        <td style="background-color:#f8f9fa;font-weight:bold;">Entry &amp; Residence</td>
        <td>
          <strong>Initial Arrival / Entry Date:</strong> ${entry}<br/>
          <strong>Nationality / Passport:</strong> ${nationality} (Passport: ${passport})
        </td>
      </tr>
      <tr>
        <td style="background-color:#f8f9fa;font-weight:bold;">Immigration Compliance</td>
        <td>${refusalStatus}</td>
      </tr>
      <tr>
        <td style="background-color:#f8f9fa;font-weight:bold;">Travel History</td>
        <td>${escapeHtml(travelSummary)}</td>
      </tr>
    </tbody>
  </table>
</div>`.trim();
}

/** Builds dynamic fee section table without hardcoded amounts. */
export function renderFeeSectionHtml({ fee, total, amountInWords, installmentPlanHtml, visaName, orgName }) {
  const feeStr = formatGbp(fee);
  const totalStr = formatGbp(total);
  const org = escapeHtml(orgName || "the firm");
  const visa = escapeHtml(visaName || "Immigration");

  return `
<div class="ccl-fees-section">
  <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;margin-top:8px;margin-bottom:12px;">
    <thead>
      <tr style="background-color:#f8f9fa;">
        <th><strong>Item</strong></th>
        <th><strong>Cost</strong></th>
        <th><strong>VAT</strong></th>
        <th><strong>Total Cost</strong></th>
        <th><strong>Comment</strong></th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${visa} Professional Legal Services</td>
        <td>${feeStr}</td>
        <td>£0.00 (Exempt/Included)</td>
        <td>${totalStr}</td>
        <td>Payable to ${org} as agreed</td>
      </tr>
      <tr>
        <td>Home Office Visa Application Fee</td>
        <td colspan="4">Disbursements payable directly to Home Office / UKVI at prevailing statutory rate</td>
      </tr>
      <tr>
        <td>Immigration Health Surcharge (IHS)</td>
        <td colspan="4">Disbursements payable directly to Home Office (if applicable to application route)</td>
      </tr>
      <tr>
        <td>Biometric Appointment</td>
        <td colspan="4">Payable directly to UKVCAS / commercial partner at booking</td>
      </tr>
    </tbody>
  </table>
  <p><strong>Agreed Professional Legal Fee:</strong> ${totalStr} (${amountInWords})</p>
  ${installmentPlanHtml ? `<p><strong>Agreed Payment Schedule:</strong></p>${installmentPlanHtml}` : ""}
</div>`.trim();
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
          attributes: ["id", "first_name", "last_name", "email", "mobile"],
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
  set("candidate_phone", application?.contactNumber || candidateUser?.mobile || "");
  set("candidate_dob", formatDate(application?.dob));
  set("passport_number", application?.passportNumber || "");
  set("nationality", application?.nationality || "");
  set("current_visa_type", application?.visaType || "");
  set("current_visa_expiry", formatDate(application?.visaEndDate));

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

  // Caseworkers — each case has EXACTLY 2 assigned caseworkers.
  // The first assigned caseworker (ids[0]) is the designated Primary/Lead caseworker
  // who acts as the primary CCL contact and signs the letter.
  // The second assigned caseworker (ids[1]) is the Joint caseworker. Both remain
  // associated with the case and are clearly presented in the letter.
  let cw1 = null;
  let cw2 = null;
  try {
    const raw = caseRecord?.assignedcaseworkerId ?? caseRecord?.assignedCaseworkerId;
    const ids = Array.isArray(raw) ? raw.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
    if (ids[0] && tenantDb?.User) {
      cw1 = await tenantDb.User.findByPk(ids[0], { attributes: ["id", "first_name", "last_name", "email", "mobile"] });
    }
    if (ids[1] && tenantDb?.User) {
      cw2 = await tenantDb.User.findByPk(ids[1], { attributes: ["id", "first_name", "last_name", "email", "mobile"] });
    }
  } catch (err) {
    logger.warn({ err }, "buildCclContext: caseworker load failed");
  }

  const primaryName = cw1 ? fullName(cw1.first_name, cw1.last_name, "Your Caseworker") : "Your Caseworker";
  const primaryEmail = cw1?.email || organisation?.primaryEmail || organisation?.email || "";
  const primaryPhone = cw1?.mobile || organisation?.phone || "";
  const secondName = cw2 ? fullName(cw2.first_name, cw2.last_name, "") : "";
  const secondEmail = cw2?.email || "";

  let allCaseworkersStr = primaryName;
  if (secondName) {
    allCaseworkersStr = `${primaryName} (Lead Caseworker) and ${secondName} (Joint Caseworker)`;
  }

  set("caseworker_name", primaryName);
  set("caseworker_email", primaryEmail);
  set("caseworker_phone", primaryPhone);
  set("second_caseworker_name", secondName);
  set("second_caseworker_email", secondEmail);
  set("caseworkers_all", allCaseworkersStr);

  // Sponsor / Private client handling
  const isPrivate = Boolean(caseRecord?.isPrivateClient || !caseRecord?.sponsorId);
  let sponsorName = "";
  let sponsorLicence = "";
  let sponsorStatement = "as an independent private client with no sponsor";
  const orgNameDisplay = organisation?.name || "the firm";

  if (!isPrivate && caseRecord?.sponsorId) {
    try {
      if (tenantDb?.SponsorProfile) {
        const sp = await tenantDb.SponsorProfile.findOne({
          where: { userId: caseRecord.sponsorId },
        });
        if (sp) {
          sponsorName = sp.companyName || sp.tradingName || "";
          sponsorLicence = sp.sponsorLicenceNumber || "";
        }
      }
      if (!sponsorName && tenantDb?.User) {
        const su = await tenantDb.User.findByPk(caseRecord.sponsorId, {
          attributes: ["id", "first_name", "last_name", "company_name", "email"],
        });
        if (su) {
          sponsorName = su.company_name || fullName(su.first_name, su.last_name, "");
        }
      }
    } catch (err) {
      logger.warn({ err }, "buildCclContext: sponsor load failed");
    }

    if (sponsorName) {
      sponsorStatement = `under the sponsorship of ${sponsorName}${sponsorLicence ? ` (Sponsor Licence: ${sponsorLicence})` : ""}`;
    }
  }

  let sponsorInstructionClause = "";
  if (isPrivate) {
    sponsorInstructionClause = `You instructed ${orgNameDisplay} to manage the application for ${visaName || "Settlement (ILR)"} as an independent private client with no sponsor.`;
  } else {
    sponsorInstructionClause = `You instructed ${orgNameDisplay} via your Sponsor ${sponsorName || "your sponsor"}, to manage the application of ${visaName || "your visa"} with the Sponsor/employer ${sponsorName || "your sponsor"}${sponsorLicence ? ` (sponsor licence number: ${sponsorLicence})` : ""}.`;
  }

  set("sponsor_name", isPrivate ? "" : sponsorName);
  set("sponsor_licence", isPrivate ? "" : sponsorLicence);
  set("sponsor_statement", sponsorStatement);
  set("sponsor_instruction_clause", sponsorInstructionClause);
  set("is_private_client", isPrivate ? "Yes" : "No");

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
  const words = amountToWords(fee);
  const instHtml = renderInstallmentPlanHtml(ccl?.installmentPlan);

  set("proposed_amount", formatGbp(proposed));
  set("total_amount", formatGbp(total));
  set("fee_amount", formatGbp(fee));
  set("amount_in_words", words);
  set("installment_plan", instHtml);
  set("fee_section", renderFeeSectionHtml({
    fee,
    total,
    amountInWords: words,
    installmentPlanHtml: instHtml,
    visaName: visaName || "Immigration",
    orgName: orgNameDisplay,
  }));

  // Appendix A
  set("appendix_a", renderAppendixAHtml(application, caseRecord));

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
 * Also performs sanitization to ensure no stale hardcoded values leak into the letter.
 */
export function interpolateCclHtml(html, values = {}) {
  if (!html) return "";

  let out = String(html);

  // 1. Sanitize awkward date line formatting (tabs/spaces pushing date across lines)
  out = out.replace(
    /(<p[^>]*>)?Dear\s+(?:Mr\.?|Mrs\.?|Ms\.?|Miss)?\s*[_.\u2026]*[^<]*?(?:[\t\s]{2,}|\s{4,})Date:\s*(?:\{\{date_today\}\}|[0-9/.\-]+)(<\/p>)?/gi,
    `<p>Date: {{date_today}}</p><p>Dear {{candidate_first_name}},</p>`
  );

  // 2. Perform token replacement
  out = out.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const k = key.toLowerCase();
    return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : "";
  });

  // 3. Fallback sanitization for legacy templates containing hardcoded caseworker David Robertson
  const cwName = values.caseworker_name || "Your Caseworker";
  const cwEmail = values.caseworker_email || "";
  const cwPhone = values.caseworker_phone || values.org_phone || "";
  const allCw = values.caseworkers_all || cwName;

  out = out.replace(
    /I,\s*David Robertson\s*will be your caseworker[\s\S]*?as and when they arise\./gi,
    `I, ${cwName} will be your caseworker and responsible for the conduct of your case. I can be contacted on ${cwPhone} and email ${cwEmail} Whenever possible, I shall be available to advise and assist you and keep you informed of the progress of your case.`
  );
  out = out.replace(
    /Your caseworker will be Mr David Robertson under the supervision of Mr Khalid Mahmood\./gi,
    `Your assigned caseworkers for this matter will be ${allCw}.`
  );
  out = out.replace(/david@elitepic\.co\.uk/gi, cwEmail);
  out = out.replace(/01217782400/g, cwPhone);
  out = out.replace(/Mr David Robertson/gi, cwName);
  out = out.replace(/David Robertson/gi, cwName);

  // 4. Fallback sanitization for hardcoded fee tables (e.g. £1420 / £5175 / £2885)
  if (values.fee_section && /Home office visa application fee/i.test(out)) {
    out = out.replace(
      /<table[^>]*>[\s\S]*?Home office visa application fee[\s\S]*?<\/table>/gi,
      values.fee_section
    );
  }

  // 5. Fallback sanitization for private client sponsor blanks:
  if (values.is_private_client === "Yes") {
    out = out.replace(
      /You instructed\s+[^<]+?\s+via your Sponsor\s*[_.\u2026]+,\s*to manage the application[^<]+?\./gi,
      values.sponsor_instruction_clause || "You instructed our firm to manage your application as an independent private client with no sponsor."
    );
    out = out.replace(
      /Sponsor\/employer\s*[_.\u2026]+(?:\(sponsor licence number:\s*[_.\u2026]+\))?/gi,
      "No sponsor (Private Client)"
    );
    out = out.replace(
      /via your Sponsor\s*[_.\u2026]+/gi,
      "as a private client (no sponsor)"
    );
  }

  // 6. Fallback sanitization for unpopulated Appendix A underscores/dots
  if (values.appendix_a && /Appendix\s*\(?A\)?/i.test(out) && (/BRP card/i.test(out) || /[_.\u2026]{3,}/.test(out))) {
    out = out.replace(
      /<p[^>]*><strong>\s*Appendix\s*\(?A\)?[\s\S]*?<\/table>/gi,
      values.appendix_a
    );
  }

  return out;
}
