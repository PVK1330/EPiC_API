import { z } from 'zod';
import { emailSchema, phoneSchema, uuidSchema, strongPasswordSchema } from './common.validation.js';

export const createCandidateSchema = z.object({
  // Admin "Add client" sends the core account fields PLUS the full application
  // wizard payload (passport/visa/nationality, the nested `application` object,
  // `applicationData`, and assorted legacy CRM fields). The service
  // (createCandidate) consumes those to create the user, application, and case
  // in one transaction — so we validate the required core fields strictly but
  // allow the rest through with `.passthrough()` instead of `.strict()`, which
  // previously rejected every extra key with "Unrecognized keys".
  body: z.object({
    first_name: z.string().trim().min(1, 'First name is required').max(100),
    last_name: z.string().trim().min(1, 'Last name is required').max(100),
    email: emailSchema,
    country_code: z.string().trim().min(1, 'Country code is required').max(10),
    mobile: phoneSchema,
    // Optional account fields the admin form may include. Password may be an
    // empty string — the service auto-generates a strong one when blank.
    password: z.string().optional(),
    confirm_password: z.string().optional(),
    role_id: z.coerce.number().int().positive().optional(),
    // Application wizard payload (validated/sanitised in the service layer).
    application: z.record(z.string(), z.any()).optional(),
    applicationData: z.record(z.string(), z.any()).optional(),
  }).passthrough(),
});

export const updateCandidateSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    first_name: z.string().trim().max(100).optional(),
    last_name: z.string().trim().max(100).optional(),
    email: emailSchema.optional(),
    country_code: z.string().trim().max(10).optional(),
    mobile: phoneSchema.optional(),
  }).strict(),
});

export const getCandidateSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
});

export const assignCandidateBusinessSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z
    .object({
      // The sponsor (business) user id to assign this candidate to.
      // null clears the assignment (unassign from any business).
      businessId: z.coerce.number().int().positive().nullable(),
    })
    .strict(),
});

export const resetCandidatePasswordSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z
    .object({
      new_password: strongPasswordSchema,
      confirm_password: z.string().min(1, 'Confirm password is required'),
    })
    .strict()
    .refine((data) => data.new_password === data.confirm_password, {
      message: 'Passwords do not match',
      path: ['confirm_password'],
    }),
});
