import { z } from 'zod';
import { emailSchema, passwordSchema, phoneSchema } from './common.validation.js';

export const registerSchema = z.object({
  body: z.object({
    first_name: z.string().trim().min(1, 'First name is required').max(100),
    last_name: z.string().trim().min(1, 'Last name is required').max(100),
    email: emailSchema,
    password: passwordSchema,
    country_code: z.string().trim().max(10).optional(),
    mobile: phoneSchema.optional(),
    role_id: z.coerce.number().int().optional(),
    date_of_birth: z.string().optional().nullable(),
    userType: z.string().optional(),
    organisation_id: z.string().optional(), // In the controller it destructures as organisation_id
  }).strict(),
});

export const loginSchema = z.object({
  body: z.object({
    email: emailSchema,
    password: z.string().min(1, 'Password is required'), // Don't use passwordSchema here to avoid leaking policy
    userType: z.string().optional(),
  }).strict(),
});

export const verifyOtpSchema = z.object({
  body: z.object({
    email: emailSchema,
    otp: z.string().length(6, 'OTP must be 6 digits'),
    organisationId: z.string().optional(),
  }).strict(),
});

export const resendOtpSchema = z.object({
  body: z.object({
    email: emailSchema,
    organisationId: z.string().optional(),
  }).strict(),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: emailSchema,
    organisationId: z.string().optional(),
  }).strict(),
});

export const verifyResetOtpSchema = z.object({
  body: z.object({
    email: emailSchema,
    otp: z.string().length(6, 'OTP must be 6 digits'),
    organisationId: z.string().optional(),
  }).strict(),
});

export const setPasswordSchema = z.object({
  body: z.object({
    email: emailSchema,
    otp: z.string().length(6, 'OTP must be 6 digits'),
    newPassword: passwordSchema,
    organisationId: z.string().optional(),
  }).strict(),
});

export const verify2faSchema = z.object({
  body: z.object({
    email: emailSchema,
    token: z.string().min(6, 'Token must be at least 6 characters'),
  }).strict(),
});

export const verify2faSetupSchema = z.object({
  body: z.object({
    token: z.string().min(6, 'Token must be at least 6 characters'),
  }).strict(),
});

export const disable2faSchema = z.object({
  body: z.object({
    password: z.string().min(1, 'Password is required'),
    token: z.string().min(6, 'Token must be at least 6 characters').optional(), // Sometimes optional based on how it's called
  }).strict(),
});

export const handoffSchema = z.object({
  body: z.object({
    token: z.string().min(1, 'Handoff token is required'),
  }).strict(),
});

export const resendOtpUserSchema = z.object({
  body: z.object({
    email: emailSchema,
  }).strict(),
});

export const verifyOtpUserSchema = z.object({
  body: z.object({
    email: emailSchema,
    otp: z.string().length(6, 'OTP must be 6 digits'),
  }).strict(),
});
