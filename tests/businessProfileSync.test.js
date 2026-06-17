// Tests: sync from Business Profile stamps provenance and imports company reg.
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncPersonnelFromProfile, syncFromBusinessProfile } from "../src/services/licenceApplicationV2.service.js";

const USER_ID = 123;

// Builds a mock tenantDb that records what the sync writes. `orgInfoExisting`
// lets a test simulate an application that already has a Companies House number.
function buildMockDb({ profile, orgInfoExisting = null } = {}) {
  const captured = { ao: null, kc: null, level1: null, orgCreate: null, orgUpdate: null };

  const recorder = (slot) => ({
    findOne: async () => null,
    create: async (data) => { captured[slot] = data; return data; },
  });

  return {
    captured,
    Sequelize: {},
    sequelize: { transaction: async (cb) => cb({}) },
    LicenceApplication: {
      findByPk: async () => ({ id: 1, organisationId: 9 }),
      // loadFullApplication() at the end of the sync calls findOne — return a stub.
      findOne: async () => ({ id: 1, toJSON: () => ({ id: 1 }) }),
    },
    SponsorProfile: { findOne: async () => profile },
    LicenceAuthorisingOfficer: recorder("ao"),
    LicenceKeyContact: recorder("kc"),
    LicenceLevel1User: {
      destroy: async () => 1,
      bulkCreate: async (rows) => { captured.level1 = rows; return rows; },
    },
    LicenceOrganisationInfo: {
      findOne: async () => orgInfoExisting,
      create: async (data) => { captured.orgCreate = data; return data; },
    },
  };
}

const fullProfile = {
  authorisingName: "Jane Doe",
  authorisingEmail: "jane@co.uk",
  authorisingPhone: "0700",
  keyContactName: "Sam Lee",
  keyContactEmail: "sam@co.uk",
  keyContactPhone: "0711",
  keyContactDepartment: "HR",
  level1Users: [{ name: "Amy Ng", email: "amy@co.uk", phone: "0722", jobTitle: "Ops" }],
  registrationNumber: "12345678",
};

test("syncFromBusinessProfile is an alias of syncPersonnelFromProfile", () => {
  assert.equal(syncFromBusinessProfile, syncPersonnelFromProfile);
});

test("stamps lastSyncedAt + lastSyncedByUserId on AO, KC and Level 1 rows", async () => {
  const db = buildMockDb({ profile: fullProfile });
  await syncPersonnelFromProfile(db, 1, USER_ID);

  for (const row of [db.captured.ao, db.captured.kc]) {
    assert.ok(row.lastSyncedAt instanceof Date, "lastSyncedAt must be set");
    assert.equal(row.lastSyncedByUserId, USER_ID);
  }
  assert.equal(db.captured.level1.length, 1);
  assert.ok(db.captured.level1[0].lastSyncedAt instanceof Date);
  assert.equal(db.captured.level1[0].lastSyncedByUserId, USER_ID);
});

test("splits full names into first/last when importing", async () => {
  const db = buildMockDb({ profile: fullProfile });
  await syncPersonnelFromProfile(db, 1, USER_ID);
  assert.equal(db.captured.ao.firstName, "Jane");
  assert.equal(db.captured.ao.lastName, "Doe");
  assert.equal(db.captured.kc.jobTitle, "HR");
  assert.equal(db.captured.level1[0].firstName, "Amy");
  assert.equal(db.captured.level1[0].lastName, "Ng");
});

test("imports company registration number into a new org-info row", async () => {
  const db = buildMockDb({ profile: fullProfile });
  await syncPersonnelFromProfile(db, 1, USER_ID);
  assert.equal(db.captured.orgCreate.companiesHouseNumber, "12345678");
  assert.ok(db.captured.orgCreate.lastSyncedAt instanceof Date);
});

test("does NOT overwrite an existing Companies House number (non-destructive)", async () => {
  let patch = null;
  const existingOrg = {
    companiesHouseNumber: "EXISTING99",
    update: async (p) => { patch = p; },
  };
  const db = buildMockDb({ profile: fullProfile, orgInfoExisting: existingOrg });
  await syncPersonnelFromProfile(db, 1, USER_ID);

  assert.equal(patch.companiesHouseNumber, undefined, "must not clobber an existing CH number");
  assert.ok(patch.lastSyncedAt instanceof Date, "but still stamps the sync time");
  assert.equal(patch.lastSyncedByUserId, USER_ID);
});

test("no Business Profile → no writes (existing applications untouched)", async () => {
  const db = buildMockDb({ profile: null });
  await syncPersonnelFromProfile(db, 1, USER_ID);
  assert.equal(db.captured.ao, null);
  assert.equal(db.captured.kc, null);
  assert.equal(db.captured.level1, null);
  assert.equal(db.captured.orgCreate, null);
});
