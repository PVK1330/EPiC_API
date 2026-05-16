/**
 * Add an entry to a case's timeline (tenant database).
 */
export const addTimelineEntry = async (data) => {
  try {
    const {
      tenantDb,
      caseId,
      actionType,
      description,
      performedBy,
      visibility = "public",
      metadata = {},
      previousValue,
      newValue,
      isSystemAction = false,
    } = data;

    if (!tenantDb) throw new Error("tenantDb is required");
    if (!caseId || !actionType || !description) {
      throw new Error("caseId, actionType, and description are required for timeline entry");
    }

    return tenantDb.CaseTimeline.create({
      caseId,
      actionType,
      description,
      performedBy,
      visibility,
      metadata,
      previousValue,
      newValue,
      isSystemAction,
    });
  } catch (error) {
    console.error("Error adding timeline entry:", error);
    throw error;
  }
};
