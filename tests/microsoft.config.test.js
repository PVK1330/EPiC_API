import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveMicrosoftOAuthConfig, MICROSOFT_CALLBACK_PATH } from "../src/modules/Shared/Integrations/microsoft/microsoft.oauth.js";

// Env keys this suite mutates. Cleared before each case and restored exactly
// afterwards (keys that were originally undefined are deleted, not set to "").
const TRACKED = [
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "MICROSOFT_TENANT_ID",
  "MICROSOFT_REDIRECT_URI",
  "MICROSOFT_AUTHORITY",
  "BASE_URL",
  "API_URL",
];

function withEnv(overrides, fn) {
  const saved = Object.fromEntries(TRACKED.map((k) => [k, process.env[k]]));
  try {
    for (const k of TRACKED) delete process.env[k];
    for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
    return fn();
  } finally {
    for (const k of TRACKED) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const CREDS = {
  MICROSOFT_CLIENT_ID: "env-client",
  MICROSOFT_CLIENT_SECRET: "env-secret",
};

describe("resolveMicrosoftOAuthConfig", () => {
  it("falls back to env credentials when no tenant config is supplied", () => {
    withEnv({ ...CREDS, MICROSOFT_REDIRECT_URI: `http://localhost:5000${MICROSOFT_CALLBACK_PATH}` }, () => {
      const config = resolveMicrosoftOAuthConfig(null);
      assert.equal(config.client_id, "env-client");
      assert.equal(config.client_secret, "env-secret");
      assert.equal(config.redirect_uri, `http://localhost:5000${MICROSOFT_CALLBACK_PATH}`);
    });
  });

  it("derives the redirect URI from BASE_URL when MICROSOFT_REDIRECT_URI is unset", () => {
    withEnv({ ...CREDS, BASE_URL: "https://api.example.com/" }, () => {
      const config = resolveMicrosoftOAuthConfig(null);
      assert.equal(config.redirect_uri, `https://api.example.com${MICROSOFT_CALLBACK_PATH}`);
    });
  });

  it("derives the authority from a bare MICROSOFT_TENANT_ID GUID", () => {
    withEnv({ ...CREDS, MICROSOFT_REDIRECT_URI: "http://x/api/microsoft/callback", MICROSOFT_TENANT_ID: "tenant-guid" }, () => {
      const config = resolveMicrosoftOAuthConfig(null);
      assert.equal(config.authority, "https://login.microsoftonline.com/tenant-guid");
    });
  });

  it("defaults to /organizations, never /common (personal accounts cannot use /me/onlineMeetings)", () => {
    withEnv({ ...CREDS, MICROSOFT_REDIRECT_URI: "http://x/api/microsoft/callback" }, () => {
      const config = resolveMicrosoftOAuthConfig(null);
      assert.equal(config.authority, "https://login.microsoftonline.com/organizations");
      assert.ok(!config.authority.endsWith("/common"));
    });
  });

  it("lets a per-organisation tenant_id win over the env authority", () => {
    withEnv({ ...CREDS, MICROSOFT_REDIRECT_URI: "http://x/api/microsoft/callback", MICROSOFT_AUTHORITY: "https://login.microsoftonline.com/env-tenant" }, () => {
      const config = resolveMicrosoftOAuthConfig({ tenant_id: "org-tenant" });
      assert.equal(config.authority, "https://login.microsoftonline.com/org-tenant");
    });
  });

  it("lets per-organisation credentials override the env credentials", () => {
    withEnv({ ...CREDS, MICROSOFT_REDIRECT_URI: "http://x/api/microsoft/callback" }, () => {
      const config = resolveMicrosoftOAuthConfig({
        client_id: "org-client",
        client_secret: "org-secret",
        redirect_uri: "https://org.example.com/api/microsoft/callback",
      });
      assert.equal(config.client_id, "org-client");
      assert.equal(config.client_secret, "org-secret");
      assert.equal(config.redirect_uri, "https://org.example.com/api/microsoft/callback");
    });
  });

  it("returns null when the configuration is incomplete", () => {
    withEnv({ MICROSOFT_CLIENT_ID: "only-id" }, () => {
      assert.equal(resolveMicrosoftOAuthConfig(null), null);
    });
  });
});
