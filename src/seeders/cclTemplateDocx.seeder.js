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
  { test: /change of employment.*(2026|mar)/i, name: "Change of Employment (Mar 2026) — CCL", visaMatchers: ["skilled"], primary: false },
  { test: /change of employment/i, name: "Change of Employment — CCL", visaMatchers: ["skilled"], primary: false },
  { test: /dependent|dependant/i, name: "Dependent Partner & Child — CCL", visaMatchers: ["dependent", "dependant", "spouse", "partner"], primary: true },
  { test: /\bilr\b|indefinite/i, name: "Indefinite Leave to Remain — CCL", visaMatchers: ["indefiniteleave", "ilr"], primary: true },
  { test: /spouse.*british/i, name: "Spouse of a British National — CCL", visaMatchers: ["spouse", "partner"], primary: true },
  { test: /nationality|naturalis/i, name: "Nationality / Naturalisation — CCL", visaMatchers: ["britishcitizen", "naturalis", "nationality", "citizenship"], primary: true },
  { test: /sponsor licence large/i, name: "Sponsor Licence (Large Companies) — CCL", visaMatchers: ["sponsorlicence", "sponsorlicense", "sponsor"], primary: true },
  { test: /sponsor licence small/i, name: "Sponsor Licence (Small Companies) — CCL", visaMatchers: ["sponsorlicence", "sponsorlicense", "sponsor"], primary: false },
  { test: /skilled worker/i, name: "Skilled Worker — CCL", visaMatchers: ["skilled"], primary: true },
];

/** Replace obvious .docx placeholders with auto-fill tags so letters self-fill. */
function injectTags(html) {
  let out = String(html || "");
  // Hardcoded date (e.g. "Date: 24/06/2024") → today's date tag.
  out = out.replace(/Date:\s*\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}/gi, "Date: {{date_today}}");
  // "Dear ____" → "Dear {{candidate_name}}".
  out = out.replace(/Dear\s+(?:Mr\.?|Mrs\.?|Ms\.?|Miss)?\s*_{2,}/gi, "Dear {{candidate_name}}");
  // Firm name → org name tag (so each org's own name is used).
  out = out.replace(/Elite\s*PIC\s*Ltd/gi, "{{org_name}}").replace(/Elite\s*PIC/gi, "{{org_name}}");
  // The first two standalone "______" paragraphs are the recipient block
  // (name then address) → fill with candidate details.
  let blanks = 0;
  out = out.replace(
    /(<p[^>]*>)(?:\s*<strong>)?\s*_{3,}\s*(?:<\/strong>\s*)?(<\/p>)/gi,
    (match, open, close) => {
      blanks += 1;
      if (blanks === 1) return `${open}{{candidate_name}}${close}`;
      if (blanks === 2) return `${open}{{candidate_address}}${close}`;
      return match; // leave other inline blanks for the caseworker to complete
    },
  );
  return out;
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
        const html = injectTags(value);
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
      } else if (row && !String(row.bodyHtml || "").includes("{{org_name}}")) {
        // One-time upgrade of letters imported before the richer tag injection
        // (they won't have {{org_name}} yet). Skipped once upgraded, so admin
        // edits aren't clobbered on later restarts.
        await row.update({ bodyHtml: tpl.html, visaTypeId, isActive });
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
