import { Op } from "sequelize";
import XLSX from "xlsx";

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
