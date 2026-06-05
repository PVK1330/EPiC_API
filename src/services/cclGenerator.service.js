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
  if (logoUrl && !/^https?:/i.test(String(logoUrl))) {
    candidates.push(path.resolve(process.cwd(), String(logoUrl)));
  }
  candidates.push(path.join(process.cwd(), "assets", "elitepic_logo.png"));

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
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
 * Render CCL HTML to a branded PDF buffer (org logo letterhead + footer).
 * @returns {Promise<Buffer>}
 */
export async function renderCclPdfBuffer({ html, organisation = null }) {
  const content = htmlToPdfmake(html || "<p></p>", { window: sharedWindow });

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
