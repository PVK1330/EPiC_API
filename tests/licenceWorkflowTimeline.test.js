// Tests: cross-entity licence workflow timeline builder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkflowEvents, ACTOR_ROLES } from "../src/services/licenceWorkflowTimeline.service.js";

// A full set of sources covering all 9 required events, deliberately out of order.
const sources = {
  licenceAudits: [
    { id: 1, action: "submit",          newStatus: "Submitted",           notes: null,             createdAt: "2026-01-01T09:00:00Z", actorName: "Acme Sponsor" },
    { id: 2, action: "request_info",    newStatus: "Information Requested", notes: "Need accounts", createdAt: "2026-01-03T09:00:00Z", actorName: "Cara Case" },
    { id: 3, action: "info_responded",  newStatus: "Under Review",          notes: "Uploaded",      createdAt: "2026-01-04T09:00:00Z", actorName: "Acme Sponsor" },
    { id: 4, action: "review_started",  newStatus: "Under Review",          notes: null,            createdAt: "2026-01-05T09:00:00Z", actorName: "Cara Case" },
    { id: 5, action: "licence_granted", newStatus: "Licence Granted",       notes: "Approved A",    createdAt: "2026-01-10T09:00:00Z", actorName: "Adam Admin" },
  ],
  cosRequests:    [{ id: 11, status: "Pending", reason: "2 devs", visaType: "Skilled Worker", requestedAmount: 2, createdAt: "2026-01-12T09:00:00Z", actorName: "Acme Sponsor" }],
  cosAllocations: [{ id: 21, notes: "Granted 2", visaType: "Skilled Worker", allocatedAmount: 2, allocatedAt: "2026-01-14T09:00:00Z", actorName: "Adam Admin" }],
  workerAudits: [
    { id: 31, action: "created",      toStatus: "CoS Assigned",  notes: null, createdAt: "2026-01-16T09:00:00Z", actorName: "Adam Admin", workerName: "Ravi Kumar" },
    { id: 32, action: "visa_granted", toStatus: "Visa Granted",  notes: null, createdAt: "2026-01-20T09:00:00Z", actorName: "Cole Comply", workerName: "Ravi Kumar" },
    { id: 33, action: "stage_advanced", toStatus: "Visa Preparation", notes: null, createdAt: "2026-01-18T09:00:00Z", actorName: "Cole Comply", workerName: "Ravi Kumar" },
  ],
};

test("emits all 9 required workflow events", () => {
  const events = buildWorkflowEvents(sources);
  const keys = events.map((e) => e.eventKey);
  for (const expected of [
    "application_submitted", "information_requested", "information_received",
    "under_review", "licence_granted", "cos_requested", "cos_allocated",
    "worker_created", "visa_granted",
  ]) {
    assert.ok(keys.includes(expected), `missing event: ${expected}`);
  }
});

test("ignores unrecognised worker audit actions (only milestones surface)", () => {
  const events = buildWorkflowEvents(sources);
  assert.ok(!events.some((e) => e.eventKey === "stage_advanced"), "stage_advanced must not appear");
});

test("orders events chronologically (oldest first)", () => {
  const events = buildWorkflowEvents(sources);
  const times = events.map((e) => new Date(e.timestamp).getTime());
  const sorted = [...times].sort((a, b) => a - b);
  assert.deepEqual(times, sorted);
  assert.equal(events[0].eventKey, "application_submitted");
  assert.equal(events[events.length - 1].eventKey, "visa_granted");
});

test("assigns each event to the correct actor swim-lane", () => {
  const events = buildWorkflowEvents(sources);
  const byKey = Object.fromEntries(events.map((e) => [e.eventKey, e.actorRole]));
  assert.equal(byKey.application_submitted, "Sponsor");
  assert.equal(byKey.information_requested, "Caseworker");
  assert.equal(byKey.information_received, "Sponsor");
  assert.equal(byKey.under_review, "Caseworker");
  assert.equal(byKey.licence_granted, "Admin");
  assert.equal(byKey.cos_requested, "Sponsor");
  assert.equal(byKey.cos_allocated, "Admin");
  assert.equal(byKey.worker_created, "Admin");
  assert.equal(byKey.visa_granted, "Compliance");
  // Every actor role used must be one of the four declared swim-lanes.
  for (const e of events) assert.ok(ACTOR_ROLES.includes(e.actorRole));
});

test("carries actor name, status and comment onto each event", () => {
  const events = buildWorkflowEvents(sources);
  const info = events.find((e) => e.eventKey === "information_requested");
  assert.equal(info.actorName, "Cara Case");
  assert.equal(info.status, "Information Requested");
  assert.equal(info.comment, "Need accounts");

  const visa = events.find((e) => e.eventKey === "visa_granted");
  assert.match(visa.comment, /Ravi Kumar/); // worker name flows into the comment
});

test("unknown licence actions fall back to a humanised label rather than being dropped", () => {
  const events = buildWorkflowEvents({
    licenceAudits: [{ id: 99, action: "credentials_generated", newStatus: "Government Processing", notes: null, createdAt: "2026-02-01T00:00:00Z", actorName: "Cara Case" }],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "Credentials Generated");
});

test("empty input yields an empty timeline (no application yet)", () => {
  assert.deepEqual(buildWorkflowEvents({}), []);
  assert.deepEqual(buildWorkflowEvents(), []);
});
