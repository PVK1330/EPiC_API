// BUG-017 / Phase 2 UAT: a case is assigned to ONE caseworker only.
// Pure unit test (no database) for the shared guard used by every case write path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { singleCaseworkerError, SINGLE_CASEWORKER_MESSAGE } from "../src/utils/case.utils.js";

test("no caseworker is allowed (caller decides the default)", () => {
  assert.equal(singleCaseworkerError(undefined), null);
  assert.equal(singleCaseworkerError(null), null);
  assert.equal(singleCaseworkerError(""), null);
  assert.equal(singleCaseworkerError([]), null);
});

test("exactly one caseworker is allowed", () => {
  assert.equal(singleCaseworkerError(5), null);
  assert.equal(singleCaseworkerError("5"), null);
  assert.equal(singleCaseworkerError([5]), null);
});

test("the same caseworker repeated counts once", () => {
  assert.equal(singleCaseworkerError([5, "5", 5]), null);
  assert.equal(singleCaseworkerError([5, null, ""]), null);
});

test("two or more different caseworkers are rejected", () => {
  assert.equal(singleCaseworkerError([5, 6]), SINGLE_CASEWORKER_MESSAGE);
  assert.equal(singleCaseworkerError(["5", "6", "7"]), SINGLE_CASEWORKER_MESSAGE);
});
