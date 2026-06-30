/**
 * Audit Preparation Mode — Section G
 *
 * Assembles a UKVI-ready audit pack for the authenticated sponsor organisation.
 * Data sources drawn from existing models and controller patterns already in use.
 *
 * Endpoints (wired in auditMode.routes.js):
 *   POST /api/business/audit/generate      → JSON summary
 *   GET  /api/business/audit/export/pdf    → PDF report
 *   GET  /api/business/audit/export/excel  → Multi-sheet XLSX workbook
 *   GET  /api/business/audit/export/zip    → ZIP: PDF report + XLSX workbook
 */

import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import logger from '../../../utils/logger.js';
import { generateBrandedPdfBuffer } from '../../../services/pdfGenerator.service.js';
import {
  multiSheetXlsxBuffer,
  sendXlsxDownload,
} from '../../../utils/excelExport.util.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const safe = (v, fallback = '—') =>
  v === null || v === undefined || v === '' ? fallback : String(v);

const safeDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB');
};

const REQUIRED_DOC_TYPES = ['passport', 'visaCopy', 'cosCopy', 'contract', 'payslips'];

const docKeyFromType = (documentType = '') => {
  const n = String(documentType || '').toLowerCase();
  if (n.includes('passport')) return 'passport';
  if (n.includes('visa')) return 'visaCopy';
  if (n.includes('cos') || n.includes('certificate of sponsorship')) return 'cosCopy';
  if (n.includes('contract')) return 'contract';
  if (n.includes('payslip') || n.includes('salary')) return 'payslips';
  return null;
};

// ---------------------------------------------------------------------------
// Core data collector — shared by all export formats
// ---------------------------------------------------------------------------

async function collectAuditData(tenantDb, sponsorId) {
  // 1. Workers list ── all Cases for this sponsor
  const workers = await tenantDb.Case.findAll({
    where: { sponsorId },
    include: [
      {
        model: tenantDb.User,
        as: 'candidate',
        attributes: ['id', 'first_name', 'last_name', 'email', 'mobile'],
        include: [
          {
            model: tenantDb.CandidateApplication,
            as: 'application',
            attributes: [
              'visaType',
              'nationality',
              'passportNumber',
              'visaEndDate',
              'cosNumber',
              'socCode',
              'contractType',
            ],
          },
        ],
      },
    ],
    order: [['created_at', 'DESC']],
  });

  // 2. Document status per worker
  const allWorkerUserIds = workers
    .map((w) => w.candidate?.id)
    .filter(Boolean);

  // Build a map: userId → { passport: status, visaCopy: status, … }
  const docStatusMap = {};
  for (const uid of allWorkerUserIds) {
    docStatusMap[uid] = {
      passport: 'missing',
      visaCopy: 'missing',
      cosCopy: 'missing',
      contract: 'missing',
      payslips: 'missing',
    };
  }

  if (allWorkerUserIds.length) {
    // ComplianceDocument is keyed by sponsorId, but documentType lets us attribute
    // them. Pull all records for this sponsor and match by document type.
    const compDocs = await tenantDb.ComplianceDocument.findAll({
      where: { sponsorId },
      attributes: ['id', 'documentType', 'status', 'candidateId'],
    }).catch(() => []);

    for (const doc of compDocs) {
      const key = docKeyFromType(doc.documentType);
      const candidateId = doc.candidateId;
      if (key && candidateId && docStatusMap[candidateId]) {
        const current = docStatusMap[candidateId][key];
        // Prefer the "best" status: approved > under_review > pending > rejected > missing
        const rank = { approved: 5, under_review: 4, pending: 3, rejected: 2, missing: 1 };
        if ((rank[doc.status] || 0) > (rank[current] || 0)) {
          docStatusMap[candidateId][key] = doc.status;
        }
      }
    }
  }

  // 3. RTW records
  const rtwRecords = await tenantDb.RightToWorkRecord
    ? await tenantDb.RightToWorkRecord.findAll({
        where: { sponsorId },
        include: [
          {
            model: tenantDb.User,
            as: 'worker',
            attributes: ['id', 'first_name', 'last_name', 'email'],
          },
        ],
        order: [['initialCheckDate', 'DESC']],
      }).catch(() => [])
    : [];

  // 4. Absence logs (>10 day incidents — SponsorWorkerEvent / WorkerEvent)
  //    The model may be named WorkerEvent or SponsorWorkerEvent depending on migration.
  const WorkerEventModel =
    tenantDb.WorkerEvent || tenantDb.SponsorWorkerEvent || null;

  const absenceEvents = WorkerEventModel
    ? await WorkerEventModel.findAll({
        where: { sponsorId },
        order: [['created_at', 'DESC']],
      }).catch(() => [])
    : [];

  const absenceLogs = absenceEvents.filter((e) => {
    const et = String(e.eventType || '').toLowerCase();
    if (!et.includes('absence')) return false;
    const start = e.startDate ? new Date(e.startDate) : null;
    const end = e.endDate ? new Date(e.endDate) : null;
    if (!start || !end) return false;
    return (end - start) / (1000 * 60 * 60 * 24) > 10;
  });

  // 5. SMS / Change request reporting history
  const SmsLogModel = tenantDb.SponsorSmsLog || tenantDb.SmsLog || null;
  const smsLogs = SmsLogModel
    ? await SmsLogModel.findAll({
        where: { sponsorId },
        order: [['created_at', 'DESC']],
      }).catch(() => [])
    : [];

  // 6. Change requests (SMS-style reporting to UKVI)
  const changeRequests = await tenantDb.SponsorChangeRequest
    ? await tenantDb.SponsorChangeRequest.findAll({
        where: { sponsorId },
        order: [['created_at', 'DESC']],
      }).catch(() => [])
    : [];

  // 7. Sponsor profile (org chart reference + company details)
  const sponsorProfile = await tenantDb.SponsorProfile.findOne({
    where: { userId: sponsorId },
  }).catch(() => null);

  // ---------------------------------------------------------------------------
  // Derived summary statistics
  // ---------------------------------------------------------------------------
  const totalWorkers = workers.length;

  let totalDocSlots = 0;
  let completedDocSlots = 0;
  for (const uid of allWorkerUserIds) {
    const statuses = Object.values(docStatusMap[uid] || {});
    totalDocSlots += statuses.length;
    completedDocSlots += statuses.filter((s) => s === 'approved').length;
  }
  const docCompletenessPct =
    totalDocSlots > 0
      ? Math.round((completedDocSlots / totalDocSlots) * 100)
      : 0;

  const overdueChanges = changeRequests.filter(
    (r) => !r.dateReported && new Date(r.reportingDeadline) < new Date(),
  ).length;

  const rtwCount = rtwRecords.length;

  return {
    sponsorProfile,
    workers,
    docStatusMap,
    rtwRecords,
    absenceLogs,
    smsLogs,
    changeRequests,
    summary: {
      totalWorkers,
      docCompletenessPct,
      overdueChanges,
      rtwCount,
      generatedAt: new Date(),
    },
  };
}

// ---------------------------------------------------------------------------
// POST /api/business/audit/generate  → JSON summary
// ---------------------------------------------------------------------------

export const generateAuditPack = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const audit = await collectAuditData(req.tenantDb, sponsorId);

    const { summary, workers, rtwRecords, absenceLogs, smsLogs, changeRequests, docStatusMap } =
      audit;

    const workerList = workers.map((w) => ({
      caseId: w.caseId,
      name: `${w.candidate?.first_name || ''} ${w.candidate?.last_name || ''}`.trim(),
      email: w.candidate?.email,
      jobTitle: w.jobTitle,
      salary: w.salaryOffered,
      status: w.status,
      visaType: w.candidate?.application?.visaType,
      nationality: w.candidate?.application?.nationality,
      visaExpiry: w.candidate?.application?.visaEndDate,
      cosNumber: w.candidate?.application?.cosNumber,
      socCode: w.candidate?.application?.socCode,
      documentStatus: docStatusMap[w.candidate?.id] || {},
    }));

    return res.status(200).json({
      status: 'success',
      data: {
        summary,
        companyName: audit.sponsorProfile?.companyName || null,
        workers: workerList,
        rtwRecords: rtwRecords.map((r) => ({
          id: r.id,
          workerName: `${r.worker?.first_name || ''} ${r.worker?.last_name || ''}`.trim(),
          initialCheckDate: r.initialCheckDate,
          followUpCheckDate: r.followUpCheckDate,
          status: r.status,
          referenceNumber: r.referenceNumber,
        })),
        absenceLogs: absenceLogs.map((a) => ({
          id: a.id,
          eventType: a.eventType,
          startDate: a.startDate,
          endDate: a.endDate,
          notes: a.notes,
        })),
        changeRequests: changeRequests.map((c) => ({
          id: c.id,
          changeType: c.changeType,
          eventDate: c.eventDate,
          reportingDeadline: c.reportingDeadline,
          status: c.status,
          dateReported: c.dateReported,
        })),
        smsLogs: smsLogs.map((s) => ({
          id: s.id,
          logType: s.logType || s.type,
          submittedAt: s.created_at,
          notes: s.notes,
        })),
      },
    });
  } catch (err) {
    logger.error({ err }, 'generateAuditPack error');
    return res.status(500).json({ status: 'error', message: err.message || 'Internal server error' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/business/audit/export/pdf
// ---------------------------------------------------------------------------

export const exportAuditPdf = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const audit = await collectAuditData(req.tenantDb, sponsorId);
    const { summary, workers, rtwRecords, absenceLogs, changeRequests, smsLogs, docStatusMap } =
      audit;

    const companyName = audit.sponsorProfile?.companyName || 'Organisation';

    // Section: Summary
    const summarySections = [
      {
        sectionTitle: 'Section G — Audit Preparation Summary',
        rows: [
          { label: 'Company', value: companyName },
          { label: 'Report Generated', value: new Date().toLocaleString('en-GB') },
          { label: 'Total Sponsored Workers', value: String(summary.totalWorkers) },
          { label: 'Document Completeness', value: `${summary.docCompletenessPct}%` },
          { label: 'Overdue Change Reports', value: String(summary.overdueChanges) },
          { label: 'RTW Checks on Record', value: String(summary.rtwCount) },
        ],
      },
    ];

    // Section: Workers
    const workerRows = workers.flatMap((w, i) => {
      const app = w.candidate?.application;
      const docSt = docStatusMap[w.candidate?.id] || {};
      return [
        { label: `Worker ${i + 1} — Name`, value: `${safe(w.candidate?.first_name)} ${safe(w.candidate?.last_name)}` },
        { label: 'Case Reference', value: safe(w.caseId) },
        { label: 'Job Title', value: safe(w.jobTitle) },
        { label: 'Salary (£)', value: safe(w.salaryOffered) },
        { label: 'Case Status', value: safe(w.status) },
        { label: 'Visa Type', value: safe(app?.visaType) },
        { label: 'Visa Expiry', value: safeDate(app?.visaEndDate) },
        { label: 'CoS Number', value: safe(app?.cosNumber) },
        { label: 'SOC Code', value: safe(app?.socCode) },
        { label: 'Docs: Passport', value: safe(docSt.passport) },
        { label: 'Docs: Visa Copy', value: safe(docSt.visaCopy) },
        { label: 'Docs: CoS Copy', value: safe(docSt.cosCopy) },
        { label: 'Docs: Contract', value: safe(docSt.contract) },
        { label: 'Docs: Payslips', value: safe(docSt.payslips) },
      ];
    });

    if (workerRows.length) {
      summarySections.push({ sectionTitle: 'Complete Worker List', rows: workerRows });
    }

    // Section: RTW
    if (rtwRecords.length) {
      summarySections.push({
        sectionTitle: 'Right to Work Records',
        rows: rtwRecords.flatMap((r, i) => [
          { label: `RTW ${i + 1} — Worker`, value: `${safe(r.worker?.first_name)} ${safe(r.worker?.last_name)}` },
          { label: 'Initial Check', value: safeDate(r.initialCheckDate) },
          { label: 'Follow-up Check', value: safeDate(r.followUpCheckDate) },
          { label: 'Status', value: safe(r.status) },
          { label: 'Reference', value: safe(r.referenceNumber) },
        ]),
      });
    }

    // Section: Absence
    if (absenceLogs.length) {
      summarySections.push({
        sectionTitle: 'Absence Logs (>10 Days)',
        rows: absenceLogs.flatMap((a, i) => [
          { label: `Absence ${i + 1} — Type`, value: safe(a.eventType) },
          { label: 'Start Date', value: safeDate(a.startDate) },
          { label: 'End Date', value: safeDate(a.endDate) },
          { label: 'Notes', value: safe(a.notes) },
        ]),
      });
    }

    // Section: Change Requests / Reporting History
    if (changeRequests.length) {
      summarySections.push({
        sectionTitle: 'SMS Reporting History — Change Requests',
        rows: changeRequests.flatMap((c, i) => [
          { label: `Request ${i + 1} — Type`, value: safe(c.changeType) },
          { label: 'Event Date', value: safeDate(c.eventDate) },
          { label: 'Reporting Deadline', value: safeDate(c.reportingDeadline) },
          { label: 'Status', value: safe(c.status) },
          { label: 'Reported On', value: safeDate(c.dateReported) },
        ]),
      });
    }

    // Section: SMS Logs
    if (smsLogs.length) {
      summarySections.push({
        sectionTitle: 'SMS Submission Log',
        rows: smsLogs.flatMap((s, i) => [
          { label: `Entry ${i + 1} — Type`, value: safe(s.logType || s.type) },
          { label: 'Submitted At', value: safeDate(s.created_at) },
          { label: 'Notes', value: safe(s.notes) },
        ]),
      });
    }

    const logoPath = path.resolve('public', 'logo.png');

    const pdfBuffer = await generateBrandedPdfBuffer({
      logoPath: fs.existsSync(logoPath) ? logoPath : null,
      title: 'UKVI Audit Preparation Pack — Section G',
      sections: summarySections,
      metadata: {
        subtitle: companyName,
        reference: `Generated: ${new Date().toLocaleString('en-GB')}`,
      },
    });

    const filename = `Audit_Pack_${companyName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.end(pdfBuffer);
  } catch (err) {
    logger.error({ err }, 'exportAuditPdf error');
    return res.status(500).json({ status: 'error', message: err.message || 'PDF generation failed' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/business/audit/export/excel
// ---------------------------------------------------------------------------

export const exportAuditExcel = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const audit = await collectAuditData(req.tenantDb, sponsorId);
    const { summary, workers, rtwRecords, absenceLogs, changeRequests, smsLogs, docStatusMap } =
      audit;

    const companyName = audit.sponsorProfile?.companyName || 'Organisation';

    // Sheet 1 — Summary
    const summarySheet = {
      name: 'Summary',
      columns: [
        { key: 'metric', header: 'Metric' },
        { key: 'value', header: 'Value' },
      ],
      rows: [
        { metric: 'Company', value: companyName },
        { metric: 'Generated At', value: new Date().toLocaleString('en-GB') },
        { metric: 'Total Sponsored Workers', value: summary.totalWorkers },
        { metric: 'Document Completeness (%)', value: summary.docCompletenessPct },
        { metric: 'Overdue Change Reports', value: summary.overdueChanges },
        { metric: 'RTW Checks on Record', value: summary.rtwCount },
      ],
    };

    // Sheet 2 — Complete Worker List
    const workerSheet = {
      name: 'Worker List',
      columns: [
        { key: 'caseId', header: 'Case Reference' },
        { key: 'name', header: 'Worker Name' },
        { key: 'email', header: 'Email' },
        { key: 'jobTitle', header: 'Job Title' },
        { key: 'salary', header: 'Salary (£)' },
        { key: 'caseStatus', header: 'Case Status' },
        { key: 'visaType', header: 'Visa Type' },
        { key: 'visaExpiry', header: 'Visa Expiry' },
        { key: 'cosNumber', header: 'CoS Number' },
        { key: 'socCode', header: 'SOC Code' },
        { key: 'docPassport', header: 'Doc: Passport' },
        { key: 'docVisa', header: 'Doc: Visa Copy' },
        { key: 'docCos', header: 'Doc: CoS Copy' },
        { key: 'docContract', header: 'Doc: Contract' },
        { key: 'docPayslips', header: 'Doc: Payslips' },
      ],
      rows: workers.map((w) => {
        const app = w.candidate?.application;
        const ds = docStatusMap[w.candidate?.id] || {};
        return {
          caseId: w.caseId,
          name: `${w.candidate?.first_name || ''} ${w.candidate?.last_name || ''}`.trim(),
          email: w.candidate?.email || '',
          jobTitle: w.jobTitle || '',
          salary: w.salaryOffered || '',
          caseStatus: w.status || '',
          visaType: app?.visaType || '',
          visaExpiry: app?.visaEndDate ? new Date(app.visaEndDate).toLocaleDateString('en-GB') : '',
          cosNumber: app?.cosNumber || '',
          socCode: app?.socCode || '',
          docPassport: ds.passport || 'missing',
          docVisa: ds.visaCopy || 'missing',
          docCos: ds.cosCopy || 'missing',
          docContract: ds.contract || 'missing',
          docPayslips: ds.payslips || 'missing',
        };
      }),
    };

    // Sheet 3 — RTW Records
    const rtwSheet = {
      name: 'RTW Records',
      columns: [
        { key: 'workerName', header: 'Worker' },
        { key: 'email', header: 'Email' },
        { key: 'initialCheckDate', header: 'Initial Check Date' },
        { key: 'followUpCheckDate', header: 'Follow-up Check Date' },
        { key: 'status', header: 'Status' },
        { key: 'referenceNumber', header: 'Reference Number' },
      ],
      rows: rtwRecords.map((r) => ({
        workerName: `${r.worker?.first_name || ''} ${r.worker?.last_name || ''}`.trim(),
        email: r.worker?.email || '',
        initialCheckDate: r.initialCheckDate ? new Date(r.initialCheckDate).toLocaleDateString('en-GB') : '',
        followUpCheckDate: r.followUpCheckDate ? new Date(r.followUpCheckDate).toLocaleDateString('en-GB') : '',
        status: r.status || '',
        referenceNumber: r.referenceNumber || '',
      })),
    };

    // Sheet 4 — Absence Logs
    const absenceSheet = {
      name: 'Absence Logs',
      columns: [
        { key: 'eventType', header: 'Event Type' },
        { key: 'startDate', header: 'Start Date' },
        { key: 'endDate', header: 'End Date' },
        { key: 'durationDays', header: 'Duration (Days)' },
        { key: 'notes', header: 'Notes' },
      ],
      rows: absenceLogs.map((a) => {
        const start = a.startDate ? new Date(a.startDate) : null;
        const end = a.endDate ? new Date(a.endDate) : null;
        const days = start && end ? Math.round((end - start) / (1000 * 60 * 60 * 24)) : '';
        return {
          eventType: a.eventType || '',
          startDate: start ? start.toLocaleDateString('en-GB') : '',
          endDate: end ? end.toLocaleDateString('en-GB') : '',
          durationDays: days,
          notes: a.notes || '',
        };
      }),
    };

    // Sheet 5 — Change Requests (SMS Reporting History)
    const changeSheet = {
      name: 'Change Requests',
      columns: [
        { key: 'changeType', header: 'Change Type' },
        { key: 'eventDate', header: 'Event Date' },
        { key: 'reportingDeadline', header: 'Reporting Deadline' },
        { key: 'status', header: 'Status' },
        { key: 'dateReported', header: 'Date Reported' },
      ],
      rows: changeRequests.map((c) => ({
        changeType: c.changeType || '',
        eventDate: c.eventDate ? new Date(c.eventDate).toLocaleDateString('en-GB') : '',
        reportingDeadline: c.reportingDeadline ? new Date(c.reportingDeadline).toLocaleDateString('en-GB') : '',
        status: c.status || '',
        dateReported: c.dateReported ? new Date(c.dateReported).toLocaleDateString('en-GB') : 'Not yet reported',
      })),
    };

    // Sheet 6 — SMS Submission Log
    const smsSheet = {
      name: 'SMS Log',
      columns: [
        { key: 'logType', header: 'Log Type' },
        { key: 'submittedAt', header: 'Submitted At' },
        { key: 'notes', header: 'Notes' },
      ],
      rows: smsLogs.map((s) => ({
        logType: s.logType || s.type || '',
        submittedAt: s.created_at ? new Date(s.created_at).toLocaleString('en-GB') : '',
        notes: s.notes || '',
      })),
    };

    const buffer = multiSheetXlsxBuffer([
      summarySheet,
      workerSheet,
      rtwSheet,
      absenceSheet,
      changeSheet,
      smsSheet,
    ]);

    const filename = `Audit_Pack_${companyName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    sendXlsxDownload(res, buffer, filename);
  } catch (err) {
    logger.error({ err }, 'exportAuditExcel error');
    return res.status(500).json({ status: 'error', message: err.message || 'Excel generation failed' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/business/audit/export/zip
// Bundles: PDF audit report + Excel workbook
// ---------------------------------------------------------------------------

export const exportAuditZip = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const audit = await collectAuditData(req.tenantDb, sponsorId);

    const companyName = (audit.sponsorProfile?.companyName || 'Organisation').replace(/\s+/g, '_');
    const dateStamp = new Date().toISOString().slice(0, 10);

    // Reuse the same PDF and Excel builders (inline to avoid duplicate DB calls)
    const { summary, workers, rtwRecords, absenceLogs, changeRequests, smsLogs, docStatusMap } =
      audit;

    // --- Build PDF buffer ---
    const pdfSections = [
      {
        sectionTitle: 'Section G — Audit Preparation Summary',
        rows: [
          { label: 'Company', value: companyName.replace(/_/g, ' ') },
          { label: 'Report Generated', value: new Date().toLocaleString('en-GB') },
          { label: 'Total Sponsored Workers', value: String(summary.totalWorkers) },
          { label: 'Document Completeness', value: `${summary.docCompletenessPct}%` },
          { label: 'Overdue Change Reports', value: String(summary.overdueChanges) },
          { label: 'RTW Checks on Record', value: String(summary.rtwCount) },
        ],
      },
    ];

    if (workers.length) {
      pdfSections.push({
        sectionTitle: 'Complete Worker List',
        rows: workers.flatMap((w, i) => {
          const app = w.candidate?.application;
          const ds = docStatusMap[w.candidate?.id] || {};
          return [
            { label: `Worker ${i + 1} — Name`, value: `${safe(w.candidate?.first_name)} ${safe(w.candidate?.last_name)}` },
            { label: 'Case Reference', value: safe(w.caseId) },
            { label: 'Job Title', value: safe(w.jobTitle) },
            { label: 'Visa Type', value: safe(app?.visaType) },
            { label: 'Visa Expiry', value: safeDate(app?.visaEndDate) },
            { label: 'Docs: Passport', value: safe(ds.passport) },
            { label: 'Docs: Visa Copy', value: safe(ds.visaCopy) },
            { label: 'Docs: CoS Copy', value: safe(ds.cosCopy) },
            { label: 'Docs: Contract', value: safe(ds.contract) },
            { label: 'Docs: Payslips', value: safe(ds.payslips) },
          ];
        }),
      });
    }

    const logoPath = path.resolve('public', 'logo.png');
    const pdfBuffer = await generateBrandedPdfBuffer({
      logoPath: fs.existsSync(logoPath) ? logoPath : null,
      title: 'UKVI Audit Preparation Pack — Section G',
      sections: pdfSections,
      metadata: { subtitle: companyName.replace(/_/g, ' ') },
    });

    // --- Build Excel buffer ---
    const excelBuffer = multiSheetXlsxBuffer([
      {
        name: 'Summary',
        columns: [{ key: 'metric', header: 'Metric' }, { key: 'value', header: 'Value' }],
        rows: [
          { metric: 'Company', value: companyName.replace(/_/g, ' ') },
          { metric: 'Generated At', value: new Date().toLocaleString('en-GB') },
          { metric: 'Total Sponsored Workers', value: summary.totalWorkers },
          { metric: 'Document Completeness (%)', value: summary.docCompletenessPct },
          { metric: 'Overdue Change Reports', value: summary.overdueChanges },
          { metric: 'RTW Checks on Record', value: summary.rtwCount },
        ],
      },
      {
        name: 'Worker List',
        columns: [
          { key: 'caseId', header: 'Case Reference' },
          { key: 'name', header: 'Worker Name' },
          { key: 'visaType', header: 'Visa Type' },
          { key: 'visaExpiry', header: 'Visa Expiry' },
          { key: 'caseStatus', header: 'Case Status' },
          { key: 'docPassport', header: 'Doc: Passport' },
          { key: 'docVisa', header: 'Doc: Visa Copy' },
          { key: 'docCos', header: 'Doc: CoS Copy' },
          { key: 'docContract', header: 'Doc: Contract' },
          { key: 'docPayslips', header: 'Doc: Payslips' },
        ],
        rows: workers.map((w) => {
          const app = w.candidate?.application;
          const ds = docStatusMap[w.candidate?.id] || {};
          return {
            caseId: w.caseId || '',
            name: `${w.candidate?.first_name || ''} ${w.candidate?.last_name || ''}`.trim(),
            visaType: app?.visaType || '',
            visaExpiry: app?.visaEndDate ? new Date(app.visaEndDate).toLocaleDateString('en-GB') : '',
            caseStatus: w.status || '',
            docPassport: ds.passport || 'missing',
            docVisa: ds.visaCopy || 'missing',
            docCos: ds.cosCopy || 'missing',
            docContract: ds.contract || 'missing',
            docPayslips: ds.payslips || 'missing',
          };
        }),
      },
      {
        name: 'RTW Records',
        columns: [
          { key: 'workerName', header: 'Worker' },
          { key: 'initialCheckDate', header: 'Initial Check' },
          { key: 'followUpCheckDate', header: 'Follow-up Check' },
          { key: 'status', header: 'Status' },
        ],
        rows: rtwRecords.map((r) => ({
          workerName: `${r.worker?.first_name || ''} ${r.worker?.last_name || ''}`.trim(),
          initialCheckDate: r.initialCheckDate ? new Date(r.initialCheckDate).toLocaleDateString('en-GB') : '',
          followUpCheckDate: r.followUpCheckDate ? new Date(r.followUpCheckDate).toLocaleDateString('en-GB') : '',
          status: r.status || '',
        })),
      },
      {
        name: 'Change Requests',
        columns: [
          { key: 'changeType', header: 'Change Type' },
          { key: 'eventDate', header: 'Event Date' },
          { key: 'reportingDeadline', header: 'Deadline' },
          { key: 'status', header: 'Status' },
        ],
        rows: changeRequests.map((c) => ({
          changeType: c.changeType || '',
          eventDate: c.eventDate ? new Date(c.eventDate).toLocaleDateString('en-GB') : '',
          reportingDeadline: c.reportingDeadline ? new Date(c.reportingDeadline).toLocaleDateString('en-GB') : '',
          status: c.status || '',
        })),
      },
    ]);

    // --- Stream ZIP ---
    const zipFilename = `Audit_Pack_${companyName}_${dateStamp}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
    res.setHeader('Cache-Control', 'no-store');

    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.on('error', (err) => {
      logger.error({ err }, 'archiver error in exportAuditZip');
      if (!res.headersSent) {
        res.status(500).json({ status: 'error', message: 'ZIP generation failed' });
      }
    });

    archive.pipe(res);

    archive.append(pdfBuffer, { name: `Audit_Report_${dateStamp}.pdf` });
    archive.append(excelBuffer, { name: `Audit_Workbook_${dateStamp}.xlsx` });

    await archive.finalize();
  } catch (err) {
    logger.error({ err }, 'exportAuditZip error');
    if (!res.headersSent) {
      return res.status(500).json({ status: 'error', message: err.message || 'ZIP generation failed' });
    }
  }
};
