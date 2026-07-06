import webpush from "web-push";
import logger from "../utils/logger.js";
import { ROLES } from "../middlewares/role.middleware.js";

// Clicking the OS toast lands on the recipient's own notifications page.
const ROLE_NOTIFICATIONS_PATH = {
  [ROLES.ADMIN]: "/admin/notifications",
  [ROLES.CASEWORKER]: "/caseworker/notifications",
  [ROLES.CANDIDATE]: "/candidate/notifications",
  [ROLES.BUSINESS]: "/business/notifications",
};

/**
 * Web Push (desktop notifications) — delivers OS-level notifications through
 * the browser push services (FCM for Chrome/Edge, Mozilla autopush for
 * Firefox) so users are notified even when no ElitePic tab is open.
 *
 * The in-page chime/badge (socket) and this channel are complementary: the
 * service worker suppresses the OS toast when an ElitePic window is focused,
 * so users never get both at once.
 */

let configured = false;
let configFailed = false;

const ensureConfigured = () => {
  if (configured || configFailed) return configured;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!publicKey || !privateKey) {
    configFailed = true;
    logger.warn("Web Push disabled: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set in .env");
    return false;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  } catch (err) {
    configFailed = true;
    logger.error({ err }, "Web Push disabled: invalid VAPID configuration");
  }
  return configured;
};

export const isWebPushEnabled = () => ensureConfigured();

export const getVapidPublicKey = () =>
  ensureConfigured() ? process.env.VAPID_PUBLIC_KEY : null;

/**
 * Store (or refresh) a browser push subscription for a user.
 * @param {object} tenantDb
 * @param {number} userId
 * @param {object} subscription - the browser PushSubscription.toJSON():
 *                                { endpoint, keys: { p256dh, auth } }
 * @param {string|null} userAgent
 */
export const savePushSubscription = async (tenantDb, userId, subscription, userAgent = null) => {
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    throw new Error("Invalid push subscription payload");
  }

  // Same browser re-subscribing gets its row refreshed; a browser previously
  // used by ANOTHER user on this machine is re-assigned to the current user.
  const [row, created] = await tenantDb.PushSubscription.findOrCreate({
    where: { endpoint },
    defaults: { userId, endpoint, p256dh, auth, userAgent },
  });
  if (!created) {
    await row.update({ userId, p256dh, auth, userAgent });
  }
  return row;
};

/**
 * Remove a subscription by endpoint (user turned the toggle off, or the push
 * service reported it gone).
 */
export const removePushSubscription = async (tenantDb, endpoint) => {
  if (!endpoint) return 0;
  return tenantDb.PushSubscription.destroy({ where: { endpoint } });
};

/**
 * Send a push to every browser the user has enabled desktop notifications in.
 * Fire-and-forget from the caller's perspective: failures are logged, and
 * subscriptions the push service reports as gone (404/410) are pruned.
 *
 * @param {object} tenantDb
 * @param {number} userId
 * @param {object} payload - { title, message, url, tag }
 */
export const sendPushToUser = async (tenantDb, userId, payload = {}) => {
  if (!ensureConfigured()) return { sent: 0 };
  if (!tenantDb?.PushSubscription || !userId) return { sent: 0 };

  let subs = [];
  try {
    subs = await tenantDb.PushSubscription.findAll({ where: { userId } });
  } catch (err) {
    // Table missing in a tenant DB that hasn't run the migration yet — skip.
    logger.warn({ err: err.message }, "push_subscriptions lookup failed — skipping web push");
    return { sent: 0 };
  }
  if (!subs.length) return { sent: 0 };

  // No explicit target → the recipient's notifications page. Only costs a
  // query when the user actually has desktop notifications enabled.
  let url = payload.url;
  if (!url) {
    const recipient = await tenantDb.User.findByPk(userId, { attributes: ["role_id"] }).catch(() => null);
    url = ROLE_NOTIFICATIONS_PATH[recipient?.role_id] || "/";
  }

  const body = JSON.stringify({
    title: String(payload.title || "New notification"),
    message: String(payload.message || ""),
    url,
    tag: payload.tag || undefined,
  });

  let sent = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          { TTL: 3600 } // undeliverable after an hour is stale anyway
        );
        sent += 1;
      } catch (err) {
        // 404/410 = subscription expired or user revoked permission → prune.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await sub.destroy().catch(() => {});
        } else {
          logger.warn({ err: err.message, statusCode: err?.statusCode }, "web push send failed");
        }
      }
    })
  );
  return { sent };
};
