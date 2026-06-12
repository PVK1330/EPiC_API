import { z } from "zod";

const idParams = z.object({
  id: z.string().regex(/^\d+$/, "id must be a positive integer"),
});

// POST /:id/government-registration/complete
export const completeRegistrationSchema = z.object({
  params: idParams,
  body: z.object({
    smsRegistrationRef: z.string().trim().min(1).max(100),
    governmentRegistrationRef: z.string().trim().min(1).max(100).optional(),
  }),
});

// POST /:id/government-submission
export const governmentSubmissionSchema = z.object({
  params: idParams,
  body: z.object({
    submissionRef: z.string().trim().min(1).max(100),
    submissionDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "submissionDate must be YYYY-MM-DD"),
  }),
});

// POST /admin/:id/generate-credentials
export const generateCredentialsSchema = z.object({
  params: idParams,
  body: z.object({
    ukviPortalUserId: z.string().trim().min(1).max(255),
    ukviPortalPassword: z.string().min(8).max(255),
    smsPortalUsername: z.string().trim().max(255).optional(),
  }),
});
