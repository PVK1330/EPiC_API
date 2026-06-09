/**
 * cclGenerator.service.js
 * Dynamic Client Care Letter generation.
 *
 * Pipeline: resolve template → interpolate {{tags}} → render branded PDF with the
 * org logo letterhead.
 *
 * Content precedence (generateCclHtmlForCase):
 *   1. ccl.draftHtml  — the per-case letter a caseworker/admin edited before issue
 *   2. org CclTemplate — visa-specific active row, else the org default (visa NULL)
 *   3. null           — caller falls back to the legacy .docx template
 */

import { Op } from "sequelize";
import fs from "fs";
import path from "path";
import { JSDOM } from "jsdom";
import htmlToPdfmake from "html-to-pdfmake";
import sharp from "sharp";
import { generatePdfBufferFromDefinition } from "./pdfGenerator.service.js";
import { buildCclContext, interpolateCclHtml } from "./cclTags.service.js";
import logger from "../utils/logger.js";

// Reuse one JSDOM window for html-to-pdfmake (creating one per render is slow).
const sharedWindow = new JSDOM("").window;

/** Active org template for a visa type → else the org default (visa_type_id NULL). */
export async function resolveDbCclTemplate(tenantDb, visaTypeId) {
  if (!tenantDb?.CclTemplate) return null;
  if (visaTypeId) {
    const specific = await tenantDb.CclTemplate.findOne({
      where: { visaTypeId, isActive: true },
      order: [["id", "DESC"]],
    });
    if (specific) return specific;
  }
  return tenantDb.CclTemplate.findOne({
    where: { visaTypeId: { [Op.is]: null }, isActive: true },
    order: [["id", "DESC"]],
  });
}

/** Load the single tenant organisation row (name + logo) when not supplied. */
async function resolveOrganisation(tenantDb, organisation) {
  if (organisation) return organisation;
  if (tenantDb?.Organisation) {
    try {
      return await tenantDb.Organisation.findOne();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Resolve the org logo (or fallback brand asset) to a PNG data URI for pdfmake.
 * sharp normalises any input (png/jpeg/webp) to PNG, which pdfkit always supports.
 */
async function resolveLogoDataUri(logoUrl) {
  const candidates = [];
  const raw = String(logoUrl || "").trim();

  if (raw && !/^https?:/i.test(raw)) {
    const norm = raw.replace(/\\/g, "/");
    // A public asset URL (e.g. /api/public/images/<rest>) → map back to the
    // storage directory it is served from so we can read it from disk.
    const marker = "/api/public/images/";
    const idx = norm.indexOf(marker);
    if (idx !== -1) {
      const rest = norm.slice(idx + marker.length);
      for (const base of ["organisations", "platform", "superadmin"]) {
        candidates.push(
          path.join(process.cwd(), "storage", "private", base, rest),
        );
      }
    }
    // A direct storage/relative path (logoUrl is usually `storage/private/...`).
    candidates.push(path.resolve(process.cwd(), norm.replace(/^\//, "")));
  }

  // Fallback brand asset.
  candidates.push(path.join(process.cwd(), "assets", "elitepic_logo.png"));

  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        const png = await sharp(p).png().toBuffer();
        return `data:image/png;base64,${png.toString("base64")}`;
      }
    } catch (err) {
      logger.warn({ err, path: p }, "resolveLogoDataUri: failed to read logo");
    }
  }
  return null;
}

/**
 * Build the interpolated CCL HTML for a case (no PDF yet).
 * @returns {Promise<{ html: string|null, source: 'draft'|'template'|'none', template: object|null }>}
 */
export async function generateCclHtmlForCase({
  tenantDb,
  caseRecord,
  ccl = null,
  organisation = null,
}) {
  if (ccl?.draftHtml && String(ccl.draftHtml).trim()) {
    // Interpolate the draft too: if it still contains {{tags}} (e.g. a saved
    // template or a tagged letter), fill them with the candidate's real data.
    // For an already-filled draft this is a harmless no-op.
    const org = await resolveOrganisation(tenantDb, organisation);
    const { values } = await buildCclContext({
      tenantDb,
      caseRecord,
      ccl,
      organisation: org,
    });
    return {
      html: interpolateCclHtml(ccl.draftHtml, values),
      source: "draft",
      template: null,
    };
  }

  const template = await resolveDbCclTemplate(tenantDb, caseRecord?.visaTypeId);
  if (!template) return { html: null, source: "none", template: null };

  const org = await resolveOrganisation(tenantDb, organisation);
  const { values } = await buildCclContext({
    tenantDb,
    caseRecord,
    ccl,
    organisation: org,
  });
  const parts = [template.headerHtml, template.bodyHtml, template.footerHtml]
    .filter((p) => p && String(p).trim())
    .join("\n");
  return {
    html: interpolateCclHtml(parts, values),
    source: "template",
    template,
  };
}

/**
 * pdfmake can only embed images that are data-URIs or readable local files. Any
 * other <img> (http/https URL, or a path that doesn't resolve) makes
 * createPdfKitDocument throw "Invalid image", which surfaced as a 500 on
 * preview/issue. Normalise every <img> in the letter HTML:
 *   - data: URIs            → kept as-is
 *   - local readable files  → converted to a PNG data-URI via sharp
 *   - everything else       → the <img> tag is removed
 */
async function sanitizeHtmlImagesForPdf(html) {
  if (!html || !/<img/i.test(html)) return html || "";

  const imgTagRe = /<img\b[^>]*>/gi;
  const srcRe = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

  const tags = html.match(imgTagRe) || [];
  let out = html;

  for (const tag of tags) {
    const m = tag.match(srcRe);
    const src = m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";

    if (!src) {
      out = out.replace(tag, "");
      continue;
    }

    if (src.startsWith("data:image/")) continue; // pdfmake handles data URIs

    let dataUri = null;
    const candidates = [];
    const normalized = src.replace(/\\/g, "/");

    if (!/^https?:/i.test(src)) {
      if (normalized.startsWith("/")) {
        candidates.push(path.resolve(process.cwd(), normalized.slice(1)));
      } else {
        candidates.push(path.resolve(process.cwd(), normalized));
      }
    }

    for (const candidate of candidates) {
      try {
        if (candidate && fs.existsSync(candidate)) {
          const png = await sharp(candidate).png().toBuffer();
          dataUri = `data:image/png;base64,${png.toString("base64")}`;
          break;
        }
      } catch (err) {
        logger.warn({ err, path: candidate }, "sanitizeHtmlImagesForPdf: failed to read image");
      }
    }

    if (dataUri) {
      out = out.replace(tag, tag.replace(srcRe, `src="${dataUri}"`));
    } else {
      out = out.replace(tag, ""); // drop images pdfmake can't embed
    }
  }

  return out;
}

/**
 * html-to-pdfmake frequently emits tables with no `widths` array and ragged rows
 * (different cell counts per row) — especially from .docx-imported letters with
 * merged cells. pdfmake then crashes with "Cannot read properties of undefined
 * (reading '_calcWidth')". Normalise every table node so it is renderable:
 *   - strip colSpan/rowSpan (html-to-pdfmake sets them without the placeholder
 *     cells pdfmake requires, which is the usual cause of the crash),
 *   - pad every row to the widest row's cell count,
 *   - guarantee a `widths` array of matching length (equal star columns).
 */
function normalizeTablesForPdfmake(node) {
  if (Array.isArray(node)) {
    node.forEach(normalizeTablesForPdfmake);
    return;
  }
  if (!node || typeof node !== "object") return;

  if (node.table && Array.isArray(node.table.body)) {
    const body = node.table.body;
    let maxCols = 1;
    for (const row of body) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        if (cell && typeof cell === "object") {
          delete cell.colSpan;
          delete cell.rowSpan;
        }
      }
      maxCols = Math.max(maxCols, row.length);
    }
    for (const row of body) {
      if (!Array.isArray(row)) continue;
      while (row.length < maxCols) row.push({ text: "" });
    }
    const w = node.table.widths;
    if (!Array.isArray(w) || w.length !== maxCols) {
      node.table.widths = new Array(maxCols).fill("*");
    }
    for (const row of body) {
      if (Array.isArray(row)) row.forEach(normalizeTablesForPdfmake);
    }
  }

  for (const key of ["stack", "columns", "ul", "ol", "content"]) {
    if (Array.isArray(node[key])) node[key].forEach(normalizeTablesForPdfmake);
  }
}

/**
 * Render CCL HTML to a branded PDF buffer (org logo letterhead + footer).
 * @returns {Promise<Buffer>}
 */
export async function renderCclPdfBuffer({ html, organisation = null }) {
  const safeHtml = await sanitizeHtmlImagesForPdf(html);
  const content = htmlToPdfmake(safeHtml || "<p></p>", {
    window: sharedWindow,
  });
  normalizeTablesForPdfmake(content);

  const images = {};
  const logo = await resolveLogoDataUri(
    organisation?.logoUrl || organisation?.logo_url,
  );
  if (logo) images.logo = logo;

  // Letterhead details (resolved from the tenant Organisation row).
  const orgName = organisation?.name || process.env.PORTAL_WEBSITE_NAME || "";
  const orgEmail =
    organisation?.primaryEmail ||
    organisation?.email ||
    organisation?.contact_email ||
    "";
  const orgPhone = organisation?.phone || organisation?.contact_phone || "";
  const orgLocation =
    organisation?.address ||
    organisation?.company_address ||
    organisation?.country ||
    "";
  const contactBits = [orgLocation, orgEmail, orgPhone].filter(Boolean);

  const website =
    process.env.PORTAL_WEBSITE_NAME ||
    orgName ||
    "https://www.elitepic.co.uk/";

  const hasHeader = !!(logo || orgName || contactBits.length);
  // Reserve enough top margin to clear the letterhead so it never overlaps body
  // text. The logo height is bounded via `fit` (the old `width`-only sizing let
  // a tall/square logo render past the margin and cover the first lines).
  const HEADER_TOP_MARGIN = 104;

  const buildLetterhead = () => {
    const details = [];
    if (orgName) {
      details.push({ text: orgName, fontSize: 14, bold: true, color: "#1e3a5f" });
    }
    if (contactBits.length) {
      details.push({
        text: contactBits.join("   ·   "),
        fontSize: 8,
        color: "#64748b",
        margin: [0, 3, 0, 0],
      });
    }

    const columns = [];
    if (logo) columns.push({ image: "logo", fit: [150, 48], width: 160 });
    if (details.length) {
      columns.push({
        width: "*",
        alignment: logo ? "right" : "left",
        margin: [0, logo ? 6 : 0, 0, 0],
        stack: details,
      });
    }
    if (!columns.length) return undefined;

    return {
      margin: [56, 28, 56, 0],
      stack: [
        { columns, columnGap: 14 },
        {
          canvas: [
            { type: "line", x1: 0, y1: 8, x2: 483, y2: 8, lineWidth: 1, lineColor: "#1d71b8" },
          ],
        },
      ],
    };
  };

  const docDefinition = {
    pageMargins: [56, hasHeader ? HEADER_TOP_MARGIN : 56, 56, 56],
    header: hasHeader ? buildLetterhead : undefined,
    footer: (currentPage, pageCount) => ({
      margin: [56, 8, 56, 0],
      columns: [
        { text: String(website), fontSize: 8, color: "#64748b", width: "*" },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          fontSize: 8,
          color: "#64748b",
          alignment: "right",
          width: "auto",
        },
      ],
    }),
    content,
    images,
    defaultStyle: { fontSize: 10, color: "#1e293b", lineHeight: 1.3 },
  };

  return generatePdfBufferFromDefinition(docDefinition);
}

/**
 * One-shot: produce the issued CCL PDF for a case from the draft/template.
 * Returns null when no dynamic template/draft exists (caller uses .docx fallback).
 * @returns {Promise<{ buffer: Buffer, source: string, template: object|null } | null>}
 */
export async function generateCclPdfForCase({
  tenantDb,
  caseRecord,
  ccl = null,
  organisation = null,
}) {
  const { html, source, template } = await generateCclHtmlForCase({
    tenantDb,
    caseRecord,
    ccl,
    organisation,
  });
  if (!html) return null;

  const org = await resolveOrganisation(tenantDb, organisation);
  const buffer = await renderCclPdfBuffer({ html, organisation: org });
  return { buffer, source, template };
}
