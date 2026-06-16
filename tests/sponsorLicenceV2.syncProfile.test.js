import test from "node:test";
import assert from "node:assert";
import { splitFullName, syncPersonnelFromProfile } from "../src/services/licenceApplicationV2.service.js";

test("splitFullName: splits names correctly", () => {
  const result1 = splitFullName("Jane Smith");
  assert.strictEqual(result1.firstName, "Jane");
  assert.strictEqual(result1.lastName, "Smith");

  const result2 = splitFullName("Jane");
  assert.strictEqual(result2.firstName, "Jane");
  assert.strictEqual(result2.lastName, "");

  const result3 = splitFullName("John Philip Sousa");
  assert.strictEqual(result3.firstName, "John");
  assert.strictEqual(result3.lastName, "Philip Sousa");
});

test("syncPersonnelFromProfile: copies personnel fields from SponsorProfile to application child tables", async () => {
  const application = { id: 36, userId: 42, organisationId: 10 };
  const profile = {
    userId: 42,
    authorisingName: "Jane Smith",
    authorisingEmail: "jane@example.com",
    authorisingPhone: "+44123456",
    keyContactName: "John Doe",
    keyContactEmail: "john@example.com",
    keyContactPhone: "+44654321",
    keyContactDepartment: "HR Manager",
    level1Users: [
      { name: "Sarah Jones", email: "sarah@example.com", phone: "+447700", jobTitle: "Compliance Lead" }
    ]
  };

  const createdAos = [];
  const createdKcs = [];
  let destroyedL1s = false;
  const createdL1s = [];

  const db = {
    LicenceApplication: {
      findByPk: async (id) => {
        assert.strictEqual(id, 36);
        return application;
      },
      findOne: async () => application,
    },
    SponsorProfile: {
      findOne: async ({ where }) => {
        assert.strictEqual(where.userId, 42);
        return profile;
      }
    },
    LicenceAuthorisingOfficer: {
      findOne: async () => null,
      create: async (data) => {
        createdAos.push(data);
        return data;
      }
    },
    LicenceKeyContact: {
      findOne: async () => null,
      create: async (data) => {
        createdKcs.push(data);
        return data;
      }
    },
    LicenceLevel1User: {
      destroy: async ({ where }) => {
        assert.strictEqual(where.licenceApplicationId, 36);
        destroyedL1s = true;
      },
      bulkCreate: async (data) => {
        createdL1s.push(...data);
        return data;
      }
    },
    sequelize: {
      transaction: async (fn) => fn({ LOCK: { UPDATE: "UPDATE" } })
    }
  };

  await syncPersonnelFromProfile(db, 36, 42);

  assert.strictEqual(createdAos.length, 1);
  assert.strictEqual(createdAos[0].firstName, "Jane");
  assert.strictEqual(createdAos[0].lastName, "Smith");
  assert.strictEqual(createdAos[0].email, "jane@example.com");

  assert.strictEqual(createdKcs.length, 1);
  assert.strictEqual(createdKcs[0].firstName, "John");
  assert.strictEqual(createdKcs[0].lastName, "Doe");
  assert.strictEqual(createdKcs[0].jobTitle, "HR Manager");

  assert.ok(destroyedL1s);
  assert.strictEqual(createdL1s.length, 1);
  assert.strictEqual(createdL1s[0].firstName, "Sarah");
  assert.strictEqual(createdL1s[0].lastName, "Jones");
  assert.strictEqual(createdL1s[0].jobTitle, "Compliance Lead");
});
