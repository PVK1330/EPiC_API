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
        candidates.push(path.join(process.cwd(), "storage", "private", base, rest));
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
export async function generateCclHtmlForCase({ tenantDb, caseRecord, ccl = null, organisation = null }) {
  if (ccl?.draftHtml && String(ccl.draftHtml).trim()) {
    return { html: ccl.draftHtml, source: "draft", template: null };
  }

  const template = await resolveDbCclTemplate(tenantDb, caseRecord?.visaTypeId);
  if (!template) return { html: null, source: "none", template: null };

  const org = await resolveOrganisation(tenantDb, organisation);
  const { values } = await buildCclContext({ tenantDb, caseRecord, ccl, organisation: org });
  const parts = [template.headerHtml, template.bodyHtml, template.footerHtml]
    .filter((p) => p && String(p).trim())
    .join("\n");
  return { html: interpolateCclHtml(parts, values), source: "template", template };
}

/**
 * Recursively repair pdfmake nodes so malformed tables can't crash pdfmake
 * (the "_calcWidth on undefined" error). Empty tables are dropped; every table
 * gets a `widths` array matching its widest row, and every row is padded to that
 * column count. Handles tables produced by html-to-pdfmake from rich-text editors
 * (e.g. Quill) that don't fully support tables.
 */
// Printable width: A4 portrait (595.28pt) minus the 56pt left/right page margins.
const PAGE_CONTENT_WIDTH = 595.28 - 56 - 56; // ≈ 483pt

// Compact table layout (small, fixed padding) so column widths are predictable.
const COMPACT_TABLE_LAYOUT = {
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 3,
  paddingBottom: () => 3,
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => "#cbd5e1",
  vLineColor: () => "#cbd5e1",
};

function stripWidth(cell) {
  if (cell && typeof cell === "object" && "width" in cell) {
    const { width, ...rest } = cell; // drop fixed cell width
    void width;
    return rest;
  }
  return cell;
}

function repairPdfmakeTables(node) {
  if (Array.isArray(node)) {
    node.forEach(repairPdfmakeTables);
    return;
  }
  if (!node || typeof node !== "object") return;

  if (node.table) {
    const body = Array.isArray(node.table.body) ? node.table.body : [];
    const cols = body.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);

    if (cols === 0 || body.length === 0) {
      // Neutralise an empty/invalid table so it renders as nothing.
      delete node.table;
      delete node.layout;
      node.text = "";
      return;
    }

    // Pad short rows and strip any per-cell fixed widths (Word/HTML widths often
    // exceed the page → overflow). Every cell wraps within its column instead.
    node.table.body = body.map((row) => {
      const r = Array.isArray(row) ? row.slice() : [];
      while (r.length < cols) r.push("");
      return r.map(stripWidth);
    });

    // Deterministic fit: explicit equal numeric column widths sized to the
    // printable area (accounting for cell padding + borders), so the table can
    // never run off the page regardless of the original .docx/HTML widths.
    const HPAD = 8; // ~4pt each side
    const usable = Math.max(40, PAGE_CONTENT_WIDTH - cols * HPAD - (cols + 1));
    const colWidth = Math.floor(usable / cols);
    node.table.widths = Array.from({ length: cols }, () => colWidth);
    node.table.dontBreakRows = false;
    if (!node.layout) node.layout = COMPACT_TABLE_LAYOUT;

    node.table.body.forEach(repairPdfmakeTables);
  }

  for (const key of ["stack", "columns", "ul", "ol"]) {
    if (Array.isArray(node[key])) node[key].forEach(repairPdfmakeTables);
  }
}

/**
 * Render CCL HTML to a branded PDF buffer (org logo letterhead + footer).
 * @returns {Promise<Buffer>}
 */
export async function renderCclPdfBuffer({ html, organisation = null }) {
  const content = htmlToPdfmake(html || "<p></p>", { window: sharedWindow });
  repairPdfmakeTables(content);

  const images = {};
  const logo = await resolveLogoDataUri(organisation?.logoUrl || organisation?.logo_url);
  if (logo) images.logo = logo;

  const website =
    process.env.PORTAL_WEBSITE_NAME || organisation?.name || "https://www.elitepic.co.uk/";

  const docDefinition = {
    pageMargins: [56, logo ? 96 : 56, 56, 56],
    header: logo
      ? { image: "logo", width: 150, margin: [56, 24, 0, 0] }
      : undefined,
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
export async function generateCclPdfForCase({ tenantDb, caseRecord, ccl = null, organisation = null }) {
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
