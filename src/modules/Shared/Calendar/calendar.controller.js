import { getWorkflowCalendarEvents } from "../../../services/calendarEvents.service.js";
import logger from "../../../utils/logger.js";

export const getWorkflowEvents = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const roleId = Number(req.user?.role_id);

    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Unauthorized",
        data: null,
      });
    }

    const events = await getWorkflowCalendarEvents(
      req.tenantDb,
      userId,
      roleId,
    );

    res.status(200).json({
      status: "success",
      message: "Calendar workflow events retrieved",
      data: { events },
    });
  } catch (err) {
    logger.error({ err }, "getWorkflowEvents");
    res.status(500).json({
      status: "error",
      message: err.message || "Failed to load calendar events",
      data: null,
    });
  }
};
