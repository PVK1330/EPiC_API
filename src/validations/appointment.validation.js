import { z } from 'zod';

export const createAppointmentSchema = z.object({
  body: z.object({
    title: z.string().trim().min(1, 'Title is required').max(200),
    description: z.string().trim().optional().nullable(),
    date: z.string().trim().min(1, 'Date is required'),
    time: z.string().trim().min(1, 'Time is required'),
    platform: z.string().trim().optional().nullable(),
    meeting_url: z.string().trim().optional().nullable(),
    case_id: z.coerce.number().int().positive().optional().nullable(),
    staff_ids: z.array(z.coerce.number().int().positive()).optional().nullable(),
  }).strict(),
});

export const updateAppointmentStatusSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    // Constrained to the Appointment model's status ENUM
    // (scheduled/completed/cancelled/live) — the DB rejects anything else, so
    // this only turns a would-be DB error into a clean 400.
    status: z.enum(['scheduled', 'completed', 'cancelled', 'live']),
  }).strict(),
});

export const getAppointmentSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
});
