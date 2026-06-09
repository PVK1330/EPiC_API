import { Op } from "sequelize";
import path from "path";
import XLSX from "xlsx";
import { generateBrandedPdfBuffer } from "./pdfGenerator.service.js";
import { getStageGuidance } from "../constants/immigrationCaseProcess.js";

/** Brand logo used across generated PDFs. */
function brandLogoPath() {
  return path.join(process.cwd(), "assets", "elitepic_logo.png");
}

/**
 * Resolve the list of documents the candidate must provide for a case.
 * Source of truth: DocumentChecklist for the case's visa type (global rows where
 * caseId is null, plus any case-specific overrides). Falls back to the standard
 * data-capture document guidance when no checklist is configured.
 * @returns {Promise<Array<{ name: string, description: string, required: boolean }>>}
 */
export async function resolveRequiredDocuments(tenantDb, caseRecord) {
  const fallback = (getStageGuidance("data_capture_initial_docs").docs || []).map(
    (name) => ({ name, description: "", required: true }),
  );

  if (!tenantDb?.DocumentChecklist) return fallback;

  try {
    const where = {
      [Op.or]: [{ caseId: { [Op.is]: null } }, { caseId: caseRecord?.id ?? -1 }],
    };
    if (caseRecord?.visaTypeId) where.visaTypeId = caseRecord.visaTypeId;

    const rows = await tenantDb.DocumentChecklist.findAll({
      where,
      order: [
        ["sortOrder", "ASC"],
        ["id", "ASC"],
      ],
    });

    if (!rows.length) return fallback;

    // Case-specific rows (caseId set) override global rows with the same name.
    const byName = new Map();
    for (const row of rows) {
      const name = String(row.documentName || row.documentType || "").trim();
      if (!name) continue;
      const entry = {
        name,
        description: String(row.description || "").trim(),
        required: row.isRequired !== false,
        _caseSpecific: row.caseId != null,
      };
      const existing = byName.get(name.toLowerCase());
      if (!existing || (entry._caseSpecific && !existing._caseSpecific)) {
        byName.set(name.toLowerCase(), entry);
      }
    }

    const list = [...byName.values()]
      .filter((d) => d.required)
      .map(({ name, description, required }) => ({ name, description, required }));
    return list.length ? list : fallback;
  } catch {
    return fallback;
  }
}

/** Human-readable required-documents block for the plain-text email body. */
export function formatRequiredDocumentsText(requiredDocuments = []) {
  if (!Array.isArray(requiredDocuments) || requiredDocuments.length === 0) {
    return "";
  }
  const lines = requiredDocuments.map((d) => {
    const desc = d.description ? ` — ${d.description}` : "";
    return `• ${d.name}${desc}`;
  });
  return `Documents we need from you:\n${lines.join("\n")}`;
}

/**
 * Resolve active data capture template for a visa type (visa-specific, else global).
 */
export async function resolveDataCaptureTemplate(tenantDb, visaTypeId) {
  if (!tenantDb?.DataCaptureTemplate) return null;

  if (visaTypeId) {
    const specific = await tenantDb.DataCaptureTemplate.findOne({
      where: { visaTypeId, isActive: true },
      order: [["id", "DESC"]],
    });
    if (specific) return specific;
  }

  return tenantDb.DataCaptureTemplate.findOne({
    where: { visaTypeId: { [Op.is]: null }, isActive: true },
    order: [["id", "DESC"]],
  });
}

function clientDisplayName(candidate, fallback = "Client") {
  if (!candidate) return fallback;
  const name = `${candidate.first_name || ""} ${candidate.last_name || ""}`.trim();
  return name || fallback;
}

function safeFilenamePart(value, fallback = "case") {
  const s = String(value || fallback)
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return s || fallback;
}

export function candidateDataCapturePortalUrl() {
  const base =
    process.env.FRONTEND_URL?.split(",")[0]?.trim() || "http://localhost:5173";
  return `${base.replace(/\/$/, "")}/candidate/data-capture-sheet`;
}

/**
 * Build an XLSX Data Capture Sheet for email attachment (blank response column).
 * @returns {{ filename: string, content: Buffer, contentType: string } | null}
 */
export function buildDataCaptureSheetAttachment({
  template,
  caseRecord,
  candidate = null,
  visaTypeName = "",
}) {
  const fields = Array.isArray(template?.fields) ? template.fields : [];
  if (fields.length === 0) return null;

  const caseRef = caseRecord?.caseId || String(caseRecord?.id || "");
  const clientName = clientDisplayName(candidate);
  const sheetName = template?.name || "Data Capture Sheet";
  const issuedDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const aoa = [
    [sheetName],
    ["Case reference", caseRef],
    ["Client name", clientName],
    ["Visa type", visaTypeName || "—"],
    ["Date issued", issuedDate],
    [],
    [
      "Instructions",
      "Complete the fields below and return this sheet with your supporting documents. You may also complete the form online using the link in your email.",
    ],
    [],
    ["Field", "Your response"],
    ...fields.map((f) => {
      const label = String(f.label || f.key || "").trim();
      const required = f.required ? " (required)" : "";
      const typeHint = f.type && f.type !== "text" ? ` [${f.type}]` : "";
      return [`${label}${required}${typeHint}`, ""];
    }),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data Capture Sheet");
  const content = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const filename = `Data-Capture-Sheet-${safeFilenamePart(caseRef)}.xlsx`;

  return {
    filename,
    content: Buffer.from(content),
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

/**
 * Build a branded PDF Data Capture Sheet for email attachment.
 * Includes the required-documents list and the data-capture fields (blank to
 * complete). Returns null if there is nothing to send.
 * @returns {Promise<{ filename: string, content: Buffer, contentType: string } | null>}
 */
export async function buildDataCaptureSheetPdfAttachment({
  template,
  caseRecord,
  candidate = null,
  visaTypeName = "",
  requiredDocuments = [],
}) {
  const fields = Array.isArray(template?.fields) ? template.fields : [];
  const docs = Array.isArray(requiredDocuments) ? requiredDocuments : [];
  if (fields.length === 0 && docs.length === 0) return null;

  const caseRef = caseRecord?.caseId || String(caseRecord?.id || "");
  const clientName = clientDisplayName(candidate);
  const sheetName = template?.name || "Data Capture Sheet";
  const issuedDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const sections = [];

  sections.push({
    sectionTitle: "Overview",
    paragraphs: [
      "Please complete the data capture fields below and return this sheet together with the required documents listed. You may also complete the form online using the link in your email.",
    ],
    rows: [
      { label: "Case reference", value: caseRef || "—" },
      { label: "Client name", value: clientName },
      { label: "Visa type", value: visaTypeName || "—" },
      { label: "Date issued", value: issuedDate },
    ],
  });

  if (docs.length) {
    sections.push({
      sectionTitle: "Required documents",
      rows: docs.map((d, i) => ({
        label: `${i + 1}. ${d.name}`,
        value: d.description || "Required",
      })),
    });
  }

  if (fields.length) {
    sections.push({
      sectionTitle: "Data capture — please complete",
      rows: fields.map((f) => {
        const label = String(f.label || f.key || "").trim();
        const required = f.required ? " (required)" : "";
        const typeHint = f.type && f.type !== "text" ? ` [${f.type}]` : "";
        return { label: `${label}${required}${typeHint}`, value: " " };
      }),
    });
  }

  const buffer = await generateBrandedPdfBuffer({
    logoPath: brandLogoPath(),
    title: sheetName,
    metadata: {
      subtitle: visaTypeName ? `${visaTypeName} application` : "",
      reference: caseRef ? `Case reference: ${caseRef}` : "",
      candidateName: clientName,
    },
    sections,
  });

  const filename = `Data-Capture-Sheet-${safeFilenamePart(caseRef)}.pdf`;
  return {
    filename,
    content: buffer,
    contentType: "application/pdf",
  };
}
