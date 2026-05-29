import request from 'supertest';
import { jest } from '@jest/globals';
import express from 'express';
import { handleWebhook } from '../src/modules/Candidate/Payments/stripepayment.controller.js';
import * as stripeTenantService from '../src/services/stripeTenant.service.js';
import platformDb from '../src/models/index.js';

// Mock dependencies
jest.mock('../src/services/stripeTenant.service.js');
jest.mock('../src/models/index.js', () => ({
  StripeWebhookEvent: {
    findOne: jest.fn(),
    create: jest.fn(),
  },
  PaymentWebhookRetryQueue: {
    create: jest.fn(),
  },
}));

const app = express();
app.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

describe('Stripe Webhook Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 400 if signature verification fails', async () => {
    stripeTenantService.constructStripeWebhookEvent.mockRejectedValueOnce(new Error('Invalid signature'));
    
    const res = await request(app)
      .post('/webhook')
      .set('stripe-signature', 'invalid-sig')
      .send(Buffer.from(JSON.stringify({ type: 'customer.created' })));

    expect(res.status).toBe(400);
    expect(res.text).toContain('Webhook Error: Invalid signature');
  });

  it('should ignore duplicate webhooks for idempotency', async () => {
    const mockEvent = { id: 'evt_duplicate123', type: 'customer.created' };
    stripeTenantService.constructStripeWebhookEvent.mockResolvedValueOnce(mockEvent);
    stripeTenantService.resolveTenantDbFromStripeObject.mockResolvedValueOnce({ tenantDb: null, organisationId: 1 });
    
    // Simulate finding an existing event
    platformDb.StripeWebhookEvent.findOne.mockResolvedValueOnce({ id: 1, event_id: 'evt_duplicate123' });

    const res = await request(app)
      .post('/webhook')
      .set('stripe-signature', 'valid-sig')
      .send(Buffer.from(JSON.stringify(mockEvent)));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, duplicate: true });
    expect(platformDb.StripeWebhookEvent.create).not.toHaveBeenCalled();
  });

  it('should push to retry queue if processing fails', async () => {
    const mockEvent = { id: 'evt_fail456', type: 'charge.refunded', data: { object: {} } };
    stripeTenantService.constructStripeWebhookEvent.mockResolvedValueOnce(mockEvent);
    stripeTenantService.resolveTenantDbFromStripeObject.mockResolvedValueOnce({ tenantDb: null, organisationId: 1 });
    
    // Simulate no duplicate
    platformDb.StripeWebhookEvent.findOne.mockResolvedValueOnce(null);

    // Mock the record creation
    const mockRecord = { save: jest.fn() };
    platformDb.StripeWebhookEvent.create.mockResolvedValueOnce(mockRecord);

    // Force an error inside the handler by mocking tenantDb.CaseTimeline.create to throw
    const mockTenantDb = {
      AuditLog: { create: jest.fn().mockRejectedValueOnce(new Error('DB Connection Failed')) },
    };
    stripeTenantService.resolveTenantDbFromStripeObject.mockReset();
    stripeTenantService.resolveTenantDbFromStripeObject.mockResolvedValueOnce({ tenantDb: mockTenantDb, organisationId: 1 });
    mockEvent.data.object = { metadata: { userId: '1' }, amount_refunded: 5000, id: 'ch_123' };

    const res = await request(app)
      .post('/webhook')
      .set('stripe-signature', 'valid-sig')
      .send(Buffer.from(JSON.stringify(mockEvent)));

    expect(res.status).toBe(200); // Must return 200 to Stripe
    expect(res.body).toEqual({ received: true, queued_for_retry: true });
    
    // Ensure it updated status to failed
    expect(mockRecord.processing_status).toBe('failed');
    
    // Ensure it was added to retry queue
    expect(platformDb.PaymentWebhookRetryQueue.create).toHaveBeenCalledWith(expect.objectContaining({
      event_id: 'evt_fail456',
      error_reason: 'DB Connection Failed'
    }));
  });
});
