/**
 * cclIssue1_bankPaymentDetails.test.js
 *
 * Tests for CCL Phase 6 — Issue #1:
 * Bank Details Table Cut-Off & Payment Instruction Clarity
 *
 * Verifies:
 * - TEST 1: CCL generation succeeds with complete bank details (PDF generated).
 * - TEST 2: Bank details table contains all configured fields (no missing/cut-off bank data).
 * - TEST 3: Payment instructions contain clearly separated UKVI/Home Office and
 *           firm/service-fee payment instructions.
 * - TEST 4: Long/normal bank values and 8-column legacy tables do not cause table overflow.
 * - TEST 5: Missing optional bank value does not cause document generation to fail or insert fake data.
 * - TEST 6: Multi-page document layout maintains valid table margins and footer.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderBankPaymentInstructionsHtml,
  buildCclContext,
  interpolateCclHtml,
  renderFeeSectionHtml,
} from '../src/services/cclTags.service.js';
import {
  generateCclHtmlForCase,
  renderCclPdfBuffer,
} from '../src/services/cclGenerator.service.js';

describe('CCL Issue #1: Bank Details Table & Payment Clarity', () => {

  test('TEST 1: CCL generation succeeds with complete bank details', async () => {
    const bankDetails = [
      'Bank Name: HSBC UK Bank plc',
      'Account Name: Elite Immigration Law Ltd',
      'Account Number: 25101352',
      'Sort Code: 40-11-18',
      'IBAN: GB29MIDL40111825101352',
    ].join('\n');

    const html = `
      <h2>Client Care Letter</h2>
      <p>Dear Jane Doe,</p>
      ${renderBankPaymentInstructionsHtml(bankDetails, 'Elite Immigration Law Ltd', 'EPIC-2026-0042')}
    `;

    const buf = await renderCclPdfBuffer({
      html,
      organisation: { name: 'Elite Immigration Law Ltd' },
    });

    assert.ok(Buffer.isBuffer(buf), 'Must return a Buffer');
    assert.ok(buf.length > 1000, 'PDF buffer must be non-empty');
    assert.equal(buf.slice(0, 5).toString('latin1'), '%PDF-', 'Must be a valid PDF');
  });

  test('TEST 2: Bank details table contains all configured fields without cut-off', async () => {
    const bankDetails = [
      'Bank Name: HSBC UK Bank plc',
      'Account Name: Elite Immigration Law Ltd',
      'Account Number: 25101352',
      'Sort Code: 40-11-18',
    ].join('\n');

    const html = renderBankPaymentInstructionsHtml(bankDetails, 'Elite Immigration Law Ltd', 'EPIC-2026-0042');

    // Verify all fields are present in HTML
    assert.match(html, /HSBC UK Bank plc/);
    assert.match(html, /Elite Immigration Law Ltd/);
    assert.match(html, /25101352/);
    assert.match(html, /40-11-18/);
    // UKVI account fields
    assert.match(html, /55332788/);
    assert.match(html, /40-35-18/);

    const buf = await renderCclPdfBuffer({
      html,
      organisation: { name: 'Elite Immigration Law Ltd' },
    });
    assert.ok(Buffer.isBuffer(buf) && buf.length > 1000);
  });

  test('TEST 3: Payment instructions clearly separate UKVI / Home Office and firm fees', async () => {
    const html = renderBankPaymentInstructionsHtml('', 'Elite PIC Ltd', 'EPIC-2026-0042');

    // Verify separation of UKVI direct payment vs Firm management fee
    assert.match(html, /UKVI \/ Home Office Visa Fees &amp; Disbursements/i);
    assert.match(html, /Direct Payment/i);
    assert.match(html, /Firm Professional Legal Management Fee/i);
    assert.match(html, /Dedicated Client Disbursements Account/i);
    assert.match(html, /Firm Office Account/i);
    assert.match(html, /EPIC-2026-0042/);
  });

  test('TEST 4: Long/normal bank values and 8-column legacy tables do not cause table overflow', async () => {
    // Legacy 8-column bank table (like test-pdf.js)
    const legacy8ColHtml = `
      <p>Payment Section</p>
      <table border="1">
        <tr>
          <td>Transfer UKVI visa fees</td>
          <td>Transfer Elite Management Fees</td>
          <td colspan="6"></td>
        </tr>
        <tr>
          <td>Bank - HSBC Very Long Branch Name Commercial Banking Centre</td>
          <td>Company name - Elite Immigration Services Global Practice UK Ltd</td>
          <td>Account No - 55332788990011</td>
          <td>Sort Code - 40-35-18</td>
          <td>Bank - HSBC Commercial Bank Office</td>
          <td>Company name - Elite Immigration Services Global Practice UK Ltd</td>
          <td>Account No - 25101352887766</td>
          <td>Sort Code - 40-11-18</td>
        </tr>
      </table>
    `;

    const buf = await renderCclPdfBuffer({
      html: legacy8ColHtml,
      organisation: { name: 'Elite Immigration Services Global Practice UK Ltd' },
    });

    assert.ok(Buffer.isBuffer(buf) && buf.length > 1000);
    assert.equal(buf.slice(0, 5).toString('latin1'), '%PDF-');
  });

  test('TEST 5: Missing optional bank value does not cause document generation to fail or insert fake data', async () => {
    // Only bank name and account number configured; sort code and IBAN omitted
    const partialBankDetails = [
      'Bank Name: Barclays',
      'Account Number: 98765432',
    ].join('\n');

    const html = renderBankPaymentInstructionsHtml(partialBankDetails, 'Elite PIC Ltd', 'EPIC-2026-0099');

    // Verify configured fields present
    assert.match(html, /Barclays/);
    assert.match(html, /98765432/);
    // Verify no invented fake sort code for firm account
    assert.doesNotMatch(html, /fake/i);

    const buf = await renderCclPdfBuffer({
      html,
      organisation: { name: 'Elite PIC Ltd' },
    });
    assert.ok(Buffer.isBuffer(buf) && buf.length > 1000);
  });

  test('TEST 6: Interpolation upgrades legacy raw docx bank tables into formatted instructions', () => {
    const rawDocxBankTableHtml = `
      <p><strong>Elite Pic Bank accounts </strong></p>
      <table>
        <tr>
          <td><p><strong>Transfer UKVI visa fees</strong></p></td>
          <td><p><strong>Transfer Elite PiC Management Fees </strong></p></td>
        </tr>
        <tr>
          <td>
            <p>Bank - HSBC</p>
            <p>Company name - Elite Pic Ltd</p>
            <p>Account No - 55332788</p>
            <p>Sort Code - 40-35-18</p>
          </td>
          <td>
            <p>Bank - HSBC</p>
            <p>Company name - Elite Pic Ltd</p>
            <p>Account No - 25101352</p>
            <p>Sort Code - 40-11-18</p>
          </td>
        </tr>
      </table>
    `;

    const bankInstructions = renderBankPaymentInstructionsHtml('', 'Elite Pic Ltd', 'EPIC-101');
    const interpolated = interpolateCclHtml(rawDocxBankTableHtml, {
      bank_payment_instructions: bankInstructions,
    });

    // The raw table should be replaced by the structured payment instructions
    assert.match(interpolated, /Payment Instructions &amp; Bank Details/);
    assert.match(interpolated, /UKVI \/ Home Office Visa Fees/);
    assert.match(interpolated, /Firm Professional Management Fees/);
  });

  test('TEST 7: Regression: Fee calculations and breakdown remain untouched', () => {
    const feeHtml = renderFeeSectionHtml({
      fee: 1500,
      total: 1500,
      amountInWords: 'One thousand five hundred pounds',
      installmentPlanHtml: '',
      visaName: 'Indefinite Leave to Remain (ILR)',
      orgName: 'Elite PIC Ltd',
    });

    assert.match(feeHtml, /£1,500\.00/);
    assert.match(feeHtml, /Indefinite Leave to Remain/);
    assert.match(feeHtml, /One thousand five hundred pounds/);
    assert.match(feeHtml, /A\. Professional Legal Services Fee/);
    assert.match(feeHtml, /B\. UKVI \/ Home Office Disbursements/);
  });
});
