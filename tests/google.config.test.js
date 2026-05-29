import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveGoogleOAuthConfig } from "../src/modules/Shared/Integrations/google/google.config.js";

test("resolveGoogleOAuthConfig uses env when tenant block is empty", () => {
  const prev = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    BASE_URL: process.env.BASE_URL,
  };

  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:5000/api/google/callback";
  process.env.BASE_URL = "http://localhost:5000";

  const config = resolveGoogleOAuthConfig({});
  assert.equal(config.client_id, "test-client-id");
  assert.equal(config.redirect_uri, "http://localhost:5000/api/google/callback");

  Object.assign(process.env, prev);
});

test("resolveGoogleOAuthConfig fills missing tenant fields from env", () => {
  const prev = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
  };

  process.env.GOOGLE_CLIENT_ID = "env-id";
  process.env.GOOGLE_CLIENT_SECRET = "env-secret";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:5000/api/google/callback";

  const config = resolveGoogleOAuthConfig({
    client_id: "tenant-id",
    client_secret: "",
    redirect_uri: "",
  });

  assert.equal(config.client_id, "tenant-id");
  assert.equal(config.client_secret, "env-secret");
  assert.equal(config.redirect_uri, "http://localhost:5000/api/google/callback");

  Object.assign(process.env, prev);
});
