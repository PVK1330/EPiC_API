import { z } from 'zod';

export const configureGatewaySchema = z.object({
  body: z.object({
    publishable_key: z.string().trim().min(1, 'Publishable key is required'),
    secret_key: z.string().trim().min(1, 'Secret key is required'),
    webhook_secret: z.string().trim().optional().nullable(),
    currency: z.string().trim().max(3).optional().nullable(),
    platform_fee: z.coerce.number().min(0).optional().nullable(),
  }).strict(),
});
