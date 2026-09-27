import { ROLES } from '../../../middlewares/role.middleware.js';
import logger from '../../../utils/logger.js';
import { sanitizePlainText } from '../../../utils/sanitizeText.js';
import { recordTimelineEntry } from '../../../services/caseTimeline.service.js';

// Create a new case note (supports multi-caseworker attendance notes)
export const createCaseNote = async (req, res) => {
  try {
    const { caseId, parentNoteId, noteType, title } = req.body;
    // SECURITY (stored XSS): case notes are plain text — strip any HTML markup.
    const content = sanitizePlainText(req.body?.content, { maxLength: 10000 });
    const userId = req.user?.userId;
    const roleId = Number(req.user?.role_id);

    if (!caseId || !content) {
      return res.status(400).json({
        status: "error",
        message: "caseId and content are required",
        data: null,
      });
    }

    // Handle both numeric id and string caseId
    let caseRecord;
    let numericCaseId;

    // If caseId is a number (or numeric string), try findByPk first
    if (!isNaN(parseInt(caseId))) {
      caseRecord = await req.tenantDb.Case.findByPk(parseInt(caseId));
      if (caseRecord) {
        numericCaseId = caseRecord.id;
      }
    }

    // If not found by numeric id, try by string caseId
    if (!caseRecord) {
      caseRecord = await req.tenantDb.Case.findOne({ where: { caseId } });
      if (caseRecord) {
        numericCaseId = caseRecord.id;
      }
    }

    if (!caseRecord) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    // BUG-027 / Business Decision Confirmed:
    // Only Admin and assigned Caseworkers may add a Case Note.
    // Everyone else (unassigned caseworkers, candidates/clients, sponsors, other roles) is denied.
    const isAdmin = roleId === ROLES.ADMIN || roleId === ROLES.SUPERADMIN;
    if (!isAdmin) {
      const rawAssigned = caseRecord.assignedcaseworkerId;
      const assignedIds = (
        Array.isArray(rawAssigned)
          ? rawAssigned
          : (rawAssigned != null ? [rawAssigned] : [])
      )
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0);

      const isCaseworkerAssigned =
        roleId === ROLES.CASEWORKER && assignedIds.includes(Number(userId));

      if (!isCaseworkerAssigned) {
        return res.status(403).json({
          status: "error",
          message: "You are not authorized to add notes to this case.",
          data: null,
        });
      }
    }

    // Phase 5: Participant Validation for Attendance Notes
    const rawParticipantIds = req.body?.participantIds ?? req.body?.attendedWith;
    let participantCaseworkerIds = [];

    if (rawParticipantIds !== undefined && rawParticipantIds !== null) {
      if (!Array.isArray(rawParticipantIds)) {
        return res.status(400).json({
          status: "error",
          message: "Participant IDs must be an array of caseworker IDs.",
          data: null,
        });
      }

      // De-duplicate participant IDs
      const uniqueIds = Array.from(
        new Set(
          rawParticipantIds
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0)
        )
      );

      if (uniqueIds.length > 0) {
        // Query users table for all submitted participant IDs in tenant DB
        const foundUsers = await req.tenantDb.User.findAll({
          where: { id: uniqueIds },
          attributes: ['id', 'first_name', 'last_name', 'email', 'role_id', 'organisation_id'],
        });

        // Check if all requested IDs exist in database
        if (foundUsers.length !== uniqueIds.length) {
          return res.status(400).json({
            status: "error",
            message: "Invalid caseworker participant ID: one or more attendance participants do not exist.",
            data: null,
          });
        }

        // Check that EVERY participant is a Caseworker (not Candidate, Sponsor, etc.)
        const nonCaseworker = foundUsers.find((u) => Number(u.role_id) !== ROLES.CASEWORKER);
        if (nonCaseworker) {
          return res.status(400).json({
            status: "error",
            message: `Participant ID ${nonCaseworker.id} is not a caseworker. Only caseworkers can be tagged as attendance participants.`,
            data: null,
          });
        }

        // Cross-organisation validation: caseworkers must belong to the same organisation as the case
        const caseOrgId = caseRecord.organisation_id || req.user?.organisation_id;
        if (caseOrgId) {
          const crossOrgCaseworker = foundUsers.find(
            (u) => u.organisation_id && Number(u.organisation_id) !== Number(caseOrgId)
          );
          if (crossOrgCaseworker) {
            return res.status(403).json({
              status: "error",
              message: `Caseworker ID ${crossOrgCaseworker.id} does not belong to the same organisation as this case. Cross-organisation participants are not allowed.`,
              data: null,
            });
          }
        }

        participantCaseworkerIds = uniqueIds;
      }
    }

    // Validate parent note exists (if provided)
    if (parentNoteId) {
      const parentNote = await req.tenantDb.CaseNote.findByPk(parentNoteId);
      if (!parentNote) {
        return res.status(404).json({
          status: "error",
          message: "Parent note not found",
          data: null,
        });
      }
    }

    const resolvedNoteType = noteType || (participantCaseworkerIds.length > 0 ? "attendance" : "internal");
    const noteTitle = title ? sanitizePlainText(title, { maxLength: 255 }) : null;

    const newNote = await req.tenantDb.CaseNote.create({
      caseId: numericCaseId,
      content,
      title: noteTitle,
      noteType: resolvedNoteType,
      parentNoteId: parentNoteId || null,
      authorId: userId,
      updatedAt: new Date(),
    });

    // Persist participants if CaseNoteParticipant model exists and IDs are provided
    if (participantCaseworkerIds.length > 0 && req.tenantDb.CaseNoteParticipant) {
      const participantRows = participantCaseworkerIds.map((cwId) => ({
        caseNoteId: newNote.id,
        case_note_id: newNote.id,
        caseworkerId: cwId,
        caseworker_id: cwId,
      }));
      await req.tenantDb.CaseNoteParticipant.bulkCreate(participantRows);
    }

    // Phase 5: Timeline / Activity logging for Attendance Notes
    if (resolvedNoteType === "attendance") {
      try {
        await recordTimelineEntry({
          tenantDb: req.tenantDb,
          caseId: numericCaseId,
          actionType: "attendance_note_created",
          description: `Attendance note recorded (${noteTitle || "Client consultation"})`,
          performedBy: userId,
          metadata: {
            noteId: newNote.id,
            noteType: "attendance",
            participantIds: participantCaseworkerIds,
          },
          visibility: "team",
        });
      } catch (timelineErr) {
        logger.error({ err: timelineErr }, "Failed to record attendance note timeline entry");
      }
    }

    // Fetch newly created note with author and participants for complete response
    let noteToReturn = newNote;
    if (req.tenantDb.CaseNoteParticipant) {
      const reloadedNote = await req.tenantDb.CaseNote.findByPk(newNote.id, {
        include: [
          {
            model: req.tenantDb.User,
            as: "author",
            attributes: ["id", "first_name", "last_name"],
          },
          {
            model: req.tenantDb.CaseNoteParticipant,
            as: "participants",
            include: [
              {
                model: req.tenantDb.User,
                as: "caseworker",
                attributes: ["id", "first_name", "last_name", "email"],
              },
            ],
          },
        ],
      });
      if (reloadedNote) noteToReturn = reloadedNote;
    }

    res.status(201).json({
      status: "success",
      message: "Case note created successfully",
      data: { note: noteToReturn },
    });

  } catch (error) {
    logger.error({ err: error }, "Create Case Note Error");
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Get all notes for a case
export const getCaseNotes = async (req, res) => {
  try {
    const caseId = req.query?.caseId || req.params?.caseId;
    const { page = 1, limit = 10 } = req.query || {};
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

    // Handle both numeric id and string caseId
    let caseRecord;
    let numericCaseId;

    // If caseId is a number (or numeric string), try findByPk first
    if (!isNaN(parseInt(caseId))) {
      caseRecord = await req.tenantDb.Case.findByPk(parseInt(caseId));
      if (caseRecord) {
        numericCaseId = caseRecord.id;
      }
    }

    // If not found by numeric id, try by string caseId
    if (!caseRecord) {
      caseRecord = await req.tenantDb.Case.findOne({ where: { caseId } });
      if (caseRecord) {
        numericCaseId = caseRecord.id;
      }
    }

    if (!caseRecord) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    const { count, rows: notes } = await req.tenantDb.CaseNote.findAndCountAll({
      where: { caseId: numericCaseId },
      include: [
        {
          model: req.tenantDb.User,
          as: 'author',
          attributes: ['id', 'first_name', 'last_name'],
        },
        ...(req.tenantDb.CaseNoteParticipant
          ? [
              {
                model: req.tenantDb.CaseNoteParticipant,
                as: 'participants',
                required: false,
                include: [
                  {
                    model: req.tenantDb.User,
                    as: 'caseworker',
                    attributes: ['id', 'first_name', 'last_name', 'email'],
                  },
                ],
              },
            ]
          : []),
        {
          model: req.tenantDb.CaseNote,
          as: 'parentNote',
          required: false,
          include: [
            {
              model: req.tenantDb.User,
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
    logger.error({ err: error }, "Get Case Notes Error");
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Update a case note
export const updateCaseNote = async (req, res) => {
  try {
    const { id } = req.params;
    const content = sanitizePlainText(req.body?.content, { maxLength: 10000 });
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
    const note = await req.tenantDb.CaseNote.findByPk(id);
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
    logger.error({ err: error }, "Update Case Note Error");
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
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
    const note = await req.tenantDb.CaseNote.findByPk(id);
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
    logger.error({ err: error }, "Delete Case Note Error");
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Get case by note ID
export const getCaseNoteByNoteId = async (req, res) => {
  try {
    const id = req.params?.id || req.params?.noteId;
    const roleId = Number(req.user?.role_id);
    const userId = req.user?.userId;

    // Find the note with its parent case for ownership verification
    const note = await req.tenantDb.CaseNote.findByPk(id, {
      include: [
        {
          model: req.tenantDb.Case,
          as: 'case',
          attributes: ['id', 'status', 'created_at', 'updated_at', 'assignedcaseworkerId', 'candidateId', 'sponsorId']
        },
        ...(req.tenantDb.CaseNoteParticipant
          ? [
              {
                model: req.tenantDb.CaseNoteParticipant,
                as: 'participants',
                required: false,
                include: [
                  {
                    model: req.tenantDb.User,
                    as: 'caseworker',
                    attributes: ['id', 'first_name', 'last_name', 'email'],
                  },
                ],
              },
            ]
          : []),
      ]
    });

    if (!note) {
      return res.status(404).json({
        status: "error",
        message: "Note not found",
        data: null,
      });
    }

    // S-07 fix: IDOR guard — verify the requester has access to the note's parent case.
    // Admins (3) and Superadmins (5) may access any note.
    // Caseworkers may only access notes on cases assigned to them.
    // Candidates/Sponsors may only access notes on their own cases.
    if (roleId !== ROLES.ADMIN && roleId !== 5) {
      const parentCase = note.case;
      if (!parentCase) {
        return res.status(403).json({ status: 'error', message: 'Access denied' });
      }
      const assignedIds = parentCase.assignedcaseworkerId ?? [];
      const isCaseworkerAssigned = roleId === ROLES.CASEWORKER && assignedIds.includes(userId);
      const isCandidate = parentCase.candidateId && Number(parentCase.candidateId) === Number(userId);
      const isSponsor = parentCase.sponsorId && Number(parentCase.sponsorId) === Number(userId);
      if (!isCaseworkerAssigned && !isCandidate && !isSponsor) {
        return res.status(403).json({ status: 'error', message: 'Access denied' });
      }
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
          case: note.case,
          participants: note.participants || [],
          attendees: (note.participants || [])
            .map((p) => p.caseworker ? `${p.caseworker.first_name} ${p.caseworker.last_name}`.trim() : null)
            .filter(Boolean),
        }
      },
    });
    
  } catch (error) {
    logger.error({ err: error }, "Get Case by Note ID Error");
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};
