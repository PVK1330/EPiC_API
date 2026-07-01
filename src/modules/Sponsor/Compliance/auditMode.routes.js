/**
 * Audit Mode routes — Section G
 *
 * Mounted at /api/business/audit (via Sponsor index.js).
 * All routes require an authenticated BUSINESS / SPONSOR session
 * (enforced by the parent router in Sponsor/index.js).
 *
 *   POST /api/business/audit/generate        → JSON audit pack summary
 *   GET  /api/business/audit/export/pdf      → PDF audit report download
 *   GET  /api/business/audit/export/excel    → Multi-sheet XLSX download
 *   GET  /api/business/audit/export/zip      → ZIP (PDF + XLSX) download
 */

import { Router } from 'express';
import {
  generateAuditPack,
  exportAuditPdf,
  exportAuditExcel,
  exportAuditZip,
} from './auditMode.controller.js';

const router = Router();

// Generate audit pack summary (JSON — used by the frontend AuditModePanel)
router.post('/generate', generateAuditPack);

// Export routes — all GETs so browsers can open them directly for downloads
router.get('/export/pdf', exportAuditPdf);
router.get('/export/excel', exportAuditExcel);
router.get('/export/zip', exportAuditZip);

export default router;
