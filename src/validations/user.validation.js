import { z } from 'zod';
import { passwordSchema, phoneSchema } from './common.validation.js';

export const editProfileSchema = z.object({
  body: z.object({
    first_name: z.string().trim().min(1, 'First name is required').max(100),
    last_name: z.string().trim().min(1, 'Last name is required').max(100),
    country_code: z.string().trim().max(10).optional().nullable(),
    mobile: phoneSchema,
    gender: z.string().optional().nullable(),
  }).strict(),
});

export const changeOwnPasswordSchema = z.object({
  body: z.object({
    new_password: passwordSchema,
  }).strict(),
});
