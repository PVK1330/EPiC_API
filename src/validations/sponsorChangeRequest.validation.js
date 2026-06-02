import { z } from 'zod';

export const createSponsorChangeRequestSchema = z.object({
  body: z.object({
    changeType: z.string().trim().min(1, 'changeType is required'),
    eventDate: z.string().min(1, 'eventDate is required'),
    description: z.string().trim().optional().nullable(),
    notes: z.string().trim().optional().nullable(),
  }).strict(),
});

export const updateSponsorChangeRequestSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    status: z.string().trim().optional(),
    notes: z.string().trim().optional().nullable(),
    dateReported: z.string().optional().nullable(),
    reportedBy: z.coerce.number().int().positive().optional().nullable(),
  }).strict(),
});
