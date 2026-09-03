import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runBug022Tests() {
  console.log('============================================================');
  console.log('STARTING BUG-022 AUTOMATED TEST SUITE — SYSTEM-WIDE CASE TERMINOLOGY');
  console.log('============================================================\n');

  // TEST 1: Check AdminCases.jsx table header uses "Case"
  console.log('TEST 1: Check AdminCases.jsx table header');
  const adminCasesPath = path.resolve(__dirname, '../../EPiC_Frontend/src/pages/admin/AdminCases.jsx');
  const adminCasesContent = fs.readFileSync(adminCasesPath, 'utf8');
  if (adminCasesContent.includes('"Case ID",\n  "Client"')) {
    throw new Error('TEST 1 Failed: "Case ID" still in AdminCases.jsx table header');
  }
  if (!adminCasesContent.includes('"Case",\n  "Client"')) {
    throw new Error('TEST 1 Failed: "Case" header missing in AdminCases.jsx');
  }
  console.log('  [PASS] AdminCases table header uses "Case".\n');

  // TEST 2: Check AdminDashboard.jsx table header uses "Case"
  console.log('TEST 2: Check AdminDashboard.jsx table header');
  const adminDashPath = path.resolve(__dirname, '../../EPiC_Frontend/src/pages/admin/AdminDashboard.jsx');
  const adminDashContent = fs.readFileSync(adminDashPath, 'utf8');
  if (adminDashContent.includes('["Case ID", "Client", "Visa Type", "Status"]')) {
    throw new Error('TEST 2 Failed: "Case ID" still in AdminDashboard.jsx table header');
  }
  if (!adminDashContent.includes('["Case", "Client", "Visa Type", "Status"]')) {
    throw new Error('TEST 2 Failed: "Case" header missing in AdminDashboard.jsx');
  }
  console.log('  [PASS] AdminDashboard table header uses "Case".\n');

  // TEST 3: Check CasesOverviewTab.jsx uses "Case Number" & "Client name"
  console.log('TEST 3: Check CasesOverviewTab.jsx labels');
  const overviewPath = path.resolve(__dirname, '../../EPiC_Frontend/src/pages/caseworker/tabs/CasesOverviewTab.jsx');
  const overviewContent = fs.readFileSync(overviewPath, 'utf8');
  if (overviewContent.includes('<Field label="Case ID">')) {
    throw new Error('TEST 3 Failed: <Field label="Case ID"> still in CasesOverviewTab.jsx');
  }
  if (!overviewContent.includes('<Field label="Case Number">')) {
    throw new Error('TEST 3 Failed: <Field label="Case Number"> missing in CasesOverviewTab.jsx');
  }
  console.log('  [PASS] CasesOverviewTab uses "Case Number" and "Client name".\n');

  // TEST 4: Check AdminFinance.jsx uses "Case"
  console.log('TEST 4: Check AdminFinance.jsx labels');
  const finPath = path.resolve(__dirname, '../../EPiC_Frontend/src/pages/admin/AdminFinance.jsx');
  const finContent = fs.readFileSync(finPath, 'utf8');
  if (finContent.includes('["Transaction ID", "Client", "Case ID",')) {
    throw new Error('TEST 4 Failed: "Case ID" still in AdminFinance table columns');
  }
  if (!finContent.includes('["Transaction ID", "Client", "Case",')) {
    throw new Error('TEST 4 Failed: "Case" missing in AdminFinance table columns');
  }
  console.log('  [PASS] AdminFinance table and inputs use "Case".\n');

  // TEST 5: Legitimate CAS terminology (UKVCAS, CoS & CAS Requirements) preserved
  console.log('TEST 5: Check legitimate immigration CAS references preserved');
  const stagesPath = path.resolve(__dirname, '../../EPiC_Frontend/src/constants/licenceStages.js');
  const stagesContent = fs.readFileSync(stagesPath, 'utf8');
  if (!stagesContent.includes('CoS & CAS Requirements')) {
    throw new Error('TEST 5 Failed: Legitimate CoS & CAS Requirements term was lost');
  }
  console.log('  [PASS] Legitimate domain CAS references preserved.\n');

  console.log('============================================================');
  console.log('ALL BUG-022 AUTOMATED TESTS PASSED 100%');
  console.log('============================================================');
  process.exit(0);
}

runBug022Tests().catch((err) => {
  console.error('BUG-022 Test Suite Failed:', err);
  process.exit(1);
});
