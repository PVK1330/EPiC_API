import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email address")
  .max(255, "Email cannot exceed 255 characters");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(100, "Password cannot exceed 100 characters");

/**
 * Strong password policy for security-sensitive flows (password resets, etc.):
 * minimum 12 characters with upper, lower, digit and special-character classes.
 */
export const strongPasswordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(100, "Password cannot exceed 100 characters")
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a number")
  .regex(/[^A-Za-z0-9]/, "Password must contain a special character");

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number format")
  .optional()
  .nullable();

export const uuidSchema = z.string().uuid("Invalid UUID format");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(100).optional(),
});

export const dateSchema = z.string().refine((val) => !isNaN(Date.parse(val)), {
  message: "Invalid date format",
});

export const currencySchema = z
  .number()
  .nonnegative("Amount cannot be negative")
  .multipleOf(0.01, "Amount can only have up to 2 decimal places");

// Common enums
export const RoleEnum = z.enum([
  "candidate",
  "caseworker",
  "admin",
  "sponsor",
  "superadmin",
]);
export const CaseStatusEnum = z.enum([
  "enquiry",
  "consultation",
  "submitted",
  "approved",
]);
export const UserStatusEnum = z.enum(["active", "inactive", "suspended"]);
