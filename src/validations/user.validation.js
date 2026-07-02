import { z } from 'zod';
import { strongPasswordSchema, phoneSchema } from './common.validation.js';

export const editProfileSchema = z.object({
  body: z.object({
    first_name: z.string().trim().min(1, 'First name is required').max(100),
    last_name: z.string().trim().min(1, 'Last name is required').max(100),
    country_code: z.string().trim().max(10).optional().nullable(),
    mobile: phoneSchema,
    // Gender constrained to the User model ENUM (male/female/other). "" is the
    // frontend's "Prefer not to say" value, so it must remain accepted.
    gender: z.union([z.literal(''), z.enum(['male', 'female', 'other'])]).optional().nullable(),
  }).strict(),
});

export const changeOwnPasswordSchema = z.object({
  body: z.object({
    new_password: strongPasswordSchema,
  }).strict(),
});
