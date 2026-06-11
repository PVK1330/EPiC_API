import { z } from "zod";

/**
 * Sponsor upload. Multipart text fields only (the file is handled by multer).
 * `.strict()` rejects any privileged field (status, reviewedBy, reviewedAt,
 * reviewNotes, ...) so a sponsor can never seed a document into a review state.
 */
export const createComplianceDocumentSchema = z.object({
  body: z
    .object({
      documentType: z.string().trim().min(1, "documentType is required"),
      expiryDate: z.string().trim().optional().nullable(),
      notes: z.string().trim().optional().nullable(),
      // optional: save without submitting for review yet
      saveAsDraft: z.union([z.boolean(), z.string()]).optional(),
    })
    .strict(),
});

/**
 * Sponsor metadata update. Only document details may change — `.strict()` makes
 * the request fail loudly if status / reviewedBy / reviewedAt / reviewNotes are
 * supplied, enforcing that sponsors cannot move status manually.
 */
export const updateComplianceDocumentSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z
    .object({
      documentType: z.string().trim().min(1).optional(),
      expiryDate: z.string().trim().optional().nullable(),
      notes: z.string().trim().optional().nullable(),
    })
    .strict(),
});

/** Reviewer action schema factory. Rejection / request-info require a reason. */
const reviewActionSchema = (requireNotes) =>
  z.object({
    params: z.object({
      id: z.coerce.number().int().positive(),
    }),
    body: z
      .object({
        notes: requireNotes
          ? z.string().trim().min(1, "A reason is required")
          : z.string().trim().optional().nullable(),
      })
      .strict(),
  });

export const startReviewComplianceSchema = reviewActionSchema(false);
export const approveComplianceSchema = reviewActionSchema(false);
export const rejectComplianceSchema = reviewActionSchema(true);
export const requestInfoComplianceSchema = reviewActionSchema(true);
