/**
 * ccl.controller.js
 * Org-level CCL templates + per-case CCL draft/issue.
 * All routes are gated to Admin + Caseworker (see ccl.routes.js).
 */
import { Op } from "sequelize";
import mammoth from "mammoth";
import {
  getCclTagRegistry,
  CCL_TAGS,
  interpolateCclHtml,
  renderInstallmentPlanHtml,
} from "../../../services/cclTags.service.js";
import {
  generateCclHtmlForCase,
  generateCclPdfForCase,
  renderCclPdfBuffer,
} from "../../../services/cclGenerator.service.js";
import { attachCclTemplateToCase } from "../../../services/cclTemplate.service.js";
import logger from "../../../utils/logger.js";

const ok = (res, data, message = "OK") =>
  res.status(200).json({ status: "success", message, data });
const bad = (res, message, code = 400) =>
  res.status(code).json({ status: "error", message, data: null });

// ── helpers ───────────────────────────────────────────────────────────────────
async function findCase(tenantDb, caseRef) {
  const ref = String(caseRef || "").replace(/^#/, "");
  if (/^\d+$/.test(ref)) {
    const byPk = await tenantDb.Case.findByPk(Number(ref));
    if (byPk) return byPk;
  }
  return tenantDb.Case.findOne({ where: { caseId: ref } });
}

/** Deactivate any other active template for the same visa slot (DB enforces one active). */
async function deactivateSiblings(tenantDb, visaTypeId, exceptId = null) {
  const where = { isActive: true, visaTypeId: visaTypeId ?? null };
  if (exceptId) where.id = { [Op.ne]: exceptId };
  await tenantDb.CclTemplate.update({ isActive: false }, { where });
}

/** Sample tag values for previewing a template with realistic placeholder data. */
function sampleValues() {
  const values = {};
  for (const t of CCL_TAGS) {
    if (t.tag === "installment_plan") {
      values[t.tag] = renderInstallmentPlanHtml([
        { label: "Deposit", amount: 500, dueDate: null },
        { label: "Balance", amount: 1000, dueDate: "2026-07-01" },
      ]);
    } else if (t.tag === "org_logo") {
      values[t.tag] = "";
    } else {
      values[t.tag] = t.sample;
    }
  }
  return values;
}

function streamPdf(res, buffer, filename) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.send(buffer);
}

// ── tag registry ────────────────────────────────────────────────────────────
export const getTags = async (_req, res) => ok(res, getCclTagRegistry());

// ── template CRUD ─────────────────────────────────────────────────────────────
export const listTemplates = async (req, res) => {
  try {
    const rows = await req.tenantDb.CclTemplate.findAll({
      include: req.tenantDb.VisaType
        ? [{ model: req.tenantDb.VisaType, as: "visaType", attributes: ["id", "name"] }]
        : [],
      order: [["visaTypeId", "ASC"], ["id", "DESC"]],
    });
    return ok(res, { templates: rows });
  } catch (err) {
    logger.error({ err }, "listTemplates");
    return bad(res, err.message, 500);
  }
};

export const getTemplate = async (req, res) => {
  try {
    const row = await req.tenantDb.CclTemplate.findByPk(req.params.id);
    if (!row) return bad(res, "Template not found", 404);
    return ok(res, { template: row });
  } catch (err) {
    logger.error({ err }, "getTemplate");
    return bad(res, err.message, 500);
  }
};

export const createTemplate = async (req, res) => {
  try {
    const { name, visaTypeId = null, bodyHtml = "", headerHtml = null, footerHtml = null } = req.body || {};
    const isActive = req.body?.isActive !== false;
    if (!name || !String(name).trim()) return bad(res, "Template name is required");
    if (!bodyHtml || !String(bodyHtml).trim()) return bad(res, "Template body is required");

    const vtId = visaTypeId === "" || visaTypeId == null ? null : Number(visaTypeId);
    if (isActive) await deactivateSiblings(req.tenantDb, vtId);

    const row = await req.tenantDb.CclTemplate.create({
      name: String(name).trim(),
      visaTypeId: vtId,
      bodyHtml,
      headerHtml,
      footerHtml,
      isActive,
      createdBy: req.user?.userId ?? null,
    });
    return res.status(201).json({ status: "success", message: "Template created", data: { template: row } });
  } catch (err) {
    logger.error({ err }, "createTemplate");
    return bad(res, err.message, 500);
  }
};

export const updateTemplate = async (req, res) => {
  try {
    const row = await req.tenantDb.CclTemplate.findByPk(req.params.id);
    if (!row) return bad(res, "Template not found", 404);

    const updates = {};
    for (const f of ["name", "bodyHtml", "headerHtml", "footerHtml"]) {
      if (req.body?.[f] !== undefined) updates[f] = req.body[f];
    }
    if (req.body?.visaTypeId !== undefined) {
      updates.visaTypeId =
        req.body.visaTypeId === "" || req.body.visaTypeId == null ? null : Number(req.body.visaTypeId);
    }
    if (req.body?.isActive !== undefined) updates.isActive = !!req.body.isActive;

    const willBeActive = updates.isActive ?? row.isActive;
    const slot = updates.visaTypeId !== undefined ? updates.visaTypeId : row.visaTypeId;
    if (willBeActive) await deactivateSiblings(req.tenantDb, slot, row.id);

    await row.update(updates);
    return ok(res, { template: row }, "Template updated");
  } catch (err) {
    logger.error({ err }, "updateTemplate");
    return bad(res, err.message, 500);
  }
};

export const deleteTemplate = async (req, res) => {
  try {
    const row = await req.tenantDb.CclTemplate.findByPk(req.params.id);
    if (!row) return bad(res, "Template not found", 404);
    await row.destroy();
    return ok(res, null, "Template deleted");
  } catch (err) {
    logger.error({ err }, "deleteTemplate");
    return bad(res, err.message, 500);
  }
};

/** Preview unsaved template HTML with sample data → PDF. */
export const previewTemplate = async (req, res) => {
  try {
    const { bodyHtml = "", headerHtml = null, footerHtml = null } = req.body || {};
    const parts = [headerHtml, bodyHtml, footerHtml].filter((p) => p && String(p).trim()).join("\n");
    const organisation = req.tenantDb.Organisation ? await req.tenantDb.Organisation.findOne() : null;

    // Preview uses sample candidate/fee data, but the REAL company details + logo
    // so the firm sees their own branding.
    const values = sampleValues();
    if (organisation?.name) values.org_name = organisation.name;
    const orgAddress = organisation?.address || organisation?.company_address;
    if (orgAddress) values.org_address = orgAddress;
    const orgEmail = organisation?.email || organisation?.primaryEmail;
    if (orgEmail) values.org_email = orgEmail;
    if (organisation?.phone) values.org_phone = organisation.phone;

    const html = interpolateCclHtml(parts, values);
    const buffer = await renderCclPdfBuffer({ html, organisation });
    return streamPdf(res, buffer, "ccl-template-preview.pdf");
  } catch (err) {
    logger.error({ err }, "previewTemplate");
    return bad(res, err.message, 500);
  }
};

// ── per-case CCL draft / issue ─────────────────────────────────────────────────
export const getCaseCcl = async (req, res) => {
  try {
    const caseRecord = await findCase(req.tenantDb, req.params.caseId);
    if (!caseRecord) return bad(res, "Case not found", 404);

    const ccl = await req.tenantDb.CaseCclRecord.findOne({ where: { caseId: caseRecord.id } });
    const { html, source } = await generateCclHtmlForCase({
      tenantDb: req.tenantDb,
      caseRecord,
      ccl,
    });

    return ok(res, {
      caseId: caseRecord.caseId || caseRecord.id,
      ccl: ccl
        ? {
            status: ccl.status,
            feeAmount: ccl.feeAmount,
            draftHtml: ccl.draftHtml,
            issuedDocumentId: ccl.issuedDocumentId,
            signedDocumentId: ccl.signedDocumentId,
          }
        : null,
      html, // editable letter (draft if present, else interpolated template)
      source, // 'draft' | 'template' | 'none'
      hasTemplate: source !== "none",
    });
  } catch (err) {
    logger.error({ err }, "getCaseCcl");
    return bad(res, err.message, 500);
  }
};

export const saveCaseDraft = async (req, res) => {
  try {
    const caseRecord = await findCase(req.tenantDb, req.params.caseId);
    if (!caseRecord) return bad(res, "Case not found", 404);
    const { draftHtml } = req.body || {};
    if (draftHtml === undefined) return bad(res, "draftHtml is required");

    const [ccl] = await req.tenantDb.CaseCclRecord.findOrCreate({
      where: { caseId: caseRecord.id },
      defaults: { caseId: caseRecord.id, status: "pending", draftHtml },
    });
    await ccl.update({ draftHtml });
    return ok(res, { draftHtml: ccl.draftHtml }, "Draft saved");
  } catch (err) {
    logger.error({ err }, "saveCaseDraft");
    return bad(res, err.message, 500);
  }
};

export const previewCaseCcl = async (req, res) => {
  try {
    const caseRecord = await findCase(req.tenantDb, req.params.caseId);
    if (!caseRecord) return bad(res, "Case not found", 404);
    const ccl = await req.tenantDb.CaseCclRecord.findOne({ where: { caseId: caseRecord.id } });

    const gen = await generateCclPdfForCase({ tenantDb: req.tenantDb, caseRecord, ccl });
    if (!gen?.buffer) {
      return bad(res, "No CCL template or draft available for this case", 404);
    }
    return streamPdf(res, gen.buffer, "ccl-preview.pdf");
  } catch (err) {
    logger.error({ err }, "previewCaseCcl");
    return bad(res, err.message, 500);
  }
};

/** Import an uploaded .docx CCL letter → convert to editable HTML draft. */
export const importCaseDraft = async (req, res) => {
  try {
    const caseRecord = await findCase(req.tenantDb, req.params.caseId);
    if (!caseRecord) return bad(res, "Case not found", 404);
    if (!req.file?.buffer) return bad(res, "A .docx file is required");

    const name = String(req.file.originalname || "").toLowerCase();
    const isDocx =
      name.endsWith(".docx") ||
      req.file.mimetype ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (!isDocx) {
      return bad(res, "Only .docx files can be imported and edited. (PDFs cannot be edited.)");
    }

    // Inline embedded images as base64 data URIs so the letterhead/logo in the
    // uploaded .docx survives the conversion. Mammoth drops images by default,
    // which is why the logo went missing on import.
    const { value: html } = await mammoth.convertToHtml(
      { buffer: req.file.buffer },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          const base64 = await image.read("base64");
          return { src: `data:${image.contentType};base64,${base64}` };
        }),
      },
    );
    if (!html || !html.trim()) {
      return bad(res, "Could not extract any content from the document");
    }

    const [ccl] = await req.tenantDb.CaseCclRecord.findOrCreate({
      where: { caseId: caseRecord.id },
      defaults: { caseId: caseRecord.id, status: "pending", draftHtml: html },
    });
    await ccl.update({ draftHtml: html });

    return ok(res, { html }, "Document imported — review and edit before issuing");
  } catch (err) {
    logger.error({ err }, "importCaseDraft");
    return bad(res, err.message, 500);
  }
};

/** (Re)generate the issued CCL document from the current draft/template. */
export const issueCaseCcl = async (req, res) => {
  try {
    const caseRecord = await findCase(req.tenantDb, req.params.caseId);
    if (!caseRecord) return bad(res, "Case not found", 404);

    const [ccl] = await req.tenantDb.CaseCclRecord.findOrCreate({
      where: { caseId: caseRecord.id },
      defaults: { caseId: caseRecord.id, status: "issued" },
    });

    // Force regeneration from the latest draft/template.
    if (ccl.issuedDocumentId) await ccl.update({ issuedDocumentId: null });

    const result = await attachCclTemplateToCase({
      tenantDb: req.tenantDb,
      caseRecord,
      ccl,
      performedBy: req.user?.userId ?? null,
    });
    if (!result?.document) return bad(res, "Could not generate the Client Care Letter", 500);

    if (ccl.status !== "signed") {
      await ccl.update({ status: "issued", issuedAt: new Date(), issuedBy: req.user?.userId ?? null });
    }
    return ok(res, { documentId: result.document.id, dynamic: !!result.dynamic }, "Client Care Letter issued");
  } catch (err) {
    logger.error({ err }, "issueCaseCcl");
    return bad(res, err.message, 500);
  }
};
