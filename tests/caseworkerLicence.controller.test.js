import test from "node:test";
import assert from "node:assert/strict";

import { getAssignedLicenceApplications } from "../src/modules/Caseworker/caseworkerLicence.controller.js";

test("getAssignedLicenceApplications includes document labels for caseworker review screens", async () => {
  const application = {
    id: 42,
    documents: ["uploads/legacy-file.pdf"],
    assignedcaseworkerId: [7],
    toJSON() {
      return {
        id: 42,
        documents: ["uploads/legacy-file.pdf"],
        assignedcaseworkerId: [7],
      };
    },
  };

  const tenantDb = {
    LicenceApplication: {
      findAndCountAll: async () => ({ rows: [application], count: 1 }),
    },
    LicenceGovernmentTracking: {},
    LicenceAppendixDocument: {
      findAll: async () => [
        { filePath: "uploads/required-doc.pdf", documentName: "Sponsor Letter" },
      ],
    },
  };

  const req = {
    user: { userId: 7 },
    tenantDb,
    query: {},
  };

  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  await getAssignedLicenceApplications(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data[0].documentNames, ["legacy-file.pdf", "Sponsor Letter"]);
});
