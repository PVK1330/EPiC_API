import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runBug029Tests() {
  console.log('============================================================');
  console.log('STARTING BUG-029 AUTOMATED TEST SUITE — REMOVE COS FROM CASEWORKER');
  console.log('============================================================\n');

  // TEST 1: Check caseworkerNavSections.js does not contain cos-requests
  console.log('TEST 1: Check caseworkerNavSections.js');
  const navSectionsPath = path.resolve(__dirname, '../../EPiC_Frontend/src/components/caseworkerNavSections.js');
  const navContent = fs.readFileSync(navSectionsPath, 'utf8');
  if (navContent.includes('/caseworker/cos-requests')) {
    throw new Error('TEST 1 Failed: /caseworker/cos-requests still present in caseworkerNavSections.js');
  }
  console.log('  [PASS] /caseworker/cos-requests successfully removed from caseworker navigation.\n');

  // TEST 2: Other caseworker tabs remain intact
  console.log('TEST 2: Verify other caseworker tabs remain');
  const expectedTabs = ['/caseworker/dashboard', '/caseworker/cases', '/caseworker/tasks', '/caseworker/calendar', '/caseworker/people/candidates', '/caseworker/licence-reviews'];
  for (const tab of expectedTabs) {
    if (!navContent.includes(tab)) {
      throw new Error(`TEST 2 Failed: Expected tab ${tab} missing from caseworkerNavSections.js`);
    }
  }
  console.log('  [PASS] All standard caseworker tabs remain intact.\n');

  // TEST 3: Check AppRouter.jsx redirects caseworker cos-requests
  console.log('TEST 3: Verify AppRouter.jsx routing');
  const routerPath = path.resolve(__dirname, '../../EPiC_Frontend/src/routes/AppRouter.jsx');
  const routerContent = fs.readFileSync(routerPath, 'utf8');
  if (routerContent.includes('<Route path="cos-requests" element={<CaseworkerCosRequests />} />')) {
    throw new Error('TEST 3 Failed: Direct caseworker cos-requests route still active in AppRouter.jsx');
  }
  if (!routerContent.includes('<Route path="cos-requests" element={<Navigate to="/caseworker/dashboard" replace />} />')) {
    throw new Error('TEST 3 Failed: Direct caseworker cos-requests redirect missing from AppRouter.jsx');
  }
  console.log('  [PASS] Direct caseworker cos-requests route redirected to dashboard.\n');

  // TEST 4: Verify Admin CoS Requests route is intact
  console.log('TEST 4: Verify Admin CoS Requests route is intact');
  if (!routerContent.includes('<Route path="cos-requests" element={<AdminCosRequests />} />')) {
    throw new Error('TEST 4 Failed: Admin CoS Requests route removed unintentionally!');
  }
  console.log('  [PASS] Admin CoS Requests route preserved for Admin/dedicated staff.\n');

  console.log('============================================================');
  console.log('ALL BUG-029 AUTOMATED TESTS PASSED 100%');
  console.log('============================================================');
  process.exit(0);
}

runBug029Tests().catch((err) => {
  console.error('BUG-029 Test Suite Failed:', err);
  process.exit(1);
});
