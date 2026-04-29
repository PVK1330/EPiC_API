import db from "../../models/index.js";
import {
  notifyAdmins,
  notifyUser,
  NotificationPriority,
  NotificationTypes,
} from "../../services/notification.service.js";

const WorkerEvent = db.WorkerEvent;
const User = db.User;
const Case = db.Case;

const addDays = (dateString, days) => {
  const date = new Date(dateString);
  date.setDate(date.getDate() + days);
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

const notifyInvolvedParties = async ({ workerCase, workerId, title, message, actionType, eventId }) => {
  try {
    await notifyAdmins({
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
    console.error("Failed to notify admins for worker event:", err);
  }

  try {
    await notifyUser(workerId, {
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
    console.error("Failed to notify worker for worker event:", err);
  }

  const caseworkerIds = extractCaseworkerIds(workerCase?.assignedcaseworkerId);
  for (const caseworkerId of caseworkerIds) {
    try {
      await notifyUser(caseworkerId, {
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
      console.error(`Failed to notify caseworker ${caseworkerId} for worker event:`, err);
    }
  }
};

export const listWorkerEvents = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const events = await WorkerEvent.findAll({
      where: { sponsorId },
      include: [{ model: User, as: "worker", attributes: ["id", "first_name", "last_name"] }],
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
        status,
        daysRemaining,
        workerName: `${plain.worker?.first_name || ""} ${plain.worker?.last_name || ""}`.trim() || "N/A",
      };
    });

    return res.status(200).json({ status: "success", data });
  } catch (error) {
    console.error("Error fetching worker events:", error);
    return res.status(500).json({ status: "error", message: "Internal server error" });
  }
};

export const createWorkerEvent = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { workerId, eventType, eventDate, description } = req.body;

    if (!workerId || !eventType || !eventDate) {
      return res.status(400).json({ status: "error", message: "workerId, eventType and eventDate are required" });
    }

    const workerCase = await Case.findOne({
      where: { sponsorId, candidateId: workerId },
      attributes: ["id", "caseId", "assignedcaseworkerId"],
    });
    if (!workerCase) {
      return res.status(404).json({ status: "error", message: "Worker is not associated with this sponsor" });
    }

    const deadlineDate = toISODate(addDays(eventDate, 10));
    const newEvent = await WorkerEvent.create({
      sponsorId,
      workerId,
      caseId: workerCase.id,
      eventType,
      eventDate: toISODate(eventDate),
      deadlineDate,
      reportedDate: null,
      status: resolveStatus(null, deadlineDate),
      description: description || null,
    });

    await notifyInvolvedParties({
      workerCase,
      workerId,
      title: "Worker Event Reported",
      message: `A ${eventType} event has been reported and is due by ${deadlineDate}.`,
      actionType: "worker_event_created",
      eventId: newEvent.id,
    });

    return res.status(201).json({ status: "success", data: newEvent });
  } catch (error) {
    console.error("Error creating worker event:", error);
    return res.status(500).json({ status: "error", message: "Internal server error" });
  }
};

export const updateWorkerEvent = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { id } = req.params;
    const { workerId, eventType, eventDate, reportedDate, description } = req.body;

    const event = await WorkerEvent.findOne({ where: { id, sponsorId } });
    if (!event) {
      return res.status(404).json({ status: "error", message: "Worker event not found" });
    }

    let workerCase = await Case.findOne({
      where: { sponsorId, candidateId: event.workerId },
      attributes: ["id", "caseId", "assignedcaseworkerId"],
    });

    if (workerId && workerId !== event.workerId) {
      workerCase = await Case.findOne({
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
    const nextReportedDate = toISODate(reportedDate);

    event.eventType = eventType || event.eventType;
    event.eventDate = nextEventDate;
    event.deadlineDate = nextDeadlineDate;
    event.reportedDate = nextReportedDate;
    event.status = resolveStatus(nextReportedDate, nextDeadlineDate);
    event.description = description ?? event.description;

    await event.save();
    await notifyInvolvedParties({
      workerCase,
      workerId: event.workerId,
      title: "Worker Event Updated",
      message: `Worker event "${event.eventType}" was updated. Current status: ${event.status}.`,
      actionType: "worker_event_updated",
      eventId: event.id,
    });

    return res.status(200).json({ status: "success", data: event });
  } catch (error) {
    console.error("Error updating worker event:", error);
    return res.status(500).json({ status: "error", message: "Internal server error" });
  }
};

export const deleteWorkerEvent = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { id } = req.params;
    const event = await WorkerEvent.findOne({ where: { id, sponsorId } });
    if (!event) {
      return res.status(404).json({ status: "error", message: "Worker event not found" });
    }

    const workerCase = await Case.findOne({
      where: { sponsorId, candidateId: event.workerId },
      attributes: ["id", "caseId", "assignedcaseworkerId"],
    });

    const deleted = await WorkerEvent.destroy({ where: { id, sponsorId } });
    if (!deleted) {
      return res.status(404).json({ status: "error", message: "Worker event not found" });
    }

    await notifyInvolvedParties({
      workerCase,
      workerId: event.workerId,
      title: "Worker Event Removed",
      message: `Worker event "${event.eventType}" has been removed from reporting obligations.`,
      actionType: "worker_event_deleted",
      eventId: event.id,
    });

    return res.status(200).json({ status: "success", message: "Worker event deleted" });
  } catch (error) {
    console.error("Error deleting worker event:", error);
    return res.status(500).json({ status: "error", message: "Internal server error" });
  }
};
