/**
 * impersonationTicket.service.js
 *
 * Short-lived, single-use tickets for the superadmin "Login as" handoff.
 *
 * WHY: previously the impersonation JWT was placed in the redirect URL
 * (`/auth/handoff?session=base64(jwt)`). URLs leak via browser history, the
 * Referer header, proxies and server access logs — so the raw JWT was exposed.
 *
 * NOW: the superadmin endpoint issues an opaque random ticket. Only the ticket
 * travels in the URL. The tenant subdomain redeems it at POST /api/auth/handoff,
 * where the JWT is minted server-side and delivered exclusively as an HttpOnly
 * cookie. The JWT never touches the browser.
 *
 * Tickets are:
 *   - random (32 bytes / 256 bits, hex-encoded)
 *   - single-use (deleted on redeem)
 *   - short-lived (60s TTL — only long enough to follow one redirect)
 *
 * STORE: in-memory LRU. The server runs as a single instance (see
 * ecosystem.config.js → instances: 1), so both the issue and redeem requests
 * hit the same process. For a clustered / multi-instance deployment, swap this
 * for a shared store (Redis or a platform DB table) keyed by the ticket.
 */

import crypto from "crypto";
import { LRUCache } from "lru-cache";

const TICKET_TTL_MS = 60 * 1000; // 60 seconds

const ticketStore = new LRUCache({
  max: 1000,
  ttl: TICKET_TTL_MS,
});

/**
 * Create a single-use impersonation ticket.
 * @param {object} claims - Minimal claims used to mint the JWT on redeem
 *   (e.g. { id, email, role_id, organisation_id }). Stored server-side only.
 * @returns {string} opaque ticket to put in the handoff URL.
 */
export function createImpersonationTicket(claims) {
  const ticket = crypto.randomBytes(32).toString("hex");
  ticketStore.set(ticket, { claims });
  return ticket;
}

/**
 * Redeem (and consume) an impersonation ticket. Returns the stored claims, or
 * null when the ticket is missing, already used, or expired.
 * @param {string} ticket
 * @returns {object|null}
 */
export function redeemImpersonationTicket(ticket) {
  if (!ticket || typeof ticket !== "string") return null;
  const entry = ticketStore.get(ticket);
  if (!entry) return null;
  ticketStore.delete(ticket); // single-use: invalidate immediately
  return entry.claims ?? null;
}
