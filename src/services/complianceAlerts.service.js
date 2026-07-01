import { Op } from "sequelize";
import platformDb from "../models/index.js";
import { getTenantDb } from "./tenantDb.service.js";
import {
  notifyAdmins,
  notifyUser,
  NotificationTypes,
  NotificationPriority,
} from "./notification.service.js";
import { localDateStr } from "../utils/dateHelpers.js";
import logger from "../utils/logger.js";

const VISA_ALERT_DAYS = [120, 90, 60, 30];

const extractCaseworkerIds = (assignedcaseworkerId) => {
  if (!Array.isArray(assignedcaseworkerId)) return [];
  return assignedcaseworkerId
    .map((entry) => {
      if (typeof entry === "number") return entry;
      if (entry && typeof entry === "object") {
        return entry.id || entry.userId || entry.caseworkerId || null;
      }
      return null;
    })
    .filter((id) => Number.isInteger(id));
};

const toDateOnly = (date) => {
  return localDateStr(new Date(date));
};

const addDays = (base, days) => {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
};

const notifyCaseworkersAndAdmins = async ({
  tenantDb,
  organisationId,
  caseworkerIds,
  title,
  message,
  actionType,
  entityId,
  entityType,
  metadata,
}) => {
  try {
    await notifyAdmins(tenantDb, {
      type: NotificationTypes.WARNING,
      priority: NotificationPriority.HIGH,
      title,
      message,
      actionType,
      entityId,
      entityType,
      metadata,
      organisationId,
      sendEmail: true,
    });
  } catch (err) {
    logger.error({ err }, "Failed to notify admins for compliance alert");
  }

  for (const caseworkerId of caseworkerIds) {
    try {
      await notifyUser(tenantDb, caseworkerId, {
        type: NotificationTypes.WARNING,
        priority: NotificationPriority.HIGH,
        title,
        message,
        actionType,
        entityId,
        entityType,
        metadata,
        sendEmail: true,
        organisationId,
      });
    } catch (err) {
      logger.error({ err, caseworkerId }, "Failed to notify caseworker for compliance alert");
    }
  }
};

const checkVisaExpiryAlerts = async (tenantDb, organisationId, today) => {
  let count = 0;

  for (const days of VISA_ALERT_DAYS) {
    const targetDate = toDateOnly(addDays(today, days));

    const cases = await tenantDb.Case.findAll({
      where: { sponsorId: { [Op.not]: null } },
      attributes: ["id", "caseId", "assignedcaseworkerId", "candidateId"],
      include: [
        {
          model: tenantDb.User,
          as: "candidate",
          attributes: ["id", "first_name", "last_name"],
          required: true,
          include: [
            {
              model: tenantDb.CandidateApplication,
              as: "application",
              where: { visaEndDate: targetDate },
              required: true,
              attributes: ["visaEndDate", "visaType"],
            },
          ],
        },
      ],
    });

    for (const workerCase of cases) {
      const candidate = workerCase.candidate;
      const workerName = [candidate?.first_name, candidate?.last_name].filter(Boolean).join(" ") || "Sponsored worker";

      await notifyCaseworkersAndAdmins({
        tenantDb,
        organisationId,
        caseworkerIds: extractCaseworkerIds(workerCase.assignedcaseworkerId),
        title: `Visa Expiry Alert: ${days} Days`,
        message: `Sponsored worker ${workerName} (case ${workerCase.caseId}) visa expires in ${days} days on ${targetDate}.`,
        actionType: "visa_expiry_alert",
        entityId: workerCase.id,
        entityType: "case",
        metadata: {
          caseId: workerCase.caseId,
          daysRemaining: days,
          visaEndDate: targetDate,
          candidateId: workerCase.candidateId,
        },
      });
      count += 1;
    }
  }

  return count;
};

const checkWorkerEventDeadlines = async (tenantDb, organisationId, today) => {
  const todayStr = toDateOnly(today);
  const twoDaysLaterStr = toDateOnly(addDays(today, 2));

  // Scope to this organisation so tenants that share a database don't emit
  // duplicate alerts for one another's worker events.
  const where = {
    status: "pending",
    deadlineDate: { [Op.between]: [todayStr, twoDaysLaterStr] },
  };
  if (organisationId != null) where.organisationId = organisationId;

  const events = await tenantDb.WorkerEvent.findAll({
    where,
    include: [
      {
        model: tenantDb.User,
        as: "worker",
        attributes: ["id", "first_name", "last_name"],
      },
    ],
  });

  for (const event of events) {
    const workerCase = await tenantDb.Case.findOne({
      where: { sponsorId: event.sponsorId, candidateId: event.workerId },
      attributes: ["id", "caseId", "assignedcaseworkerId"],
    });

    const worker = event.worker;
    const workerName = [worker?.first_name, worker?.last_name].filter(Boolean).join(" ") || "Worker";

    await notifyCaseworkersAndAdmins({
      tenantDb,
      organisationId,
      caseworkerIds: extractCaseworkerIds(workerCase?.assignedcaseworkerId),
      title: "Worker Event Reporting Deadline Approaching",
      message: `Worker event "${event.eventType}" for ${workerName} is due by ${event.deadlineDate}. Please ensure SMS reporting is completed.`,
      actionType: "worker_event_deadline_approaching",
      entityId: event.id,
      entityType: "worker_event",
      metadata: {
        caseId: workerCase?.caseId || null,
        eventType: event.eventType,
        deadlineDate: event.deadlineDate,
        workerId: event.workerId,
      },
    });
  }

  return events.length;
};

const checkRightToWorkFollowUps = async (tenantDb, organisationId, today) => {
  const todayStr = toDateOnly(today);
  const fourteenDaysLaterStr = toDateOnly(addDays(today, 14));

  const records = await tenantDb.RightToWorkRecord.findAll({
    where: {
      followUpCheckDate: {
        [Op.not]: null,
        [Op.between]: [todayStr, fourteenDaysLaterStr],
      },
    },
    include: [
      {
        // RightToWorkRecord.worker is a SponsoredWorker (FK workerId), not a User —
        // unlike WorkerEvent.worker which is a User. Using tenantDb.User here threw
        // SequelizeEagerLoadingError ("User associated multiple times").
        model: tenantDb.SponsoredWorker,
        as: "worker",
        attributes: ["id", "workerFirstName", "workerLastName"],
      },
    ],
  });

  for (const record of records) {
    const workerCase = await tenantDb.Case.findOne({
      where: { sponsorId: record.sponsorId, candidateId: record.workerId },
      attributes: ["id", "caseId", "assignedcaseworkerId"],
    });

    const worker = record.worker;
    const workerName = [worker?.workerFirstName, worker?.workerLastName].filter(Boolean).join(" ") || "Worker";

    await notifyCaseworkersAndAdmins({
      tenantDb,
      organisationId,
      caseworkerIds: extractCaseworkerIds(workerCase?.assignedcaseworkerId),
      title: "Right to Work Follow-up Check Due",
      message: `A right to work follow-up check for ${workerName} is due by ${record.followUpCheckDate}.`,
      actionType: "rtw_followup_alert",
      entityId: record.id,
      entityType: "right_to_work_record",
      metadata: {
        caseId: workerCase?.caseId || null,
        followUpCheckDate: record.followUpCheckDate,
        workerId: record.workerId,
      },
    });
  }

  return records.length;
};

const checkSponsorChangeRequestDeadlines = async (tenantDb, organisationId, today) => {
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfTwoDays = addDays(today, 2);
  endOfTwoDays.setHours(23, 59, 59, 999);

  const requests = await tenantDb.SponsorChangeRequest.findAll({
    where: {
      status: "pending",
      reportingDeadline: { [Op.between]: [startOfToday, endOfTwoDays] },
    },
  });

  for (const request of requests) {
    const deadlineLabel = request.reportingDeadline
      ? localDateStr(new Date(request.reportingDeadline))
      : "soon";

    try {
      await notifyAdmins(tenantDb, {
        type: NotificationTypes.WARNING,
        priority: NotificationPriority.HIGH,
        title: "Sponsor Change Request Deadline Approaching",
        message: `A sponsor change request (${request.changeType}) must be reported by ${deadlineLabel}.`,
        actionType: "sponsor_change_deadline_approaching",
        entityId: request.id,
        entityType: "sponsor_change_request",
        metadata: {
          changeType: request.changeType,
          reportingDeadline: request.reportingDeadline,
          sponsorId: request.sponsorId,
        },
        organisationId,
        sendEmail: true,
      });
    } catch (err) {
      logger.error({ err }, "Failed to notify admins for sponsor change request alert");
    }

    if (request.sponsorId) {
      try {
        await notifyUser(tenantDb, request.sponsorId, {
          type: NotificationTypes.WARNING,
          priority: NotificationPriority.HIGH,
          title: "Sponsor Change Request Deadline Approaching",
          message: `Your sponsor change request (${request.changeType}) must be reported by ${deadlineLabel}.`,
          actionType: "sponsor_change_deadline_approaching",
          entityId: request.id,
          entityType: "sponsor_change_request",
          metadata: {
            changeType: request.changeType,
            reportingDeadline: request.reportingDeadline,
          },
          sendEmail: true,
          organisationId,
        });
      } catch (err) {
        logger.error({ err, sponsorId: request.sponsorId }, "Failed to notify sponsor for change request alert");
      }
    }
  }

  return requests.length;
};

const runTenantComplianceChecks = async (tenantDb, organisationId, today) => {
  const visaAlerts = await checkVisaExpiryAlerts(tenantDb, organisationId, today);
  const workerEventAlerts = await checkWorkerEventDeadlines(tenantDb, organisationId, today);
  const rtwAlerts = await checkRightToWorkFollowUps(tenantDb, organisationId, today);
  const changeRequestAlerts = await checkSponsorChangeRequestDeadlines(tenantDb, organisationId, today);

  return {
    visaAlerts,
    workerEventAlerts,
    rtwAlerts,
    changeRequestAlerts,
  };
};

export async function runComplianceAlerts() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const organisations = await platformDb.Organisation.findAll({
      where: {
        status: { [Op.in]: ["active", "trial"] },
        database_name: { [Op.not]: null },
      },
      attributes: ["id", "name", "database_name"],
    });

    let visaAlerts = 0;
    let workerEventAlerts = 0;
    let rtwAlerts = 0;
    let changeRequestAlerts = 0;
    let organisationsProcessed = 0;

    for (const org of organisations) {
      try {
        const tenantDb = getTenantDb(org.database_name);
        const result = await runTenantComplianceChecks(tenantDb, org.id, today);
        visaAlerts += result.visaAlerts;
        workerEventAlerts += result.workerEventAlerts;
        rtwAlerts += result.rtwAlerts;
        changeRequestAlerts += result.changeRequestAlerts;
        organisationsProcessed += 1;
      } catch (err) {
        logger.error({ err, organisationId: org.id }, "Compliance alerts failed for org");
      }
    }

    logger.info(
      { organisationsProcessed, visaAlerts, workerEventAlerts, rtwAlerts, changeRequestAlerts },
      "Compliance alerts completed",
    );
  } catch (error) {
    logger.error({ err: error }, "Compliance alerts check failed");
  }
}
