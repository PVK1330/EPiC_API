import { z } from 'zod';
import { emailSchema, phoneSchema, passwordSchema, paginationSchema, UserStatusEnum } from './common.validation.js';

export const createSponsorSchema = z.object({
  body: z.object({
    first_name: z.string().trim().min(1, 'First name is required').max(100),
    last_name: z.string().trim().min(1, 'Last name is required').max(100),
    email: emailSchema,
    country_code: z.string().trim().min(1, 'Country code is required').max(10),
    mobile: phoneSchema,
    role_id: z.coerce.number().int().optional().default(4),
    password: passwordSchema.optional().nullable(),
    confirm_password: z.string().optional().nullable(),
    companyName: z.string().trim().min(1, 'Company name is required').max(200),
    tradingName: z.string().trim().max(200).optional().nullable(),
    registrationNumber: z.string().trim().max(100).optional().nullable(),
    industrySector: z.string().trim().max(100).optional().nullable(),
    sponsorLicenceNumber: z.string().trim().max(100).optional().nullable(),
    licenceStatus: z.string().trim().max(50).optional().nullable(),
    licenceExpiryDate: z.string().optional().nullable(),
    registeredAddress: z.string().trim().max(500).optional().nullable(),
    city: z.string().trim().max(100).optional().nullable(),
    postalCode: z.string().trim().max(20).optional().nullable(),
    country: z.string().trim().max(100).optional().nullable(),
    cosAllocation: z.coerce.number().int().optional().nullable(),
    activeCases: z.coerce.number().int().optional().nullable(),
    sponsoredWorkers: z.coerce.number().int().optional().nullable(),
    riskLevel: z.string().trim().max(50).optional().nullable(),
    riskPct: z.coerce.number().optional().nullable(),
    outstandingBalance: z.coerce.number().optional().nullable(),
  }).strict().refine((data) => {
    if (data.password || data.confirm_password) {
      return data.password === data.confirm_password;
    }
    return true;
  }, {
    message: "Password and confirm password do not match",
    path: ["confirm_password"],
  }),
});

export const updateSponsorSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    first_name: z.string().trim().max(100).optional(),
    last_name: z.string().trim().max(100).optional(),
    email: emailSchema.optional(),
    country_code: z.string().trim().max(10).optional(),
    mobile: phoneSchema.optional(),
    role_id: z.coerce.number().int().optional(),
    status: UserStatusEnum.optional(),
    companyName: z.string().trim().max(200).optional(),
    tradingName: z.string().trim().max(200).optional().nullable(),
    registrationNumber: z.string().trim().max(100).optional().nullable(),
    sponsorLicenceNumber: z.string().trim().max(100).optional().nullable(),
    licenceRating: z.string().trim().max(50).optional().nullable(),
    industrySector: z.string().trim().max(100).optional().nullable(),
    yearEstablished: z.coerce.number().int().optional().nullable(),
    website: z.string().trim().max(200).optional().nullable(),
    registeredAddress: z.string().trim().max(500).optional().nullable(),
    tradingAddress: z.string().trim().max(500).optional().nullable(),
    city: z.string().trim().max(100).optional().nullable(),
    state: z.string().trim().max(100).optional().nullable(),
    country: z.string().trim().max(100).optional().nullable(),
    postalCode: z.string().trim().max(20).optional().nullable(),
    authorisingName: z.string().trim().max(200).optional().nullable(),
    authorisingPhone: z.string().trim().max(50).optional().nullable(),
    authorisingEmail: z.string().email().optional().nullable(),
    keyContactName: z.string().trim().max(200).optional().nullable(),
    keyContactPhone: z.string().trim().max(50).optional().nullable(),
    keyContactEmail: z.string().email().optional().nullable(),
    ownershipType: z.string().trim().max(100).optional().nullable(),
    hrName: z.string().trim().max(200).optional().nullable(),
    hrPhone: z.string().trim().max(50).optional().nullable(),
    hrEmail: z.string().email().optional().nullable(),
    licenceIssueDate: z.string().optional().nullable(),
    licenceExpiryDate: z.string().optional().nullable(),
    cosAllocation: z.coerce.number().int().optional().nullable(),
    billingName: z.string().trim().max(200).optional().nullable(),
    billingEmail: z.string().email().optional().nullable(),
    billingPhone: z.string().trim().max(50).optional().nullable(),
    outstandingBalance: z.coerce.number().optional().nullable(),
    paymentTerms: z.string().trim().max(100).optional().nullable(),
    sponsorLetter: z.string().optional().nullable(),
    insuranceCertificate: z.string().optional().nullable(),
    hrPolicies: z.string().optional().nullable(),
    organisationalChart: z.string().optional().nullable(),
    recruitmentDocs: z.string().optional().nullable(),
    licenceStatus: z.string().trim().max(50).optional().nullable(),
    riskLevel: z.string().trim().max(50).optional().nullable(),
    activeCases: z.coerce.number().int().optional().nullable(),
    sponsoredWorkers: z.coerce.number().int().optional().nullable(),
    notes: z.string().optional().nullable(),
    riskPct: z.coerce.number().optional().nullable(),
  }).strict(),
});

export const getSponsorSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
});

export const resetSponsorPasswordSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    new_password: passwordSchema,
    confirm_password: z.string(),
  }).strict().refine((data) => data.new_password === data.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  }),
});
