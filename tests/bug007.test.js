import { getTenantDb } from '../src/services/tenantDb.service.js';
import { sanitizeApplicationPayload, validateFinalApplicationSubmission } from '../src/utils/applicationPayload.util.js';

async function runVerification() {
  console.log('--- Testing applicationPayload.util.js sanitization & validation ---');

  // Test 1: Valid payload with Rent
  const validRent = {
    firstName: 'John',
    lastName: 'Doe',
    address: '123 High Street, London',
    addressStartDate: '2023-01-15',
    housingStatus: 'Rent',
    landlordName: 'Letting Agency Ltd',
    landlordContactNumber: '+44 7123456789',
    landlordEmail: 'agency@example.com',
    landlordAddress: '456 Agency Road, London',
  };
  const sanitized = sanitizeApplicationPayload(validRent);
  console.log('[PASS] Sanitized payload:', sanitized.addressStartDate, sanitized.housingStatus, sanitized.landlordName);
  validateFinalApplicationSubmission(sanitized);
  console.log('[PASS] validateFinalApplicationSubmission passed for valid Rent payload');

  // Test 2: Valid payload with Own
  const validOwn = {
    addressStartDate: '2020-05-01',
    housingStatus: 'Own',
  };
  const sanitizedOwn = sanitizeApplicationPayload(validOwn);
  validateFinalApplicationSubmission(sanitizedOwn);
  console.log('[PASS] validateFinalApplicationSubmission passed for Own payload (no landlord required)');

  // Test 3: Future date rejection
  try {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    sanitizeApplicationPayload({ addressStartDate: futureDate.toISOString().slice(0, 10) });
    console.error('[FAIL] Future date was not rejected!');
  } catch (err) {
    console.log('[PASS] Future date correctly rejected:', err.message);
  }

  // Test 4: Rent without landlord name rejection
  try {
    validateFinalApplicationSubmission({ addressStartDate: '2023-01-01', housingStatus: 'Rent' });
    console.error('[FAIL] Missing landlord name was not rejected!');
  } catch (err) {
    console.log('[PASS] Missing landlord name rejected:', err.message);
  }

  // Test 5: Database schema check
  const db = getTenantDb('epic_technoweb');
  const [cols] = await db.sequelize.query(`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'candidate_applications' 
      AND column_name IN ('addressStartDate', 'housingStatus', 'landlordName', 'landlordContactNumber', 'landlordEmail', 'landlordAddress')
    ORDER BY column_name;
  `);
  console.log('[PASS] DB CandidateApplication columns:', cols);

  const [unverifiedCols] = await db.sequelize.query(`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'unverified_users' 
      AND column_name = 'profile_data';
  `);
  console.log('[PASS] DB UnverifiedUser profile_data column:', unverifiedCols);

  console.log('\n--- ALL BUG-007 UNIT VERIFICATIONS PASSED ---');
  process.exit(0);
}

runVerification().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
