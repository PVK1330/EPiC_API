import { z } from 'zod';
import { emailSchema, phoneSchema, uuidSchema } from './common.validation.js';

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
