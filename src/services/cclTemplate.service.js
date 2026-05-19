import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getStepById, resolveCaseStage } from "../constants/immigrationCaseProcess.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CCL_TEMPLATES_DIR = path.join(__dirname, "../../assets/ccl-templates");

/** Minimum workflow step order when the Client Care Letter is shown to the candidate (ccl_issued). */
export const CCL_VISIBLE_MIN_ORDER = 10;

/**
 * Visa-type keyword rules (first match wins). Keys are matched against normalised visa + petition labels.
 */
const TEMPLATE_RULES = [
  {
    id: "switch_skilled_worker",
    file: "Client Care Letter- Switch to Skilled Worker.docx",
    label: "Switch to Skilled Worker",
    match: (t) => t.includes("switch") && t.includes("skilled"),
  },
  {
    id: "change_of_employment_2026",
    file: "Client Care Letter- Change of Employment MAR 2026.docx",
    label: "Change of Employment",
    match: (t) => t.includes("change") && t.includes("employment"),
  },
  {
    id: "dependent_sw",
    file: "Client Care Letter- Dependent Partner & Child to SW.docx",
    label: "Dependent Partner & Child (Skilled Worker)",
    match: (t) =>
      t.includes("dependent") ||
      (t.includes("partner") && t.includes("child")) ||
      t.includes("dependant"),
  },
  {
    id: "ilr",
    file: "Client Care Letter- ILR.docx",
    label: "Indefinite Leave to Remain (ILR)",
    match: (t) => t.includes("ilr") || t.includes("indefinite leave"),
  },
  {
    id: "nationality",
    file: "Client Care letter- Nationality.docx",
    label: "Nationality",
    match: (t) => t.includes("nationality") || t.includes("naturalisation") || t.includes("naturalization"),
  },
  {
    id: "sponsor_large",
    file: "Client Care letter- Sponsor Licence Large Companies.docx",
    label: "Sponsor Licence (Large Company)",
    match: (t) => t.includes("sponsor") && t.includes("large"),
  },
  {
    id: "sponsor_small",
    file: "Client Care letter- Sponsor Licence Small Companies.docx",
    label: "Sponsor Licence (Small Company)",
    match: (t) =>
      t.includes("sponsor") && (t.includes("small") || t.includes("licence") || t.includes("license")),
  },
  {
    id: "spouse_british",
    file: "Client Care Letter-Spouse of a British National Visa.docx",
    label: "Spouse of a British National",
    match: (t) =>
      (t.includes("spouse") || t.includes("partner")) &&
      (t.includes("british") || t.includes("uk national")),
  },
  {
    id: "skilled_worker",
    file: "Client Care Letter- Skilled Worker.docx",
    label: "Skilled Worker",
    match: (t) => t.includes("skilled worker") || t.includes("skilled"),
  },
];

const DEFAULT_RULE = TEMPLATE_RULES.find((r) => r.id === "skilled_worker");

function normaliseLabel(...parts) {
  return parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveCclTemplate(visaTypeName = "", petitionTypeName = "") {
  const haystack = normaliseLabel(visaTypeName, petitionTypeName);
  const rule = TEMPLATE_RULES.find((r) => r.match(haystack)) || DEFAULT_RULE;
  const absolutePath = path.join(CCL_TEMPLATES_DIR, rule.file);
  const exists = fs.existsSync(absolutePath);
  return {
    ...rule,
    absolutePath,
    exists,
    visaTypeName: visaTypeName || null,
  };
}

export function isCclStageVisibleToCandidate(caseRecord) {
  if (!caseRecord) return false;
  const stageId = resolveCaseStage(caseRecord);
  const step = getStepById(stageId);
  return (step?.order ?? 0) >= CCL_VISIBLE_MIN_ORDER;
}

export function listAvailableCclTemplates() {
  if (!fs.existsSync(CCL_TEMPLATES_DIR)) return [];
  return fs
    .readdirSync(CCL_TEMPLATES_DIR)
    .filter((f) => f.toLowerCase().endsWith(".docx"))
    .sort();
}

/**
 * Copy the visa-appropriate CCL template onto the case and link it on CaseCclRecord.issued_document_id.
 */
export async function attachCclTemplateToCase({
  tenantDb,
  caseRecord,
  ccl,
  performedBy = null,
  visaTypeName = null,
  petitionTypeName = null,
}) {
  if (!tenantDb?.Document || !tenantDb?.CaseCclRecord || !caseRecord || !ccl) {
    return { document: null, template: null };
  }

  if (ccl.issuedDocumentId) {
    const existing = await tenantDb.Document.findByPk(ccl.issuedDocumentId);
    if (existing) {
      return { document: existing, template: null, reused: true };
    }
  }

  const visaName =
    visaTypeName ||
    caseRecord.visaType?.name ||
    (caseRecord.visaTypeId
      ? (await tenantDb.VisaType?.findByPk(caseRecord.visaTypeId, { attributes: ["name"] }))?.name
      : null);

  let petitionName = petitionTypeName;
  if (!petitionName && caseRecord.petitionTypeId && tenantDb.PetitionType) {
    petitionName = (
      await tenantDb.PetitionType.findByPk(caseRecord.petitionTypeId, { attributes: ["name"] })
    )?.name;
  }

  const template = resolveCclTemplate(visaName, petitionName);
  if (!template.exists) {
    console.warn("CCL template missing:", template.absolutePath);
    return { document: null, template };
  }

  const caseFolder = path.join("uploads", "caseimages", String(caseRecord.id), "ccl");
  fs.mkdirSync(caseFolder, { recursive: true });

  const safeBase = path.basename(template.file);
  const destPath = path.join(caseFolder, safeBase);
  fs.copyFileSync(template.absolutePath, destPath);

  const candidateId = caseRecord.candidateId;
  if (!candidateId) {
    return { document: null, template };
  }

  const document = await tenantDb.Document.create({
    userId: candidateId,
    caseId: caseRecord.id,
    documentType: "Client Care Letter",
    documentName: safeBase,
    userFileName: safeBase,
    documentPath: destPath.replace(/\\/g, "/"),
    documentCategory: "legal",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileSize: fs.statSync(destPath).size,
    status: "approved",
    uploadedBy: performedBy,
    uploadedAt: new Date(),
    reviewedBy: performedBy,
    reviewedAt: new Date(),
    reviewNotes: `Auto-attached CCL template: ${template.label}`,
    isRequired: false,
  });

  await ccl.update({ issuedDocumentId: document.id });
  await ccl.reload();

  return { document, template, created: true };
}
