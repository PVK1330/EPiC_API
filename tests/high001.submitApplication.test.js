import test from "node:test";
import assert from "node:assert";
import { submitApplication } from "../src/services/licenceApplicationV2.service.js";

// Mock DB helper
function mockDb(applicationData, sponsorProfileData = null) {
  return {
    LicenceApplication: {
      findOne: async () => ({
        ...applicationData,
        routes: applicationData.routes || [],
        cosRequirements: applicationData.cosRequirements || [],
        authorisingOfficer: applicationData.authorisingOfficer || {},
        keyContact: applicationData.keyContact || {},
        organisationInfo: applicationData.organisationInfo || {},
      }),
    },
    SponsorProfile: {
      findOne: async () => sponsorProfileData,
    },
    LicenceApplicationRoute: {},
    LicenceOrganisationInfo: {},
    LicenceCosRequirement: {},
    LicenceAppendixDocument: {},
    LicenceAuthorisingOfficer: {},
    LicenceKeyContact: {},
    LicenceLevel1User: {},
    LicenceDeclaration: {},
    User: {},
  };
}

test("submitApplication: Draft -> Pending succeeds", async () => {
  const application = {
    id: 123,
    userId: 42,
    status: "Draft",
    update: async (fields) => {
      application.status = fields.status;
      return application;
    },
  };

  const db = mockDb(application);
  const result = await submitApplication({ tenantDb: db, application });
  assert.strictEqual(application.status, "Pending");
  assert.ok(result);
});

test("submitApplication: Under Review -> Pending is blocked (422)", async () => {
  const application = {
    id: 123,
    userId: 42,
    status: "Under Review",
    update: async (fields) => {
      application.status = fields.status;
      return application;
    },
  };

  const db = mockDb(application);
  await assert.rejects(
    async () => {
      await submitApplication({ tenantDb: db, application });
    },
    (err) => {
      assert.strictEqual(err.statusCode, 422);
      assert.ok(err.message.includes("Invalid transition"));
      return true;
    }
  );
});

test("submitApplication: Licence Granted -> Pending is blocked (422)", async () => {
  const application = {
    id: 123,
    userId: 42,
    status: "Licence Granted",
    update: async (fields) => {
      application.status = fields.status;
      return application;
    },
  };

  const db = mockDb(application);
  await assert.rejects(
    async () => {
      await submitApplication({ tenantDb: db, application });
    },
    (err) => {
      assert.strictEqual(err.statusCode, 422);
      assert.ok(err.message.includes("Invalid transition"));
      return true;
    }
  );
});
