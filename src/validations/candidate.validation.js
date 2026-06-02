import { z } from 'zod';
import { emailSchema, phoneSchema, uuidSchema, strongPasswordSchema } from './common.validation.js';

export const createCandidateSchema = z.object({
  body: z.object({
    first_name: z.string().trim().min(1, 'First name is required').max(100),
    last_name: z.string().trim().min(1, 'Last name is required').max(100),
    email: emailSchema,
    country_code: z.string().trim().min(1, 'Country code is required').max(10),
    mobile: phoneSchema,
  }).strict(),
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
