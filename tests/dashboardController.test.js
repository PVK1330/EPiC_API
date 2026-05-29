import test from 'node:test';
import assert from 'node:assert';
import { PassThrough } from 'node:stream';
import {
  testPdfGeneration,
  exportDashboardPDF,
} from '../src/modules/Admin/Dashboard/dashboard.controller.js';

function createMockResponse() {
  const res = {
    headers: {},
    statusCode: 200,
    sent: null,
    status(status) {
      this.statusCode = status;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
    send(payload) {
      this.sent = payload;
      return this;
    },
    json(payload) {
      this.sent = payload;
      return this;
    },
  };
  return res;
}

test('testPdfGeneration returns a valid PDF response', async () => {
  const req = {};
  const res = createMockResponse();
  await testPdfGeneration(req, res, (err) => {
    if (err) throw err;
  });

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['Content-Type'], 'application/pdf');
  assert.ok(res.sent instanceof Buffer, 'Expected PDF response buffer');
  assert.ok(res.sent.length > 0, 'Expected non-empty PDF buffer');
});

test('exportDashboardPDF returns 401 when user is not authenticated', async () => {
  const req = { user: null };
  const res = createMockResponse();
  await exportDashboardPDF(req, res, (err) => {
    if (err) throw err;
  });

  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.sent.status, 'error');
  assert.strictEqual(res.sent.message, 'Authentication required');
});

test('exportDashboardPDF returns 500 when tenant database is missing', async () => {
  const req = { user: { userId: 1 } };
  const res = createMockResponse();
  await exportDashboardPDF(req, res, (err) => {
    if (err) throw err;
  });

  assert.strictEqual(res.statusCode, 500);
  assert.strictEqual(res.sent.status, 'error');
  assert.strictEqual(res.sent.message, 'Tenant database not initialized');
});

test('exportDashboardPDF generates PDF when tenantDb is provided', async () => {
  const req = {
    user: { userId: 1 },
    tenantDb: {
      sequelize: {
        fn: () => ['COUNT', '*'],
      },
      Case: {
        count: async () => 1,
        findAll: async () => [{ status: 'Pending', count: 1 }],
      },
      Task: {
        count: async () => 2,
        findAll: async () => [{ priority: 'High', count: 1 }],
      },
      Escalation: {
        findAll: async () => [{ caseId: 'CASE-1', triggerType: 'Delay', severity: 'High', status: 'Open', created_at: new Date() }],
      },
      User: {
        findAll: async () => [{ id: 10, first_name: 'John', last_name: 'Smith' }],
      },
    },
  };

  const res = createMockResponse();
  await exportDashboardPDF(req, res, (err) => {
    if (err) throw err;
  });

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['Content-Type'], 'application/pdf');
  assert.ok(res.sent instanceof Buffer, 'Expected PDF response buffer');
  assert.ok(res.sent.length > 0, 'Expected non-empty PDF buffer');
});
