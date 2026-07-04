import { z } from 'zod';

// validation-admin-settings-no-schema (partial): SLA rules had no validation, so
// `days` could be any value and rule_type any string. Constrained to the SlaRule
// model (name STRING, days INTEGER, rule_type ENUM). `.passthrough()` keeps any
// extra field the controller might read, and the id param stays a string (the
// controller resolves via findByPk which accepts a numeric string) to avoid the
// varchar/integer coercion pitfall seen with case ids.
const RULE_TYPES = ['Visa', 'Global'];

export const createSlaRuleSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(1, 'Name is required').max(255),
      days: z.coerce.number().int().min(0, 'Days cannot be negative').max(3650, 'Days is unreasonably large'),
      rule_type: z.enum(RULE_TYPES),
    })
    .passthrough(),
});

export const updateSlaRuleSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z
    .object({
      name: z.string().trim().min(1).max(255).optional(),
      days: z.coerce.number().int().min(0).max(3650).optional(),
      rule_type: z.enum(RULE_TYPES).optional(),
    })
    .passthrough(),
});
