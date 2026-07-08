import test from "node:test";
import assert from "node:assert/strict";

import { createDraft } from "../src/services/licenceApplicationV2.service.js";
import { deriveStageCompletion } from "../src/services/licenceStageTask.service.js";
import { isApplicationEditable } from "../src/modules/Sponsor/Licence/sponsorLicenceV2.controller.js";

test("createDraft blocks reapplication while a rejected licence is still in cooldown", async () => {
  let callCount = 0;
  const tenantDb = {
    sequelize: {
      transaction: async (_opts, cb) => {
        const t = { LOCK: { UPDATE: "UPDATE" } };
        if (typeof _opts === "function") return _opts(t);
        return cb(t);
      },
      constructor: {
        Transaction: {
          ISOLATION_LEVELS: { SERIALIZABLE: "SERIALIZABLE" },
        },
      },
    },
    LicenceApplication: {
      findOne: async () => {
        callCount += 1;
        if (callCount === 1) {
          return null;
        }
        return {
          id: 99,
          status: "Licence Rejected",
          rejectionCooldownUntil: "2099-12-31",
        };
      },
      create: async () => {
        throw new Error("createDraft should not create a new draft while cooldown is active");
      },
    },
  };

  await assert.rejects(
    () => createDraft({ tenantDb, userId: 7, organisationId: 10 }),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.match(err.message, /6 months/i);
      return true;
    },
    "rejected applications should be blocked until the cooldown expires",
  );
});

test("deriveStageCompletion keeps the first stage active for a fresh application", () => {
  const result = deriveStageCompletion({
    status: "Draft",
    submittedAt: null,
    routes: [],
    organisationInfo: null,
    cosRequirements: [],
    appendixDocuments: [],
    authorisingOfficer: null,
    declaration: null,
  });

  assert.equal(result.currentKey, "enquiry_onboarding");
  assert.equal(result.completed.has("enquiry_onboarding"), false);
});

test("isApplicationEditable allows sponsor edits for pending and information-requested states", () => {
  assert.equal(isApplicationEditable("Draft"), true);
  assert.equal(isApplicationEditable("Pending"), true);
  assert.equal(isApplicationEditable("Information Requested"), true);
  assert.equal(isApplicationEditable("Under Review"), true);
  assert.equal(isApplicationEditable("Approved"), false);
  assert.equal(isApplicationEditable("Licence Rejected"), false);
});
