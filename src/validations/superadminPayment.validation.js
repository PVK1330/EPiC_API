import { z } from 'zod';

export const configureGatewaySchema = z.object({
  body: z.object({
    publishable_key: z.string().trim().optional().nullable(),
    secret_key: z.string().trim().optional().nullable(),
    webhook_secret: z.string().trim().optional().nullable(),
    currency: z.string().trim().max(3).optional().nullable(),
    platform_fee: z.coerce.number().min(0).optional().nullable(),
    tax_rate: z.any().optional(),
    tax_id: z.any().optional(),
  }).strict(),
});
