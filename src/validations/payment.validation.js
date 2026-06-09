import { z } from 'zod';

export const createPaymentIntentSchema = z.object({
  body: z.object({
    amount: z.coerce.number().positive().optional(),
    currency: z.string().trim().max(3).optional().default('gbp'),
    payment_method_id: z.string().trim().optional(),
    metadata: z.record(z.string()).optional(),
  }).strict(),
});

export const confirmPaymentSchema = z.object({
  body: z.object({
    payment_intent_id: z.string().trim().min(1, 'Payment intent ID is required'),
    payment_method_id: z.string().trim().optional(),
  }).strict(),
});

export const cancelPaymentSchema = z.object({
  body: z.object({
    payment_intent_id: z.string().trim().min(1, 'Payment intent ID is required'),
  }).strict(),
});

export const createSetupIntentSchema = z.object({
  body: z.object({
    customer_id: z.string().trim().min(1, 'Customer ID is required'),
  }).strict(),
});

export const createRefundSchema = z.object({
  body: z.object({
    payment_intent_id: z.string().trim().min(1, 'Payment intent ID is required'),
    amount: z.coerce.number().positive().optional(),
    reason: z.string().trim().optional(),
  }).strict(),
});

export const createSubscriptionSchema = z.object({
  body: z.object({
    plan_id: z.string().trim().min(1, 'Plan ID is required'),
    payment_method_id: z.string().trim().min(1, 'Payment method ID is required'),
  }).strict(),
});

export const renewSubscriptionSchema = z.object({
  body: z.object({
    subscription_id: z.string().trim().min(1, 'Subscription ID is required'),
  }).strict(),
});

export const cancelSubscriptionSchema = z.object({
  body: z.object({
    subscription_id: z.string().trim().min(1, 'Subscription ID is required'),
  }).strict(),
});

export const updateSubscriptionSchema = z.object({
  body: z.object({
    subscription_id: z.string().trim().min(1, 'Subscription ID is required'),
    plan_id: z.string().trim().min(1, 'Plan ID is required'),
  }).strict(),
});

// Matches the fields the receipt/invoice download actually sends (see
// stripepayment.controller.exportInvoiceReceiptPdf). The previous schema
// required `payment_intent_id` and was `.strict()`, so every receipt download
// was rejected with 400 and silently failed in the UI.
export const exportInvoiceReceiptSchema = z.object({
  body: z.object({
    caseId: z.union([z.string(), z.number()]).transform((v) => String(v)),
    amount: z.union([z.string(), z.number()]),
    date: z.string().trim().min(1, 'Date is required'),
    description: z.string().optional(),
    candidateName: z.string().optional(),
    isReceipt: z.boolean().optional(),
    platformName: z.string().optional(),
  }),
});
