import logger from '../../../utils/logger.js';
import {
  notifyAdmins,
  notifyUser,
  NotificationPriority,
  NotificationTypes,
} from '../../../services/notification.service.js';

const addDays = (dateString, days) => {
  const date = new Date(dateString);
  let count = 0;
  while (count < days) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) {
      count++;
    }
  }
  return date;
};

const toISODate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const resolveStatus = (reportedDate, deadlineDate) => {
  if (reportedDate) return "reported";
  return new Date(deadlineDate) < new Date() ? "overdue" : "pending";
};

/**
 * Notification matrix for Worker Events
 * - worker_event_created: Admins, involved Candidate, assigned Caseworker(s)
 * - worker_event_updated: Admins, involved Candidate, assigned Caseworker(s)
 * - worker_event_deleted: Admins, involved Candidate, assigned Caseworker(s)
 */
const extractCaseworkerIds = (assignedcaseworkerId) => {
  if (!Array.isArray(assignedcaseworkerId)) return [];
  return assignedcaseworkerId
    .map((entry) => {
      if (typeof entry === "number") return entry;
      if (entry && typeof entry === "object") {
        return entry.id || entry.userId || entry.caseworkerId || null;
      }
      return null;
    })
    .filter((id) => Number.isInteger(id));
};

const notifyInvolvedParties = async ({ tenantDb, workerCase, workerId, title, message, actionType, eventId }) => {
  try {
    await notifyAdmins(tenantDb, {
      type: NotificationTypes.INFO,
      priority: NotificationPriority.HIGH,
      title,
      message,
      actionType,
      entityId: eventId,
      entityType: "worker_event",
      metadata: { caseId: workerCase?.caseId },
    });
  } catch (err) {
    logger.error({ err }, "Failed to notify admins for worker event");
  }

  try {
    await notifyUser(tenantDb, workerId, {
      type: NotificationTypes.INFO,
      priority: NotificationPriority.MEDIUM,
      title,
      message,
      actionType,
      entityId: eventId,
      entityType: "worker_event",
      metadata: { caseId: workerCase?.caseId },
      sendEmail: true,
    });
  } catch (err) {
    logger.error({ err }, "Failed to notify worker for worker event");
  }

  const caseworkerIds = extractCaseworkerIds(workerCase?.assignedcaseworkerId);
  for (const caseworkerId of caseworkerIds) {
    try {
      await notifyUser(tenantDb, caseworkerId, {
        type: NotificationTypes.INFO,
        priority: NotificationPriority.HIGH,
        title,
        message,
        actionType,
        entityId: eventId,
        entityType: "worker_event",
        metadata: { caseId: workerCase?.caseId, workerId },
        sendEmail: true,
      });
    } catch (err) {
      logger.error({ err, caseworkerId }, "Failed to notify caseworker for worker event");
    }
  }
};

export const listWorkerEvents = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const events = await req.tenantDb.WorkerEvent.findAll({
      where: { sponsorId },
      include: [{ model: req.tenantDb.User, as: "worker", attributes: ["id", "first_name", "last_name"] }],
      order: [["eventDate", "DESC"]],
    });

    const data = events.map((event) => {
      const plain = event.toJSON();
      const status = resolveStatus(plain.reportedDate, plain.deadlineDate);
      const deadline = new Date(plain.deadlineDate);
      const today = new Date();
      const daysRemaining = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
      return {
        ...plain,
        worker: `${plain.worker?.first_name || ""} ${plain.worker?.last_name || ""}`.trim() || "N/A",
        workerName: `${plain.worker?.first_name || ""} ${plain.worker?.last_name || ""}`.trim() || "N/A",
        deadline: plain.deadlineDate,
        status: status.charAt(0).toUpperCase() + status.slice(1),
        daysRemaining,
        risk: daysRemaining < 0 ? "high" : daysRemaining <= 3 ? "medium" : "low",
      };
    });

    return res.status(200).json({ status: "success", data });
  } catch (error) {
    logger.error({ err: error }, "Error fetching worker events");
    return res.status(500).json({ status: "error", message: "Internal server error" });
  }
};

export const createWorkerEvent = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { workerId, eventType, eventDate, description, reportedBy, dateReportedToSms } = req.body;

    if (!workerId || !eventType || !eventDate) {
      return res.status(400).json({ status: "error", message: "workerId, eventType and eventDate are required" });
    }

    const workerCase = await req.tenantDb.Case.findOne({
      where: { sponsorId, candidateId: workerId },
      attributes: ["id", "caseId", "assignedcaseworkerId"],
    });
    if (!workerCase) {
      return res.status(404).json({ status: "error", message: "Worker is not associated with this sponsor" });
    }

    const deadlineDate = toISODate(addDays(eventDate, 10));
    const organisationId = req.user?.organisation_id != null ? Number(req.user.organisation_id) : null;
    const evidenceFile = req.file ? req.file.path.replace(/\\/g, '/') : null;

    const newEvent = await req.tenantDb.WorkerEvent.create({
      sponsorId,
      workerId,
      caseId: workerCase.id,
      eventType,
      eventDate: toISODate(eventDate),
      deadlineDate,
      reportedDate: null,
      status: resolveStatus(null, deadlineDate),
      description: description || null,
      reportedBy: reportedBy || null,
      evidenceFile: evidenceFile,
      dateReportedToSms: dateReportedToSms ? new Date(dateReportedToSms) : null,
      organisation_id: organisationId,
    });

    await notifyInvolvedParties({
      tenantDb: req.tenantDb,
      workerCase,
      workerId,
      title: "Worker Event Reported",
      message: `A ${eventType} event has been reported and is due by ${deadlineDate}.`,
      actionType: "worker_event_created",
      eventId: newEvent.id,
    });

    return res.status(201).json({ status: "success", data: newEvent });
  } catch (error) {
    logger.error({ err: error }, "Error creating worker event");
    return res.status(500).json({ status: "error", message: "Internal server error" });
  }
};

export const updateWorkerEvent = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { id } = req.params;
    const { workerId, eventType, eventDate, reportedDate, description, reportedBy, dateReportedToSms } = req.body;

    const event = await req.tenantDb.WorkerEvent.findOne({ where: { id, sponsorId } });
    if (!event) {
      return res.status(404).json({ status: "error", message: "Worker event not found" });
    }

    let workerCase = await req.tenantDb.Case.findOne({
      where: { sponsorId, candidateId: event.workerId },
      attributes: ["id", "caseId", "assignedcaseworkerId"],
    });

    if (workerId && workerId !== event.workerId) {
      workerCase = await req.tenantDb.Case.findOne({
        where: { sponsorId, candidateId: workerId },
        attributes: ["id", "caseId", "assignedcaseworkerId"],
      });
      if (!workerCase) {
        return res.status(404).json({ status: "error", message: "Worker is not associated with this sponsor" });
      }
      event.workerId = workerId;
      event.caseId = workerCase.id;
    }

    const nextEventDate = toISODate(eventDate || event.eventDate);
    const nextDeadlineDate = toISODate(addDays(nextEventDate, 10));
    const nextReportedDate = toISODate(reportedDate || dateReportedToSms);

    event.eventType = eventType || event.eventType;
    event.eventDate = nextEventDate;
    event.deadlineDate = nextDeadlineDate;
    event.reportedDate = nextReportedDate;
    event.status = resolveStatus(nextReportedDate, nextDeadlineDate);
    event.description = description ?? event.description;
    event.reportedBy = reportedBy ?? event.reportedBy;
    if (req.file) {
      event.evidenceFile = req.file.path.replace(/\\/g, '/');
    }
    if (dateReportedToSms !== undefined) {
      event.dateReportedToSms = dateReportedToSms ? new Date(dateReportedToSms) : null;
    }

    await event.save();
    await notifyInvolvedParties({
      tenantDb: req.tenantDb,
      workerCase,
      workerId: event.workerId,
      title: "Worker Event Updated",
      message: `Worker event "${event.eventType}" was updated. Current status: ${event.status}.`,
      actionType: "worker_event_updated",
      eventId: event.id,
    });

    return res.status(200).json({ status: "success", data: event });
  } catch (error) {
    logger.error({ err: error }, "Error updating worker event");
    return res.status(500).json({ status: "error", message: "Internal server error" });
  }
};

export const deleteWorkerEvent = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { id } = req.params;
    const event = await req.tenantDb.WorkerEvent.findOne({ where: { id, sponsorId } });
    if (!event) {
      return res.status(404).json({ status: "error", message: "Worker event not found" });
    }

    const workerCase = await req.tenantDb.Case.findOne({
      where: { sponsorId, candidateId: event.workerId },
      attributes: ["id", "caseId", "assignedcaseworkerId"],
    });

    const deleted = await req.tenantDb.WorkerEvent.destroy({ where: { id, sponsorId } });
    if (!deleted) {
      return res.status(404).json({ status: "error", message: "Worker event not found" });
    }

    await notifyInvolvedParties({
      tenantDb: req.tenantDb,
      workerCase,
      workerId: event.workerId,
      title: "Worker Event Removed",
      message: `Worker event "${event.eventType}" has been removed from reporting obligations.`,
      actionType: "worker_event_deleted",
      eventId: event.id,
    });

    return res.status(200).json({ status: "success", message: "Worker event deleted" });
  } catch (error) {
    logger.error({ err: error }, "Error deleting worker event");
    return res.status(500).json({ status: "error", message: "Internal server error" });
  }
};
