import test from "node:test";
import assert from "node:assert";
import { createSponsoredWorker } from "../src/services/sponsoredWorker.service.js";

function makeMockDb() {
  return {
    SponsoredWorker: {
      create: async (data) => ({ id: 999, ...data }),
    },
    SponsoredWorkerAudit: {
      create: async () => {},
    },
  };
}

test("createSponsoredWorker email validation: valid email succeeds", async () => {
  const db = makeMockDb();
  const worker = await createSponsoredWorker(db, {
    sponsorId: 10,
    workerFirstName: "John",
    workerLastName: "Doe",
    workerEmail: "john.doe@example.com",
  }, 1);

  assert.strictEqual(worker.workerEmail, "john.doe@example.com");
});

test("createSponsoredWorker email validation: invalid email format throws 400", async () => {
  const db = makeMockDb();
  await assert.rejects(
    () => createSponsoredWorker(db, {
      sponsorId: 10,
      workerFirstName: "John",
      workerLastName: "Doe",
      workerEmail: "invalid-email-address",
    }, 1),
    (err) => {
      assert.strictEqual(err.statusCode, 400);
      assert.ok(err.message.includes("Invalid worker email format"));
      return true;
    }
  );
});

test("createSponsoredWorker email validation: null/undefined/empty email is skipped and succeeds", async () => {
  const db = makeMockDb();
  
  const workerNull = await createSponsoredWorker(db, {
    sponsorId: 10,
    workerFirstName: "John",
    workerLastName: "Doe",
    workerEmail: null,
  }, 1);
  assert.strictEqual(workerNull.workerEmail, null);

  const workerUndefined = await createSponsoredWorker(db, {
    sponsorId: 10,
    workerFirstName: "John",
    workerLastName: "Doe",
    workerEmail: undefined,
  }, 1);
  assert.strictEqual(workerUndefined.workerEmail, null);

  const workerEmpty = await createSponsoredWorker(db, {
    sponsorId: 10,
    workerFirstName: "John",
    workerLastName: "Doe",
    workerEmail: "",
  }, 1);
  assert.strictEqual(workerEmpty.workerEmail, "");
});
