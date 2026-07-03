import logger from '../../../utils/logger.js';
import { rowsToXlsxBuffer, sendXlsxDownload } from '../../../utils/excelExport.util.js';
import {
  sendAnnouncement,
  resolveUserIdsByTargetRoles,
} from '../../../services/announcement.service.js';

const ALLOWED_TARGET_ROLES = new Set(['caseworker', 'sponsor', 'candidate', 'business']);

export const createTenantAnnouncement = async (req, res) => {
  try {
    const organisationId = req.user?.organisation_id;
    if (!organisationId || !req.tenantDb) {
      return res.status(403).json({
        status: 'error',
        message: 'Organisation context required',
        data: null,
      });
    }

    const { targetRoles = [], title, message, sendEmail = true } = req.body || {};

    if (!title?.trim() || !message?.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Title and message are required',
        data: null,
      });
    }

    const roles = (Array.isArray(targetRoles) ? targetRoles : [])
      .map((r) => String(r).trim().toLowerCase())
      .filter((r) => ALLOWED_TARGET_ROLES.has(r));

    if (!roles.length) {
      return res.status(400).json({
        status: 'error',
        message: 'Select at least one audience: caseworker, sponsor, or candidate',
        data: null,
      });
    }

    const userIds = await resolveUserIdsByTargetRoles(
      req.tenantDb,
      roles,
      organisationId,
    );

    const uniqueIds = [...new Set(userIds)];

    if (!uniqueIds.length) {
      return res.status(404).json({
        status: 'error',
        message: 'No active users found for the selected audiences',
        data: null,
      });
    }

    const senderId = req.user?.userId ?? req.user?.id;
    const result = await sendAnnouncement(req.tenantDb, uniqueIds, title, message, {
      sendEmail: sendEmail !== false,
      organisationId,
      metadata: {
        source: 'org_admin',
        targetRoles: roles,
        sentByUserId: senderId,
      },
    });

    // Persist a first-class announcement record so admins can review history.
    try {
      await req.tenantDb.Announcement.create({
        title: title.trim(),
        message: message.trim(),
        target_roles: roles,
        recipients: result.notified,
        send_email: sendEmail !== false,
        created_by: senderId ?? null,
        created_by_name:
          [req.user?.first_name, req.user?.last_name].filter(Boolean).join(' ') || null,
      });
    } catch (persistErr) {
      logger.warn({ err: persistErr }, 'Failed to persist tenant announcement record');
    }

    return res.status(200).json({
      status: 'success',
      message: `Announcement sent to ${result.notified} user(s).`,
      data: {
        notified: result.notified,
        targetRoles: roles,
      },
    });
  } catch (err) {
    logger.error({ err }, 'createTenantAnnouncement error');
    return res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to send announcement',
      data: null,
    });
  }
};

/**
 * List previous announcements sent by this organisation (most recent first).
 */
export const listTenantAnnouncements = async (req, res) => {
  try {
    if (!req.tenantDb) {
      return res.status(403).json({ status: 'error', message: 'Organisation context required', data: null });
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));

    const { count, rows } = await req.tenantDb.Announcement.findAndCountAll({
      order: [['createdAt', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    });

    return res.status(200).json({
      status: 'success',
      message: 'Announcements retrieved successfully',
      data: {
        announcements: rows,
        total: count,
        page,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    logger.error({ err }, 'listTenantAnnouncements error');
    return res.status(500).json({ status: 'error', message: 'Failed to load announcements', data: null });
  }
};

/**
 * Edit a previous announcement and RE-SEND it (fresh in-app notifications +
 * optional email) to the (possibly changed) audience.
 */
export const updateTenantAnnouncement = async (req, res) => {
  try {
    const organisationId = req.user?.organisation_id;
    if (!organisationId || !req.tenantDb) {
      return res.status(403).json({ status: 'error', message: 'Organisation context required', data: null });
    }

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ status: 'error', message: 'A valid announcement id is required', data: null });
    }

    const announcement = await req.tenantDb.Announcement.findByPk(id);
    if (!announcement) {
      return res.status(404).json({ status: 'error', message: 'Announcement not found', data: null });
    }

    const { targetRoles = [], title, message, sendEmail = true } = req.body || {};
    if (!title?.trim() || !message?.trim()) {
      return res.status(400).json({ status: 'error', message: 'Title and message are required', data: null });
    }

    const roles = (Array.isArray(targetRoles) ? targetRoles : [])
      .map((r) => String(r).trim().toLowerCase())
      .filter((r) => ALLOWED_TARGET_ROLES.has(r));

    if (!roles.length) {
      return res.status(400).json({
        status: 'error',
        message: 'Select at least one audience: caseworker, sponsor, or candidate',
        data: null,
      });
    }

    const userIds = await resolveUserIdsByTargetRoles(req.tenantDb, roles, organisationId);
    const uniqueIds = [...new Set(userIds)];
    if (!uniqueIds.length) {
      return res.status(404).json({ status: 'error', message: 'No active users found for the selected audiences', data: null });
    }

    const senderId = req.user?.userId ?? req.user?.id;
    // Re-broadcast the (edited) announcement.
    const result = await sendAnnouncement(req.tenantDb, uniqueIds, title, message, {
      sendEmail: sendEmail !== false,
      organisationId,
      metadata: {
        source: 'org_admin',
        targetRoles: roles,
        sentByUserId: senderId,
        editedAnnouncementId: id,
      },
    });

    await announcement.update({
      title: title.trim(),
      message: message.trim(),
      target_roles: roles,
      recipients: result.notified,
      send_email: sendEmail !== false,
    });

    return res.status(200).json({
      status: 'success',
      message: `Announcement updated and re-sent to ${result.notified} user(s).`,
      data: { notified: result.notified, targetRoles: roles, announcement },
    });
  } catch (err) {
    logger.error({ err }, 'updateTenantAnnouncement error');
    return res.status(500).json({ status: 'error', message: err.message || 'Failed to update announcement', data: null });
  }
};

/**
 * Export all previous announcements for this organisation as an Excel file.
 */
export const exportTenantAnnouncements = async (req, res) => {
  try {
    if (!req.tenantDb) {
      return res.status(403).json({ status: 'error', message: 'Organisation context required', data: null });
    }

    const announcements = await req.tenantDb.Announcement.findAll({
      order: [['createdAt', 'DESC']],
    });

    const columns = [
      { key: 'date', header: 'Date' },
      { key: 'title', header: 'Title' },
      { key: 'message', header: 'Message' },
      { key: 'audience', header: 'Audience' },
      { key: 'recipients', header: 'Recipients' },
      { key: 'email', header: 'Email Sent' },
      { key: 'sentBy', header: 'Sent By' },
    ];

    const rows = announcements.map((a) => ({
      date: a.createdAt ? new Date(a.createdAt).toLocaleString() : '',
      title: a.title || '',
      message: a.message || '',
      audience: Array.isArray(a.target_roles) ? a.target_roles.join(', ') : '',
      recipients: a.recipients ?? 0,
      email: a.send_email ? 'Yes' : 'No',
      sentBy: a.created_by_name || '',
    }));

    const buffer = rowsToXlsxBuffer(rows, columns);
    sendXlsxDownload(res, buffer, `Announcements_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (err) {
    logger.error({ err }, 'exportTenantAnnouncements error');
    return res.status(500).json({ status: 'error', message: 'Failed to export announcements', data: null });
  }
};

/**
 * Delete an announcement history record.
 */
export const deleteTenantAnnouncement = async (req, res) => {
  try {
    if (!req.tenantDb) {
      return res.status(403).json({ status: 'error', message: 'Organisation context required', data: null });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ status: 'error', message: 'A valid announcement id is required', data: null });
    }

    const deleted = await req.tenantDb.Announcement.destroy({ where: { id } });
    if (!deleted) {
      return res.status(404).json({ status: 'error', message: 'Announcement not found', data: null });
    }

    return res.status(200).json({ status: 'success', message: 'Announcement deleted', data: null });
  } catch (err) {
    logger.error({ err }, 'deleteTenantAnnouncement error');
    return res.status(500).json({ status: 'error', message: 'Failed to delete announcement', data: null });
  }
};
