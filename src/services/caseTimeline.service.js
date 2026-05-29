import logger from "../utils/logger.js";

/**
 * Records a timeline entry for a case in the tenant database.
 */
export const recordTimelineEntry = async ({
  tenantDb,
  caseId,
  actionType,
  description,
  performedBy,
  previousValue = null,
  newValue = null,
  metadata = null,
  isSystemAction = false,
  visibility = "public",
}) => {
  try {
    if (!tenantDb) return;
    await tenantDb.CaseTimeline.create({
      caseId,
      actionType,
      description,
      performedBy,
      previousValue,
      newValue,
      metadata,
      isSystemAction,
      visibility,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to record timeline entry");
  }
};

export const recordCaseCreated = async (params) => {
  return recordTimelineEntry({
    ...params,
    actionType: "case_created",
    description: params.description || "Case created",
    isSystemAction: params.isSystemAction ?? false,
  });
};

export const recordStatusChange = async (params) => {
  return recordTimelineEntry({
    ...params,
    actionType: "status_changed",
    description:
      params.description ||
      `Status changed from ${params.previousValue} to ${params.newValue}`,
  });
};

export const recordAssignmentChange = async (params) => {
  return recordTimelineEntry({
    ...params,
    actionType: "assignment_changed",
    description: params.description || "Case assignment updated",
  });
};
