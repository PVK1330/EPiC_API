import { ROLES } from '../../../middlewares/role.middleware.js';
import { notifyTaskAssigned } from '../../../services/notification.service.js';

// Constants
const PRIORITIES = ["low", "medium", "high"];
const STATUSES = ["pending", "in-progress", "completed"];
const FILTER_OPTIONS = ["all", "due_soon", "today_due", "overdue", "completed"];


function fullName(user) {
  if (!user) return null;
  const first = user.first_name || "";
  const last = user.last_name || "";
  const s = `${first} ${last}`.trim();
  return s || null;
}

function userInclude(req, as) {
  return {
    model: req.tenantDb.User,
    as,
    attributes: ["id", "first_name", "last_name", "email"],
    required: false,
  };
}

function caseInclude(req) {
  return {
    model: req.tenantDb.Case,
    as: "case",
    attributes: ["id", "caseId", "candidateId", "sponsorId"],
    include: [
      {
        model: req.tenantDb.User,
        as: "candidate",
        attributes: ["id", "first_name", "last_name"],
      },
    ],
    required: false,
  };
}

function mapTask(task) {
  const plain = task.get ? task.get({ plain: true }) : { ...task };
  const assignee = plain.assignee;
  const creator = plain.creator;
  const caseData = plain.case;
  delete plain.assignee;
  delete plain.creator;
  delete plain.case;
  
  return {
    ...plain,
    assigned_to_name: fullName(assignee),
    assigned_by_name: fullName(creator),
    case_number: caseData?.caseId || null,
    candidate_name: caseData?.candidate ? fullName(caseData.candidate) : null,
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

      const caseRow = await req.tenantDb.Case.findByPk(case_id);
      if (!caseRow) {
        return res.status(404).json({
          status: "error",
          message: "Case not found",
          data: null,
        });
      }

      const assigneeUser = await req.tenantDb.User.findByPk(assigned_to);
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
        const caseRow = await req.tenantDb.Case.findByPk(case_id);
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

    const organisationId = req.user?.organisation_id != null ? Number(req.user.organisation_id) : null;

    const created = await req.tenantDb.Task.create({
      title: String(title).trim(),
      due_date,
      priority,
      status,
      case_id,
      assigned_to,
      created_by: userId,
    });

    const withUsers = await req.tenantDb.Task.findByPk(created.id, {
      include: [userInclude(req, "assignee"), userInclude(req, "creator"), caseInclude(req)],
    });

    // Notify assigned user if assigned to someone else
    if (assigned_to !== userId) {
      try {
        const plain = created.get({ plain: true });
        const caseLabel = withUsers?.case?.caseId || null;
        await notifyTaskAssigned(req.tenantDb, assigned_to, {
          ...plain,
          organisationId,
          metadata: { caseId: caseLabel },
        });
      } catch (notifErr) {
        console.error("Failed to notify user about assigned task:", notifErr);
      }
    }

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

    const rows = await req.tenantDb.Task.findAll({
      where,
      include: [userInclude(req, "assignee"), userInclude(req, "creator")],
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

    const row = await req.tenantDb.Task.findByPk(taskId, {
      include: [userInclude(req, "assignee"), userInclude(req, "creator")],
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

    // Handle both numeric id and string caseId
    let numericCaseId;

    // If id is a number (or numeric string), use it directly
    if (!isNaN(parseInt(id))) {
      numericCaseId = parseInt(id);
    } else {
      // Otherwise, find case by string caseId to get numeric id
      const caseRecord = await req.tenantDb.Case.findOne({ where: { caseId: id } });
      if (!caseRecord) {
        return res.status(404).json({
          status: "error",
          message: "Case not found",
          data: null,
        });
      }
      numericCaseId = caseRecord.id;
    }

    const rows = await req.tenantDb.Task.findAll({
      where: { case_id: numericCaseId },
      include: [userInclude(req, "assignee"), userInclude(req, "creator")],
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

    const row = await req.tenantDb.Task.findByPk(taskId);
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

      if (s === "completed" && row.case_id) {
        const title = row.title || "";
        if (/UK visa portal/i.test(title)) {
          try {
            const caseRecord = await req.tenantDb.Case.findByPk(row.case_id);
            if (caseRecord) {
              const { applyCaseStageChange } = await import("../../../services/caseStageAutomation.service.js");
              await applyCaseStageChange({
                tenantDb: req.tenantDb,
                caseRecord,
                nextStageId: "application_submitted",
                performedBy: userId,
                organisationId: req.user?.organisation_id != null ? Number(req.user.organisation_id) : null,
                reason: "Caseworker marked UK Visa Portal task as complete",
              });
            }
          } catch (stageErr) {
            console.error("Failed to automatically transition case stage on UK Visa Portal task completion:", stageErr);
          }
        }
      }
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
          const c = await req.tenantDb.Case.findByPk(cid);
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
        const u = await req.tenantDb.User.findByPk(aid);
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

    const refreshed = await req.tenantDb.Task.findByPk(row.id, {
      include: [userInclude(req, "assignee"), userInclude(req, "creator")],
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

    const row = await req.tenantDb.Task.findByPk(taskId);
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


export const getTasksByUserId = async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "User not authenticated",
        data: null,
      });
    }

    const { search, filter = "all", page = 1, limit = 20 } = req.query;

    // Validate filter
    if (!FILTER_OPTIONS.includes(filter)) {
      return res.status(400).json({
        status: "error",
        message: `filter must be one of: ${FILTER_OPTIONS.join(", ")}`,
        data: null,
      });
    }

    const where = { assigned_to: userId };

    // Search filter
    if (search && search.trim() !== "") {
      where.title = {
        [req.tenantDb.Sequelize.Op.iLike]: `%${search.trim()}%`,
      };
    }

    // Date/status based filters
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (filter === "overdue") {
      // Past due date, not completed
      where.due_date = { [req.tenantDb.Sequelize.Op.lt]: today };
      where.status = { [req.tenantDb.Sequelize.Op.ne]: "completed" };

    } else if (filter === "due_soon") {
      const in48h = new Date();
      in48h.setHours(in48h.getHours() + 48);
      where.due_date = {
        [req.tenantDb.Sequelize.Op.gte]: today,
        [req.tenantDb.Sequelize.Op.lte]: in48h,
      };
      where.status = { [req.tenantDb.Sequelize.Op.ne]: "completed" };

    } else if (filter === "today_due") {
      // Due today, not completed
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      where.due_date = {
        [req.tenantDb.Sequelize.Op.gte]: today,
        [req.tenantDb.Sequelize.Op.lt]: tomorrow,
      };
      where.status = { [req.tenantDb.Sequelize.Op.ne]: "completed" };

    } else if (filter === "completed") {
      // Status-based only
      where.status = "completed";

    }
    // filter === "all" → no extra where conditions

    // Pagination validation
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (Number.isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({
        status: "error",
        message: "page must be a positive integer",
        data: null,
      });
    }

    if (Number.isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        status: "error",
        message: "limit must be a positive integer between 1 and 100",
        data: null,
      });
    }

    const offset = (pageNum - 1) * limitNum;

    const { count, rows } = await req.tenantDb.Task.findAndCountAll({
      where,
      include: [userInclude(req, "assignee"), userInclude(req, "creator"), caseInclude(req)],
      order: [["due_date", "ASC"], ["id", "DESC"]],
      limit: limitNum,
      offset,
    });

    const totalPages = Math.ceil(count / limitNum);

    res.status(200).json({
      status: "success",
      message: "Tasks retrieved successfully",
      data: {
        tasks: rows.map(mapTask),
        pagination: {
          total: count,
          page: pageNum,
          limit: limitNum,
          totalPages,
        },
        applied_filter: filter,
      },
    });
  } catch (error) {
    console.error("Get Tasks by User ID Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};
