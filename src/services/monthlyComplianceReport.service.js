/**
 * Monthly Compliance Review Service — Section N
 *
 * Assembles a frozen, timestamped monthly compliance report for a sponsor
 * organisation covering five sections:
 *   1. Compliance Summary   — worker counts, risk breakdown, licence status
 *   2. Workers Expiring     — visa expiry within 90 days
 *   3. Reporting History    — aggregate of compliance actions during the period
 *   4. Missing Documents    — workers without required compliance docs
 *   5. Risk Movement        — month-over-month risk score comparison
 *
 * The finished report is persisted in `monthly_compliance_reviews` and emailed
 * to Sponsor admins, linked caseworkers, and platform admins.
 */

import { Op, fn, col } from "sequelize";
import platformDb from "../models/index.js";
import { getTenantDb } from "./tenantDb.service.js";
import { sendTransactionalEmail } from "./mail.service.js";
import { generateMonthlyComplianceReportTemplate } from "../utils/emailTemplates.js";
import logger from "../utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Date utilities
// ─────────────────────────────────────────────────────────────────────────────

const addDays = (base, days) => {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
};

/**
 * Return the first-day-of-month Date for a given date.
 * monthOffset < 0 goes back: -1 = last month, -2 = two months ago.
 */
function firstOfMonth(date, monthOffset = 0) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() + monthOffset);
  return d;
}

/**
 * Return the last day (23:59:59.999) of a given month (same month as `date`).
 */
function endOfMonth(date) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  d.setHours(23, 59, 59, 999);
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Section 1 — Compliance Summary
 * Snapshot of the sponsor's workforce compliance posture.
 */
async function buildComplianceSummary(tenantDb, sponsorId) {
  const today = new Date();

  const cases = await tenantDb.Case.findAll({
    where: { sponsorId },
    attributes: ["id", "caseId", "status"],
    include: [
      {
        model: tenantDb.User,
        as: "candidate",
        attributes: ["id", "first_name", "last_name", "email"],
        required: false,
      },
      {
        model: tenantDb.CandidateApplication,
        as: "application",
        attributes: ["visaType", "visaEndDate", "nationality"],
        required: false,
      },
    ],
  });

  const profile = await tenantDb.SponsorProfile.findOne({ where: { userId: sponsorId } });

  const workers = cases.map((c) => {
    const visaExpiry = c.application?.visaEndDate ?? null;
    const daysToExpiry = visaExpiry
      ? Math.ceil((new Date(visaExpiry) - today) / 86_400_000)
      : null;
    const riskFlag =
      daysToExpiry === null
        ? "unknown"
        : daysToExpiry < 30
        ? "high"
        : daysToExpiry < 90
        ? "medium"
        : "low";
    return {
      caseId: c.caseId,
      status: c.status,
      candidateName: [c.candidate?.first_name, c.candidate?.last_name].filter(Boolean).join(" "),
      candidateEmail: c.candidate?.email || null,
      nationality: c.application?.nationality || null,
      visaType: c.application?.visaType || null,
      visaExpiry,
      daysToExpiry,
      riskFlag,
    };
  });

  const highRiskCount = workers.filter((w) => w.riskFlag === "high").length;
  const mediumRiskCount = workers.filter((w) => w.riskFlag === "medium").length;
  const lowRiskCount = workers.filter((w) => w.riskFlag === "low").length;
  const complianceScore =
    typeof profile?.riskPct === "number" ? Math.max(0, 100 - profile.riskPct) : null;

  return {
    totalWorkers: workers.length,
    highRiskCount,
    mediumRiskCount,
    lowRiskCount,
    complianceScore: complianceScore ?? 80,
    riskLevel: profile?.riskLevel || "Low",
    licenceStatus: profile?.licenceStatus || null,
    licenceExpiryDate: profile?.licenceExpiryDate || null,
    licenceRating: profile?.licenceRating || null,
    workers,
  };
}

/**
 * Section 2 — Workers Expiring in Next 90 Days
 * Ordered by days remaining (most urgent first).
 */
async function buildWorkersExpiring(tenantDb, sponsorId, today) {
  const ninetyDaysOut = addDays(today, 90);

  const cases = await tenantDb.Case.findAll({
    where: { sponsorId },
    attributes: ["id", "caseId"],
    include: [
      {
        model: tenantDb.User,
        as: "candidate",
        attributes: ["id", "first_name", "last_name", "email"],
        required: true,
      },
      {
        model: tenantDb.CandidateApplication,
        as: "application",
        where: {
          visaEndDate: {
            [Op.gte]: today,
            [Op.lte]: ninetyDaysOut,
          },
        },
        required: true,
        attributes: ["visaType", "visaEndDate", "nationality"],
      },
    ],
  });

  const list = cases.map((c) => {
    const visaEndDate = c.application?.visaEndDate;
    const daysRemaining = visaEndDate
      ? Math.ceil((new Date(visaEndDate) - today) / 86_400_000)
      : null;
    return {
      caseId: c.caseId,
      candidateName: [c.candidate?.first_name, c.candidate?.last_name].filter(Boolean).join(" "),
      candidateEmail: c.candidate?.email || null,
      visaType: c.application?.visaType || null,
      visaEndDate,
      daysRemaining,
      urgency: daysRemaining !== null && daysRemaining <= 30 ? "high" : "medium",
    };
  });

  list.sort((a, b) => (a.daysRemaining ?? 999) - (b.daysRemaining ?? 999));
  return list;
}

/**
 * Section 3 — Reporting History
 * Aggregated counts of compliance review actions during the report month.
 */
async function buildReportingHistory(tenantDb, organisationId, periodStart, periodEnd) {
  // Count by action across all entity types.
  const rows = await tenantDb.ComplianceReviewHistory.findAll({
    where: {
      organisationId,
      created_at: { [Op.between]: [periodStart, periodEnd] },
    },
    attributes: [
      "action",
      [fn("COUNT", col("id")), "count"],
    ],
    group: ["action"],
    raw: true,
  });

  const byAction = {};
  let total = 0;
  for (const row of rows) {
    byAction[row.action] = Number(row.count);
    total += Number(row.count);
  }

  return {
    total,
    submitted: byAction.respond ?? 0,
    underReview: byAction.review ?? 0,
    approved: byAction.approve ?? 0,
    rejected: byAction.reject ?? 0,
    informationRequested: byAction.request_info ?? 0,
    breakdown: byAction,
  };
}

/**
 * Section 4 — Missing Documents
 * Workers whose compliance documents have a 'missing', 'expired', or 'rejected'
 * status (i.e. the compliance file cabinet has a gap).
 */
async function buildMissingDocuments(tenantDb, sponsorId) {
  let docs = [];
  try {
    docs = await tenantDb.ComplianceDocument.findAll({
      where: {
        sponsorId,
        status: { [Op.in]: ["missing", "expired", "rejected"] },
      },
      attributes: ["id", "documentType", "status", "expiryDate", "notes"],
      order: [["upload_date", "DESC"]],
    });
  } catch (err) {
    logger.warn({ err }, "[monthlyComplianceReport] ComplianceDocument query failed — skipping");
  }

  return docs.map((d) => ({
    id: d.id,
    documentType: d.documentType,
    status: d.status,
    expiryDate: d.expiryDate || null,
    notes: d.notes || null,
  }));
}

/**
 * Section 5 — Risk Movement
 * Compare the current month's risk score against last month's stored value.
 * Returns null for direction/delta when no prior month exists.
 */
async function buildRiskMovement(tenantDb, sponsorId, organisationId, currentRiskScore) {
  // Fetch last month's stored report for this sponsor (if any).
  const lastMonth = await tenantDb.MonthlyComplianceReview.findOne({
    where: { sponsorId, organisationId },
    order: [["report_month", "DESC"]],
    attributes: ["riskScore", "reportMonth"],
  }).catch(() => null);

  const previousScore = lastMonth?.riskScore != null ? Number(lastMonth.riskScore) : null;
  const current = currentRiskScore != null ? Number(currentRiskScore) : null;
  let delta = null;
  let direction = "unchanged";

  if (previousScore !== null && current !== null) {
    delta = parseFloat((current - previousScore).toFixed(2));
    direction = delta > 0 ? "worse" : delta < 0 ? "improved" : "unchanged";
  }

  return {
    currentRiskScore: current,
    previousRiskScore: previousScore,
    previousReportMonth: lastMonth?.reportMonth || null,
    delta,
    direction,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main report builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a monthly compliance report for a single sponsor user.
 *
 * @param {object} tenantDb  — connected tenant Sequelize instance
 * @param {number} sponsorId — user.id of the sponsor (BUSINESS role)
 * @param {number} organisationId
 * @param {Date}   reportDate — the date being reported (defaults to today)
 * @param {'cron'|'manual'} generatedBy
 * @returns {object} The persisted MonthlyComplianceReview instance.
 */
export async function generateSponsorMonthlyReport({
  tenantDb,
  sponsorId,
  organisationId,
  reportDate = new Date(),
  generatedBy = "cron",
}) {
  const today = new Date(reportDate);
  today.setHours(0, 0, 0, 0);

  // Period = calendar month containing `reportDate`.
  const periodStart = firstOfMonth(today);
  const periodEnd = endOfMonth(today);

  // Build all five sections in parallel where possible.
  const [complianceSummary, workersExpiring, reportingHistory, missingDocuments] =
    await Promise.all([
      buildComplianceSummary(tenantDb, sponsorId),
      buildWorkersExpiring(tenantDb, sponsorId, today),
      buildReportingHistory(tenantDb, organisationId, periodStart, periodEnd),
      buildMissingDocuments(tenantDb, sponsorId),
    ]);

  // Risk score derived from the compliance summary (section 1).
  const riskScore = complianceSummary.complianceScore != null
    ? parseFloat((100 - complianceSummary.complianceScore).toFixed(2))
    : null;

  const riskMovement = await buildRiskMovement(
    tenantDb,
    sponsorId,
    organisationId,
    riskScore,
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    reportMonth: periodStart.toISOString().slice(0, 10),
    periodStart: periodStart.toISOString().slice(0, 10),
    periodEnd: periodEnd.toISOString().slice(0, 10),
    complianceSummary,
    workersExpiring,
    reportingHistory,
    missingDocuments,
    riskMovement,
  };

  const report = await tenantDb.MonthlyComplianceReview.create({
    organisationId,
    sponsorId,
    reportMonth: periodStart.toISOString().slice(0, 10),
    totalWorkers: complianceSummary.totalWorkers,
    highRiskCount: complianceSummary.highRiskCount,
    mediumRiskCount: complianceSummary.mediumRiskCount,
    workersExpiringIn90Days: workersExpiring.length,
    missingDocumentCount: missingDocuments.length,
    riskScore,
    riskScoreDelta: riskMovement.delta,
    generatedBy,
    payload,
  });

  return report;
}

// ─────────────────────────────────────────────────────────────────────────────
// Email dispatch
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send the monthly compliance report email to a list of recipients.
 * Each recipient gets the same content; failures are logged but do not abort.
 */
async function dispatchReportEmails({ report, sponsorEmail, recipients, orgName, organisationId }) {
  const payload = report.payload || {};
  const reportMonth = report.reportMonth
    ? new Date(report.reportMonth).toLocaleString("en-GB", { month: "long", year: "numeric" })
    : "This Month";

  for (const recipient of recipients) {
    if (!recipient?.email) continue;
    try {
      const html = generateMonthlyComplianceReportTemplate({
        recipientName: recipient.name || "Team",
        orgName,
        reportMonth,
        complianceSummary: payload.complianceSummary || {},
        workersExpiring: payload.workersExpiring || [],
        reportingHistory: payload.reportingHistory || {},
        missingDocuments: payload.missingDocuments || [],
        riskMovement: payload.riskMovement || {},
      });

      await sendTransactionalEmail({
        to: recipient.email,
        subject: `${orgName} — Monthly Compliance Review: ${reportMonth}`,
        html,
        organisationId,
        failureContext: "monthly_compliance_report",
      });

      logger.info(
        { to: recipient.email, reportMonth, organisationId },
        "[monthlyComplianceReport] Email sent",
      );
    } catch (err) {
      logger.error(
        { err, to: recipient.email, organisationId },
        "[monthlyComplianceReport] Failed to send report email",
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-tenant runner (called by the cron job and the manual trigger endpoint)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the monthly compliance review for all sponsors in one tenant organisation.
 *
 * @param {object} tenantDb
 * @param {number} organisationId
 * @param {object} orgRow — { id, name } from platformDb.Organisation
 * @param {'cron'|'manual'} generatedBy
 * @param {Date}   reportDate — the calendar month to cover
 * @returns {{ reportsGenerated, emailsSent, errors }}
 */
export async function runTenantMonthlyReview({
  tenantDb,
  organisationId,
  orgName,
  generatedBy = "cron",
  reportDate = new Date(),
}) {
  let reportsGenerated = 0;
  let emailsSent = 0;
  const errors = [];

  // Find all BUSINESS (sponsor, role_id = 4) users in this tenant.
  const sponsors = await tenantDb.User.findAll({
    where: { role_id: 4 },
    attributes: ["id", "first_name", "last_name", "email"],
  }).catch((err) => {
    logger.error({ err, organisationId }, "[monthlyComplianceReport] Could not load sponsors");
    return [];
  });

  // Find all caseworkers (role_id = 2) so we can CC them on every report.
  const caseworkers = await tenantDb.User.findAll({
    where: { role_id: 2 },
    attributes: ["id", "first_name", "last_name", "email"],
  }).catch(() => []);

  // Find all admins (role_id = 3) in this tenant.
  const admins = await tenantDb.User.findAll({
    where: { role_id: 3 },
    attributes: ["id", "first_name", "last_name", "email"],
  }).catch(() => []);

  for (const sponsor of sponsors) {
    try {
      const report = await generateSponsorMonthlyReport({
        tenantDb,
        sponsorId: sponsor.id,
        organisationId,
        reportDate,
        generatedBy,
      });
      reportsGenerated += 1;

      // Collect all recipients: this sponsor + caseworkers + admins.
      const recipients = [
        { name: [sponsor.first_name, sponsor.last_name].filter(Boolean).join(" "), email: sponsor.email },
        ...caseworkers.map((u) => ({
          name: [u.first_name, u.last_name].filter(Boolean).join(" "),
          email: u.email,
        })),
        ...admins.map((u) => ({
          name: [u.first_name, u.last_name].filter(Boolean).join(" "),
          email: u.email,
        })),
      ].filter(
        // Deduplicate by email.
        (r, i, arr) => r.email && arr.findIndex((x) => x.email === r.email) === i,
      );

      await dispatchReportEmails({
        report,
        sponsorEmail: sponsor.email,
        recipients,
        orgName,
        organisationId,
      });
      emailsSent += recipients.length;
    } catch (err) {
      logger.error(
        { err, sponsorId: sponsor.id, organisationId },
        "[monthlyComplianceReport] Failed for sponsor",
      );
      errors.push({ sponsorId: sponsor.id, error: err.message });
    }
  }

  return { reportsGenerated, emailsSent, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level cron entry-point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the monthly compliance review across ALL active tenant organisations.
 * Registered as the 'monthly-compliance-review' cron job.
 */
export async function runMonthlyComplianceReview() {
  const reportDate = new Date();
  let organisationsProcessed = 0;
  let totalReports = 0;
  let totalEmails = 0;
  const allErrors = [];

  try {
    const organisations = await platformDb.Organisation.findAll({
      where: {
        status: { [Op.in]: ["active", "trial"] },
        database_name: { [Op.not]: null },
      },
      attributes: ["id", "name", "database_name"],
    });

    for (const org of organisations) {
      try {
        const tenantDb = getTenantDb(org.database_name);
        const result = await runTenantMonthlyReview({
          tenantDb,
          organisationId: org.id,
          orgName: org.name || "Organisation",
          generatedBy: "cron",
          reportDate,
        });
        totalReports += result.reportsGenerated;
        totalEmails += result.emailsSent;
        allErrors.push(...result.errors);
        organisationsProcessed += 1;
      } catch (err) {
        logger.error({ err, organisationId: org.id }, "[monthlyComplianceReview] Org failed");
        allErrors.push({ organisationId: org.id, error: err.message });
      }
    }

    logger.info(
      { organisationsProcessed, totalReports, totalEmails, errorCount: allErrors.length },
      "[monthlyComplianceReview] Cron run complete",
    );

    return { organisationsProcessed, totalReports, totalEmails, errorCount: allErrors.length };
  } catch (err) {
    logger.error({ err }, "[monthlyComplianceReview] Top-level cron failure");
    throw err;
  }
}
