import { Op } from "sequelize";
import { DEFAULT_CASE_STAGE } from "../constants/immigrationCaseProcess.js";
import { generateCaseId } from "../utils/case.utils.js";

/**
 * Ensures a new candidate has an enquiry-stage case (Standard Immigration Case Process step 1).
 */
export async function ensureCandidateEnquiryCase(tenantDb, userId, { visaTypeName = null, organisationId = null } = {}) {
  const { Case, CandidateApplication } = tenantDb;

  const existing = await Case.findOne({ where: { candidateId: userId } });
  if (existing) return existing;

  let visaTypeId = null;
  if (visaTypeName && tenantDb.VisaType) {
    const vt = await tenantDb.VisaType.findOne({
      where: { name: { [Op.iLike]: `%${visaTypeName}%` } },
    });
    if (vt) visaTypeId = vt.id;
  }

  let resolvedOrgId = organisationId;
  if (resolvedOrgId == null && tenantDb.Organisation) {
    const firstOrg = await tenantDb.Organisation.findOne({
      attributes: ["id"],
      order: [["id", "ASC"]],
    });
    resolvedOrgId = firstOrg?.id ?? null;
  }

  const app = await CandidateApplication.findOne({ where: { userId } });
  if (!app) {
    await CandidateApplication.create({
      userId,
      status: "draft",
      visaType: visaTypeName || null,
      organisation_id: resolvedOrgId,
    });
  }

  return Case.create({
    caseId: await generateCaseId(tenantDb),
    candidateId: userId,
    visaTypeId,
    status: "Lead",
    caseStage: DEFAULT_CASE_STAGE,
    priority: "medium",
    targetSubmissionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    nationality: null,
    jobTitle: "Client enquiry",
    assignedcaseworkerId: null,
    organisation_id: resolvedOrgId,
  });
}
