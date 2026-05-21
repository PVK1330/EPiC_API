import { Op } from "sequelize";
import { ROLES } from "../middlewares/role.middleware.js";
import { getWorkflowState } from "./caseWorkflowProcess.service.js";

function parseBiometricDateTime(bookedSlot) {
  const dateStr = bookedSlot?.appointmentDate;
  if (!dateStr) return null;

  const rawTime = String(bookedSlot.appointmentTime || "09:00").trim();
  let hours = 9;
  let minutes = 0;

  const match = rawTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (match) {
    hours = parseInt(match[1], 10);
    minutes = parseInt(match[2], 10);
    const ampm = match[3];
    if (ampm) {
      const upper = ampm.toUpperCase();
      if (upper === "PM" && hours < 12) hours += 12;
      if (upper === "AM" && hours === 12) hours = 0;
    }
  }

  const isoDate = String(dateStr).slice(0, 10);
  const start = new Date(
    `${isoDate}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`,
  );
  if (Number.isNaN(start.getTime())) {
    const fallback = new Date(dateStr);
    if (Number.isNaN(fallback.getTime())) return null;
    return {
      start: fallback,
      end: new Date(fallback.getTime() + 60 * 60 * 1000),
    };
  }

  return {
    start,
    end: new Date(start.getTime() + 60 * 60 * 1000),
  };
}

function taskToEvent(task, assigneeName) {
  const dueDate = task.due_date ? new Date(task.due_date) : new Date();
  const endDate = new Date(dueDate.getTime() + 60 * 60 * 1000);
  const isCompleted = task.status === "completed";

  return {
    id: `task-${task.id}`,
    title: task.title,
    start: dueDate.toISOString(),
    end: endDate.toISOString(),
    type: "task",
    location: "Task",
    attendees: [assigneeName || "Assigned user"],
    description: `Priority: ${task.priority || "medium"}${task.caseRef ? ` · Case ${task.caseRef}` : ""}`,
    color: isCompleted
      ? "bg-gray-400"
      : task.priority === "high"
        ? "bg-red-500"
        : task.priority === "medium"
          ? "bg-amber-500"
          : "bg-green-500",
    completed: isCompleted,
    caseId: task.caseRef || null,
    isTask: true,
    taskId: task.id,
  };
}

function biometricToEvent(caseRecord, bookedSlot) {
  const times = parseBiometricDateTime(bookedSlot);
  if (!times) return null;

  const caseRef = caseRecord.caseId || `#${caseRecord.id}`;
  const instructions = bookedSlot.instructions?.trim() || "";

  return {
    id: `biometric-${caseRecord.id}`,
    title: "Biometrics appointment",
    start: times.start.toISOString(),
    end: times.end.toISOString(),
    type: "biometric",
    location: bookedSlot.location || "Biometrics centre",
    attendees: [caseRef],
    description: instructions
      ? instructions
      : `Biometrics appointment for case ${caseRef}`,
    color: "bg-cyan-600",
    completed: times.end < new Date(),
    caseId: caseRef,
    isBiometric: true,
  };
}

async function loadTasksForCalendar(tenantDb, userId, roleId) {
  const where = {};

  if (roleId === ROLES.CANDIDATE || roleId === ROLES.CASEWORKER) {
    where.assigned_to = userId;
  }

  const rows = await tenantDb.Task.findAll({
    where,
    order: [
      ["status", "ASC"],
      ["due_date", "ASC"],
      ["id", "DESC"],
    ],
    limit: 200,
    include: [
      {
        model: tenantDb.User,
        as: "assignee",
        attributes: ["id", "first_name", "last_name"],
        required: false,
      },
      {
        model: tenantDb.Case,
        as: "case",
        attributes: ["id", "caseId"],
        required: false,
      },
    ],
  });

  return rows.map((row) => {
    const plain = row.get({ plain: true });
    const assignee = plain.assignee;
    const assigneeName = assignee
      ? `${assignee.first_name || ""} ${assignee.last_name || ""}`.trim()
      : null;
    return {
      id: plain.id,
      title: plain.title,
      status: plain.status,
      priority: plain.priority,
      due_date: plain.due_date,
      caseRef: plain.case?.caseId || (plain.case_id ? `#${plain.case_id}` : null),
      assigneeName,
    };
  });
}

async function loadCasesForBiometrics(tenantDb, userId, roleId) {
  const attributes = ["id", "caseId", "candidateId", "workflowState", "biometricsDate"];

  if (roleId === ROLES.CANDIDATE) {
    return tenantDb.Case.findAll({
      where: { candidateId: userId },
      attributes,
      order: [["updated_at", "DESC"]],
      limit: 20,
    });
  }

  if (roleId === ROLES.CASEWORKER) {
    return tenantDb.Case.findAll({
      where: {
        [Op.or]: [
          tenantDb.sequelize.literal(
            `"assignedcaseworkerId"::jsonb @> '[${Number(userId)}]'::jsonb`,
          ),
        ],
      },
      attributes,
      order: [["updated_at", "DESC"]],
      limit: 100,
    });
  }

  if (roleId === ROLES.ADMIN) {
    return tenantDb.Case.findAll({
      attributes,
      order: [["updated_at", "DESC"]],
      limit: 200,
    });
  }

  return [];
}

/**
 * Tasks + biometric bookings for calendar views (all roles).
 */
export async function getWorkflowCalendarEvents(tenantDb, userId, roleId) {
  const events = [];

  const tasks = await loadTasksForCalendar(tenantDb, userId, roleId);
  for (const task of tasks) {
    if (task.due_date || task.title) {
      events.push(taskToEvent(task, task.assigneeName));
    }
  }

  const cases = await loadCasesForBiometrics(tenantDb, userId, roleId);
  for (const caseRecord of cases) {
    const ws = getWorkflowState(caseRecord);
    const bookedSlot = ws?.biometrics?.bookedSlot;
    if (bookedSlot?.appointmentDate) {
      const ev = biometricToEvent(caseRecord, bookedSlot);
      if (ev) events.push(ev);
    }
  }

  return events;
}
