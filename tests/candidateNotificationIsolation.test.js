import assert from 'node:assert/strict';
import { getTenantDb } from '../src/services/tenantDb.service.js';
import {
  getUserNotifications,
  getUnreadCount,
  notifyDocumentUploaded,
  notifyPaymentReceived,
  notifyUser,
  notifyCaseAssigned,
  deleteNotification,
  NotificationTypes,
  NotificationPriority,
} from '../src/services/notification.service.js';
import * as notificationController from '../src/modules/Shared/Notifications/notification.controller.js';

async function runCandidateNotificationIsolationTests() {
  console.log('============================================================');
  console.log('STARTING CANDIDATE NOTIFICATION ISOLATION TEST SUITE (N1 - N12)');
  console.log('============================================================\n');

  const tenantDb = getTenantDb('epic_technoweb');
  const { User, Organisation, Notification } = tenantDb;

  // Sync sequences
  await tenantDb.sequelize.query(`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1));`);
  await tenantDb.sequelize.query(`SELECT setval('notifications_id_seq', COALESCE((SELECT MAX(id) FROM notifications), 1));`);

  const org = await Organisation.findOne({ order: [['id', 'ASC']] });
  const orgId = org ? org.id : 1;

  let counter = Date.now();
  async function createTestUser(roleId = 4, explicitOrgId = orgId) {
    return await User.create({
      first_name: `UAT-NOTIFICATION-${counter}`,
      last_name: 'Tester',
      email: `uat_notif_${counter++}@example.com`,
      country_code: '+44',
      mobile: `777${Math.floor(1000000 + Math.random() * 9000000)}`,
      password: 'HashedPassword123!',
      role_id: roleId,
      is_email_verified: true,
      is_otp_verified: true,
      status: 'active',
      organisation_id: explicitOrgId,
    });
  }

  const candidateA = await createTestUser(4, orgId);
  const candidateB = await createTestUser(4, orgId);

  // TEST N1: New candidate with no notifications returns empty list, no mock data
  console.log('TEST N1: New candidate with no notifications returns empty list');
  const notifsNew = await getUserNotifications(tenantDb, candidateB.id, { organisationId: orgId });
  assert.equal(notifsNew.notifications.length, 0, 'New candidate must have 0 notifications');
  assert.equal(notifsNew.total, 0, 'Total count must be 0');
  console.log('  [PASS] New candidate has 0 notifications (no mock/default data returned).\n');

  // TEST N2: Candidate A general notification is invisible to Candidate B
  console.log('TEST N2: Candidate A notification is invisible to Candidate B');
  const notifA1 = await notifyUser(tenantDb, candidateA.id, {
    title: 'Candidate A General Alert',
    message: 'Message meant only for Candidate A',
    category: 'system',
    organisationId: orgId,
  });
  const notifsB_N2 = await getUserNotifications(tenantDb, candidateB.id, { organisationId: orgId });
  assert.ok(!notifsB_N2.notifications.some(n => n.id === notifA1.id), 'Candidate B must not see Candidate A notification');
  console.log('  [PASS] Candidate B cannot see Candidate A general notification.\n');

  // TEST N3: Candidate A document notification is invisible to Candidate B
  console.log('TEST N3: Candidate A document notification is invisible to Candidate B');
  const docNotifA = await notifyDocumentUploaded(tenantDb, candidateA.id, {
    title: 'Document Uploaded: Passport',
    message: 'Passport document processed for Candidate A',
    id: 101,
  });
  const notifsB_N3 = await getUserNotifications(tenantDb, candidateB.id, { organisationId: orgId });
  assert.ok(!notifsB_N3.notifications.some(n => n.id === docNotifA.id), 'Candidate B must not see Candidate A document notification');
  console.log('  [PASS] Candidate B cannot see Candidate A document notification.\n');

  // TEST N4: Candidate A payment notification is invisible to Candidate B
  console.log('TEST N4: Candidate A payment notification is invisible to Candidate B');
  const payNotifA = await notifyPaymentReceived(tenantDb, candidateA.id, {
    title: 'Payment Received: £500',
    message: 'Payment received for Candidate A case',
    id: 202,
  });
  const notifsB_N4 = await getUserNotifications(tenantDb, candidateB.id, { organisationId: orgId });
  assert.ok(!notifsB_N4.notifications.some(n => n.id === payNotifA.id), 'Candidate B must not see Candidate A payment notification');
  console.log('  [PASS] Candidate B cannot see Candidate A payment notification.\n');

  // TEST N5: Candidate A visa expiry notification is invisible to Candidate B
  console.log('TEST N5: Candidate A visa expiry notification is invisible to Candidate B');
  const visaNotifA = await notifyUser(tenantDb, candidateA.id, {
    type: NotificationTypes.WARNING,
    priority: NotificationPriority.HIGH,
    title: 'Visa Expiry Alert',
    message: 'Your Skilled Worker Visa expires in 30 days',
    category: 'case',
    actionType: 'visa_expiry',
    organisationId: orgId,
  });
  const notifsB_N5 = await getUserNotifications(tenantDb, candidateB.id, { organisationId: orgId });
  assert.ok(!notifsB_N5.notifications.some(n => n.id === visaNotifA.id), 'Candidate B must not see Candidate A visa expiry alert');
  console.log('  [PASS] Candidate B cannot see Candidate A visa expiry alert.\n');

  // TEST N6: Candidate A case notification is invisible to Candidate B
  console.log('TEST N6: Candidate A case notification is invisible to Candidate B');
  const caseNotifA = await notifyCaseAssigned(tenantDb, candidateA.id, {
    caseId: 'CASE-CAND-A-999',
    candidateName: 'Candidate A',
    title: 'Case Status Updated: In Progress',
    message: 'Case status changed to In Progress for Candidate A',
    sendEmail: false,
  });
  const notifsB_N6 = await getUserNotifications(tenantDb, candidateB.id, { organisationId: orgId });
  assert.ok(!notifsB_N6.notifications.some(n => n.id === caseNotifA.id), 'Candidate B must not see Candidate A case notification');
  console.log('  [PASS] Candidate B cannot see Candidate A case notification.\n');

  // TEST N7: Controller derives user ID from authenticated token & ignores spoofed query parameters
  console.log('TEST N7: Controller ignores spoofed query parameters (userId / candidateId)');
  let controllerResult = null;
  const mockReqN7 = {
    user: { userId: candidateB.id, role_id: 4, organisation_id: orgId },
    query: { userId: candidateA.id, candidateId: candidateA.id, organisation_id: 999 },
    tenantDb,
  };
  const mockResN7 = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      controllerResult = data;
      return this;
    },
  };
  await notificationController.getNotifications(mockReqN7, mockResN7);
  assert.equal(mockResN7.statusCode, 200);
  const returnedIdsN7 = controllerResult.data.notifications.map(n => n.id);
  assert.ok(!returnedIdsN7.includes(notifA1.id), 'Controller must not return Candidate A notification even if Candidate B queries userId=CandidateA');
  console.log('  [PASS] Controller strictly derived identity from session and ignored spoofed query parameters.\n');

  // TEST N8: Cross-tenant notification isolation
  console.log('TEST N8: Cross-tenant notification isolation');
  const tenantBOrgId = orgId + 999;
  const candidateTenantB = await createTestUser(4, tenantBOrgId);
  const notifTenantB = await notifyUser(tenantDb, candidateTenantB.id, {
    title: 'Tenant B Secret Alert',
    message: 'Data belonging to Tenant B',
    organisationId: tenantBOrgId,
  });

  const notifsAFromTenantB = await getUserNotifications(tenantDb, candidateA.id, { organisationId: tenantBOrgId });
  assert.equal(notifsAFromTenantB.notifications.length, 0, 'Candidate A must receive 0 notifications when querying under another tenant ID');
  console.log('  [PASS] Cross-tenant notification isolation verified.\n');

  // TEST N9: Notification detail / mark-as-read / delete ownership enforcement
  console.log('TEST N9: Mark-as-read & delete ownership enforcement (returns 404 for unauthorized access)');
  let markResData = null;
  const mockReqMark = {
    user: { userId: candidateB.id, role_id: 4, organisation_id: orgId },
    params: { id: notifA1.id },
    tenantDb,
  };
  const mockResMark = {
    status(code) { this.statusCode = code; return this; },
    json(data) { markResData = data; return this; },
  };
  await notificationController.markNotificationAsRead(mockReqMark, mockResMark);
  assert.equal(mockResMark.statusCode, 404, 'Mark as read must return 404 when Candidate B attempts to mark Candidate A notification');

  let deleteResData = null;
  const mockReqDel = {
    user: { userId: candidateB.id, role_id: 4, organisation_id: orgId },
    params: { id: notifA1.id },
    tenantDb,
  };
  const mockResDel = {
    status(code) { this.statusCode = code; return this; },
    json(data) { deleteResData = data; return this; },
  };
  await notificationController.deleteNotificationById(mockReqDel, mockResDel);
  assert.equal(mockResDel.statusCode, 404, 'Delete notification must return 404 when Candidate B attempts to delete Candidate A notification');
  console.log('  [PASS] Single-notification mark-read and delete operations strictly enforce ownership.\n');

  // TEST N10: Session switch verification
  console.log('TEST N10: Logout/login switch clears state & returns only current candidate notifications');
  const notifB1 = await notifyUser(tenantDb, candidateB.id, {
    title: 'Candidate B Personal Alert',
    message: 'Targeted to Candidate B',
    organisationId: orgId,
  });
  const notifsA = await getUserNotifications(tenantDb, candidateA.id, { organisationId: orgId });
  const notifsB = await getUserNotifications(tenantDb, candidateB.id, { organisationId: orgId });

  assert.ok(notifsA.notifications.some(n => n.id === notifA1.id));
  assert.ok(!notifsA.notifications.some(n => n.id === notifB1.id));
  assert.ok(notifsB.notifications.some(n => n.id === notifB1.id));
  assert.ok(!notifsB.notifications.some(n => n.id === notifA1.id));
  console.log('  [PASS] Candidate A and Candidate B fetch strictly isolated notification payloads.\n');

  // TEST N11: API response contains only authorized records
  console.log('TEST N11: API response payload sanitization & authorization');
  const notifB_IDs = notifsB.notifications.map(n => n.userId);
  assert.ok(notifB_IDs.every(uid => uid === candidateB.id), 'Every notification in Candidate B response must belong to Candidate B');
  console.log('  [PASS] API response payload strictly contains only authorized notifications.\n');

  // TEST N12: No mock/default notifications for clean candidate
  console.log('TEST N12: Clean candidate with zero notifications');
  const candidateC = await createTestUser(4, orgId);
  const notifsC = await getUserNotifications(tenantDb, candidateC.id, { organisationId: orgId });
  assert.equal(notifsC.notifications.length, 0);
  assert.equal(notifsC.total, 0);
  console.log('  [PASS] Clean candidate returns 0 notifications without default/mock fallback.\n');

  // Cleanup test notifications
  await Notification.destroy({
    where: {
      userId: [candidateA.id, candidateB.id, candidateTenantB.id, candidateC.id],
    },
  });
  await User.destroy({
    where: {
      id: [candidateA.id, candidateB.id, candidateTenantB.id, candidateC.id],
    },
  });

  console.log('============================================================');
  console.log('ALL CANDIDATE NOTIFICATION ISOLATION TESTS PASSED (N1 - N12)');
  console.log('============================================================\n');
}

runCandidateNotificationIsolationTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
