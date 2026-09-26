/**
 * issue4_cclGeneration.test.js
 *
 * Comprehensive tests for Issue #4: Client Care Letter (CCL) Mismatches
 *
 * Verifies:
 *  - TEST 1: ILR Private Client (no sponsor, exactly 2 caseworkers, correct ILR data, fees, Appendix A, dates)
 *  - TEST 2: Sponsored Case (correct sponsor, client, visa type, caseworkers)
 *  - TEST 3: Caseworker (no hardcoded "David Robertson", caseworker info from actual case)
 *  - TEST 4: Fees (no hardcoded Skilled Worker fees £1420/£5175, fees come from case)
 *  - TEST 5: Private Client Sponsor (no fake/stale sponsor displayed)
 *  - TEST 6: Appendix A (populated from actual CandidateApplication history, no fake history)
 *  - TEST 7: Dates (correct, consistently formatted, no awkward line wrap, no raw ISO strings)
 *  - TEST 8: Client Isolation (data from Client A never appears in Client B's CCL)
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCclContext,
  interpolateCclHtml,
  renderAppendixAHtml,
  renderFeeSectionHtml,
  formatDate,
  formatGbp,
  amountToWords,
  getCclTagRegistry,
} from '../src/services/cclTags.service.js';
import {
  generateCclHtmlForCase,
  resolveDbCclTemplate,
} from '../src/services/cclGenerator.service.js';
import { resolveCclTemplate } from '../src/services/cclTemplate.service.js';

// ── Mock In-Memory Tenant DB ──────────────────────────────────────────────────
function createMockTenantDb() {
  const users = new Map();
  const sponsorProfiles = new Map();
  const applications = new Map();
  const visaTypes = new Map();
  const petitionTypes = new Map();
  const cclTemplates = new Map();

  return {
    User: {
      findByPk: async (id, opts = {}) => users.get(Number(id)) || null,
      _add: (u) => { users.set(Number(u.id), u); return u; },
    },
    SponsorProfile: {
      findOne: async ({ where }) => {
        if (where?.userId) return sponsorProfiles.get(Number(where.userId)) || null;
        return null;
      },
      _add: (sp) => { sponsorProfiles.set(Number(sp.userId), sp); return sp; },
    },
    CandidateApplication: {
      findOne: async ({ where }) => {
        if (where?.userId) return applications.get(Number(where.userId)) || null;
        return null;
      },
      _add: (app) => { applications.set(Number(app.userId), app); return app; },
    },
    VisaType: {
      findByPk: async (id) => visaTypes.get(Number(id)) || null,
      findAll: async () => Array.from(visaTypes.values()),
      _add: (vt) => { visaTypes.set(Number(vt.id), vt); return vt; },
    },
    PetitionType: {
      findByPk: async (id) => petitionTypes.get(Number(id)) || null,
      _add: (pt) => { petitionTypes.set(Number(pt.id), pt); return pt; },
    },
    CclTemplate: {
      findOne: async ({ where }) => {
        const list = Array.from(cclTemplates.values()).filter((t) => t.isActive);
        if (where?.visaTypeId) {
          const match = list.find((t) => t.visaTypeId === where.visaTypeId);
          if (match) return match;
        }
        if (where?.name?.[Object.getOwnPropertySymbols(where.name)[0] || '']) {
          // Op.iLike match fallback
        }
        return list.find((t) => t.visaTypeId == null) || list[0] || null;
      },
      findAll: async () => Array.from(cclTemplates.values()),
      _add: (tpl) => { cclTemplates.set(Number(tpl.id), tpl); return tpl; },
    },
  };
}

describe('Issue #4: Client Care Letter (CCL) Mismatches', () => {
  let tenantDb;
  let cwLead;
  let cwJoint;
  let clientUser;
  let sponsorUser;
  let sponsorProfile;
  let ilrVisa;
  let swVisa;
  let clientApplication;

  before(() => {
    tenantDb = createMockTenantDb();

    // Caseworkers (Exactly 2 caseworkers per case)
    cwLead = tenantDb.User._add({
      id: 101,
      first_name: 'Elena',
      last_name: 'Vance',
      email: 'elena.vance@elitepic.co.uk',
      mobile: '+44 7123 456789',
    });

    cwJoint = tenantDb.User._add({
      id: 102,
      first_name: 'Marcus',
      last_name: 'Brody',
      email: 'marcus.brody@elitepic.co.uk',
      mobile: '+44 7987 654321',
    });

    // Client user
    clientUser = tenantDb.User._add({
      id: 201,
      first_name: 'Priya',
      last_name: 'Sharma',
      email: 'priya.sharma@example.com',
      mobile: '+44 7700 900123',
    });

    // Sponsor user and profile
    sponsorUser = tenantDb.User._add({
      id: 301,
      first_name: 'John',
      last_name: 'Sponsor',
      company_name: 'Apex Global Logistics Ltd',
      email: 'hr@apexlogistic.co.uk',
    });

    sponsorProfile = tenantDb.SponsorProfile._add({
      id: 1,
      userId: 301,
      companyName: 'Apex Global Logistics Ltd',
      sponsorLicenceNumber: 'APEX-LIC-998877',
      registeredAddress: '100 Business Park, Birmingham, B1 1AA',
    });

    // Visa types
    ilrVisa = tenantDb.VisaType._add({
      id: 1,
      name: 'Indefinite Leave to Remain (ILR)',
    });

    swVisa = tenantDb.VisaType._add({
      id: 2,
      name: 'Skilled Worker Visa',
    });

    // Candidate Application (stored immigration history for Appendix A)
    clientApplication = tenantDb.CandidateApplication._add({
      id: 1,
      userId: 201,
      firstName: 'Priya',
      lastName: 'Sharma',
      email: 'priya.sharma@example.com',
      contactNumber: '+44 7700 900123',
      address: '42 Blossom Way, Manchester, M4 1AA',
      dob: new Date('1992-05-15'),
      passportNumber: 'PS98765432',
      nationality: 'Indian',
      brpNumber: 'BRP9876543',
      visaType: 'Skilled Worker',
      visaEndDate: new Date('2026-11-30'),
      entryDate: new Date('2021-06-01'),
      refusedVisa: 'No',
      travelHistory: [
        { country: 'India', entryDate: '2023-01-10', leaveDate: '2023-01-28' },
        { country: 'France', entryDate: '2024-07-05', leaveDate: '2024-07-15' },
      ],
    });
  });

  // ── TEST 1: ILR Private Client ──────────────────────────────────────────────
  test('TEST 1: ILR Private Client (no sponsor, exactly 2 caseworkers, correct ILR data, fees, Appendix A)', async () => {
    const caseRecord = {
      id: 501,
      caseId: 'EPIC-2026-0501',
      candidateId: clientUser.id,
      sponsorId: null,
      isPrivateClient: true,
      visaTypeId: ilrVisa.id,
      visaType: ilrVisa,
      assignedcaseworkerId: [cwLead.id, cwJoint.id], // Exactly 2 caseworkers
      totalAmount: 2200.0,
      proposedAmount: 2200.0,
      targetSubmissionDate: new Date('2026-10-15'),
    };

    const ccl = {
      feeAmount: 2200.0,
      installmentPlan: [
        { label: 'Instalment 1', amount: 1100, dueDate: '2026-06-01' },
        { label: 'Instalment 2', amount: 1100, dueDate: '2026-07-01' },
      ],
      issuedAt: new Date('2026-06-01'),
    };

    const org = {
      name: 'Elite PIC Ltd',
      phone: '+44 20 1234 5678',
      primaryEmail: 'contact@elitepic.co.uk',
    };

    const { values } = await buildCclContext({
      tenantDb,
      caseRecord,
      ccl,
      organisation: org,
    });

    // 1. Client details correct
    assert.equal(values.candidate_name, 'Priya Sharma');
    assert.equal(values.candidate_first_name, 'Priya');
    assert.equal(values.candidate_email, 'priya.sharma@example.com');
    assert.equal(values.candidate_address, '42 Blossom Way, Manchester, M4 1AA');
    assert.equal(values.passport_number, 'PS98765432');
    assert.equal(values.nationality, 'Indian');

    // 2. ILR displayed
    assert.equal(values.visa_type, 'Indefinite Leave to Remain (ILR)');

    // 3. No fake sponsor (private client)
    assert.equal(values.is_private_client, 'Yes');
    assert.equal(values.sponsor_name, '');
    assert.equal(values.sponsor_licence, '');
    assert.match(values.sponsor_statement, /independent private client with no sponsor/i);
    assert.match(values.sponsor_instruction_clause, /independent private client with no sponsor/i);

    // 4. Correct caseworkers (Lead contact = cwLead, Joint = cwJoint)
    assert.equal(values.caseworker_name, 'Elena Vance');
    assert.equal(values.caseworker_email, 'elena.vance@elitepic.co.uk');
    assert.equal(values.caseworker_phone, '+44 7123 456789');
    assert.equal(values.second_caseworker_name, 'Marcus Brody');
    assert.equal(values.second_caseworker_email, 'marcus.brody@elitepic.co.uk');
    assert.match(values.caseworkers_all, /Elena Vance.*Lead Caseworker.*Marcus Brody.*Joint Caseworker/);

    // 5. Correct fee source (case totalAmount = £2,200.00; words = Two thousand two hundred pounds)
    assert.equal(values.fee_amount, '£2,200.00');
    assert.equal(values.total_amount, '£2,200.00');
    assert.equal(values.amount_in_words, 'Two thousand two hundred pounds');
    assert.match(values.fee_section, /£2,200\.00/);
    // MUST NOT have hardcoded Skilled Worker £1420 or IHS £5175
    assert.ok(!values.fee_section.includes('£1,420'));
    assert.ok(!values.fee_section.includes('£5,175'));
    assert.ok(!values.fee_section.includes('£1420'));
    assert.ok(!values.fee_section.includes('£5175'));

    // 6. Appendix A populated from stored history
    assert.match(values.appendix_a, /BRP9876543/);
    assert.match(values.appendix_a, /Skilled Worker/);
    assert.match(values.appendix_a, /30 November 2026/); // visaEndDate
    assert.match(values.appendix_a, /1 June 2021/); // entryDate
    assert.match(values.appendix_a, /India/);
    assert.match(values.appendix_a, /France/);

    // 7. Dates formatted cleanly
    assert.match(values.date_today, /\d{1,2}\s+[A-Za-z]+\s+\d{4}/);
    assert.ok(!values.date_today.includes('T'));
    assert.ok(!values.date_today.includes('Z'));
  });

  // ── TEST 2: Sponsored Case ──────────────────────────────────────────────────
  test('TEST 2: Sponsored Case (correct sponsor, client, visa type, caseworkers)', async () => {
    const caseRecord = {
      id: 502,
      caseId: 'EPIC-2026-0502',
      candidateId: clientUser.id,
      sponsorId: sponsorUser.id,
      isPrivateClient: false,
      visaTypeId: swVisa.id,
      visaType: swVisa,
      assignedcaseworkerId: [cwLead.id, cwJoint.id],
      totalAmount: 1500.0,
      proposedAmount: 1500.0,
    };

    const { values } = await buildCclContext({
      tenantDb,
      caseRecord,
      ccl: null,
      organisation: { name: 'Elite PIC Ltd' },
    });

    // Correct sponsor
    assert.equal(values.is_private_client, 'No');
    assert.equal(values.sponsor_name, 'Apex Global Logistics Ltd');
    assert.equal(values.sponsor_licence, 'APEX-LIC-998877');
    assert.match(values.sponsor_statement, /Apex Global Logistics Ltd/);
    assert.match(values.sponsor_instruction_clause, /Apex Global Logistics Ltd/);
    assert.match(values.sponsor_instruction_clause, /APEX-LIC-998877/);

    // Correct client & visa
    assert.equal(values.candidate_name, 'Priya Sharma');
    assert.equal(values.visa_type, 'Skilled Worker Visa');

    // Correct caseworkers
    assert.equal(values.caseworker_name, 'Elena Vance');
    assert.equal(values.second_caseworker_name, 'Marcus Brody');
  });

  // ── TEST 3: Caseworker (No hardcoded David Robertson) ───────────────────────
  test('TEST 3: Caseworker (no hardcoded "David Robertson", info comes from actual case)', async () => {
    // Template simulating legacy hardcoded template
    const legacyTemplateHtml = `
      <p>I, David Robertson will be your caseworker and responsible for the conduct of your case. I can be contacted on 01217782400 and email david@elitepic.co.uk Whenever possible, I shall be available to advise and assist you and keep you informed you of the progress of your case regarding any communication with Home Office or other development as and when they arise.</p>
      <p>Your caseworker will be Mr David Robertson under the supervision of Mr Khalid Mahmood. We aim to offer all our clients an efficient and effective service.</p>
      <p>Yours sincerely,</p>
      <p>David Robertson</p>
    `;

    const caseRecord = {
      id: 503,
      candidateId: clientUser.id,
      assignedcaseworkerId: [cwLead.id, cwJoint.id],
    };

    const { values } = await buildCclContext({ tenantDb, caseRecord });
    const interpolated = interpolateCclHtml(legacyTemplateHtml, values);

    // Verify David Robertson is completely absent
    assert.ok(!interpolated.includes('David Robertson'), 'David Robertson must not appear');
    assert.ok(!interpolated.includes('david@elitepic.co.uk'), 'david@elitepic.co.uk must not appear');
    assert.ok(!interpolated.includes('01217782400'), '01217782400 must not appear');

    // Verify actual caseworker Elena Vance is present
    assert.ok(interpolated.includes('Elena Vance'), 'Actual caseworker Elena Vance must appear');
    assert.ok(interpolated.includes('elena.vance@elitepic.co.uk'), 'Actual caseworker email must appear');
    assert.ok(interpolated.includes('+44 7123 456789'), 'Actual caseworker phone must appear');
  });

  // ── TEST 4: Fees (No hardcoded Skilled Worker fees) ──────────────────────────
  test('TEST 4: Fees (no hardcoded Skilled Worker fees, fees come from case)', async () => {
    const legacyFeeTemplate = `
      <table>
        <tr><td>Home office visa application fee</td><td>£1420</td><td>£0</td><td>£1420</td></tr>
        <tr><td>Health Surcharge</td><td>£1035 per year</td><td>£0</td><td>£5175</td></tr>
      </table>
    `;

    const caseRecord = {
      id: 504,
      candidateId: clientUser.id,
      visaType: ilrVisa,
      totalAmount: 3400.0,
      proposedAmount: 3400.0,
      assignedcaseworkerId: [cwLead.id, cwJoint.id],
    };

    const { values } = await buildCclContext({
      tenantDb,
      caseRecord,
      ccl: { feeAmount: 3400.0 },
    });

    const interpolated = interpolateCclHtml(legacyFeeTemplate, values);

    // Verify hardcoded fee values are gone
    assert.ok(!interpolated.includes('£1420'));
    assert.ok(!interpolated.includes('£1,420'));
    assert.ok(!interpolated.includes('£5175'));
    assert.ok(!interpolated.includes('£5,175'));

    // Verify case fee is present
    assert.ok(interpolated.includes('£3,400.00'));
    assert.ok(interpolated.includes('Three thousand four hundred pounds'));
  });

  // ── TEST 5: Private Client Sponsor (No fake/stale sponsor) ───────────────────
  test('TEST 5: Private Client Sponsor (no fake/stale sponsor from another case)', async () => {
    const legacySponsorTemplate = `
      <p>You instructed Elite PIC Ltd via your Sponsor ____________, to manage the application of Skilled Worker Visa for 05 years duration with the Sponsor/employer __________(sponsor licence number: _____). Your job title is ‘____’ with SOC code ‘____’.</p>
    `;

    const caseRecord = {
      id: 505,
      candidateId: clientUser.id,
      sponsorId: null,
      isPrivateClient: true,
      visaType: ilrVisa,
      assignedcaseworkerId: [cwLead.id, cwJoint.id],
    };

    const { values } = await buildCclContext({
      tenantDb,
      caseRecord,
      organisation: { name: 'Elite PIC Ltd' },
    });

    const interpolated = interpolateCclHtml(legacySponsorTemplate, values);

    // Must not contain fake/stale sponsor or unresolved blanks
    assert.ok(!interpolated.includes('Apex Global Logistics'), 'Must not leak sponsor from other case');
    assert.ok(!interpolated.includes('via your Sponsor ____________'));
    assert.ok(!interpolated.includes('Sponsor/employer __________'));
    assert.match(interpolated, /independent private client with no sponsor|private client \(no sponsor\)/i);
  });

  // ── TEST 6: Appendix A (Populated from application data) ─────────────────────
  test('TEST 6: Appendix A (actual stored immigration history used, no fake data)', async () => {
    const legacyAppendixTemplate = `
      <p><strong>Appendix (A) – Immigration</strong></p>
      <table><tr><td><p>BRP card </p><p>_____ </p></td><td><p>Expiry date: _____</p></td></tr></table>
    `;

    const caseRecord = {
      id: 506,
      candidateId: clientUser.id,
      assignedcaseworkerId: [cwLead.id, cwJoint.id],
    };

    const { values } = await buildCclContext({ tenantDb, caseRecord });
    const interpolated = interpolateCclHtml(legacyAppendixTemplate, values);

    // Verify dynamic Appendix A replaced the blanks
    assert.ok(!interpolated.includes('BRP card </p><p>_____'));
    assert.ok(interpolated.includes('BRP9876543'));
    assert.ok(interpolated.includes('30 November 2026'));
    assert.ok(interpolated.includes('India'));
    assert.ok(interpolated.includes('France'));
  });

  // ── TEST 7: Dates (Consistently formatted, no awkward line wrap) ─────────────
  test('TEST 7: Dates (correct, consistently formatted, no awkward line wrap, no raw ISO)', async () => {
    // Template with awkward date line containing tab characters
    const templateWithTabs = `
      <p>Dear ………………, \t\t\t\t\t\t\t\t\t Date: 13/09/2024</p>
      <p>Expiry: {{current_visa_expiry}}</p>
    `;

    const caseRecord = {
      id: 507,
      candidateId: clientUser.id,
      assignedcaseworkerId: [cwLead.id, cwJoint.id],
    };

    const { values } = await buildCclContext({ tenantDb, caseRecord });
    const interpolated = interpolateCclHtml(templateWithTabs, values);

    // Verify tabs are cleaned up and date is rendered properly
    assert.ok(!interpolated.includes('\t\t\t\t'), 'Awkward tab stops must be removed');
    assert.match(interpolated, /Date:\s+\d{1,2}\s+[A-Za-z]+\s+\d{4}/);
    assert.ok(interpolated.includes('30 November 2026'));
    // No raw ISO dates
    assert.ok(!interpolated.includes('T00:00:00.000Z'));
  });

  // ── TEST 8: Client Isolation ────────────────────────────────────────────────
  test('TEST 8: Client Isolation (Client A data never appears in Client B CCL)', async () => {
    // Create Client B
    const clientBUser = tenantDb.User._add({
      id: 202,
      first_name: 'David',
      last_name: 'Copperfield',
      email: 'david.c@magic.com',
    });

    const cw3 = tenantDb.User._add({
      id: 103,
      first_name: 'Arthur',
      last_name: 'Pendleton',
      email: 'arthur.pendleton@firm.com',
    });

    const cw4 = tenantDb.User._add({
      id: 104,
      first_name: 'Gwen',
      last_name: 'Stacy',
      email: 'gwen.stacy@firm.com',
    });

    const sponsorBUser = tenantDb.User._add({
      id: 302,
      first_name: 'Bob',
      last_name: 'Boss',
      company_name: 'Cyberdyne Systems UK',
    });

    tenantDb.SponsorProfile._add({
      id: 2,
      userId: 302,
      companyName: 'Cyberdyne Systems UK',
      sponsorLicenceNumber: 'CYBER-887766',
    });

    const appB = tenantDb.CandidateApplication._add({
      id: 2,
      userId: 202,
      firstName: 'David',
      lastName: 'Copperfield',
      email: 'david.c@magic.com',
      brpNumber: 'BRP-DIFFERENT-999',
    });

    // Case A: Priya Sharma (ILR, Private, Elena Vance & Marcus Brody, £2,200)
    const caseA = {
      id: 510,
      caseId: 'EPIC-A',
      candidateId: clientUser.id,
      sponsorId: null,
      isPrivateClient: true,
      visaType: ilrVisa,
      assignedcaseworkerId: [cwLead.id, cwJoint.id],
      totalAmount: 2200.0,
    };

    // Case B: David Copperfield (Skilled Worker, Sponsored by Cyberdyne, Arthur & Gwen, £1,800)
    const caseB = {
      id: 511,
      caseId: 'EPIC-B',
      candidateId: clientBUser.id,
      sponsorId: sponsorBUser.id,
      isPrivateClient: false,
      visaType: swVisa,
      assignedcaseworkerId: [cw3.id, cw4.id],
      totalAmount: 1800.0,
    };

    const ctxA = await buildCclContext({ tenantDb, caseRecord: caseA });
    const ctxB = await buildCclContext({ tenantDb, caseRecord: caseB });

    const htmlA = interpolateCclHtml('{{candidate_name}} | {{sponsor_name}} | {{caseworkers_all}} | {{total_amount}} | {{appendix_a}}', ctxA.values);
    const htmlB = interpolateCclHtml('{{candidate_name}} | {{sponsor_name}} | {{caseworkers_all}} | {{total_amount}} | {{appendix_a}}', ctxB.values);

    // Verify Case A has ONLY Case A details
    assert.ok(htmlA.includes('Priya Sharma'));
    assert.ok(htmlA.includes('Elena Vance'));
    assert.ok(htmlA.includes('Marcus Brody'));
    assert.ok(htmlA.includes('£2,200.00'));
    assert.ok(htmlA.includes('BRP9876543'));
    assert.ok(!htmlA.includes('David Copperfield'));
    assert.ok(!htmlA.includes('Cyberdyne Systems UK'));
    assert.ok(!htmlA.includes('Arthur Pendleton'));
    assert.ok(!htmlA.includes('£1,800.00'));
    assert.ok(!htmlA.includes('BRP-DIFFERENT-999'));

    // Verify Case B has ONLY Case B details
    assert.ok(htmlB.includes('David Copperfield'));
    assert.ok(htmlB.includes('Cyberdyne Systems UK'));
    assert.ok(htmlB.includes('Arthur Pendleton'));
    assert.ok(htmlB.includes('Gwen Stacy'));
    assert.ok(htmlB.includes('£1,800.00'));
    assert.ok(htmlB.includes('BRP-DIFFERENT-999'));
    assert.ok(!htmlB.includes('Priya Sharma'));
    assert.ok(!htmlB.includes('Elena Vance'));
    assert.ok(!htmlB.includes('£2,200.00'));
    assert.ok(!htmlB.includes('BRP9876543'));
  });

  // ── Rule Confirmation: Exactly 2 Caseworkers Rule ───────────────────────────
  test('CONFIRMATION: Caseworkers assignment preserves exactly 2 caseworkers', async () => {
    const raw = [cwLead.id, cwJoint.id];
    assert.equal(raw.length, 2, 'Case must have exactly 2 caseworkers');
    const caseRecord = {
      id: 520,
      candidateId: clientUser.id,
      assignedcaseworkerId: raw,
    };
    const { values } = await buildCclContext({ tenantDb, caseRecord });
    assert.equal(values.caseworker_name, 'Elena Vance');
    assert.equal(values.second_caseworker_name, 'Marcus Brody');
    assert.ok(values.caseworkers_all.includes('Elena Vance'));
    assert.ok(values.caseworkers_all.includes('Marcus Brody'));
  });
});
