import { z } from 'zod';

export const configureGatewaySchema = z.object({
  body: z.object({
    publishable_key: z.string().trim().optional().nullable(),
    secret_key: z.string().trim().optional().nullable(),
    webhook_secret: z.string().trim().optional().nullable(),
    currency: z.string().trim().max(3).optional().nullable(),
    // platform_fee and tax_rate are PERCENTAGES (0-100), not money amounts.
    platform_fee: z.coerce.number().min(0).max(100).optional().nullable(),
    tax_rate: z.coerce.number().min(0).max(100).optional().nullable(),
    tax_id: z.string().trim().max(255).optional().nullable(),
    free_trial_enabled: z.boolean().optional().nullable(),
    free_trial_days: z.coerce.number().int().min(1).max(365).optional().nullable(),
  }).strict(),
});
