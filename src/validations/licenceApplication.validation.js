/**
 * Explicit field whitelists for the V1 sponsor licence application endpoints.
 *
 * Mass-assignment protection strategy:
 *   - These schemas use Zod's default strip behaviour (unknown keys are silently
 *     dropped), so any field not listed here is removed from req.body before it
 *     reaches the controller or the database.  The validate() middleware replaces
 *     req.body with the parsed (stripped) value.
 *
 * Fields that must NEVER be writeable through these endpoints:
 *   status               — controlled exclusively by the workflow engine
 *   assignedcaseworkerId — controlled by the assignCaseworker endpoint
 *   userId               — set at creation; ownership is immutable
 *   organisationId       — tenant isolation; immutable
 *   type                 — Initial | Renewal; set on creation
 *   applicationVersion   — system field
 *   cosAllocation        — set by the licence activation workflow
 *   licenceNumber        — generated on activation
 *   licenceIssueDate     — generated on activation
 *   licenceExpiryDate    — generated on activation
 *   documents            — managed by the file-upload endpoints only
 *   adminNotes           — admin-only; not writable by sponsors
 *   requestedDocuments   — admin-only; not writable by sponsors
 */

import { z } from "zod";

// ── Primitives ────────────────────────────────────────────────────────────────

const str = (max) => z.string().trim().max(max).optional().nullable();

// Accepts ISO date strings, empty string, or "Invalid date" (the value
// momentjs emits for unparseable dates) — all treated as null.
const dateField = z
  .string()
  .trim()
  .max(40)
  .transform((v) => (v === "" || v === "Invalid date" ? null : v))
  .nullable()
  .optional();

// Accepts a number or a numeric-ish string; empty string → null.
const numField = z
  .preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.coerce.number().nonnegative().max(99_999_999).optional().nullable()
  );

// ── Field-set that sponsors may legitimately provide ──────────────────────────

const SPONSOR_FIELDS = z.object({
  companyName:          str(255),
  tradingName:          str(255),
  registrationNumber:   str(50),
  industry:             str(100),
  contactName:          str(255),
  contactEmail:         z.string().trim().email().max(255).optional().nullable(),
  contactPhone:         str(30),
  licenceType:          str(120),
  proposedStartDate:    dateField,
  estimatedAnnualCost:  numField,
  reason:               str(5000),
  notes:                str(5000),
  numberOfEmployees:    z.coerce.number().int().nonnegative().max(9_999_999).optional().nullable(),
});

// ── Exported schemas (wrapped in { body, params } for validate() middleware) ──

/** POST /api/business/licence/apply — sponsor initial submission. */
export const sponsorSubmitLicenceSchema = z.object({
  body: SPONSOR_FIELDS,
});

/** PUT /api/business/licence/update/:id — sponsor update while Pending or Information Requested. */
export const sponsorUpdateLicenceSchema = z.object({
  body: SPONSOR_FIELDS,
  params: z.object({ id: z.coerce.number().int().positive() }),
});

/**
 * PUT /api/admin/licence/update/:id — admin field-level correction.
 *
 * Extends the sponsor fields with admin-only fields.  Status changes, caseworker
 * assignment, and activation data are all handled by dedicated endpoints.
 */
export const adminUpdateLicenceSchema = z.object({
  body: SPONSOR_FIELDS.extend({
    adminNotes:          str(5000),
    requestedDocuments:  z.array(z.string().trim().max(500)).max(20).optional().nullable(),
  }),
  params: z.object({ id: z.coerce.number().int().positive() }),
});
