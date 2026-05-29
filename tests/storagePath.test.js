import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeStorageRelativePath } from "../src/utils/storagePath.util.js";
import { toPublicAssetUrl } from "../src/services/stripeTenant.service.js";

test("normalizeStorageRelativePath strips absolute Windows paths", () => {
  const input =
    "C:/Users/dev/EPiC_API/Server/storage/private/organisations/uuid_123.png";
  assert.equal(
    normalizeStorageRelativePath(input),
    "storage/private/organisations/uuid_123.png",
  );
});

test("toPublicAssetUrl maps storage path to public images URL", () => {
  process.env.BASE_URL = "http://localhost:5000";
  const result = toPublicAssetUrl(
    "storage/private/organisations/uuid_123.png",
  );
  assert.equal(result, "http://localhost:5000/api/public/images/uuid_123.png");
});
