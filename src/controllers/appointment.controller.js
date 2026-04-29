import db from "../models/index.js";
import { Op } from "sequelize";

const Appointment = db.Appointment;
const User = db.User;
const Case = db.Case;
const Notification = db.Notification;

import { sendAppointmentEmail } from "../services/email.service.js";
import { generateAppointmentTemplate } from "../utils/emailTemplate.js";
import { ROLES } from "../middlewares/role.middleware.js";

// Get appointments for the current user; admins see all appointments
export const getMyAppointments = async (req, res) => {
  try {
    const userId = req.user.userId;
    const isAdmin = req.user.role_name === 'admin';

    const where = isAdmin
      ? {}
      : {
          [Op.or]: [
            { candidate_id: userId },
            { caseworker_id: userId },
            // Check if userId is in the invited_staff JSON array using Postgres @> operator
            db.sequelize.literal(`invited_staff::jsonb @> '[${userId}]'`)
          ]
        };

    const appointments = await Appointment.findAll({
      where,
      include: [
        {
          model: User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: User,
          as: 'caseworker',
          attributes: ['id', 'first_name', 'last_name', 'email']
        },
        {
          model: Case,
          as: 'case',
          attributes: ['id', 'caseId']
        }
      ],
      order: [
        ['date', 'ASC'],
        ['time', 'ASC']
      ]
    });

    res.status(200).json({
      status: "success",
      message: "Appointments retrieved successfully",
      data: { appointments }
    });
  } catch (error) {
    console.error("Get Appointments Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Create a new appointment
export const createAppointment = async (req, res) => {
  try {
    const { title, description, date, time, platform, meeting_url, case_id, staff_ids } = req.body;
    const candidate_id = req.user.userId;

    // Primary caseworker is the first one in the list
    let caseworker_id = (staff_ids && staff_ids.length > 0) ? staff_ids[0] : null;
    
    if (!caseworker_id && case_id) {
      const caseData = await Case.findByPk(case_id);
      if (caseData && caseData.assignedcaseworkerId && caseData.assignedcaseworkerId.length > 0) {
        caseworker_id = caseData.assignedcaseworkerId[0];
      }
    }

    const appointment = await Appointment.create({
      title,
      description,
      date,
      time,
      platform,
      meeting_url,
      candidate_id,
      caseworker_id,
      invited_staff: staff_ids || [],
      case_id,
      status: 'scheduled'
    });

    // --- Notifications & Emails ---
    const candidate = await User.findByPk(candidate_id);
    const allStaffIds = staff_ids || (caseworker_id ? [caseworker_id] : []);

    if (allStaffIds.length > 0 && candidate) {
      for (const staffId of allStaffIds) {
        const staff = await User.findByPk(staffId);
        if (!staff) continue;

        // 1. Create System Notification for each Staff member
        await Notification.create({
          userId: staff.id,
          type: 'info',
          priority: 'medium',
          title: 'New Appointment Scheduled',
          message: `${candidate.first_name} ${candidate.last_name} has scheduled a meeting: ${title} on ${date} at ${time}.`,
          entityId: appointment.id,
          entityType: 'appointment',
          actionType: 'appointment_created'
        });

        // 2. Send Email to each Staff member
        try {
          await sendAppointmentEmail({
            to: staff.email,
            html: generateAppointmentTemplate({
              title,
              date,
              time,
              platform,
              meetingUrl: meeting_url,
              candidateName: `${candidate.first_name} ${candidate.last_name}`,
              staffName: `${staff.first_name} ${staff.last_name}`,
              isStaffRecipient: true
            })
          });
        } catch (err) {
          console.error(`Failed to send appointment email to staff ${staffId}:`, err);
        }
      }

      // 3. Send single Confirmation Email to Candidate
      try {
        // Use the first staff member's name for the "Meeting with..." label
        const primaryStaff = await User.findByPk(allStaffIds[0]);
        await sendAppointmentEmail({
          to: candidate.email,
          html: generateAppointmentTemplate({
            title,
            date,
            time,
            platform,
            meetingUrl: meeting_url,
            candidateName: `${candidate.first_name} ${candidate.last_name}`,
            staffName: primaryStaff ? `${primaryStaff.first_name} ${primaryStaff.last_name}${allStaffIds.length > 1 ? ` + ${allStaffIds.length - 1} others` : ''}` : 'EPiC Staff',
            isStaffRecipient: false
          })
        });
      } catch (err) {
        console.error("Failed to send appointment confirmation to candidate:", err);
      }
    }

    res.status(201).json({
      status: "success",
      message: "Appointment created successfully",
      data: { appointment }
    });
  } catch (error) {
    console.error("Create Appointment Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Get available staff (Caseworkers and Admins) for scheduling
export const getAvailableStaff = async (req, res) => {
  try {
    const staff = await User.findAll({
      where: {
        role_id: {
          [Op.in]: [ROLES.ADMIN, ROLES.CASEWORKER, ROLES.BUSINESS]
        },
        status: 'active'
      },
      attributes: ['id', 'first_name', 'last_name', 'email'],
      order: [['first_name', 'ASC']]
    });

    res.status(200).json({
      status: "success",
      message: "Staff retrieved successfully",
      data: { staff }
    });
  } catch (error) {
    console.error("Get Staff Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Update appointment status
export const updateAppointmentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const appointment = await Appointment.findByPk(id);
    if (!appointment) {
      return res.status(404).json({
        status: "error",
        message: "Appointment not found",
        data: null
      });
    }

    // Authorization check: only candidate or caseworker of this appointment can update it
    if (appointment.candidate_id !== req.user.userId && appointment.caseworker_id !== req.user.userId && req.user.role_name !== 'admin') {
      return res.status(403).json({
        status: "error",
        message: "Access denied",
        data: null
      });
    }

    appointment.status = status;
    await appointment.save();

    res.status(200).json({
      status: "success",
      message: "Appointment status updated successfully",
      data: { appointment }
    });
  } catch (error) {
    console.error("Update Appointment Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};

// Delete/Cancel appointment
export const deleteAppointment = async (req, res) => {
  try {
    const { id } = req.params;

    const appointment = await Appointment.findByPk(id);
    if (!appointment) {
      return res.status(404).json({
        status: "error",
        message: "Appointment not found",
        data: null
      });
    }

    // Authorization check
    if (appointment.candidate_id !== req.user.userId && appointment.caseworker_id !== req.user.userId && req.user.role_name !== 'admin') {
      return res.status(403).json({
        status: "error",
        message: "Access denied",
        data: null
      });
    }

    await appointment.destroy();

    res.status(200).json({
      status: "success",
      message: "Appointment cancelled successfully",
      data: null
    });
  } catch (error) {
    console.error("Delete Appointment Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message
    });
  }
};
