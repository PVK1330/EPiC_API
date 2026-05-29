import request from 'supertest';
import { jest } from '@jest/globals';
import express from 'express';
import * as microsoftController from '../src/modules/Shared/Integrations/microsoft/microsoft.controller.js';
import * as microsoftOauth from '../src/modules/Shared/Integrations/microsoft/microsoft.oauth.js';
import * as microsoftService from '../src/modules/Shared/Integrations/microsoft/microsoft.service.js';

jest.mock('../src/modules/Shared/Integrations/microsoft/microsoft.oauth.js');
jest.mock('../src/modules/Shared/Integrations/microsoft/microsoft.service.js');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.user = { id: 1, role: 'caseworker', organisation_id: 1 };
  req.tenantDb = { 
    AuditLog: { create: jest.fn().mockResolvedValue(true) },
    CaseTimeline: { create: jest.fn().mockResolvedValue(true) }
  };
  next();
});

app.get('/api/microsoft/auth-url', microsoftController.getMicrosoftAuthUrl);
app.get('/api/microsoft/callback', microsoftController.getMicrosoftCallback);
app.post('/api/microsoft/disconnect', microsoftController.disconnectMicrosoft);

describe('Microsoft Integration Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/microsoft/auth-url', () => {
    it('should return a valid auth URL', async () => {
      microsoftOauth.getAuthUrl.mockReturnValue('https://login.microsoft.com/auth');
      const res = await request(app).get('/api/microsoft/auth-url');
      expect(res.status).toBe(200);
      expect(res.body.authUrl).toBe('https://login.microsoft.com/auth');
    });
  });

  describe('GET /api/microsoft/callback', () => {
    it('should redirect to error if no code provided', async () => {
      const res = await request(app).get('/api/microsoft/callback');
      expect(res.status).toBe(302);
      expect(res.header.location).toContain('microsoft_error');
    });

    it('should save connection and create audit log on success', async () => {
      microsoftOauth.exchangeCodeForTokens.mockResolvedValue({ access_token: 'acc', refresh_token: 'ref', expires_in: 3600 });
      microsoftOauth.getMicrosoftProfile.mockResolvedValue({ id: 'mid', email: 'test@ms.com', name: 'Test User' });
      microsoftService.saveConnection.mockResolvedValue(true);

      const res = await request(app).get('/api/microsoft/callback?code=validcode');
      expect(res.status).toBe(302);
      expect(res.header.location).toContain('microsoft_success');
      expect(microsoftService.saveConnection).toHaveBeenCalled();
    });
  });

  describe('POST /api/microsoft/disconnect', () => {
    it('should disconnect and log audit', async () => {
      microsoftService.disconnectConnection.mockResolvedValue(true);
      const res = await request(app).post('/api/microsoft/disconnect');
      expect(res.status).toBe(200);
      expect(res.body.data.disconnected).toBe(true);
    });

    it('should return 404 if not connected', async () => {
      microsoftService.disconnectConnection.mockResolvedValue(false);
      const res = await request(app).post('/api/microsoft/disconnect');
      expect(res.status).toBe(404);
    });
  });
});
