import { z } from 'zod';
import { paginationSchema } from './common.validation.js';

export const createChangeRequestSchema = z.object({
  body: z.object({
    entityType: z.string().trim().min(1, 'Entity type is required'),
    entityId: z.union([z.string(), z.number()]),
    fieldName: z.string().trim().min(1, 'Field name is required'),
    requestedValue: z.any(),
    reason: z.string().trim().optional().nullable(),
    changeCategory: z.string().trim().optional().nullable(),
    riskLevel: z.string().trim().optional().nullable(),
    caseId: z.coerce.number().int().optional().nullable(),
  }).strict(),
});

export const getChangeRequestSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
});

export const listChangeRequestsSchema = z.object({
  query: z.object({
    status: z.string().optional(),
    entityType: z.string().optional(),
    riskLevel: z.string().optional(),
    caseId: z.coerce.number().int().optional(),
  }).merge(paginationSchema).strict(),
});

export const reviewActionSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    notes: z.string().trim().optional().nullable(),
  }).strict(),
});
