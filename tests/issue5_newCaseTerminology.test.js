import dotenv from 'dotenv';
dotenv.config({ path: './Server/.env' });
process.env.NODE_ENV = 'development';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getTenantDb } from '../src/services/tenantDb.service.js';
import { generateCaseId } from '../src/utils/case.utils.js';
import { ROLES } from '../src/middlewares/role.middleware.js';
import { DEFAULT_CASE_STAGE } from '../src/constants/immigrationCaseProcess.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

describe('Issue #5: New Case Form Currency and US Immigration Terminology', async () => {
  const tenantDb = getTenantDb('epic_technoweb');
  const { User, Organisation, Case, VisaType, PetitionType } = tenantDb;

  const org = await Organisation.findOne({ order: [['id', 'ASC']] });
  const orgId = org ? org.id : 1;
  const timestamp = Date.now();

  let candidateUser = null;
  let sponsorUser = null;
  let visaType = null;
  let petitionType = null;
  let caseworkers = [];

  try {
    candidateUser = await User.findOne({
      where: { role_id: ROLES.CANDIDATE, organisation_id: orgId },
      order: [['id', 'ASC']],
    });
    if (!candidateUser) {
      candidateUser = await User.create({
        first_name: 'Issue5',
        last_name: 'ClientTest',
        email: `issue5.client.${timestamp}@example.com`,
        password: 'hash',
        role_id: ROLES.CANDIDATE,
        is_email_verified: true,
        status: 'active',
        organisation_id: orgId,
      });
    }

    sponsorUser = await User.findOne({
      where: { role_id: ROLES.SPONSOR, organisation_id: orgId },
      order: [['id', 'ASC']],
    });

    visaType = await VisaType.findOne({ order: [['id', 'ASC']] });
    petitionType = await PetitionType.findOne({ order: [['id', 'ASC']] });

    caseworkers = await User.findAll({
      where: { role_id: ROLES.CASEWORKER, organisation_id: orgId },
      limit: 3,
    });
  } catch (err) {
    console.warn('[Issue #5 Setup]', err.message);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1 — Currency
  // ──────────────────────────────────────────────────────────────────────────
  test('TEST 1: Currency — £ is displayed where relevant case fee is shown, and $ is not in relevant New Case form', () => {
    const cwCasesPath = path.join(rootDir, 'EPiC_Frontend', 'src', 'pages', 'caseworker', 'Cases.jsx');
    const adminModalPath = path.join(rootDir, 'EPiC_Frontend', 'src', 'components', 'admin', 'AdminCaseFormModal.jsx');

    const cwCasesSrc = fs.readFileSync(cwCasesPath, 'utf8');
    const adminModalSrc = fs.readFileSync(adminModalPath, 'utf8');

    // 1. In Caseworker Cases.jsx New Case & Edit Case forms:
    assert.ok(cwCasesSrc.includes('Salary Offered (£)'), 'Cases.jsx must display Salary Offered (£)');
    assert.ok(cwCasesSrc.includes('Total Amount (£)'), 'Cases.jsx must display Total Amount (£)');
    assert.ok(cwCasesSrc.includes('Paid Amount (£)'), 'Cases.jsx must display Paid Amount (£)');
    assert.ok(!cwCasesSrc.includes('Salary Offered ($)'), 'Cases.jsx must NOT display Salary Offered ($)');
    assert.ok(!cwCasesSrc.includes('Total Amount ($)'), 'Cases.jsx must NOT display Total Amount ($)');
    assert.ok(!cwCasesSrc.includes('Paid Amount ($)'), 'Cases.jsx must NOT display Paid Amount ($)');

    // 2. In AdminCaseFormModal.jsx:
    assert.ok(adminModalSrc.includes('Salary Offered (£)'), 'AdminCaseFormModal must display Salary Offered (£)');
    assert.ok(adminModalSrc.includes('Total Amount (£)'), 'AdminCaseFormModal must display Total Amount (£)');
    assert.ok(adminModalSrc.includes('Paid Amount (£)'), 'AdminCaseFormModal must display Paid Amount (£)');
    assert.ok(adminModalSrc.includes('CCL fee (£)'), 'AdminCaseFormModal must display CCL fee (£)');
    assert.ok(!adminModalSrc.includes('Salary Offered ($)'), 'AdminCaseFormModal must NOT display Salary Offered ($)');
    assert.ok(!adminModalSrc.includes('Total Amount ($)'), 'AdminCaseFormModal must NOT display Total Amount ($)');
    assert.ok(!adminModalSrc.includes('Paid Amount ($)'), 'AdminCaseFormModal must NOT display Paid Amount ($)');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2 — Petition Type
  // ──────────────────────────────────────────────────────────────────────────
  test('TEST 2: Petition Type — Verify user-facing New Case form does not display "Petition Type"', () => {
    const cwCasesPath = path.join(rootDir, 'EPiC_Frontend', 'src', 'pages', 'caseworker', 'Cases.jsx');
    const adminModalPath = path.join(rootDir, 'EPiC_Frontend', 'src', 'components', 'admin', 'AdminCaseFormModal.jsx');

    const cwCasesSrc = fs.readFileSync(cwCasesPath, 'utf8');
    const adminModalSrc = fs.readFileSync(adminModalPath, 'utf8');

    // Both forms should use "Application Type" instead of "Petition Type"
    assert.ok(!cwCasesSrc.includes('<label className="text-sm font-medium text-gray-700">\n                  Petition Type'), 'Caseworker Cases form must not have Petition Type label');
    assert.ok(!adminModalSrc.includes('<label className="text-sm font-medium text-gray-700">Petition Type</label>'), 'Admin case form modal must not have Petition Type label');

    assert.ok(cwCasesSrc.includes('Application Type'), 'Caseworker Cases form must have Application Type label');
    assert.ok(adminModalSrc.includes('Application Type'), 'Admin case form modal must have Application Type label');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3 — LCA Number
  // ──────────────────────────────────────────────────────────────────────────
  test('TEST 3: LCA Number — Verify user-facing New Case form does not display "LCA Number"', () => {
    const cwCasesPath = path.join(rootDir, 'EPiC_Frontend', 'src', 'pages', 'caseworker', 'Cases.jsx');
    const adminModalPath = path.join(rootDir, 'EPiC_Frontend', 'src', 'components', 'admin', 'AdminCaseFormModal.jsx');

    const cwCasesSrc = fs.readFileSync(cwCasesPath, 'utf8');
    const adminModalSrc = fs.readFileSync(adminModalPath, 'utf8');

    assert.ok(!cwCasesSrc.includes('LCA Number'), 'Caseworker Cases form must not display LCA Number');
    assert.ok(!adminModalSrc.includes('label="LCA Number"'), 'AdminCaseFormModal must not display LCA Number');
    assert.ok(!cwCasesSrc.includes('placeholder="e.g. I-200-24001"'), 'Caseworker Cases form must not use US LCA placeholder');
    assert.ok(!adminModalSrc.includes('placeholder="e.g. I-200-24001"'), 'AdminCaseFormModal must not use US LCA placeholder');

    // Must use CoS Reference Number
    assert.ok(cwCasesSrc.includes('CoS Reference Number'), 'Caseworker Cases form must display CoS Reference Number');
    assert.ok(adminModalSrc.includes('label="CoS Reference Number"'), 'AdminCaseFormModal must display CoS Reference Number');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4 — Receipt Number
  // ──────────────────────────────────────────────────────────────────────────
  test('TEST 4: Receipt Number — Verify user-facing New Case form does not display "Receipt Number"', () => {
    const cwCasesPath = path.join(rootDir, 'EPiC_Frontend', 'src', 'pages', 'caseworker', 'Cases.jsx');
    const adminModalPath = path.join(rootDir, 'EPiC_Frontend', 'src', 'components', 'admin', 'AdminCaseFormModal.jsx');

    const cwCasesSrc = fs.readFileSync(cwCasesPath, 'utf8');
    const adminModalSrc = fs.readFileSync(adminModalPath, 'utf8');

    assert.ok(!cwCasesSrc.includes('Receipt Number'), 'Caseworker Cases form must not display Receipt Number');
    assert.ok(!adminModalSrc.includes('label="Receipt Number"'), 'AdminCaseFormModal must not display Receipt Number');
    assert.ok(!cwCasesSrc.includes('placeholder="e.g. EAC240..."'), 'Caseworker Cases form must not use US EAC receipt placeholder');
    assert.ok(!adminModalSrc.includes('placeholder="e.g. EAC240..."'), 'AdminCaseFormModal must not use US EAC receipt placeholder');

    // Must use UKVI Reference Number
    assert.ok(cwCasesSrc.includes('UKVI Reference Number'), 'Caseworker Cases form must display UKVI Reference Number');
    assert.ok(adminModalSrc.includes('label="UKVI Reference Number"'), 'AdminCaseFormModal must display UKVI Reference Number');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 5 — UK Terminology
  // ──────────────────────────────────────────────────────────────────────────
  test('TEST 5: UK Terminology — Replacement terminology matches UK/UKVI/CoS workflow and does not misrepresent underlying fields', () => {
    const pipelineCwPath = path.join(rootDir, 'EPiC_Frontend', 'src', 'pages', 'caseworker', 'Pipeline.jsx');
    const pipelineAdminPath = path.join(rootDir, 'EPiC_Frontend', 'src', 'pages', 'admin', 'AdminPipeline.jsx');
    const cwExportPath = path.join(rootDir, 'Server', 'src', 'modules', 'Caseworker', 'Cases', 'caseworkerCase.controller.js');
    const adminExportPath = path.join(rootDir, 'Server', 'src', 'modules', 'Admin', 'case.controller.js');

    const pipelineCwSrc = fs.readFileSync(pipelineCwPath, 'utf8');
    const pipelineAdminSrc = fs.readFileSync(pipelineAdminPath, 'utf8');
    const cwExportSrc = fs.readFileSync(cwExportPath, 'utf8');
    const adminExportSrc = fs.readFileSync(adminExportPath, 'utf8');

    // Pipeline previews use UK terminology:
    assert.ok(pipelineCwSrc.includes('CoS Reference Number'), 'Caseworker pipeline drawer has CoS Reference Number');
    assert.ok(pipelineCwSrc.includes('UKVI Reference Number'), 'Caseworker pipeline drawer has UKVI Reference Number');
    assert.ok(pipelineCwSrc.includes('Application Type'), 'Caseworker pipeline drawer has Application Type');

    assert.ok(pipelineAdminSrc.includes('CoS Reference Number'), 'Admin pipeline drawer has CoS Reference Number');
    assert.ok(pipelineAdminSrc.includes('UKVI Reference Number'), 'Admin pipeline drawer has UKVI Reference Number');
    assert.ok(pipelineAdminSrc.includes('Application Type'), 'Admin pipeline drawer has Application Type');

    // Excel exports use UK terminology:
    assert.ok(cwExportSrc.includes('header: "CoS Reference Number"'), 'Caseworker export has CoS Reference Number');
    assert.ok(cwExportSrc.includes('header: "UKVI Reference Number"'), 'Caseworker export has UKVI Reference Number');
    assert.ok(cwExportSrc.includes('header: "Application Type"'), 'Caseworker export has Application Type');
    assert.ok(cwExportSrc.includes('header: "Salary Offered (£)"'), 'Caseworker export has Salary Offered (£)');

    assert.ok(adminExportSrc.includes("header: 'CoS Reference Number'"), 'Admin export has CoS Reference Number');
    assert.ok(adminExportSrc.includes("header: 'UKVI Reference Number'"), 'Admin export has UKVI Reference Number');
    assert.ok(adminExportSrc.includes("header: 'Application Type'"), 'Admin export has Application Type');
    assert.ok(adminExportSrc.includes("header: 'Salary Offered (£)'"), 'Admin export has Salary Offered (£)');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 6 — Existing Case Data
  // ──────────────────────────────────────────────────────────────────────────
  test('TEST 6: Existing case data — Verify an existing case can still be opened and its data remains intact', async () => {
    // Find an existing case or create a mock legacy one
    let testCase = await Case.findOne({
      where: { organisation_id: orgId },
      order: [['id', 'DESC']],
    });

    if (!testCase) {
      const caseRef = await generateCaseId(tenantDb, { organisationId: orgId, visaTypeId: visaType?.id });
      testCase = await Case.create({
        caseId: caseRef,
        candidateId: candidateUser.id,
        sponsorId: sponsorUser?.id || null,
        visaTypeId: visaType?.id || null,
        petitionTypeId: petitionType?.id || null,
        priority: 'medium',
        status: 'In Progress',
        lcaNumber: 'COS-UK-998877',
        receiptNumber: 'UAN-2026-112233',
        salaryOffered: 45000,
        totalAmount: 1800,
        paidAmount: 900,
        assignedcaseworkerId: caseworkers.slice(0, 2).map((c) => c.id),
        organisation_id: orgId,
      });
    }

    // Reload the case from DB
    const loaded = await Case.findByPk(testCase.id, {
      include: [
        { model: VisaType, as: 'visaType' },
        { model: PetitionType, as: 'petitionType' },
      ],
    });

    assert.ok(loaded, 'Case must load successfully');
    assert.ok(loaded.caseId, 'Case ID must be intact');
    assert.equal(loaded.candidateId, testCase.candidateId, 'Candidate ID intact');
    assert.equal(loaded.lcaNumber, testCase.lcaNumber, 'CoS/LCA number intact');
    assert.equal(loaded.receiptNumber, testCase.receiptNumber, 'UKVI/receipt number intact');
    assert.equal(Number(loaded.totalAmount), Number(testCase.totalAmount), 'Total amount intact');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 7 — Case Creation
  // ──────────────────────────────────────────────────────────────────────────
  test('TEST 7: Case creation — Verify a valid case can still be submitted after terminology changes', async () => {
    const caseRef = await generateCaseId(tenantDb, { organisationId: orgId, visaTypeId: visaType?.id });
    const assignedIds = caseworkers.length >= 2
      ? [caseworkers[0].id, caseworkers[1].id]
      : [1, 2];

    const newCase = await Case.create({
      caseId: caseRef,
      candidateId: candidateUser.id,
      sponsorId: sponsorUser?.id || null,
      businessId: sponsorUser?.id || null,
      visaTypeId: visaType?.id || null,
      petitionTypeId: petitionType?.id || null,
      priority: 'high',
      status: 'In Progress',
      caseStage: DEFAULT_CASE_STAGE,
      targetSubmissionDate: '2026-12-31',
      lcaNumber: 'CoS-REF-778899', // CoS Reference Number
      receiptNumber: 'UKVI-UAN-123456', // UKVI Reference Number
      salaryOffered: 55000, // Stored numeric amount (£55,000)
      totalAmount: 2500, // Stored numeric amount (£2,500)
      paidAmount: 1250, // Stored numeric amount (£1,250)
      assignedcaseworkerId: assignedIds, // exactly 2 caseworkers
      organisation_id: orgId,
    });

    assert.ok(newCase.id, 'Case was created successfully');
    assert.equal(newCase.caseId, caseRef);
    assert.equal(newCase.lcaNumber, 'CoS-REF-778899');
    assert.equal(newCase.receiptNumber, 'UKVI-UAN-123456');
    assert.equal(Number(newCase.salaryOffered), 55000);
    assert.equal(Number(newCase.totalAmount), 2500);
    assert.equal(Number(newCase.paidAmount), 1250);

    // Verify caseworker count is strictly 2
    const finalCw = Array.isArray(newCase.assignedcaseworkerId) ? newCase.assignedcaseworkerId : [newCase.assignedcaseworkerId];
    assert.equal(finalCw.length, 2, 'Case must have exactly 2 caseworkers');

    // Clean up
    await newCase.destroy();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // STRICT RULE CONFIRMATIONS: Client terminology & Exactly 2 Caseworkers
  // ──────────────────────────────────────────────────────────────────────────
  test('CONFIRMATION: Client terminology is preserved and not renamed to Candidate', () => {
    const adminModalPath = path.join(rootDir, 'EPiC_Frontend', 'src', 'components', 'admin', 'AdminCaseFormModal.jsx');
    const pipelineCwPath = path.join(rootDir, 'EPiC_Frontend', 'src', 'pages', 'caseworker', 'Pipeline.jsx');
    const pipelineAdminPath = path.join(rootDir, 'EPiC_Frontend', 'src', 'pages', 'admin', 'AdminPipeline.jsx');

    const adminModalSrc = fs.readFileSync(adminModalPath, 'utf8');
    const pipelineCwSrc = fs.readFileSync(pipelineCwPath, 'utf8');
    const pipelineAdminSrc = fs.readFileSync(pipelineAdminPath, 'utf8');

    // Verify Client terminology
    assert.ok(adminModalSrc.includes('Client Information'), 'AdminCaseFormModal retains Client Information');
    assert.ok(adminModalSrc.includes('CCL fee (£) — amount Client must pay'), 'AdminCaseFormModal uses Client for CCL fee');
    assert.ok(!adminModalSrc.includes('amount candidate must pay'), 'Candidate must pay was removed in favor of Client');

    assert.ok(pipelineCwSrc.includes('<label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Client</label>'), 'Caseworker Pipeline displays Client');
    assert.ok(pipelineAdminSrc.includes('<label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Client</label>'), 'Admin Pipeline displays Client');
  });

  test('CONFIRMATION: Exactly 2 Caseworkers Rule strictly enforced', () => {
    const cwCasesPath = path.join(rootDir, 'EPiC_Frontend', 'src', 'pages', 'caseworker', 'Cases.jsx');
    const cwCasesSrc = fs.readFileSync(cwCasesPath, 'utf8');

    assert.ok(cwCasesSrc.includes('finalCount !== 2'), 'Validation checks finalCount !== 2');
    assert.ok(cwCasesSrc.includes('Exactly 2 caseworkers are required'), 'Validation error requires exactly 2 caseworkers');
  });
});
