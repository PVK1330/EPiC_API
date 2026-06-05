import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getCclTagRegistry,
  interpolateCclHtml,
  amountToWords,
  formatGbp,
  renderInstallmentPlanHtml,
} from "../src/services/cclTags.service.js";
import {
  VISA_DOCUMENT_CHECKLISTS,
  deriveIsRequired,
  deriveCategory,
} from "../src/constants/visaDocumentChecklists.js";
import {
  generateCclHtmlForCase,
  renderCclPdfBuffer,
} from "../src/services/cclGenerator.service.js";

test("tag registry exposes grouped tags", () => {
  const reg = getCclTagRegistry();
  assert.ok(Array.isArray(reg.tags) && reg.tags.length > 0);
  for (const g of ["Organisation", "Candidate", "Case", "Fees"]) {
    assert.ok(reg.groups[g]?.length > 0, `missing group ${g}`);
  }
});

test("interpolation fills known tags and drops unknown ones", () => {
  const out = interpolateCclHtml("Dear {{candidate_name}}, ref {{case_ref}}. {{nope}}", {
    candidate_name: "Jane Doe",
    case_ref: "EPIC-1",
  });
  assert.equal(out, "Dear Jane Doe, ref EPIC-1. ");
});

test("amountToWords handles pounds and pence", () => {
  assert.equal(amountToWords(1500), "One thousand five hundred pounds");
  assert.equal(amountToWords(1500.5), "One thousand five hundred pounds and fifty pence");
  assert.equal(amountToWords(1), "One pound");
});

test("formatGbp formats currency", () => {
  assert.equal(formatGbp(1500), "£1,500.00");
  assert.equal(formatGbp(-5), "£0.00");
});

test("installment table renders rows", () => {
  const html = renderInstallmentPlanHtml([
    { label: "Deposit", amount: 500, dueDate: null },
    { label: "Balance", amount: 1000, dueDate: "2026-07-01" },
  ]);
  assert.match(html, /<table/);
  assert.match(html, /Deposit/);
  assert.match(html, /£1,000\.00/);
  assert.equal(renderInstallmentPlanHtml([]), "");
});

test("checklist data: 9 groups and sensible required/category parsing", () => {
  assert.equal(VISA_DOCUMENT_CHECKLISTS.length, 9);
  assert.equal(deriveIsRequired("Passport copy"), true);
  assert.equal(deriveIsRequired("ATAS certificate (if applicable)"), false);
  assert.equal(deriveCategory("Last 6 months' bank statements"), "financial");
  assert.equal(deriveCategory("Certificate of Sponsorship (CoS)"), "work");
  assert.equal(deriveCategory("Tuberculosis certificate (if applicable)"), "medical");
});

test("generateCclHtmlForCase: per-case draft takes precedence", async () => {
  const res = await generateCclHtmlForCase({
    tenantDb: { CclTemplate: { findOne: async () => null } },
    caseRecord: { id: 1, visaTypeId: 1 },
    ccl: { draftHtml: "<p>EDITED</p>" },
  });
  assert.equal(res.source, "draft");
  assert.equal(res.html, "<p>EDITED</p>");
});

test("generateCclHtmlForCase: no template → null (caller falls back)", async () => {
  const res = await generateCclHtmlForCase({
    tenantDb: { CclTemplate: { findOne: async () => null }, Organisation: { findOne: async () => null } },
    caseRecord: { id: 1, visaTypeId: 1 },
    ccl: {},
  });
  assert.equal(res.source, "none");
  assert.equal(res.html, null);
});

test("renderCclPdfBuffer produces a valid PDF", async () => {
  const buf = await renderCclPdfBuffer({
    html: "<h2>CCL</h2><p>Dear Jane Doe,</p>",
    organisation: { name: "Elite Immigration Ltd", logoUrl: null },
  });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 1000);
  assert.equal(buf.slice(0, 5).toString("latin1"), "%PDF-");
});
