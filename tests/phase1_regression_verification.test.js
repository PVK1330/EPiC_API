/**
 * tests/phase1_regression_verification.test.js
 * 
 * PHASE-1 REGRESSION VERIFICATION TEST SUITE
 * Covers:
 * - BUG-005: Registration Organisation ID vs Case ID
 * - BUG-018: Candidate Application Excel Import Configuration
 * - BUG-024: Notifications Display Candidate Name alongside Case Reference
 * - BUG-025: Case Workflow Consultation Stage (Business Decision Verification)
 * - BUG-026: Target Submission Date in Caseworker Calendar
 * - BUG-027: Other Caseworkers Adding Notes to Unassigned Cases (Access Policy Verification)
 * - BUG-028: Automated Case Timeline Generation
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { registerSchema } from '../src/validations/auth.validation.js';
import * as candidateApplicationController from '../src/modules/Candidate/Application/candidateApplication.controller.js';
import { notifyCaseAssigned } from '../src/services/notification.service.js';
import { getWorkflowCalendarEvents } from '../src/services/calendarEvents.service.js';
import { IMMIGRATION_CASE_STEPS } from '../src/constants/immigrationCaseProcess.js';
import { recordTimelineEntry } from '../src/services/caseTimeline.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Phase-1 Regression Verification Suite (BUG-005, BUG-018, BUG-024, BUG-025, BUG-026, BUG-027, BUG-028)', () => {

  // =========================================================================
  // BUG-005: Registration Reference Number (Organisation ID vs Case ID)
  // =========================================================================
  describe('BUG-005: Candidate Registration ID & Organisation Code', () => {
    test('Self-registration schema does NOT require organisation_id or treat it as a mandatory Case ID', async () => {
      const candidatePayload = {
        first_name: 'Wahid',
        last_name: 'Manzoor',
        email: 'wahid.test@example.com',
        password: 'ValidPassword123!',
        country_code: '+44',
        mobile: '7896600585',
        date_of_birth: '1988-02-18',
        address: '64 Olastonbury Road',
        city: 'Birmingham',
        state: 'West Midlands',
        country: 'United Kingdom',
        pincode: 'B14 4DR',
        nationality: 'Pakistan',
      };

      // 1. Without organisation_id
      const resWithoutOrg = await registerSchema.safeParseAsync({ body: candidatePayload });
      assert.equal(resWithoutOrg.success, true, 'Registration succeeds without organisation_id');
      assert.equal(resWithoutOrg.data.body.organisation_id, undefined);

      // 2. With optional organisation_id (e.g. EPIC2026)
      const resWithOrg = await registerSchema.safeParseAsync({
        body: { ...candidatePayload, email: 'wahid2.test@example.com', organisation_id: 'EPIC2026' }
      });
      assert.equal(resWithOrg.success, true, 'Registration succeeds with optional firm code EPIC2026');
      assert.equal(resWithOrg.data.body.organisation_id, 'EPIC2026');
    });

    test('Frontend registration form presents organisation field as optional and does not mislabel it as Case ID', () => {
      const loginPagePath = path.resolve(__dirname, '../../EPiC_Frontend/src/pages/auth/LoginPage.jsx');
      const content = fs.readFileSync(loginPagePath, 'utf8');

      // Verify label is optional and explanatory
      assert.ok(
        content.includes('label="Organisation ID or code (optional)"'),
        'Registration page labels Organisation ID as optional'
      );
      assert.ok(
        content.includes('If your adviser provided an organisation code or link, it will be applied automatically'),
        'Explains that organisation code is provided by adviser or link'
      );
      assert.ok(
        !content.includes('Case ID *'),
        'Registration page does not inappropriately demand a pre-existing Case ID'
      );
    });
  });

  // =========================================================================
  // BUG-018: Candidate Application Excel Import Configuration
  // =========================================================================
  describe('BUG-018: Application Import Form & Endpoint Configuration', () => {
    test('Backend export/import endpoints are configured and exported', () => {
      assert.equal(
        typeof candidateApplicationController.importCandidateApplicationsExcel,
        'function',
        'importCandidateApplicationsExcel controller exists'
      );
      assert.equal(
        typeof candidateApplicationController.downloadImportSampleTemplate,
        'function',
        'downloadImportSampleTemplate controller exists'
      );
    });

    test('Candidate routes register /applications/import and /applications/import/sample with Staff role checks', () => {
      const routesPath = path.resolve(__dirname, '../src/modules/Admin/Candidates/candidate.routes.js');
      const content = fs.readFileSync(routesPath, 'utf8');

      assert.ok(
        content.includes('/applications/import/sample'),
        'Route /applications/import/sample registered'
      );
      assert.ok(
        content.includes('/applications/import'),
        'Route /applications/import registered'
      );
      assert.ok(
        content.includes('checkRole([ROLES.ADMIN, ROLES.CASEWORKER])'),
        'Import routes guarded by Admin and Caseworker roles'
      );
    });

    test('Frontend AdminCandidates has configured Import modal, sample template button, and import handler', () => {
      const adminCandidatesPath = path.resolve(__dirname, '../../EPiC_Frontend/src/pages/admin/AdminCandidates.jsx');
      const content = fs.readFileSync(adminCandidatesPath, 'utf8');

      assert.ok(content.includes('Import Data'), 'AdminCandidates has Import Data action button');
      assert.ok(content.includes('Download sample template (.xlsx)'), 'Has sample template download action');
      assert.ok(content.includes('importCandidateApplicationsExcel'), 'Calls candidateApi import service');
      assert.ok(content.includes('title="Import applications (Excel)"'), 'Has import modal dialog');
    });
  });

  // =========================================================================
  // BUG-024: Notifications Clearly Display Candidate Name alongside Case Ref
  // =========================================================================
  describe('BUG-024: Notifications Surface Candidate Name', () => {
    test('notifyCaseAssigned includes candidateName in notification title, message, and metadata', async () => {
      let createdPayload = null;

      const mockTenantDb = {
        User: {
          findByPk: async () => ({
            id: 20,
            first_name: 'Simran',
            last_name: 'Kaur',
            email: 'simran@example.com',
            organisation_id: 1
          })
        },
        NotificationPreference: {
          findOne: async () => ({ inAppNotifications: true, emailNotifications: false })
        },
        Notification: {
          create: async (payload) => {
            createdPayload = payload;
            return { id: 101, ...payload };
          }
        }
      };

      await notifyCaseAssigned(mockTenantDb, 20, {
        id: 55,
        caseId: 'EPIC-ILR26-001',
        candidateName: 'Wahid Manzoor',
        assignedBy: 'Admin Khalid',
        sendEmail: false
      });

      assert.ok(createdPayload, 'Notification was created in database');
      assert.ok(
        createdPayload.title.includes('Wahid Manzoor'),
        `Title "${createdPayload.title}" must contain candidate name "Wahid Manzoor"`
      );
      assert.ok(
        createdPayload.title.includes('EPIC-ILR26-001'),
        `Title "${createdPayload.title}" must contain case reference "EPIC-ILR26-001"`
      );
      assert.ok(
        createdPayload.message.includes('Wahid Manzoor'),
        `Message "${createdPayload.message}" must contain candidate name "Wahid Manzoor"`
      );
      assert.ok(
        createdPayload.message.includes('EPIC-ILR26-001'),
        `Message "${createdPayload.message}" must contain case reference "EPIC-ILR26-001"`
      );
    });
  });

  // =========================================================================
  // BUG-025: Consultation Stage Routing vs Direct Assignment (Business Decision)
  // =========================================================================
  describe('BUG-025: Case Workflow Consultation Stage (Business Decision Verification)', () => {
    test('Workflow stages include initial_consultation as an active formal stage', () => {
      assert.ok(Array.isArray(IMMIGRATION_CASE_STEPS), 'IMMIGRATION_CASE_STEPS is an array');
      const consultationStage = IMMIGRATION_CASE_STEPS.find(s => s.id === 'initial_consultation');
      assert.ok(consultationStage, 'initial_consultation stage exists in workflow definitions');
      assert.equal(consultationStage.title, 'Initial Consultation');
    });

    test('Workflow transitions allow advancing or custom routing based on firm policy', () => {
      const processPath = path.resolve(__dirname, '../src/constants/immigrationCaseProcess.js');
      const content = fs.readFileSync(processPath, 'utf8');

      // Confirms both consultation and admin assignment stages are defined
      assert.ok(content.includes('client_enquiry'), 'Has client_enquiry stage');
      assert.ok(content.includes('consultation'), 'Has consultation stage');
      assert.ok(content.includes('admin_assignment'), 'Has admin_assignment stage');
      assert.ok(content.includes('data_capture_initial_docs'), 'Has data_capture_initial_docs stage');
    });
  });

  // =========================================================================
  // BUG-026: Target Submission Date in Caseworker Calendar
  // =========================================================================
  describe('BUG-026: Target Submission Date Visible in Caseworker Calendar', () => {
    test('getWorkflowCalendarEvents returns target submission date as deadline calendar event', async () => {
      const mockTenantDb = {
        sequelize: { literal: (str) => str },
        Task: {
          findAll: async () => []
        },
        Case: {
          findAll: async () => [
            {
              id: 42,
              caseId: 'EPIC-ILR26-001',
              candidateId: 10,
              workflowState: {},
              targetSubmissionDate: '2026-10-25T12:00:00.000Z',
              biometricsDate: null,
            }
          ]
        },
        LicenceStageTask: {
          findAll: async () => []
        },
        LicenceApplication: {
          findAll: async () => []
        },
      };

      const events = await getWorkflowCalendarEvents(mockTenantDb, 20, 2, 'mine');
      const targetEvent = events.find(e => e.id === 'target-submission-42');

      assert.ok(targetEvent, 'Target submission date event exists in calendar events');
      assert.equal(targetEvent.type, 'deadline');
      assert.equal(targetEvent.isDeadline, true);
      assert.ok(targetEvent.title.includes('Target submission due'));
      assert.ok(targetEvent.title.includes('EPIC-ILR26-001'));
      assert.equal(targetEvent.caseId, 'EPIC-ILR26-001');
      assert.equal(targetEvent.start, new Date('2026-10-25T12:00:00.000Z').toISOString());
    });

    test('Frontend Caseworker Calendar fetches and renders workflow calendar events', () => {
      const calendarPath = path.resolve(__dirname, '../../EPiC_Frontend/src/pages/caseworker/Calendar.jsx');
      const content = fs.readFileSync(calendarPath, 'utf8');

      assert.ok(content.includes('getWorkflowCalendarEvents'), 'Caseworker calendar calls getWorkflowCalendarEvents()');
      assert.ok(content.includes('mapWorkflowEventsToCalendar'), 'Transforms workflow events for calendar display');
      assert.ok(content.includes('allEvents'), 'Merges workflow events into calendar allEvents list');
    });
  });

  // =========================================================================
  // BUG-027: Caseworkers Adding Notes to Unassigned Cases (Access Policy)
  // =========================================================================
  describe('BUG-027: Note Creation Permission on Cases (Access Policy Verification)', () => {
    test('caseNote.controller.js enforces assigned caseworker or admin gate', () => {
      const controllerPath = path.resolve(__dirname, '../src/modules/Admin/Dashboard/caseNote.controller.js');
      const content = fs.readFileSync(controllerPath, 'utf8');

      // Verifies the access check logic
      assert.ok(
        content.includes('roleId === ROLES.CASEWORKER && assignedIds.includes(Number(userId))'),
        'Checks if caseworker is assigned to case'
      );
      assert.ok(
        content.includes('const isAdmin = roleId === ROLES.ADMIN || roleId === ROLES.SUPERADMIN'),
        'Admins and Superadmins can add notes to any case'
      );
      assert.ok(
        content.includes('message: "You are not authorized to add notes to this case."'),
        'Returns 403 with standard authorization error when unauthorized user attempts to add note'
      );
    });
  });

  // =========================================================================
  // BUG-028: Automated Case Timeline Generation
  // =========================================================================
  describe('BUG-028: Automated Case Timeline Generation', () => {
    test('recordTimelineEntry function exists and persists timeline rows', async () => {
      let createdRow = null;
      const mockTenantDb = {
        CaseTimeline: {
          create: async (data) => {
            createdRow = data;
            return { id: 1, ...data };
          }
        }
      };

      await recordTimelineEntry({
        tenantDb: mockTenantDb,
        caseId: 50,
        actionType: 'status_change',
        description: 'Case status updated automatically to In Progress',
        performedBy: 1,
        metadata: { stage: 'application_preparation' }
      });

      assert.ok(createdRow, 'Timeline entry created in database');
      assert.equal(createdRow.caseId, 50);
      assert.equal(createdRow.actionType, 'status_change');
      assert.equal(createdRow.description, 'Case status updated automatically to In Progress');
    });

    test('Case workflow process automatically triggers recordTimelineEntry across lifecycle events', () => {
      const workflowServicePath = path.resolve(__dirname, '../src/services/caseWorkflowProcess.service.js');
      const content = fs.readFileSync(workflowServicePath, 'utf8');

      assert.ok(content.includes('recordTimelineEntry'), 'Imports and uses recordTimelineEntry');
      // Verifies automated triggers for draft review, biometrics, submission
      assert.ok(content.includes('Candidate confirmed draft application'), 'Records draft review timeline event');
      assert.ok(content.includes('Application submitted on visa portal'), 'Records application submission timeline event');
      assert.ok(content.includes('Biometrics appointment:'), 'Records biometrics slot timeline event');
    });
  });
});
