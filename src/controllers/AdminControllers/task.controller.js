import db from "../../models/index.js";
import { ROLES } from "../../middlewares/role.middleware.js";

const Task = db.Task;
const User = db.User;
const Case = db.Case;

const PRIORITIES = ["low", "medium", "high"];
const STATUSES = ["pending", "in-progress", "completed"];

function fullName(user) {
  if (!user) return null;
  const first = user.first_name || "";
  const last = user.last_name || "";
  const s = `${first} ${last}`.trim();
  return s || null;
}

function userInclude(as) {
  return {
    model: User,
    as,
    attributes: ["id", "first_name", "last_name", "email"],
    required: false,
  };
}

function mapTask(task) {
  const plain = task.get ? task.get({ plain: true }) : { ...task };
  const assignee = plain.assignee;
  const creator = plain.creator;
  delete plain.assignee;
  delete plain.creator;
  return {
    ...plain,
    assigned_to_name: fullName(assignee),
    assigned_by_name: fullName(creator),
  };
}

export const createTask = async (req, res) => {
  try {
    const roleId = req.user?.role_id;
    const userId = req.user?.userId;

    const {
      title,
      due_date,
      priority: priorityRaw,
      status: statusRaw,
      case_id: caseIdRaw,
      assigned_to: assignedToRaw,
    } = req.body;

    if (!title || String(title).trim() === "") {
      return res.status(400).json({
        status: "error",
        message: "title is required",
        data: null,
      });
    }

    if (due_date === undefined || due_date === null || due_date === "") {
      return res.status(400).json({
        status: "error",
        message: "due_date is required",
        data: null,
      });
    }

    let priority = priorityRaw !== undefined && priorityRaw !== null ? String(priorityRaw) : "medium";
    let status = statusRaw !== undefined && statusRaw !== null ? String(statusRaw) : "pending";

    if (!PRIORITIES.includes(priority)) {
      return res.status(400).json({
        status: "error",
        message: `priority must be one of: ${PRIORITIES.join(", ")}`,
        data: null,
      });
    }

    if (!STATUSES.includes(status)) {
      return res.status(400).json({
        status: "error",
        message: `status must be one of: ${STATUSES.join(", ")}`,
        data: null,
      });
    }

    let case_id = null;
    let assigned_to;

    if (roleId === ROLES.ADMIN) {
      if (caseIdRaw === undefined || caseIdRaw === null || caseIdRaw === "") {
        return res.status(400).json({
          status: "error",
          message: "case_id is required for admin",
          data: null,
        });
      }
      if (assignedToRaw === undefined || assignedToRaw === null || assignedToRaw === "") {
        return res.status(400).json({
          status: "error",
          message: "assigned_to is required for admin",
          data: null,
        });
      }
      case_id = parseInt(caseIdRaw, 10);
      assigned_to = parseInt(assignedToRaw, 10);
      if (Number.isNaN(case_id) || Number.isNaN(assigned_to)) {
        return res.status(400).json({
          status: "error",
          message: "case_id and assigned_to must be valid integers",
          data: null,
        });
      }

      const caseRow = await Case.findByPk(case_id);
      if (!caseRow) {
        return res.status(404).json({
          status: "error",
          message: "Case not found",
          data: null,
        });
      }

      const assigneeUser = await User.findByPk(assigned_to);
      if (!assigneeUser) {
        return res.status(404).json({
          status: "error",
          message: "Assigned user not found",
          data: null,
        });
      }
    } else if (roleId === ROLES.CASEWORKER) {
      assigned_to = userId;
      if (caseIdRaw !== undefined && caseIdRaw !== null && caseIdRaw !== "") {
        case_id = parseInt(caseIdRaw, 10);
        if (Number.isNaN(case_id)) {
          return res.status(400).json({
            status: "error",
            message: "case_id must be a valid integer when provided",
            data: null,
          });
        }
        const caseRow = await Case.findByPk(case_id);
        if (!caseRow) {
          return res.status(404).json({
            status: "error",
            message: "Case not found",
            data: null,
          });
        }
      }
    } else {
      return res.status(403).json({
        status: "error",
        message: "Access denied",
        data: null,
      });
    }

    const created = await Task.create({
      title: String(title).trim(),
      due_date,
      priority,
      status,
      case_id,
      assigned_to,
      created_by: userId,
    });

    const withUsers = await Task.findByPk(created.id, {
      include: [userInclude("assignee"), userInclude("creator")],
    });

    res.status(201).json({
      status: "success",
      message: "Task created successfully",
      data: { task: mapTask(withUsers) },
    });
  } catch (error) {
    console.error("Create Task Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

export const getTasks = async (req, res) => {
  try {
    const roleId = req.user?.role_id;
    const userId = req.user?.userId;
    const { case_id: caseIdQ, assigned_to: assignedToQ } = req.query;

    const where = {};

    if (roleId === ROLES.CASEWORKER) {
      where.assigned_to = userId;
    }

    if (caseIdQ !== undefined && caseIdQ !== null && String(caseIdQ).trim() !== "") {
      const cid = parseInt(caseIdQ, 10);
      if (Number.isNaN(cid)) {
        return res.status(400).json({
          status: "error",
          message: "case_id query must be a valid integer",
          data: null,
        });
      }
      where.case_id = cid;
    }

    if (assignedToQ !== undefined && assignedToQ !== null && String(assignedToQ).trim() !== "") {
      if (roleId === ROLES.CASEWORKER) {
        const aid = parseInt(assignedToQ, 10);
        if (Number.isNaN(aid) || aid !== userId) {
          return res.status(400).json({
            status: "error",
            message: "assigned_to filter must match your user for caseworker role",
            data: null,
          });
        }
      } else {
        const aid = parseInt(assignedToQ, 10);
        if (Number.isNaN(aid)) {
          return res.status(400).json({
            status: "error",
            message: "assigned_to query must be a valid integer",
            data: null,
          });
        }
        where.assigned_to = aid;
      }
    }

    const rows = await Task.findAll({
      where,
      include: [userInclude("assignee"), userInclude("creator")],
      order: [["due_date", "ASC"], ["id", "DESC"]],
    });

    res.status(200).json({
      status: "success",
      message: "Tasks retrieved successfully",
      data: { tasks: rows.map(mapTask) },
    });
  } catch (error) {
    console.error("Get Tasks Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

export const getTaskById = async (req, res) => {
  try {
    const { id } = req.params;
    const roleId = req.user?.role_id;
    const userId = req.user?.userId;

    const taskId = parseInt(id, 10);
    if (Number.isNaN(taskId)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid task id",
        data: null,
      });
    }

    const row = await Task.findByPk(taskId, {
      include: [userInclude("assignee"), userInclude("creator")],
    });

    if (!row) {
      return res.status(404).json({
        status: "error",
        message: "Task not found",
        data: null,
      });
    }

    if (roleId === ROLES.ADMIN) {
      return res.status(200).json({
        status: "success",
        message: "Task retrieved successfully",
        data: { task: mapTask(row) },
      });
    }

    if (roleId === ROLES.CASEWORKER) {
      if (row.assigned_to !== userId && row.created_by !== userId) {
        return res.status(403).json({
          status: "error",
          message: "Access denied",
          data: null,
        });
      }
      return res.status(200).json({
        status: "success",
        message: "Task retrieved successfully",
        data: { task: mapTask(row) },
      });
    }

    return res.status(403).json({
      status: "error",
      message: "Access denied",
      data: null,
    });
  } catch (error) {
    console.error("Get Task By ID Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

export const getTaskByCaseId = async (req, res) => {
  try {
    const { id } = req.params;
    const roleId = req.user?.role_id;
    const userId = req.user?.userId;

    const caseId = parseInt(id, 10);
    if (Number.isNaN(caseId)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid case id",
        data: null,
      });
    }

    const rows = await Task.findAll({
      where: { case_id: caseId },
      include: [userInclude("assignee"), userInclude("creator")],
    });

    if (roleId === ROLES.ADMIN) {
      return res.status(200).json({
        status: "success",
        message: "Tasks retrieved successfully",
        data: { tasks: rows.map(mapTask) },
      });
    }

    if (roleId === ROLES.CASEWORKER) {
      const filtered = rows.filter(
        (t) => t.assigned_to === userId || t.created_by === userId
      );
      return res.status(200).json({
        status: "success",
        message: "Tasks retrieved successfully",
        data: { tasks: filtered.map(mapTask) },
      });
    }

    return res.status(403).json({
      status: "error",
      message: "Access denied",
      data: null,
    });
  } catch (error) {
    console.error("Get Tasks by Case ID Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

export const updateTask = async (req, res) => {
  try {
    const { id } = req.params;
    const roleId = req.user?.role_id;
    const userId = req.user?.userId;

    const taskId = parseInt(id, 10);
    if (Number.isNaN(taskId)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid task id",
        data: null,
      });
    }

    const row = await Task.findByPk(taskId);
    if (!row) {
      return res.status(404).json({
        status: "error",
        message: "Task not found",
        data: null,
      });
    }

    const isAdmin = roleId === ROLES.ADMIN;
    const isAssignee = row.assigned_to === userId;

    if (!isAdmin && !isAssignee) {
      return res.status(403).json({
        status: "error",
        message: "Only the assignee or an admin can update this task",
        data: null,
      });
    }

    const updates = {};
    const {
      title,
      due_date,
      priority: priorityRaw,
      status: statusRaw,
      case_id: caseIdRaw,
      assigned_to: assignedToRaw,
    } = req.body;

    if (title !== undefined) {
      if (!title || String(title).trim() === "") {
        return res.status(400).json({
          status: "error",
          message: "title cannot be empty",
          data: null,
        });
      }
      updates.title = String(title).trim();
    }

    if (due_date !== undefined) {
      updates.due_date = due_date;
    }

    if (priorityRaw !== undefined) {
      const p = String(priorityRaw);
      if (!PRIORITIES.includes(p)) {
        return res.status(400).json({
          status: "error",
          message: `priority must be one of: ${PRIORITIES.join(", ")}`,
          data: null,
        });
      }
      updates.priority = p;
    }

    if (statusRaw !== undefined) {
      const s = String(statusRaw);
      if (!STATUSES.includes(s)) {
        return res.status(400).json({
          status: "error",
          message: `status must be one of: ${STATUSES.join(", ")}`,
          data: null,
        });
      }
      updates.status = s;
    }

    if (isAdmin) {
      if (caseIdRaw !== undefined) {
        if (caseIdRaw === null || caseIdRaw === "") {
          updates.case_id = null;
        } else {
          const cid = parseInt(caseIdRaw, 10);
          if (Number.isNaN(cid)) {
            return res.status(400).json({
              status: "error",
              message: "case_id must be a valid integer or null",
              data: null,
            });
          }
          const c = await Case.findByPk(cid);
          if (!c) {
            return res.status(404).json({
              status: "error",
              message: "Case not found",
              data: null,
            });
          }
          updates.case_id = cid;
        }
      }
      if (assignedToRaw !== undefined) {
        const aid = parseInt(assignedToRaw, 10);
        if (Number.isNaN(aid)) {
          return res.status(400).json({
            status: "error",
            message: "assigned_to must be a valid integer",
            data: null,
          });
        }
        const u = await User.findByPk(aid);
        if (!u) {
          return res.status(404).json({
            status: "error",
            message: "Assigned user not found",
            data: null,
          });
        }
        updates.assigned_to = aid;
      }
    }

    await row.update(updates);

    const refreshed = await Task.findByPk(row.id, {
      include: [userInclude("assignee"), userInclude("creator")],
    });

    res.status(200).json({
      status: "success",
      message: "Task updated successfully",
      data: { task: mapTask(refreshed) },
    });
  } catch (error) {
    console.error("Update Task Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

export const deleteTask = async (req, res) => {
  try {
    const { id } = req.params;
    const roleId = req.user?.role_id;
    const userId = req.user?.userId;

    const taskId = parseInt(id, 10);
    if (Number.isNaN(taskId)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid task id",
        data: null,
      });
    }

    const row = await Task.findByPk(taskId);
    if (!row) {
      return res.status(404).json({
        status: "error",
        message: "Task not found",
        data: null,
      });
    }

    const isAdmin = roleId === ROLES.ADMIN;
    const isCreator = row.created_by === userId;

    if (!isAdmin && !isCreator) {
      return res.status(403).json({
        status: "error",
        message: "Only an admin or the task creator can delete this task",
        data: null,
      });
    }

    await row.destroy();

    res.status(200).json({
      status: "success",
      message: "Task deleted successfully",
      data: null,
    });
  } catch (error) {
    console.error("Delete Task Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};
