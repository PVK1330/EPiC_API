import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import express from "express";

// node:test module mocking (run with --experimental-test-module-mocks; see package.json).
// Mock the OAuth + service modules BEFORE importing the controller that uses them.
const oauth = {
  loadTenantMicrosoftConfig: mock.fn(async () => ({})),
  getAuthUrl: mock.fn(() => "https://login.microsoft.com/auth"),
  exchangeCodeForTokens: mock.fn(async () => ({ access_token: "acc", refresh_token: "ref", expires_in: 3600 })),
  getMicrosoftProfile: mock.fn(async () => ({ id: "mid", email: "test@ms.com", name: "Test User" })),
};
const service = {
  saveConnection: mock.fn(async () => true),
  getConnection: mock.fn(async () => null),
  disconnectConnection: mock.fn(async () => true),
};

mock.module("../src/modules/Shared/Integrations/microsoft/microsoft.oauth.js", { namedExports: oauth });
mock.module("../src/modules/Shared/Integrations/microsoft/microsoft.service.js", { namedExports: service });
// createOAuthState persists to the platform DB — mock it so the test needs no DB.
mock.module("../src/services/oauthState.service.js", {
  namedExports: { createOAuthState: mock.fn(async () => "test-state-nonce") },
});

const microsoftController = await import(
  "../src/modules/Shared/Integrations/microsoft/microsoft.controller.js"
);

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.user = { id: 1, role: "caseworker", organisation_id: 1 };
  req.tenantDb = {
    AuditLog: { create: async () => true },
    CaseTimeline: { create: async () => true },
  };
  next();
});
app.get("/api/microsoft/auth-url", microsoftController.getMicrosoftAuthUrl);
app.get("/api/microsoft/callback", microsoftController.getMicrosoftCallback);
app.post("/api/microsoft/disconnect", microsoftController.disconnectMicrosoft);

describe("Microsoft Integration Controller", () => {
  beforeEach(() => {
    oauth.getAuthUrl.mock.resetCalls();
    oauth.getAuthUrl.mock.mockImplementation(() => "https://login.microsoft.com/auth");
    oauth.exchangeCodeForTokens.mock.resetCalls();
    oauth.exchangeCodeForTokens.mock.mockImplementation(async () => ({ access_token: "acc", refresh_token: "ref", expires_in: 3600 }));
    oauth.getMicrosoftProfile.mock.resetCalls();
    oauth.getMicrosoftProfile.mock.mockImplementation(async () => ({ id: "mid", email: "test@ms.com", name: "Test User" }));
    service.saveConnection.mock.resetCalls();
    service.saveConnection.mock.mockImplementation(async () => true);
    service.disconnectConnection.mock.resetCalls();
    service.disconnectConnection.mock.mockImplementation(async () => true);
  });

  it("GET /auth-url returns a valid auth URL", async () => {
    const res = await request(app).get("/api/microsoft/auth-url");
    assert.equal(res.status, 200);
    assert.equal(res.body.authUrl, "https://login.microsoft.com/auth");
  });

  it("GET /callback redirects to error when no code is provided", async () => {
    const res = await request(app).get("/api/microsoft/callback");
    assert.equal(res.status, 302);
    assert.ok(res.header.location.includes("microsoft_error"));
  });

  it("GET /callback saves the connection on success", async () => {
    const res = await request(app).get("/api/microsoft/callback?code=validcode");
    assert.equal(res.status, 302);
    assert.ok(res.header.location.includes("microsoft_success"));
    assert.ok(service.saveConnection.mock.calls.length > 0);
  });

  it("POST /disconnect disconnects and returns success", async () => {
    service.disconnectConnection.mock.mockImplementation(async () => true);
    const res = await request(app).post("/api/microsoft/disconnect");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.disconnected, true);
  });

  it("POST /disconnect returns 404 when not connected", async () => {
    service.disconnectConnection.mock.mockImplementation(async () => false);
    const res = await request(app).post("/api/microsoft/disconnect");
    assert.equal(res.status, 404);
  });
});
