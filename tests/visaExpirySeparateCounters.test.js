import dotenv from 'dotenv';
dotenv.config({ path: './Server/.env' });
process.env.NODE_ENV = 'development';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getTenantDb } from '../src/services/tenantDb.service.js';
import { ROLES } from '../src/middlewares/role.middleware.js';
import { CandidateService } from '../src/modules/Admin/Candidates/candidate.service.js';

describe('Separate Counters: Expired Visas vs Upcoming Visa Alerts', async () => {
  const tenantDb = getTenantDb(process.env.TEST_TENANT_DB || 'epic_technoweb');
  const { User, Organisation, Case } = tenantDb;
  const candidateService = new CandidateService(tenantDb);

  let counter = Date.now();

  async function createTestOrg() {
    const unique = `${counter++}_${Math.floor(Math.random() * 10000)}`;
    return await Organisation.create({
      name: `SepCounters Org ${unique}`,
      slug: `slug-sepcounters-${unique}`,
      primaryEmail: `org_${unique}@example.com`,
      code: `O${Math.floor(Math.random() * 1000)}`,
      status: 'active',
    });
  }

  async function createTestClient(namePrefix, organisationId) {
    return await User.create({
      first_name: namePrefix,
      last_name: 'SepTester',
      email: `test_sepcounters_${counter++}_${Math.floor(Math.random() * 10000)}@example.com`,
      country_code: '+44',
      mobile: `778${Math.floor(1000000 + Math.random() * 9000000)}`,
      password: 'HashedPassword123!',
      role_id: ROLES.CANDIDATE,
      is_email_verified: true,
      is_otp_verified: true,
      status: 'active',
      organisation_id: organisationId,
    });
  }

  test('Correctly separates Expired Visas (past dates) and Upcoming Visa Alerts (next 90 days)', async () => {
    const org = await createTestOrg();

    // Client 1: Expired 7 days ago
    const clientExpired1 = await createTestClient('ExpiredClient1', org.id);
    const pastDate1 = new Date();
    pastDate1.setDate(pastDate1.getDate() - 7);
    await Case.create({
      caseId: `CAS-SEP-1-${counter++}`,
      candidateId: clientExpired1.id,
      status: 'In Progress',
      targetSubmissionDate: '2026-12-31',
      visaEndDate: pastDate1,
      organisation_id: org.id,
    });

    // Client 2: Expired 1 day ago
    const clientExpired2 = await createTestClient('ExpiredClient2', org.id);
    const pastDate2 = new Date();
    pastDate2.setDate(pastDate2.getDate() - 1);
    await Case.create({
      caseId: `CAS-SEP-2-${counter++}`,
      candidateId: clientExpired2.id,
      status: 'In Progress',
      targetSubmissionDate: '2026-12-31',
      visaEndDate: pastDate2,
      organisation_id: org.id,
    });

    // Client 3: Upcoming in 15 days (within 90 days)
    const clientUpcoming = await createTestClient('UpcomingClient', org.id);
    const upcomingDate = new Date();
    upcomingDate.setDate(upcomingDate.getDate() + 15);
    await Case.create({
      caseId: `CAS-SEP-3-${counter++}`,
      candidateId: clientUpcoming.id,
      status: 'In Progress',
      targetSubmissionDate: '2026-12-31',
      visaEndDate: upcomingDate,
      organisation_id: org.id,
    });

    // Client 4: Far future in 180 days (beyond 90 days)
    const clientFar = await createTestClient('FarClient', org.id);
    const farDate = new Date();
    farDate.setDate(farDate.getDate() + 180);
    await Case.create({
      caseId: `CAS-SEP-4-${counter++}`,
      candidateId: clientFar.id,
      status: 'In Progress',
      targetSubmissionDate: '2026-12-31',
      visaEndDate: farDate,
      organisation_id: org.id,
    });

    const stats = await candidateService.getVisaExpiryAlertStats({
      organisationId: org.id,
      windowDays: 90,
    });

    assert.equal(stats.expired, 2, 'Must count exactly 2 expired visas');
    assert.equal(stats.upcoming, 1, 'Must count exactly 1 upcoming visa alert');
    assert.equal(stats.total, 3, 'Total alerts must equal expired + upcoming (3)');

    const upcomingCount = await candidateService.countUpcomingVisaExpiryAlerts({ organisationId: org.id });
    assert.equal(upcomingCount, 1, 'countUpcomingVisaExpiryAlerts must return upcoming count (1)');

    const expiredCount = await candidateService.countExpiredVisaAlerts({ organisationId: org.id });
    assert.equal(expiredCount, 2, 'countExpiredVisaAlerts must return expired count (2)');

    const listRes = await candidateService.getAllCandidates({}, org.id);
    assert.equal(listRes.visaExpiredAlertsCount, 2, 'getAllCandidates must expose visaExpiredAlertsCount (2)');
    assert.equal(listRes.visaExpiryAlertsCount, 1, 'getAllCandidates must expose visaExpiryAlertsCount (1)');
    assert.equal(listRes.visaExpiryAlerts.expiredCount, 2);
    assert.equal(listRes.visaExpiryAlerts.count, 1);
  });
});
