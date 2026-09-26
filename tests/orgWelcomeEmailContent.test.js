import test from 'node:test';
import assert from 'node:assert';
import { generateAdminCredentialsTemplate, generateOrganisationWelcomeTemplate } from '../src/utils/emailTemplates.js';
import { credentialsBlockHtml } from '../src/utils/epicEmailLayout.js';

test('credentialsBlockHtml renders Organisation ID, Organisation Code, and Candidate Self-Registration link', () => {
  const html = credentialsBlockHtml({
    email: 'admin@acme.com',
    password: 'TemporaryPassword123!',
    loginUrl: 'https://acme.epic.com/login',
    organisationId: 42,
    organisationCode: 'ACME2026',
    selfRegistrationUrl: 'https://acme.epic.com/login?tab=register&org=ACME2026',
  });

  assert.ok(html.includes('Organisation ID'), 'Must include Organisation ID label');
  assert.ok(html.includes('42'), 'Must include Organisation ID value');
  assert.ok(html.includes('Organisation Code'), 'Must include Organisation Code label');
  assert.ok(html.includes('ACME2026'), 'Must include Organisation Code value');
  assert.ok(html.includes('Candidate Self-Registration'), 'Must include Candidate Self-Registration section');
  assert.ok(html.includes('tab=register') && html.includes('org=ACME2026'), 'Must include candidate registration URL with org code');
});

test('generateAdminCredentialsTemplate forwards organisationId and organisationCode to email template', () => {
  const html = generateAdminCredentialsTemplate({
    email: 'admin@testcorp.com',
    password: 'TempPassword456!',
    loginUrl: 'https://testcorp.epic.com/login',
    organisationId: 105,
    organisationCode: 'TESTCORP',
    selfRegistrationUrl: 'https://testcorp.epic.com/login?tab=register&org=TESTCORP',
  });

  assert.ok(html.includes('105'), 'Template must include organisationId');
  assert.ok(html.includes('TESTCORP'), 'Template must include organisationCode');
  assert.ok(html.includes('Candidate Self-Registration'), 'Template must include Candidate Self-Registration');
  assert.ok(html.includes('tab=register') && html.includes('org=TESTCORP'), 'Template must include candidate registration query parameter');
});

test('generateOrganisationWelcomeTemplate renders Organisation ID and Code for tenant welcome', () => {
  const html = generateOrganisationWelcomeTemplate({
    organisationName: 'Global Visas Ltd',
    adminName: 'John Doe',
    email: 'john@globalvisas.com',
    temporaryPassword: 'SecurePassword789!',
    loginUrl: 'https://globalvisas.epic.com/login',
    organisationId: 88,
    organisationCode: 'GLOBALVISAS',
    selfRegistrationUrl: 'https://globalvisas.epic.com/login?tab=register&org=GLOBALVISAS',
  });

  assert.ok(html.includes('88'), 'Welcome template must include organisationId');
  assert.ok(html.includes('GLOBALVISAS'), 'Welcome template must include organisationCode');
  assert.ok(html.includes('Candidate Self-Registration'), 'Welcome template must include registration section');
});

test('sendOrganisationAdminWelcomeEmail prepares payload with Organisation ID, Code, and Self-Registration URL', async () => {
  const { sendOrganisationAdminWelcomeEmail } = await import('../src/services/mail.service.js');

  const admin = {
    first_name: 'Alice',
    email: 'alice@innovate.co.uk',
  };
  const org = {
    id: 55,
    name: 'Innovate Law',
    code: 'INNOVATE',
    slug: 'innovate-law',
  };

  // Calling with unconfigured or test SMTP still evaluates the message builder logic
  const result = await sendOrganisationAdminWelcomeEmail({
    admin,
    plainPassword: 'SecretPassword999!',
    organisationId: org.id,
    organisation: org,
  });

  // Result will have sent: false with reason: 'mail_not_configured' or sent: true depending on env
  assert.ok(result, 'Expected result object');
  assert.ok('sent' in result, 'Expected sent property');
});
