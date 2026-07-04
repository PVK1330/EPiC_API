import { broadcastPlatformAnnouncement } from '../../services/announcement.service.js';
import platformDb from '../../models/index.js';
import logger from '../../utils/logger.js';
import { rowsToXlsxBuffer, sendXlsxDownload } from '../../utils/excelExport.util.js';

export const createPlatformAnnouncement = async (req, res) => {
  try {
    const { target = 'all', orgIds = [], title, message, sendEmail = true } = req.body || {};

    if (!title?.trim() || !message?.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Title and message are required',
        data: null,
      });
    }

    const normalizedTarget = target === 'selected' ? 'selected' : 'all';

    if (normalizedTarget === 'selected') {
      const ids = Array.isArray(orgIds) ? orgIds : [];
      if (!ids.length) {
        return res.status(400).json({
          status: 'error',
          message: 'orgIds is required when target is selected',
          data: null,
        });
      }
    }

    const summary = await broadcastPlatformAnnouncement({
      target: normalizedTarget,
      orgIds,
      title: title.trim(),
      message: message.trim(),
      sendEmail: sendEmail !== false,
    });

    // Persist a first-class record so superadmins can review broadcast history.
    try {
      await platformDb.PlatformAnnouncement.create({
        title: title.trim(),
        message: message.trim(),
        target: normalizedTarget,
        org_ids: normalizedTarget === 'selected' ? (Array.isArray(orgIds) ? orgIds : []) : null,
        recipients: summary.recipients || 0,
        organisations_count: summary.organisations || 0,
        send_email: sendEmail !== false,
        created_by: req.user?.id ?? req.user?.userId ?? null,
        created_by_email: req.user?.email ?? null,
      });
    } catch (persistErr) {
      logger.warn({ err: persistErr }, 'Failed to persist platform announcement record');
    }

    return res.status(200).json({
      status: 'success',
      message: `Announcement sent to ${summary.recipients} organisation admin(s) across ${summary.organisations} organisation(s).`,
      data: { summary },
    });
  } catch (err) {
    logger.error({ err }, 'createPlatformAnnouncement error');
    return res.status(500).json({
      status: 'error',
      message: 'Failed to send announcement',
      data: null,
    });
  }
};

/**
 * List previous platform announcements (most recent first).
 */
export const listPlatformAnnouncements = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));

    const { count, rows } = await platformDb.PlatformAnnouncement.findAndCountAll({
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
    logger.error({ err }, 'listPlatformAnnouncements error');
    return res.status(500).json({ status: 'error', message: 'Failed to load announcements', data: null });
  }
};

/**
 * Edit a previous platform announcement and RE-BROADCAST it (fresh in-app
 * notifications + optional email to organisation admins).
 */
export const updatePlatformAnnouncement = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ status: 'error', message: 'A valid announcement id is required', data: null });
    }

    const record = await platformDb.PlatformAnnouncement.findByPk(id);
    if (!record) {
      return res.status(404).json({ status: 'error', message: 'Announcement not found', data: null });
    }

    const { target = 'all', orgIds = [], title, message, sendEmail = true } = req.body || {};
    if (!title?.trim() || !message?.trim()) {
      return res.status(400).json({ status: 'error', message: 'Title and message are required', data: null });
    }

    const normalizedTarget = target === 'selected' ? 'selected' : 'all';
    if (normalizedTarget === 'selected') {
      const ids = Array.isArray(orgIds) ? orgIds : [];
      if (!ids.length) {
        return res.status(400).json({ status: 'error', message: 'orgIds is required when target is selected', data: null });
      }
    }

    const summary = await broadcastPlatformAnnouncement({
      target: normalizedTarget,
      orgIds,
      title: title.trim(),
      message: message.trim(),
      sendEmail: sendEmail !== false,
    });

    await record.update({
      title: title.trim(),
      message: message.trim(),
      target: normalizedTarget,
      org_ids: normalizedTarget === 'selected' ? (Array.isArray(orgIds) ? orgIds : []) : null,
      recipients: summary.recipients || 0,
      organisations_count: summary.organisations || 0,
      send_email: sendEmail !== false,
    });

    return res.status(200).json({
      status: 'success',
      message: `Announcement updated and re-sent to ${summary.recipients} organisation admin(s) across ${summary.organisations} organisation(s).`,
      data: { summary },
    });
  } catch (err) {
    logger.error({ err }, 'updatePlatformAnnouncement error');
    return res.status(500).json({ status: 'error', message: err.message || 'Failed to update announcement', data: null });
  }
};

/**
 * Export all previous platform announcements as an Excel file.
 */
export const exportPlatformAnnouncements = async (req, res) => {
  try {
    const announcements = await platformDb.PlatformAnnouncement.findAll({
      order: [['createdAt', 'DESC']],
    });

    const columns = [
      { key: 'date', header: 'Date' },
      { key: 'title', header: 'Title' },
      { key: 'message', header: 'Message' },
      { key: 'audience', header: 'Audience' },
      { key: 'organisations', header: 'Organisations' },
      { key: 'recipients', header: 'Recipients' },
      { key: 'email', header: 'Email Sent' },
      { key: 'sentBy', header: 'Sent By' },
    ];

    const rows = announcements.map((a) => ({
      date: a.createdAt ? new Date(a.createdAt).toLocaleString() : '',
      title: a.title || '',
      message: a.message || '',
      audience: a.target === 'selected'
        ? `${(a.org_ids || []).length} selected`
        : 'All organisations',
      organisations: a.organisations_count ?? 0,
      recipients: a.recipients ?? 0,
      email: a.send_email ? 'Yes' : 'No',
      sentBy: a.created_by_email || '',
    }));

    const buffer = rowsToXlsxBuffer(rows, columns);
    sendXlsxDownload(res, buffer, `Platform_Announcements_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (err) {
    logger.error({ err }, 'exportPlatformAnnouncements error');
    return res.status(500).json({ status: 'error', message: 'Failed to export announcements', data: null });
  }
};

/**
 * Delete a platform announcement history record.
 */
export const deletePlatformAnnouncement = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ status: 'error', message: 'A valid announcement id is required', data: null });
    }

    const deleted = await platformDb.PlatformAnnouncement.destroy({ where: { id } });
    if (!deleted) {
      return res.status(404).json({ status: 'error', message: 'Announcement not found', data: null });
    }

    return res.status(200).json({ status: 'success', message: 'Announcement deleted', data: null });
  } catch (err) {
    logger.error({ err }, 'deletePlatformAnnouncement error');
    return res.status(500).json({ status: 'error', message: 'Failed to delete announcement', data: null });
  }
};
