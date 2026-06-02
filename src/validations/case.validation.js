import { z } from 'zod';
import { uuidSchema, CaseStatusEnum } from './common.validation.js';

export const createCaseSchema = z.object({
  body: z.object({
    type: z.string().min(1, 'Type is required'),
    title: z.string().min(1, 'Title is required').max(200),
    description: z.string().optional(),
    sponsorId: uuidSchema.optional().nullable(),
    candidateId: uuidSchema.optional().nullable(),
  }).strict(),
});

export const updateCaseSchema = z.object({
  params: z.object({
    id: uuidSchema,
  }),
  body: z.object({
    status: CaseStatusEnum.optional(),
    title: z.string().max(200).optional(),
    description: z.string().optional(),
  }).strict(),
});

export const getCaseSchema = z.object({
  params: z.object({
    id: uuidSchema,
  }),
});
