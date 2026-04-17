import db from "../../models/index.js";
import { ROLES } from "../../middlewares/role.middleware.js";

const CaseNote = db.CaseNote;
const Case = db.Case;
const User = db.User;

// Create a new case note
export const createCaseNote = async (req, res) => {
  try {
    const { caseId, content, parentNoteId } = req.body;
    const userId = req.user?.userId;
    const roleId = req.user?.role_id;

    if (!caseId || !content) {
      return res.status(400).json({
        status: "error",
        message: "caseId and content are required",
        data: null,
      });
    }

    // Validate case exists
    const caseExists = await Case.findByPk(caseId);
    if (!caseExists) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    // Validate parent note exists (if provided)
    if (parentNoteId) {
      const parentNote = await CaseNote.findByPk(parentNoteId);
      if (!parentNote) {
        return res.status(404).json({
          status: "error",
          message: "Parent note not found",
          data: null,
        });
      }
    }

    const newNote = await CaseNote.create({
      caseId,
      content,
      parentNoteId: parentNoteId || null,
      authorId: userId,
      updatedAt: new Date(),
    });

    res.status(201).json({
      status: "success",
      message: "Case note created successfully",
      data: { note: newNote },
    });

  } catch (error) {
    console.error("Create Case Note Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get all notes for a case
export const getCaseNotes = async (req, res) => {
  try {
    const { caseId, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;
    const userId = req.user?.userId;
    const roleId = req.user?.role_id;

    if (!caseId) {
      return res.status(400).json({
        status: "error",
        message: "caseId is required",
        data: null,
      });
    }

    // Validate case exists
    const caseExists = await Case.findByPk(caseId);
    if (!caseExists) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    const { count, rows: notes } = await CaseNote.findAndCountAll({
      where: { caseId },
      include: [
        {
          model: User,
          as: 'author',
          attributes: ['id', 'first_name', 'last_name'],
        },
        {
          model: CaseNote,
          as: 'parentNote',
          required: false,
          include: [
            {
              model: User,
              as: 'author',
              attributes: ['id', 'first_name', 'last_name'],
            }
          ]
        }
      ],
      order: [['created_at', 'ASC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    res.status(200).json({
      status: "success",
      message: "Case notes retrieved successfully",
      data: {
        notes: notes,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(count / limit),
        },
      },
    });

  } catch (error) {
    console.error("Get Case Notes Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Update a case note
export const updateCaseNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const userId = req.user?.userId;
    const roleId = req.user?.role_id;

    if (!content) {
      return res.status(400).json({
        status: "error",
        message: "Content is required",
        data: null,
      });
    }

    // Find the note
    const note = await CaseNote.findByPk(id);
    if (!note) {
      return res.status(404).json({
        status: "error",
        message: "Note not found",
        data: null,
      });
    }

    // Check permissions
    if (note.authorId !== userId && roleId !== ROLES.ADMIN) {
      return res.status(403).json({
        status: "error",
        message: "Access denied",
        data: null,
      });
    }

    await note.update({
      content,
      updatedAt: new Date(),
    });

    res.status(200).json({
      status: "success",
      message: "Case note updated successfully",
      data: { note },
    });

  } catch (error) {
    console.error("Update Case Note Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Delete a case note
export const deleteCaseNote = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;
    const roleId = req.user?.role_id;

    // Find the note
    const note = await CaseNote.findByPk(id);
    if (!note) {
      return res.status(404).json({
        status: "error",
        message: "Note not found",
        data: null,
      });
    }

    // Check permissions
    if (note.authorId !== userId && roleId !== ROLES.ADMIN) {
      return res.status(403).json({
        status: "error",
        message: "Access denied",
        data: null,
      });
    }

    await note.destroy();

    res.status(200).json({
      status: "success",
      message: "Case note deleted successfully",
      data: null,
    });

  } catch (error) {
    console.error("Delete Case Note Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Get case by note ID
export const getCaseNoteByNoteId = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find the note
    const note = await CaseNote.findByPk(id, {
      include: [
        {
          model: Case,
          as: 'case',
          attributes: ['id', 'status', 'created_at', 'updated_at']
        }
      ]
    });
    
    if (!note) {
      return res.status(404).json({
        status: "error",
        message: "Note not found",
        data: null,
      });
    }
    
    res.status(200).json({
      status: "success",
      message: "Note retrieved successfully",
      data: { 
        note: {
          id: note.id,
          caseId: note.caseId,
          noteType: note.noteType,
          title: note.title,
          content: note.content,
          visibility: note.visibility,
          isPinned: note.isPinned,
          isArchived: note.isArchived,
          reminderDate: note.reminderDate,
          parentNoteId: note.parentNoteId,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          case: note.case
        }
      },
    });
    
  } catch (error) {
    console.error("Get Case by Note ID Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};
