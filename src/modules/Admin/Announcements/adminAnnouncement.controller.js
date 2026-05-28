import logger from '../../../utils/logger.js';
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
