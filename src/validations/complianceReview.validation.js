import { z } from "zod";

const entityParams = z.object({
  entityType: z.enum(["right-to-work", "worker-events", "change-requests"]),
  id: z.coerce.number().int().positive(),
});

/** Reviewer action. Reject / request-info require a reason. */
const reviewActionSchema = (requireNotes) =>
  z.object({
    params: entityParams,
    body: z
      .object({
        notes: requireNotes
          ? z.string().trim().min(1, "A reason is required")
          : z.string().trim().optional().nullable(),
      })
      .strict(),
  });

export const reviewStartSchema = reviewActionSchema(false);
export const reviewApproveSchema = reviewActionSchema(false);
export const reviewRejectSchema = reviewActionSchema(true);
export const reviewRequestInfoSchema = reviewActionSchema(true);

/** Sponsor respond. Notes optional (evidence file handled by multer). */
export const sponsorRespondSchema = z.object({
  params: entityParams,
  body: z
    .object({
      notes: z.string().trim().optional().nullable(),
    })
    .strict(),
});
