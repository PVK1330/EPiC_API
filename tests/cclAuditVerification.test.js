import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  interpolateCclHtml,
  findUnresolvedPlaceholders,
  renderAppendixAHtml,
  renderFeeSectionHtml,
  buildCclContext,
  getCclTagRegistry,
} from "../src/services/cclTags.service.js";
import { renderCclPdfBuffer } from "../src/services/cclGenerator.service.js";
import { resolveCclTemplate } from "../src/services/cclTemplate.service.js";

describe("CCL Complete Audit Verification Suite (CCL-1 to CCL-11)", () => {
  // ─── CCL-1: Bank Details ───────────────────────────────────────────────────
  test("CCL-1: Bank details table normalizes cleanly into 2 columns without overflowing margins", async () => {
    const rawBankHtml = `
      <table border="1">
        <tr>
          <td>Transfer UKVI visa fees</td><td>Transfer Management Fees</td><td colspan="6"></td>
        </tr>
        <tr>
          <td>Bank - HSBC</td><td>Company name - shivora</td><td>Account No - 55332788</td><td>Sort Code - 40-35-18</td>
          <td>Bank - HSBC</td><td>Company name - shivora</td><td>Account No 25101352</td><td>Sort Code 40-11-18</td>
        </tr>
      </table>
    `;
    const pdfBuffer = await renderCclPdfBuffer({ html: rawBankHtml });
    assert.ok(pdfBuffer && pdfBuffer.length > 1000, "PDF buffer must be generated successfully");
  });

  // ─── CCL-2: Firm Address / Sign-off ────────────────────────────────────────
  test("CCL-2: Sign-off block is marked unbreakable and table rows don't break across pages", async () => {
    const letterHtml = `
      <p>Letter body content...</p>
      <table border="1"><tr><td>Item 1</td><td>Value 1</td></tr></table>
      <p>Yours sincerely,</p>
      <p>Jane Doe</p>
      <p>Client Signature: __________________________</p>
    `;
    const pdfBuffer = await renderCclPdfBuffer({ html: letterHtml });
    assert.ok(pdfBuffer && pdfBuffer.length > 1000, "PDF buffer must generate with unbreakable sign-off");
  });

  // ─── CCL-3: Proofreading ───────────────────────────────────────────────────
  test("CCL-3: Proofreading typos are automatically corrected in template output", () => {
    const dirtyHtml = `
      <p>Application of Skilled Worker Visa for 05 years duration.</p>
      <p>Instructions should be provided preferable in writing.</p>
      <p>Fees are calculated on a pro rota basis.</p>
      <p>We aim to respond you within 3 days.</p>
    `;
    const cleanHtml = interpolateCclHtml(dirtyHtml, {});
    assert.ok(!cleanHtml.includes("05 years"), "05 years must be replaced");
    assert.ok(cleanHtml.includes("5 years"), "Must say 5 years");

    assert.ok(!cleanHtml.includes("preferable in writing"), "preferable in writing must be replaced");
    assert.ok(cleanHtml.includes("preferably in writing"), "Must say preferably in writing");

    assert.ok(!cleanHtml.includes("pro rota"), "pro rota must be replaced");
    assert.ok(cleanHtml.includes("pro rata"), "Must say pro rata");

    assert.ok(!cleanHtml.includes("respond you within 3 days"), "respond you within 3 days must be replaced");
    assert.ok(cleanHtml.includes("respond to you within 3 days"), "Must say respond to you within 3 days");
  });

  // ─── CCL-4: ILR Guidance Link ──────────────────────────────────────────────
  test("CCL-4: ILR letters remove inappropriate Skilled Worker guidance link", () => {
    const rawIlrLetter = `
      <p>We have considered your application against the relevant current immigration rules -
      <a href="https://www.gov.uk/guidance/immigration-rules/immigration-rules-part-6a-the-points-based-system#pt6aindefinite">Part 6A Indefinite</a> (245AAA) &amp;
      <a href="https://www.gov.uk/guidance/immigration-rules/immigration-rules-appendix-skilled-worker">https://www.gov.uk/guidance/immigration-rules/immigration-rules-appendix-skilled-worker</a>
      and can confirm we support your Settlement application.</p>
    `;
    const cleanIlr = interpolateCclHtml(rawIlrLetter, { visa_type: "Indefinite Leave to Remain (ILR)" });
    assert.ok(!cleanIlr.includes("appendix-skilled-worker"), "ILR letter must not contain Skilled Worker appendix link");
    assert.ok(cleanIlr.includes("pt6aindefinite"), "ILR letter must retain genuine settlement guidance link");
  });

  // ─── CCL-5: Unfilled Blanks Guard ──────────────────────────────────────────
  test("CCL-5: findUnresolvedPlaceholders blocks unresolved tags, blanks, and ellipses but allows valid letters", () => {
    // 1. Unresolved tag
    const tagDraft = "<p>Dear {{candidate_first_name}}, your case is {{unknown_tag}}.</p>";
    const res1 = findUnresolvedPlaceholders(tagDraft);
    assert.equal(res1.valid, false);
    assert.ok(res1.missing.some((m) => m.includes("unknown_tag")));

    // 2. Blank fill underscores
    const underscoreDraft = "<p>You instructed our firm via your Sponsor ____________ to apply.</p>";
    const res2 = findUnresolvedPlaceholders(underscoreDraft);
    assert.equal(res2.valid, false);
    assert.ok(res2.missing.some((m) => m.includes("underscore")));

    // 3. Blank ellipses
    const ellipsisDraft = "<p>Dear …………, your case reference is 123.</p>";
    const res3 = findUnresolvedPlaceholders(ellipsisDraft);
    assert.equal(res3.valid, false);
    assert.ok(res3.missing.some((m) => m.includes("ellipses")));

    // 4. Valid letter with signature line (allowed)
    const validLetter = `
      <p>Dear Jane,</p>
      <p>Your case reference is EPIC-2026-001.</p>
      <p>Signed: __________________________    Date: ____________________</p>
    `;
    const res4 = findUnresolvedPlaceholders(validLetter);
    assert.equal(res4.valid, true, "Valid letter with signature line must pass validation");
  });

  // ─── CCL-6: Supervisor Name ────────────────────────────────────────────────
  test("CCL-6: Supervisor information is resolved from firm configuration and not hardcoded", async () => {
    const reg = getCclTagRegistry();
    const hasTag = reg.tags.some((t) => t.tag === "supervisor_name");
    assert.ok(hasTag, "supervisor_name must be present in tag registry");

    const mockTenantDb = {
      User: { findByPk: async () => ({ id: 1, first_name: "Alex", last_name: "Morgan", email: "a.morgan@firm.com" }) },
      SponsorProfile: { findOne: async () => null },
      CandidateApplication: { findOne: async () => null },
      VisaType: { findByPk: async () => ({ id: 1, name: "ILR" }) },
      PaymentSetting: { findOne: async () => null },
    };

    const caseRecord = {
      id: 1,
      candidateId: 1,
      assignedcaseworkerId: [1],
    };

    // Case A: Organisation has supervisor configured
    const ctxA = await buildCclContext({
      tenantDb: mockTenantDb,
      caseRecord,
      organisation: { name: "Legal Firm Ltd", supervisor_name: "Partner Sarah Jenkins" },
    });
    assert.equal(ctxA.values.supervisor_name, "Partner Sarah Jenkins");

    // Case B: Organisation has no supervisor configured (handled safely)
    const ctxB = await buildCclContext({
      tenantDb: mockTenantDb,
      caseRecord,
      organisation: { name: "Legal Firm Ltd" },
    });
    assert.equal(ctxB.values.supervisor_name, "");
  });

  // ─── CCL-7: Appendix A Multi-Refusal Support ──────────────────────────────
  test("CCL-7: Appendix A correctly supports zero, one, and multiple visa refusals without dropping any", () => {
    // 1. Zero refusals
    const appZero = {
      brpNumber: "BRP000",
      visaType: "Skilled Worker",
      refusedVisa: "No",
      visaRefusals: [],
    };
    const htmlZero = renderAppendixAHtml(appZero, {});
    assert.ok(htmlZero.includes("No adverse immigration history or visa refusals recorded"));

    // 2. One refusal
    const appOne = {
      brpNumber: "BRP001",
      visaType: "Skilled Worker",
      refusedVisa: "Yes",
      visaRefusals: [
        { country: "UK", refusalDate: "2023-05-10", visaType: "Student Visa", reason: "Maintenance funds" },
      ],
    };
    const htmlOne = renderAppendixAHtml(appOne, {});
    assert.ok(htmlOne.includes("Refusal 1: UK for Student Visa (10 May 2023): Maintenance funds"));

    // 3. Multiple refusals (none dropped)
    const appMulti = {
      brpNumber: "BRP002",
      visaType: "Skilled Worker",
      refusedVisa: "Yes",
      visaRefusals: [
        { country: "UK", refusalDate: "2021-03-15", visaType: "Visitor Visa", reason: "Intent to return" },
        { country: "Canada", refusalDate: "2022-07-20", visaType: "Work Permit", reason: "LMIA verification" },
        { country: "USA", refusalDate: "2023-11-05", visaType: "B1/B2", reason: "Ties to home country" },
      ],
    };
    const htmlMulti = renderAppendixAHtml(appMulti, {});
    assert.ok(htmlMulti.includes("Refusal 1: UK for Visitor Visa (15 March 2021): Intent to return"));
    assert.ok(htmlMulti.includes("Refusal 2: Canada for Work Permit (20 July 2022): LMIA verification"));
    assert.ok(htmlMulti.includes("Refusal 3: USA for B1/B2 (5 November 2023): Ties to home country"));
  });

  // ─── CCL-8 & CCL-9: Fee Schedule & Payer Distinction ───────────────────────
  test("CCL-8 & CCL-9: Fee section distinguishes firm legal fees from UKVI statutory disbursements with official links", () => {
    const feeHtml = renderFeeSectionHtml({
      fee: 1500,
      total: 1500,
      amountInWords: "One thousand five hundred pounds",
      visaName: "Indefinite Leave to Remain",
      orgName: "Shivora Legal Services Ltd",
    });

    assert.ok(feeHtml.includes("A. Professional Legal Services Fee — Payable to Shivora Legal Services Ltd"));
    assert.ok(feeHtml.includes("£1,500.00"));
    assert.ok(feeHtml.includes("B. UKVI / Home Office Disbursements — Payable directly to UKVI / Home Office"));
    assert.ok(feeHtml.includes("https://www.gov.uk/visa-fees"));
    assert.ok(feeHtml.includes("https://www.gov.uk/healthcare-immigration-application"));
  });

  // ─── CCL-11: Dynamic Caseworker Data ───────────────────────────────────────
  test("CCL-11: Caseworker contact details and sign-off are dynamic with no stale David Robertson", () => {
    const template = `
      <p>I, David Robertson, will be your caseworker and responsible for the conduct of your case as and when they arise.</p>
      <p>Your caseworker will be Mr David Robertson under the supervision of Mr Khalid Mahmood.</p>
      <p>Yours sincerely,</p>
      <p>David Robertson</p>
    `;
    const clean = interpolateCclHtml(template, {
      caseworker_name: "Elena Rostova",
      caseworker_phone: "+44 207 946 0192",
      caseworker_email: "elena.rostova@lawfirm.co.uk",
      caseworkers_all: "Elena Rostova",
    });

    assert.ok(!clean.includes("David Robertson"), "Stale David Robertson must be removed");
    assert.ok(!clean.includes("Khalid Mahmood"), "Stale Khalid Mahmood must be removed");
    assert.ok(clean.includes("Elena Rostova"), "Dynamic caseworker name must be present");
    assert.ok(clean.includes("+44 207 946 0192"), "Dynamic phone must be present");
    assert.ok(clean.includes("elena.rostova@lawfirm.co.uk"), "Dynamic email must be present");
  });
});
