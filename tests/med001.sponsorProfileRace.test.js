import test from "node:test";
import assert from "node:assert";
import { getProfile } from "../src/modules/Sponsor/Account/sponsorAccount.controller.js";

// Mock response builder
function mockRes() {
  const res = {
    statusCode: 200,
    sentData: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.sentData = data;
      return this;
    },
  };
  return res;
}

test("getProfile: uses findOrCreate to fetch/create profile and preference when missing", async () => {
  let findOrCreateProfileCalled = false;
  let findOrCreatePrefCalled = false;

  const mockUser = {
    id: 42,
    sponsorProfile: null,
    sponsorPreferences: null,
    toJSON() {
      return { id: 42 };
    },
  };

  const req = {
    user: { userId: 42 },
    tenantDb: {
      User: {
        findOne: async () => mockUser,
      },
      SponsorProfile: {
        findOrCreate: async ({ where, defaults }) => {
          findOrCreateProfileCalled = true;
          assert.strictEqual(where.userId, 42);
          assert.strictEqual(defaults.userId, 42);
          return [{ id: 100, userId: 42 }, true];
        },
      },
      SponsorUserPreference: {
        findOrCreate: async ({ where, defaults }) => {
          findOrCreatePrefCalled = true;
          assert.strictEqual(where.userId, 42);
          assert.strictEqual(defaults.userId, 42);
          return [{ id: 200, userId: 42 }, true];
        },
      },
    },
  };

  const res = mockRes();
  await getProfile(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.ok(findOrCreateProfileCalled);
  assert.ok(findOrCreatePrefCalled);
  assert.strictEqual(res.sentData.status, "success");
  assert.strictEqual(res.sentData.data.profile.id, 100);
  assert.strictEqual(res.sentData.data.preferences.id, 200);
});
