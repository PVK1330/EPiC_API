/**
 * Imports the firm's existing .docx Client Care Letters (assets/ccl-templates)
 * into the dynamic CCL template system as editable, tag-filled CclTemplate rows.
 *
 * Each .docx is converted to HTML (mammoth), obvious placeholders are turned into
 * {{tags}} (date, candidate name), and the letter is mapped to its visa type. The
 * primary letter for each visa type is set active; variants are imported inactive
 * so admins can switch/edit them. Idempotent (findOrCreate by name).
 *
 * The conversion is cached at module scope so the .docx are parsed once, not once
 * per tenant.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mammoth from "mammoth";
import { normaliseVisaName } from "../constants/visaDocumentChecklists.js";
import logger from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CCL_DOCX_DIR = path.join(__dirname, "../../assets/ccl-templates");

// Filename → template name + target visa type (matchers) + whether it's the
// primary (active) letter for that visa type. Order matters: most specific first.
const DOCX_RULES = [
  { test: /switch to skilled/i, name: "Switch to Skilled Worker — CCL", visaMatchers: ["skilled"], primary: false },
  // The two Change of Employment .docx files are a real client's completed
  // letter (name, address, passport, sponsor, salary, family) — genericInstructions
  // replaces that case-specific section with tag-filled standard wording.
  { test: /change of employment.*(2026|mar)/i, name: "Change of Employment (Mar 2026) — CCL", visaMatchers: ["skilled"], primary: false, genericInstructions: true },
  { test: /change of employment/i, name: "Change of Employment — CCL", visaMatchers: ["skilled"], primary: false, genericInstructions: true },
  { test: /dependent|dependant/i, name: "Dependent Partner & Child — CCL", visaMatchers: ["dependent", "dependant", "spouse", "partner"], primary: true },
  { test: /\bilr\b|indefinite/i, name: "Indefinite Leave to Remain — CCL", visaMatchers: ["indefiniteleave", "ilr", "settlement"], primary: true },
  { test: /spouse.*british/i, name: "Spouse of a British National — CCL", visaMatchers: ["spouse", "partner"], primary: true },
  { test: /nationality|naturalis/i, name: "Nationality / Naturalisation — CCL", visaMatchers: ["britishcitizen", "naturalis", "nationality", "citizenship"], primary: true },
  { test: /sponsor licence large/i, name: "Sponsor Licence (Large Companies) — CCL", visaMatchers: ["sponsorlicence", "sponsorlicense", "sponsor"], primary: true },
  { test: /sponsor licence small/i, name: "Sponsor Licence (Small Companies) — CCL", visaMatchers: ["sponsorlicence", "sponsorlicense", "sponsor"], primary: false },
  { test: /skilled worker/i, name: "Skilled Worker — CCL", visaMatchers: ["skilled"], primary: true },
];

// Standard letter header: recipient, date, salutation — all auto-filled.
const STANDARD_LETTER_HEADER =
  "<p>{{candidate_name}}</p><p>{{candidate_address}}</p><p>Date: {{date_today}}</p><p>Dear {{candidate_first_name}},</p>";

// Tag-filled replacement for a case-specific "Your Instructions" + "Our advice"
// section (Change of Employment letters).
const GENERIC_COE_INSTRUCTIONS =
  "<p><strong>Your Instructions</strong></p>" +
  "<p>{{sponsor_instruction_clause}}</p>" +
  "<p>You have provided evidence that your current visa is {{current_visa_type}} (Passport No: {{passport_number}}) and that it expires on {{current_visa_expiry}}.</p>" +
  "<p><strong>Our advice:</strong></p>" +
  '<p>We have considered your application against the current relevant immigration rules - <a href="https://www.gov.uk/guidance/immigration-rules/immigration-rules-appendix-skilled-worker">https://www.gov.uk/guidance/immigration-rules/immigration-rules-appendix-skilled-worker</a> and can confirm that, providing the information above is accurate and complete, we can support your Skilled Worker (change of employment) application.</p>';

/** Replace obvious .docx placeholders with auto-fill tags so letters self-fill. */
function injectTags(html, rule = {}) {
  let out = String(html || "");

  // Letter header: everything above the "Re: Client Care Letter" heading is the
  // recipient block — dotted/underscore placeholders in most templates, but a
  // REAL client's name and address in the Change of Employment files. Replace
  // it with the standard auto-filled header (Phase 2 UAT 4.2 #2 / #4).
  out = out.replace(/^[\s\S]*?(?=<p>(?:\s|<[^>]+>)*Re:\s*Client Care Letter)/i, STANDARD_LETTER_HEADER);

  // Case-specific instructions/advice (real client's history) → generic tagged text.
  if (rule.genericInstructions) {
    out = out.replace(
      /<p>(?:\s|<[^>]+>)*Your Instructions(?:\s|<[^>]+>)*<\/p>[\s\S]*?(?=<p>(?:\s|<[^>]+>)*What w(?:ill we|e will) do for you\?)/i,
      GENERIC_COE_INSTRUCTIONS
    );
  }
  // Hardcoded date (e.g. "Date: 24/06/2024" or "Date: 13/09/2024") → today's date tag.
  out = out.replace(/Date:\s*\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}/gi, "Date: {{date_today}}");

  // Fix awkward date line wrapping: in mammoth output, tabs between Dear and Date push Date into wrapping
  out = out.replace(
    /(<p[^>]*>)?Dear\s+(?:Mr\.?|Mrs\.?|Ms\.?|Miss)?\s*[_.\u2026]*[^<]*?(?:[\t\s]{2,}|\s{4,})Date:\s*(?:\{\{date_today\}\}|[0-9/.\-]+)(<\/p>)?/gi,
    `<p>Date: {{date_today}}</p><p>Dear {{candidate_first_name}},</p>`
  );

  // "Dear ____" or "Dear ……" → "Dear {{candidate_first_name}}".
  out = out.replace(/Dear\s+(?:Mr\.?|Mrs\.?|Ms\.?|Miss)?\s*[_.\u2026]{2,}/gi, "Dear {{candidate_first_name}}");

  // Caseworker contact details FIRST — the firm-name rewrite below also matches
  // "elitepic" inside "david@elitepic.co.uk"; running it first produced
  // "david@Elite_pic.co.uk" in issued letters (Phase 2 UAT 4.2 #3).
  out = out.replace(/<a[^>]*href="mailto:[^"]*@elitepic\.co\.uk"[^>]*>[\s\S]*?<\/a>/gi, "{{caseworker_email}}");
  out = out.replace(/[A-Za-z0-9._%+-]+@elitepic\.co\.uk/gi, "{{caseworker_email}}");
  out = out.replace(/01217782400/g, "{{caseworker_phone}}");

  // Firm name → org name tag (so each org's own name is used).
  out = out.replace(/Elite\s*PIC\s*Ltd/gi, "{{org_name}}").replace(/Elite\s*PIC/gi, "{{org_name}}");

  // Recipient block (first two standalone placeholder paragraphs) with underscores, dots, or ellipsis.
  // Only for letters without a "Re: Client Care Letter" heading — the others
  // already got the standard header above, and a later blank must not be filled.
  let blanks = out.startsWith(STANDARD_LETTER_HEADER) ? 2 : 0;
  out = out.replace(
    /(<p[^>]*>)(?:\s*<strong>)?\s*[_.\u2026]{3,}\s*(?:<\/strong>\s*)?(<\/p>)/gi,
    (match, open, close) => {
      blanks += 1;
      if (blanks === 1) return `${open}{{candidate_name}}${close}`;
      if (blanks === 2) return `${open}{{candidate_address}}${close}`;
      return match;
    },
  );

  // Caseworker replacement: remove hardcoded "David Robertson" and contact details
  out = out.replace(
    /I,\s*(?:David Robertson|Khalid Mahmood),?\s*will be your caseworker[\s\S]*?as and when they arise\./gi,
    "I, {{caseworker_name}} will be your primary caseworker and responsible for the conduct of your case. I can be contacted on {{caseworker_phone}} and email {{caseworker_email}} Whenever possible, I shall be available to advise and assist you and keep you informed of the progress of your case."
  );
  out = out.replace(
    /Your caseworker will be Mr David Robertson under the supervision of Mr Khalid Mahmood\./gi,
    "Your assigned caseworkers for this matter will be {{caseworkers_all}}."
  );
  out = out.replace(
    /Your caseworker will be Mr Khalid Mahmood\./gi,
    "Your assigned caseworker for this matter will be {{caseworkers_all}}."
  );
  out = out.replace(/(<p>\s*Yours sincerely,?\s*<\/p>\s*<p>)\s*Khalid Mahmood\s*(<\/p>)/gi, "$1{{caseworker_name}}$2");
  out = out.replace(/Mr David Robertson/gi, "{{caseworker_name}}");
  out = out.replace(/David Robertson/gi, "{{caseworker_name}}");

  // Fee table replacement: replace static disbursement tables with dynamic {{fee_section}}
  out = out.replace(
    /<table[^>]*>[\s\S]*?(?:Home office visa application fee|Health Surcharge|Home office visa fee|Sponsor Licence Application Fee)[\s\S]*?<\/table>/gi,
    "{{fee_section}}"
  );

  // Sponsor clause replacement in templates that have hardcoded blanks:
  out = out.replace(
    /You instructed \{\{org_name\}\} via your Sponsor [_.\u2026]+,\s*to manage the application[^<]+?\./gi,
    "{{sponsor_instruction_clause}}"
  );

  // Appendix A replacement: replace empty table with dynamic {{appendix_a}}
  out = out.replace(
    /<p[^>]*><strong>\s*Appendix\s*\(?A\)?[\s\S]*?<\/table>/gi,
    "{{appendix_a}}"
  );

  // Bank details & payment clarity replacement: replace static bank table with dynamic {{bank_payment_instructions}}
  out = out.replace(
    /(?:<p[^>]*>(?:\s|<[^>]+>)*(?:Elite\s*Pic\s*Bank\s*accounts|\{\{org_name\}\}\s*Bank\s*accounts)[^<]*(?:<[^>]+>)*<\/p>\s*)?<table[^>]*>[\s\S]*?Transfer\s*UKVI\s*visa\s*fees[\s\S]*?Transfer\s*(?:Elite\s*PiC|\{\{org_name\}\})?\s*Management\s*Fees[\s\S]*?<\/table>/gi,
    "{{bank_payment_instructions}}"
  );

  return out;
}

// Bump when injectTags() changes so stored templates are upgraded ONCE.
export const CCL_SEED_VERSION = 5;
const SEED_MARKER = `<!-- ccl-seed:v${CCL_SEED_VERSION} -->`;
const SEED_MARKER_RE = /<!-- ccl-seed:v(\d+) -->/;
// Text that only ever came from an old/buggy import (hard-coded adviser, the
// firm-name-in-email bug, legacy unformatted bank table). A stored row with none of these and no marker is
// treated as admin-edited and left alone.
const LEGACY_SEED_TEXT_RE =
  /David Robertson|I,\s*Khalid Mahmood,?\s*will be your caseworker|@elitepic\.co\.uk|@\{\{org_name\}\}|Elite_pic\.co\.uk|Y9158089|1H9W3VKX8|Jomon|Transfer\s*UKVI\s*visa\s*fees/i;

/** Should a stored template row be replaced by the freshly seeded HTML? */
export function shouldRefreshSeededTemplate(bodyHtml) {
  const body = String(bodyHtml || "");
  const m = body.match(SEED_MARKER_RE);
  if (m) return Number(m[1]) < CCL_SEED_VERSION;
  if (LEGACY_SEED_TEXT_RE.test(body)) return true;
  // Header still holding .docx placeholders (…… / ____) or the real client's
  // details from the Change of Employment files → an unedited old import.
  const parts = body.split(/Re:\s*Client Care Letter/i);
  if (parts.length < 2) return false; // no heading \u2192 no separate header to inspect
  return /[_\u2026]{4,}|\.{6,}|Jomon|Gillott Road|Mr XXX/i.test(parts[0]);
}

let cachedPromise = null;
/** Convert every .docx once → [{ name, html, visaMatchers, primary }]. Cached. */
function loadDocxTemplates() {
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    if (!fs.existsSync(CCL_DOCX_DIR)) return [];
    const files = fs.readdirSync(CCL_DOCX_DIR).filter((f) => f.toLowerCase().endsWith(".docx"));
    const out = [];
    for (const file of files) {
      const rule = DOCX_RULES.find((r) => r.test.test(file));
      if (!rule) continue;
      try {
        const { value } = await mammoth.convertToHtml({ path: path.join(CCL_DOCX_DIR, file) });
        const html = `${SEED_MARKER}${injectTags(value, rule)}`;
        if (html && html.trim()) {
          out.push({ name: rule.name, html, visaMatchers: rule.visaMatchers, primary: rule.primary });
        }
      } catch (err) {
        logger.warn({ err, file }, "cclTemplateDocx: convert failed");
      }
    }
    return out;
  })();
  return cachedPromise;
}

function resolveVisaTypeId(visaTypes, matchers) {
  for (const m of matchers) {
    const hit = visaTypes.find((v) => normaliseVisaName(v.name).includes(m));
    if (hit) return hit.id;
  }
  return null;
}

export async function seedCclTemplatesFromDocxForDb(tenantDb) {
  if (!tenantDb?.CclTemplate || !tenantDb?.VisaType) return;

  let templates;
  try {
    templates = await loadDocxTemplates();
  } catch (err) {
    logger.warn({ err }, "seedCclTemplatesFromDocxForDb: load failed");
    return;
  }
  if (!templates.length) return;

  const visaRows = await tenantDb.VisaType.findAll({ attributes: ["id", "name"] });
  const visaTypes = visaRows.map((v) => ({ id: v.id, name: v.name }));

  // Track visa types that already have an active template (DB enforces one active
  // per visa slot) so we don't violate the unique index.
  const activeVisa = new Set();
  try {
    const actives = await tenantDb.CclTemplate.findAll({
      where: { isActive: true },
      attributes: ["visaTypeId"],
    });
    for (const a of actives) if (a.visaTypeId != null) activeVisa.add(a.visaTypeId);
  } catch {
    /* ignore */
  }

  let created = 0;
  let refreshed = 0;
  for (const tpl of templates) {
    const visaTypeId = resolveVisaTypeId(visaTypes, tpl.visaMatchers);
    // Active only if it's the primary letter, has a visa type, and none active yet.
    let isActive = false;
    if (tpl.primary && visaTypeId != null && !activeVisa.has(visaTypeId)) {
      isActive = true;
      activeVisa.add(visaTypeId);
    }
    try {
      const [row, wasCreated] = await tenantDb.CclTemplate.findOrCreate({
        where: { name: tpl.name },
        defaults: {
          name: tpl.name,
          visaTypeId,
          bodyHtml: tpl.html,
          headerHtml: null,
          footerHtml: null,
          isActive,
          createdBy: null,
        },
      });
      if (wasCreated) {
        created += 1;
      } else if (row && shouldRefreshSeededTemplate(row.bodyHtml)) {
        // Upgrade letters imported by an older seed version (or with legacy
        // hard-coded adviser / broken email text). Rows already at this seed
        // version, or cleaned up by an admin, are left untouched — previously
        // the check re-imported some templates on every server restart.
        await row.update({ bodyHtml: tpl.html, visaTypeId: visaTypeId ?? row.visaTypeId, isActive: row.isActive || isActive });
        refreshed += 1;
      }
    } catch (err) {
      logger.warn({ err, name: tpl.name }, "cclTemplateDocx: upsert failed");
    }
  }

  if (created > 0 || refreshed > 0) {
    logger.info({ created, refreshed }, "seedCclTemplatesFromDocx: imported/upgraded CCL templates");
  }
}

export default seedCclTemplatesFromDocxForDb;
