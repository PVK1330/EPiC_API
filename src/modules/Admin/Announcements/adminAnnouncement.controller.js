import { Op } from 'sequelize';
import logger from '../../../utils/logger.js';
import {
  sendAnnouncement,
  resolveUserIdsByTargetRoles,
} from '../../../services/announcement.service.js';
import { rowsToXlsxBuffer, sendXlsxDownload } from '../../../utils/excelExport.util.js';

const ALLOWED_TARGET_ROLES = new Set(['caseworker', 'sponsor', 'candidate', 'business']);

const ROLE_EXPORT_LABEL = {
  caseworker: 'Caseworkers',
  sponsor: 'Sponsors',
  business: 'Sponsors',
  candidate: 'Candidates',
};

// History rows are org-scoped; legacy NULL-org rows stay visible (same policy
// as applyOrganisationScope, hand-rolled here because the Announcement model
// uses the camelCase `organisationId` attribute).
const announcementWhere = (organisationId) =>
  organisationId == null
    ? {}
    : { [Op.or]: [{ organisationId }, { organisationId: null }] };

// The page reads snake_case keys (target_roles, send_email, created_by_name)
// plus camelCase createdAt — serialize explicitly rather than leaking the
// model's attribute names.
const shapeAnnouncement = (a) => ({
  id: a.id,
  title: a.title,
  message: a.message,
  target_roles: Array.isArray(a.targetRoles) ? a.targetRoles : [],
  send_email: a.sendEmail !== false,
  recipients: a.recipients ?? 0,
  created_by_name: a.createdByName || null,
  // `createdAt: 'created_at'` in the model options renames the ATTRIBUTE, so
  // instances expose created_at — normalise to the camelCase the page reads.
  createdAt: a.createdAt ?? a.created_at ?? null,
  updatedAt: a.updatedAt ?? a.updated_at ?? null,
});

const normaliseRoles = (targetRoles) =>
  (Array.isArray(targetRoles) ? targetRoles : [])
    .map((r) => String(r).trim().toLowerCase())
    .filter((r) => ALLOWED_TARGET_ROLES.has(r));

const resolveSenderName = async (tenantDb, senderId) => {
  if (!senderId) return null;
  const sender = await tenantDb.User.findByPk(senderId, {
    attributes: ['first_name', 'last_name', 'email'],
  }).catch(() => null);
  if (!sender) return null;
  const name = [sender.first_name, sender.last_name].filter(Boolean).join(' ').trim();
  return name || sender.email || null;
};

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

    const roles = normaliseRoles(targetRoles);

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

    // Persist to history (best-effort: the announcement is already delivered,
    // so a history failure must not turn the response into an error).
    let announcement = null;
    try {
      announcement = await req.tenantDb.Announcement.create({
        title: title.trim(),
        message: message.trim(),
        targetRoles: roles,
        sendEmail: sendEmail !== false,
        recipients: result.notified,
        createdBy: senderId ?? null,
        createdByName: await resolveSenderName(req.tenantDb, senderId),
        organisationId,
      });
    } catch (histErr) {
      logger.error({ err: histErr }, 'Announcement history save failed (announcement WAS sent)');
    }

    return res.status(200).json({
      status: 'success',
      message: `Announcement sent to ${result.notified} user(s).`,
      data: {
        notified: result.notified,
        targetRoles: roles,
        announcement: announcement ? shapeAnnouncement(announcement) : null,
      },
    });
  } catch (err) {
    logger.error({ err }, 'createTenantAnnouncement error');
    return res.status(500).json({
      status: 'error',
      message: 'Failed to send announcement',
      data: null,
    });
  }
};

// GET /api/admin/announcements — history, newest first, paginated.
export const listTenantAnnouncements = async (req, res) => {
  try {
    const organisationId = req.user?.organisation_id;
    if (!organisationId || !req.tenantDb) {
      return res.status(403).json({
        status: 'error',
        message: 'Organisation context required',
        data: null,
      });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 10), 100);

    const { count, rows } = await req.tenantDb.Announcement.findAndCountAll({
      where: announcementWhere(organisationId),
      order: [['created_at', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    });

    return res.status(200).json({
      status: 'success',
      message: 'Announcements retrieved',
      data: {
        announcements: rows.map(shapeAnnouncement),
        total: count,
        page,
        totalPages: Math.max(1, Math.ceil(count / limit)),
      },
    });
  } catch (err) {
    logger.error({ err }, 'listTenantAnnouncements error');
    return res.status(500).json({
      status: 'error',
      message: 'Failed to load announcements',
      data: null,
    });
  }
};

// PUT /api/admin/announcements/:id — edit the history entry AND re-send it to
// the (possibly changed) audience. Recipient count reflects the latest send.
export const updateTenantAnnouncement = async (req, res) => {
  try {
    const organisationId = req.user?.organisation_id;
    if (!organisationId || !req.tenantDb) {
      return res.status(403).json({
        status: 'error',
        message: 'Organisation context required',
        data: null,
      });
    }

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid announcement id',
        data: null,
      });
    }

    const announcement = await req.tenantDb.Announcement.findOne({
      where: { [Op.and]: [{ id }, announcementWhere(organisationId)] },
    });
    if (!announcement) {
      return res.status(404).json({
        status: 'error',
        message: 'Announcement not found',
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

    const roles = normaliseRoles(targetRoles);
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
        resendOfAnnouncementId: id,
      },
    });

    await announcement.update({
      title: title.trim(),
      message: message.trim(),
      targetRoles: roles,
      sendEmail: sendEmail !== false,
      recipients: result.notified,
    });

    return res.status(200).json({
      status: 'success',
      message: `Announcement updated and re-sent to ${result.notified} user(s).`,
      data: { announcement: shapeAnnouncement(announcement) },
    });
  } catch (err) {
    logger.error({ err }, 'updateTenantAnnouncement error');
    return res.status(500).json({
      status: 'error',
      message: 'Failed to update announcement',
      data: null,
    });
  }
};

// DELETE /api/admin/announcements/:id — remove from history only (already
// delivered notifications are the recipients' own and are not retracted).
export const deleteTenantAnnouncement = async (req, res) => {
  try {
    const organisationId = req.user?.organisation_id;
    if (!organisationId || !req.tenantDb) {
      return res.status(403).json({
        status: 'error',
        message: 'Organisation context required',
        data: null,
      });
    }

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid announcement id',
        data: null,
      });
    }

    const deleted = await req.tenantDb.Announcement.destroy({
      where: { [Op.and]: [{ id }, announcementWhere(organisationId)] },
    });
    if (!deleted) {
      return res.status(404).json({
        status: 'error',
        message: 'Announcement not found',
        data: null,
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Announcement deleted',
      data: null,
    });
  } catch (err) {
    logger.error({ err }, 'deleteTenantAnnouncement error');
    return res.status(500).json({
      status: 'error',
      message: 'Failed to delete announcement',
      data: null,
    });
  }
};

// GET /api/admin/announcements/export — full history as .xlsx.
export const exportTenantAnnouncements = async (req, res) => {
  try {
    const organisationId = req.user?.organisation_id;
    if (!organisationId || !req.tenantDb) {
      return res.status(403).json({
        status: 'error',
        message: 'Organisation context required',
        data: null,
      });
    }

    const rows = await req.tenantDb.Announcement.findAll({
      where: announcementWhere(organisationId),
      order: [['created_at', 'DESC']],
    });

    const exportRows = rows.map((a) => ({
      date: (a.createdAt ?? a.created_at)
        ? new Date(a.createdAt ?? a.created_at).toISOString().replace('T', ' ').slice(0, 16)
        : '',
      title: a.title,
      message: a.message,
      audience: (Array.isArray(a.targetRoles) ? a.targetRoles : [])
        .map((r) => ROLE_EXPORT_LABEL[r] || r)
        .join(', '),
      recipients: a.recipients ?? 0,
      email: a.sendEmail !== false ? 'Yes' : 'No',
      sentBy: a.createdByName || '',
    }));

    const buffer = rowsToXlsxBuffer(exportRows, [
      { key: 'date', header: 'Date (UTC)' },
      { key: 'title', header: 'Title' },
      { key: 'message', header: 'Message' },
      { key: 'audience', header: 'Audience' },
      { key: 'recipients', header: 'Recipients' },
      { key: 'email', header: 'Email sent' },
      { key: 'sentBy', header: 'Sent by' },
    ]);

    return sendXlsxDownload(
      res,
      buffer,
      `announcements_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  } catch (err) {
    logger.error({ err }, 'exportTenantAnnouncements error');
    return res.status(500).json({
      status: 'error',
      message: 'Failed to export announcements',
      data: null,
    });
  }
};
