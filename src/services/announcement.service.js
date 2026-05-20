import { Op } from 'sequelize';
import platformDb from '../models/index.js';
import { getTenantDb } from './tenantDb.service.js';
import { ROLES } from '../middlewares/role.middleware.js';
import { applyOrganisationScope } from '../utils/tenantScope.js';
import {
  createBulkNotifications,
  NotificationTypes,
  NotificationPriority,
} from './notification.service.js';
import { sendTransactionalEmail } from './mail.service.js';
import { generateNotificationEmailTemplate } from '../utils/emailTemplate.js';

const ROLE_NAME_TO_ID = {
  candidate: ROLES.CANDIDATE,
  caseworker: ROLES.CASEWORKER,
  admin: ROLES.ADMIN,
  sponsor: ROLES.BUSINESS,
  business: ROLES.BUSINESS,
};

/**
 * Create in-app notifications (and optional email) for a set of tenant user IDs.
 * @param {object} tenantDb - Tenant Sequelize registry
 * @param {number[]} userIds - Recipient user IDs in the tenant DB
 * @param {string} title
 * @param {string} message
 * @param {object} [options]
 * @param {boolean} [options.sendEmail=true]
 * @param {number|null} [options.organisationId]
 * @param {object} [options.metadata]
 */
export async function sendAnnouncement(tenantDb, userIds, title, message, options = {}) {
  const {
    sendEmail = true,
    organisationId = null,
    metadata = {},
    priority = NotificationPriority.HIGH,
    source = 'announcement',
  } = options;

  if (!tenantDb) throw new Error('tenantDb is required');
  if (!title?.trim() || !message?.trim()) throw new Error('Title and message are required');

  const uniqueIds = [...new Set((userIds || []).map((id) => Number(id)).filter((id) => id > 0))];
  if (!uniqueIds.length) {
    return { notified: 0, emailsAttempted: 0 };
  }

  await createBulkNotifications(uniqueIds, {
    tenantDb,
    type: NotificationTypes.SYSTEM_MAINTENANCE,
    priority,
    title: title.trim(),
    message: message.trim(),
    actionType: 'announcement',
    metadata: { source, ...metadata },
    sendEmail,
    organisationId,
    isInternalAdminOnly: true,
  });

  return { notified: uniqueIds.length, emailsAttempted: sendEmail ? uniqueIds.length : 0 };
}

/**
 * Resolve tenant user IDs for organisation admins (match platform admins by email).
 */
export async function resolveTenantAdminUserIds(org, tenantDb) {
  if (!org?.id || !tenantDb) return [];

  const platformAdmins = await platformDb.User.findAll({
    where: { organisation_id: org.id, role_id: ROLES.ADMIN, status: 'active' },
    attributes: ['id', 'email'],
  });

  const tenantAdmins = await tenantDb.User.findAll({
    where: { role_id: ROLES.ADMIN, status: 'active' },
    attributes: ['id', 'email'],
  });

  const byEmail = new Map(
    tenantAdmins
      .filter((u) => u.email)
      .map((u) => [String(u.email).trim().toLowerCase(), u.id]),
  );

  const ids = new Set();
  for (const pa of platformAdmins) {
    const tid = byEmail.get(String(pa.email || '').trim().toLowerCase());
    if (tid) ids.add(tid);
  }

  if (!ids.size) {
    tenantAdmins.forEach((u) => ids.add(u.id));
  }

  return [...ids];
}

/**
 * Map role slugs from API to tenant user IDs (scoped to organisation when set on users).
 */
export async function resolveUserIdsByTargetRoles(tenantDb, targetRoles, organisationId) {
  if (!tenantDb || !Array.isArray(targetRoles) || !targetRoles.length) {
    return [];
  }

  const roleIds = new Set();
  const normalized = targetRoles.map((r) => String(r).trim().toLowerCase());

  for (const name of normalized) {
    if (ROLE_NAME_TO_ID[name] != null) {
      roleIds.add(ROLE_NAME_TO_ID[name]);
    }
  }

  if (!roleIds.size) return [];

  const users = await tenantDb.User.findAll({
    where: applyOrganisationScope(
      { role_id: [...roleIds], status: 'active' },
      organisationId,
    ),
    attributes: ['id'],
  });

  return users.map((u) => u.id);
}

/**
 * Optional: email organisation primary contact when no tenant admin user exists.
 */
export async function emailOrganisationPrimaryContact(org, title, message) {
  if (!org?.primaryEmail) return false;
  const result = await sendTransactionalEmail({
    organisationId: org.id,
    to: org.primaryEmail,
    subject: `EPiC Announcement: ${title}`,
    html: generateNotificationEmailTemplate({
      recipientName: org.name || 'Organisation Admin',
      title,
      message,
      priority: NotificationPriority.HIGH,
      notificationType: NotificationTypes.SYSTEM_MAINTENANCE,
      metadata: { source: 'platform_announcement' },
    }),
  });
  return result.sent === true;
}

/**
 * Broadcast from platform superadmin to one or more organisations.
 */
export async function broadcastPlatformAnnouncement({ target, orgIds, title, message, sendEmail = true }) {
  const where =
    target === 'selected' && Array.isArray(orgIds) && orgIds.length
      ? { id: { [Op.in]: orgIds.map((id) => Number(id)).filter((id) => id > 0) } }
      : { status: { [Op.in]: ['active', 'trial'] } };

  const organisations = await platformDb.Organisation.findAll({
    where,
    attributes: ['id', 'name', 'database_name', 'primaryEmail', 'status'],
  });

  const summary = {
    organisations: organisations.length,
    recipients: 0,
    skipped: [],
  };

  for (const org of organisations) {
    if (!org.database_name) {
      summary.skipped.push({ orgId: org.id, reason: 'no_tenant_database' });
      continue;
    }

    let tenantDb;
    try {
      tenantDb = getTenantDb(org.database_name);
    } catch (err) {
      summary.skipped.push({ orgId: org.id, reason: err.message });
      continue;
    }

    const userIds = await resolveTenantAdminUserIds(org, tenantDb);
    if (!userIds.length) {
      if (sendEmail) {
        await emailOrganisationPrimaryContact(org, title, message);
      }
      summary.skipped.push({ orgId: org.id, reason: 'no_tenant_admin_users' });
      continue;
    }

    const result = await sendAnnouncement(tenantDb, userIds, title, message, {
      sendEmail,
      organisationId: org.id,
      metadata: { source: 'superadmin', organisationId: org.id, organisationName: org.name },
    });
    summary.recipients += result.notified;
  }

  return summary;
}
