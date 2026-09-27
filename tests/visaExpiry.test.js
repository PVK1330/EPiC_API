// Phase 2 UAT 3.1 / 3.2 — visa expiry alert window + target-date warning. DB-free.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  targetDateVisaWarning,
  getVisaExpiryAlertDays,
  setVisaExpiryAlertDays,
  DEFAULT_VISA_EXPIRY_ALERT_DAYS,
  buildTargetDateWarnings,
} from "../src/services/visaExpiry.service.js";

test("warns only when the target date is AFTER the visa expiry (the client's 21 Oct vs 30 Sept example)", () => {
  assert.match(targetDateVisaWarning("2026-10-21", "2026-09-30"), /after the client's visa expiry/);
  assert.equal(targetDateVisaWarning("2026-09-30", "2026-09-30"), null, "same day is fine");
  assert.equal(targetDateVisaWarning("2026-09-01", "2026-09-30"), null);
  assert.equal(targetDateVisaWarning("2026-10-21", null), null, "no expiry → no warning");
  assert.equal(targetDateVisaWarning(null, "2026-09-30"), null);
  assert.equal(targetDateVisaWarning(new Date("2026-10-21T10:00:00Z"), new Date("2026-09-30T00:00:00Z")) !== null, true);
});

test("alert window: stored value, default fallback, and validation", async () => {
  let row = { visa_expiry_alert_days: 60, update: async (v) => Object.assign(row, v) };
  const db = { SlaSetting: { findOne: async () => row, create: async () => row } };
  assert.equal(await getVisaExpiryAlertDays(db), 60);
  assert.equal(await getVisaExpiryAlertDays({}), DEFAULT_VISA_EXPIRY_ALERT_DAYS);
  assert.equal(await getVisaExpiryAlertDays({ SlaSetting: { findOne: async () => null } }), DEFAULT_VISA_EXPIRY_ALERT_DAYS);
  assert.equal(await setVisaExpiryAlertDays(db, 120), 120);
  assert.equal(row.visa_expiry_alert_days, 120);
  for (const bad of [0, -5, 400, 1.5, "abc", null]) {
    await assert.rejects(() => setVisaExpiryAlertDays(db, bad), /between 1 and 365/);
  }
});

test("case warnings use the case's own expiry first, then the client's application", async () => {
  const db = { CandidateApplication: { findOne: async () => ({ visaEndDate: "2026-09-30" }) } };
  assert.equal((await buildTargetDateWarnings(db, { candidateId: 1, targetSubmissionDate: "2026-10-21" })).length, 1);
  assert.equal(
    (await buildTargetDateWarnings(db, { candidateId: 1, caseVisaEndDate: "2026-12-31", targetSubmissionDate: "2026-10-21" })).length,
    0,
    "case-specific expiry wins",
  );
});
