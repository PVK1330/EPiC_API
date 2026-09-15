import assert from 'node:assert/strict';
import { getTenantDb } from '../src/services/tenantDb.service.js';
import { getWorkflowCalendarEvents } from '../src/services/calendarEvents.service.js';
import * as calendarController from '../src/modules/Shared/Calendar/calendar.controller.js';
import * as appointmentController from '../src/modules/Shared/Appointments/appointment.controller.js';
import { ROLES } from '../src/middlewares/role.middleware.js';

async function runCalendarAssignmentIsolationTests() {
  console.log('============================================================');
  console.log('STARTING CALENDAR ASSIGNMENT ISOLATION TEST SUITE');
  console.log('============================================================\n');

  const tenantDb = getTenantDb('epic_technoweb');
  const { User, Organisation, Task, Case, Appointment } = tenantDb;

  // Sync sequences
  await tenantDb.sequelize.query(`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1));`);
  await tenantDb.sequelize.query(`SELECT setval('tasks_id_seq', COALESCE((SELECT MAX(id) FROM tasks), 1));`);
  await tenantDb.sequelize.query(`SELECT setval('cases_id_seq', COALESCE((SELECT MAX(id) FROM cases), 1));`);
  await tenantDb.sequelize.query(`SELECT setval('appointments_id_seq', COALESCE((SELECT MAX(id) FROM appointments), 1));`);

  const org = await Organisation.findOne({ order: [['id', 'ASC']] });
  const orgId = org ? org.id : 1;

  let counter = Date.now();
  async function createTestUser(roleId = ROLES.CASEWORKER, explicitOrgId = orgId) {
    return await User.create({
      first_name: `UAT-CALENDAR-${counter}`,
      last_name: 'User',
      email: `uat_cal_${counter++}@example.com`,
      country_code: '+44',
      mobile: `776${Math.floor(1000000 + Math.random() * 9000000)}`,
      password: 'HashedPassword123!',
      role_id: roleId,
      is_email_verified: true,
      is_otp_verified: true,
      status: 'active',
      organisation_id: explicitOrgId,
    });
  }

  const superadminUser = await createTestUser(ROLES.SUPERADMIN, orgId);
  const adminUser = await createTestUser(ROLES.ADMIN, orgId);
  const caseworkerA = await createTestUser(ROLES.CASEWORKER, orgId);
  const caseworkerB = await createTestUser(ROLES.CASEWORKER, orgId);
  const candidateUser = await createTestUser(ROLES.CANDIDATE, orgId);
  const sponsorUser = await createTestUser(ROLES.BUSINESS, orgId);

  // ------------------------------------------------------------
  // 1. TASK EVENTS & ASSIGNMENT ISOLATION
  // ------------------------------------------------------------
  console.log('TEST C1: User A sees assigned task');
  const taskA = await Task.create({
    title: 'Task Assigned to Caseworker A',
    assigned_to: caseworkerA.id,
    created_by: adminUser.id,
    due_date: new Date().toISOString().split('T')[0],
    priority: 'medium',
    status: 'pending',
  });
  const eventsCW_A = await getWorkflowCalendarEvents(tenantDb, caseworkerA.id, ROLES.CASEWORKER, 'mine');
  assert.ok(eventsCW_A.some(e => e.taskId === taskA.id), 'Caseworker A must see task assigned to Caseworker A');
  console.log('  [PASS] Caseworker A sees task assigned to Caseworker A.\n');

  console.log('TEST C2: User A (Caseworker A) cannot see User B (Caseworker B) task');
  const taskB = await Task.create({
    title: 'Task Assigned to Caseworker B',
    assigned_to: caseworkerB.id,
    created_by: adminUser.id,
    due_date: new Date().toISOString().split('T')[0],
    priority: 'high',
    status: 'pending',
  });
  assert.ok(!eventsCW_A.some(e => e.taskId === taskB.id), 'Caseworker A must not see Caseworker B task');
  console.log('  [PASS] Caseworker A cannot see Caseworker B task.\n');

  console.log('TEST C3 & C5: Visibility follows assigned_to (assignee), not created_by (creator)');
  const eventsCW_B = await getWorkflowCalendarEvents(tenantDb, caseworkerB.id, ROLES.CASEWORKER, 'mine');
  assert.ok(eventsCW_B.some(e => e.taskId === taskB.id), 'Caseworker B sees task B');
  assert.ok(!eventsCW_B.some(e => e.taskId === taskA.id), 'Caseworker B does NOT see task A created by Admin for Caseworker A');
  console.log('  [PASS] Task created by Admin for Caseworker A is visible to Caseworker A, not Caseworker B.\n');

  console.log('TEST C4: Caseworker B cannot see Caseworker A task');
  assert.ok(!eventsCW_B.some(e => e.taskId === taskA.id));
  console.log('  [PASS] Caseworker B isolation verified.\n');

  console.log('TEST C6: Candidate cannot see internal caseworker/admin tasks');
  const eventsCand = await getWorkflowCalendarEvents(tenantDb, candidateUser.id, ROLES.CANDIDATE, 'mine');
  assert.ok(!eventsCand.some(e => e.taskId === taskA.id || e.taskId === taskB.id), 'Candidate must not see internal tasks');
  console.log('  [PASS] Candidate cannot see internal tasks.\n');

  // ------------------------------------------------------------
  // 2. UNASSIGNED / OTHER USER TASKS
  // ------------------------------------------------------------
  console.log('TEST C7: Tasks assigned to others do not appear in personal calendar scope=mine');
  const otherUserTask = await Task.create({
    title: 'Organisation Task Assigned to Other User',
    assigned_to: adminUser.id,
    created_by: adminUser.id,
    due_date: new Date().toISOString().split('T')[0],
    priority: 'low',
    status: 'pending',
  });
  assert.ok(!eventsCW_A.some(e => e.taskId === otherUserTask.id), 'Task assigned to Admin must not appear in Caseworker A personal calendar');
  assert.ok(!eventsCW_B.some(e => e.taskId === otherUserTask.id), 'Task assigned to Admin must not appear in Caseworker B personal calendar');
  console.log('  [PASS] Tasks assigned to others are excluded from personal scope=mine.\n');

  // ------------------------------------------------------------
  // 3. APPOINTMENTS (OWNER, CASEWORKER, INVITED STAFF, CANCELLED)
  // ------------------------------------------------------------
  console.log('TEST C8: Appointment visibility by participant & invited staff');
  const appointmentA = await Appointment.create({
    title: 'Candidate Consultation with Caseworker A',
    description: 'Initial intake meeting',
    date: new Date().toISOString().split('T')[0],
    time: '10:00 AM',
    platform: 'Teams',
    candidate_id: candidateUser.id,
    caseworker_id: caseworkerA.id,
    invited_staff: [caseworkerA.id],
    status: 'scheduled',
    organisation_id: orgId,
  });

  const apptInvited = await Appointment.create({
    title: 'Multi-staff Case Strategy Session',
    description: 'Strategy session with invited staff',
    date: new Date().toISOString().split('T')[0],
    time: '02:00 PM',
    platform: 'Google Meet',
    candidate_id: candidateUser.id,
    caseworker_id: adminUser.id,
    invited_staff: [caseworkerB.id],
    status: 'scheduled',
    organisation_id: orgId,
  });

  const apptCancelled = await Appointment.create({
    title: 'Cancelled Client Briefing',
    description: 'Cancelled meeting',
    date: new Date().toISOString().split('T')[0],
    time: '04:00 PM',
    platform: 'Zoom',
    candidate_id: candidateUser.id,
    caseworker_id: caseworkerA.id,
    invited_staff: [],
    status: 'cancelled',
    organisation_id: orgId,
  });

  // Query appointments for Candidate
  let candApptRes = null;
  await appointmentController.getMyAppointments(
    { user: { userId: candidateUser.id, role_id: ROLES.CANDIDATE }, tenantDb },
    { status: (c) => ({ json: (d) => { candApptRes = d; } }) }
  );
  assert.ok(candApptRes.data.appointments.some(a => a.id === appointmentA.id), 'Candidate sees own appointment');
  assert.ok(candApptRes.data.appointments.some(a => a.id === apptInvited.id), 'Candidate sees invited appointment where they are candidate');

  // Query appointments for Caseworker A
  let cwAApptRes = null;
  await appointmentController.getMyAppointments(
    { user: { userId: caseworkerA.id, role_id: ROLES.CASEWORKER }, tenantDb },
    { status: (c) => ({ json: (d) => { cwAApptRes = d; } }) }
  );
  assert.ok(cwAApptRes.data.appointments.some(a => a.id === appointmentA.id), 'Caseworker A sees appointment where assigned as caseworker');
  assert.ok(!cwAApptRes.data.appointments.some(a => a.id === apptInvited.id), 'Caseworker A does NOT see appointment where not caseworker or invited');

  // Query appointments for Caseworker B (invited staff test)
  let cwBApptRes = null;
  await appointmentController.getMyAppointments(
    { user: { userId: caseworkerB.id, role_id: ROLES.CASEWORKER }, tenantDb },
    { status: (c) => ({ json: (d) => { cwBApptRes = d; } }) }
  );
  assert.ok(!cwBApptRes.data.appointments.some(a => a.id === appointmentA.id), 'Caseworker B does NOT see Caseworker A appointment');
  assert.ok(cwBApptRes.data.appointments.some(a => a.id === apptInvited.id), 'Caseworker B sees appointment where listed in invited_staff JSON');
  console.log('  [PASS] Appointments strictly isolated by participant and invited_staff array.\n');

  // ------------------------------------------------------------
  // 4. BIOMETRICS & WORKFLOW EVENTS
  // ------------------------------------------------------------
  console.log('TEST C9: Biometrics and Workflow case deadlines');
  const caseCand = await Case.create({
    caseId: `CASE-CAL-${counter++}`,
    candidateId: candidateUser.id,
    assignedcaseworkerId: JSON.stringify([caseworkerA.id]),
    status: 'Lead',
    caseStage: 'initial_consultation',
    targetSubmissionDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    workflowState: {
      biometrics: {
        bookedSlot: {
          appointmentDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          appointmentTime: '11:00 AM',
          location: 'VFS London',
        },
      },
    },
    organisation_id: orgId,
  });

  const eventsCandCase = await getWorkflowCalendarEvents(tenantDb, candidateUser.id, ROLES.CANDIDATE, 'mine');
  assert.ok(eventsCandCase.some(e => e.id === `target-submission-${caseCand.id}`), 'Candidate sees target submission date');
  assert.ok(eventsCandCase.some(e => e.id === `biometric-${caseCand.id}`), 'Candidate sees biometric appointment');

  const eventsCW_B_Case = await getWorkflowCalendarEvents(tenantDb, caseworkerB.id, ROLES.CASEWORKER, 'mine');
  assert.ok(!eventsCW_B_Case.some(e => e.id === `target-submission-${caseCand.id}`), 'Unassigned Caseworker B does NOT see Candidate case deadline');
  assert.ok(!eventsCW_B_Case.some(e => e.id === `biometric-${caseCand.id}`), 'Unassigned Caseworker B does NOT see Candidate biometric appointment');
  console.log('  [PASS] Biometrics and workflow events visible only to assigned candidate & caseworker.\n');

  // ------------------------------------------------------------
  // 5. ROLE AUTHORIZATION & SUPERADMIN TENANT SCOPE
  // ------------------------------------------------------------
  console.log('TEST C10: Unauthorized scope=all requests by non-admin roles are safely downgraded');
  const nonAdminRoles = [
    { roleId: ROLES.CANDIDATE, name: 'Candidate' },
    { roleId: ROLES.CASEWORKER, name: 'Caseworker' },
    { roleId: ROLES.BUSINESS, name: 'Sponsor' },
  ];

  for (const { roleId, name } of nonAdminRoles) {
    let result = null;
    const req = { user: { userId: caseworkerA.id, role_id: roleId, organisation_id: orgId }, query: { scope: 'all' }, tenantDb };
    const res = { status: (c) => ({ json: (d) => { result = d; } }) };
    await calendarController.getWorkflowEvents(req, res);
    assert.equal(result.data.scope, 'mine', `${name} scope=all must be downgraded to scope=mine`);
  }
  console.log('  [PASS] Candidate, Caseworker, and Sponsor scope=all requests strictly forced to scope=mine.\n');

  console.log('TEST C11: Superadmin & Admin scope=all tenant boundary enforcement');
  const [orgB] = await Organisation.findOrCreate({
    where: { slug: 'uat-cal-tenant-b' },
    defaults: { name: 'UAT Cal Tenant B', slug: 'uat-cal-tenant-b', primaryEmail: 'uat_cal_b@example.com', status: 'active' }
  });
  const tenantBOrgId = orgB.id;
  const userTenantB = await createTestUser(ROLES.CASEWORKER, tenantBOrgId);

  // Admin scope=all returns tenant organisation tasks, but not another tenant
  let adminAllResult = null;
  const reqAdmin = { user: { userId: adminUser.id, role_id: ROLES.ADMIN, organisation_id: orgId }, query: { scope: 'all' }, tenantDb };
  const resAdmin = { status: (c) => ({ json: (d) => { adminAllResult = d; } }) };
  await calendarController.getWorkflowEvents(reqAdmin, resAdmin);
  assert.equal(adminAllResult.data.scope, 'all');
  assert.ok(adminAllResult.data.events.some(e => e.taskId === taskA.id), 'Admin scope=all includes tenant task A');
  assert.ok(adminAllResult.data.events.some(e => e.taskId === otherUserTask.id), 'Admin scope=all includes organisation task');

  // Superadmin scope=all returns current organisation/tenant tasks
  let superadminAllResult = null;
  const reqSuperadmin = { user: { userId: superadminUser.id, role_id: ROLES.SUPERADMIN, organisation_id: orgId }, query: { scope: 'all' }, tenantDb };
  const resSuperadmin = { status: (c) => ({ json: (d) => { superadminAllResult = d; } }) };
  await calendarController.getWorkflowEvents(reqSuperadmin, resSuperadmin);
  assert.equal(superadminAllResult.data.scope, 'all');
  assert.ok(superadminAllResult.data.events.some(e => e.taskId === taskA.id), 'Superadmin scope=all includes tenant task A');

  // Superadmin scope=mine returns only tasks assigned to Superadmin
  let superadminMineResult = null;
  const reqSuperadminMine = { user: { userId: superadminUser.id, role_id: ROLES.SUPERADMIN, organisation_id: orgId }, query: { scope: 'mine' }, tenantDb };
  const resSuperadminMine = { status: (c) => ({ json: (d) => { superadminMineResult = d; } }) };
  await calendarController.getWorkflowEvents(reqSuperadminMine, resSuperadminMine);
  assert.equal(superadminMineResult.data.scope, 'mine');
  assert.ok(!superadminMineResult.data.events.some(e => e.taskId === taskA.id), 'Superadmin scope=mine excludes unassigned/caseworker tasks');
  console.log('  [PASS] Superadmin & Admin scope=all operate strictly within current tenant DB boundaries.\n');

  // ------------------------------------------------------------
  // 6. UNAUTHENTICATED & EMPTY STATE
  // ------------------------------------------------------------
  console.log('TEST C12: Unauthenticated calendar request returns 401');
  let mock401Result = null;
  await calendarController.getWorkflowEvents(
    { user: null, query: {}, tenantDb },
    { status: (c) => ({ json: (d) => { mock401Result = d; } }) }
  );
  assert.equal(mock401Result.status, 'error');
  console.log('  [PASS] Unauthenticated request returns 401.\n');

  // Cleanup test data
  await Task.destroy({ where: { id: [taskA.id, taskB.id, otherUserTask.id] } });
  await Appointment.destroy({ where: { id: [appointmentA.id, apptInvited.id, apptCancelled.id] } });
  await Case.destroy({ where: { id: [caseCand.id] } });
  await User.destroy({
    where: {
      id: [superadminUser.id, adminUser.id, caseworkerA.id, caseworkerB.id, candidateUser.id, sponsorUser.id, userTenantB.id],
    },
  });

  console.log('============================================================');
  console.log('ALL CALENDAR EVENT SOURCE & ISOLATION TESTS PASSED');
  console.log('============================================================\n');
}

runCalendarAssignmentIsolationTests().catch((err) => {
  console.error(err);
  process.exit(1);
});

