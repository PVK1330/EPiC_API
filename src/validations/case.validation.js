import { z } from 'zod';

// validation-case-schema-unwired fix: the previous schemas required `type` +
// `title` and validated FK ids as UUIDs — none of which the case controller
// actually uses (it reads integer FKs candidateId/sponsorId/businessId/…, plus
// priority/status/notes/etc). Wiring those would have rejected every valid
// request. These rewritten schemas are PERMISSIVE: `.passthrough()` lets the
// controller's flexible field set through unchanged, and we only add the safe,
// high-confidence constraints — the model's priority/status ENUMs and length
// caps that prevent varchar-overflow-style bad input. Empty strings are tolerated
// on the ENUM fields because forms submit "" for an unset dropdown.

const PRIORITY = ['low', 'medium', 'high', 'urgent'];
const STATUS = [
  'Lead', 'Pending', 'Docs Pending', 'Drafting', 'Submitted', 'Decision',
  'In Progress', 'Completed', 'On Hold', 'Cancelled', 'Under Review',
  'Overdue', 'Approved', 'Rejected', 'Closed',
];

const optionalEnum = (values) =>
  z.union([z.literal(''), z.enum(values)]).optional().nullable();

// Optional free-text with an upper bound (guards against oversized payloads /
// varchar overflow) but never required.
const cappedText = (max) => z.string().max(max).optional().nullable();

export const createCaseSchema = z.object({
  body: z
    .object({
      priority: optionalEnum(PRIORITY),
      notes: cappedText(10000),
      jobTitle: cappedText(200),
      nationality: cappedText(100),
      lcaNumber: cappedText(100),
      receiptNumber: cappedText(100),
    })
    .passthrough(),
});

export const updateCaseSchema = z.object({
  // Keep id as a STRING (route params are strings; the controller resolves a
  // case by either numeric PK or the varchar caseId). Coercing to a number broke
  // the varchar caseId lookup ("operator does not exist: character varying = integer").
  params: z.object({
    id: z.string().min(1),
  }),
  body: z
    .object({
      priority: optionalEnum(PRIORITY),
      status: optionalEnum(STATUS),
      notes: cappedText(10000),
      jobTitle: cappedText(200),
      nationality: cappedText(100),
      lcaNumber: cappedText(100),
      receiptNumber: cappedText(100),
    })
    .passthrough(),
});

export const getCaseSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});
