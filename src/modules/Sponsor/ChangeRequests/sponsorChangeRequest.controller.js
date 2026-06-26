import logger from '../../../utils/logger.js';
import { getPaginationParams, buildPaginationMeta } from '../../../utils/paginate.js';

const addDays = (dateString, days) => {
  const date = new Date(dateString);
  let count = 0;
  while (count < days) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) {
      count++;
    }
  }
  return date;
};

const toISODate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const resolveStatus = (dateReported, reportingDeadline) => {
  if (dateReported) return "submitted";
  return new Date(reportingDeadline) < new Date() ? "overdue" : "pending";
};

export const createChangeRequest = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { changeType, description, eventDate, notes } = req.validated.body;

    const reportingDeadline = addDays(eventDate, 20);
    const organisationId = req.user?.organisation_id != null ? Number(req.user.organisation_id) : null;
    const evidenceFile = req.file ? req.file.path.replace(/\\/g, '/') : null;

    const newRequest = await req.tenantDb.SponsorChangeRequest.create({
      sponsorId,
      organisationId,
      changeType,
      description: description || null,
      requestedBy: sponsorId,
      status: "pending",
      eventDate: new Date(eventDate),
      reportingDeadline,
      evidenceFile,
      notes: notes || null,
    });

    return res.status(201).json({ status: "success", data: newRequest });
  } catch (error) {
    logger.error({ err: error }, "Error creating sponsor change request");
    return res.status(500).json({ status: "error", message: "Internal server error" });
  }
};

export const getChangeRequestsBySponsor = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { page, limit, offset } = getPaginationParams(req.query);

    const { count, rows: requests } = await req.tenantDb.SponsorChangeRequest.findAndCountAll({
      where: { sponsorId },
      include: [
        { model: req.tenantDb.User, as: "requester", attributes: ["id", "first_name", "last_name", "email"] },
        { model: req.tenantDb.User, as: "reporter", attributes: ["id", "first_name", "last_name", "email"] },
      ],
      order: [["eventDate", "DESC"]],
      limit,
      offset,
    });

    // BUG-08 fix: GET handlers must be idempotent. Overdue status is computed
    // in memory only. Durable persistence of "overdue" is handled by the
    // background compliance job, not on every list read.
    const data = requests.map((reqItem) => {
      const plain = reqItem.toJSON();
      return {
        ...plain,
        status: resolveStatus(plain.dateReported, plain.reportingDeadline),
      };
    });

    return res.status(200).json({
      status: "success",
      data,
      pagination: buildPaginationMeta(count, page, limit),
    });
  } catch (error) {
    logger.error({ err: error }, "Error fetching sponsor change requests");
    return res.status(500).json({ status: "error", message: "Internal server error" });
  }
};

// BUG-03 fix: sponsors may only update notes, evidence, and dateReported.
// Status is always computed server-side via resolveStatus() — never accepted
// from the request body — so a sponsor cannot self-approve/reject their own
// regulatory change request.
const SPONSOR_MUTABLE_STATUSES = ["pending", "submitted", "overdue"];

export const updateChangeRequestStatus = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { id } = req.params;
    const { notes, dateReported, reportedBy } = req.validated.body;

    const request = await req.tenantDb.SponsorChangeRequest.findOne({ where: { id, sponsorId } });
    if (!request) {
      return res.status(404).json({ status: "error", message: "Change request not found" });
    }

    // Only allow edits while the request is still in a sponsor-mutable state.
    if (!SPONSOR_MUTABLE_STATUSES.includes(request.status)) {
      return res.status(400).json({
        status: "error",
        message: `Change request cannot be edited in its current state: ${request.status}`,
      });
    }

    const nextDateReported = dateReported ? new Date(dateReported) : request.dateReported;
    // Status is always derived from the data — never from the request body.
    const nextStatus = resolveStatus(nextDateReported, request.reportingDeadline);

    request.status = nextStatus;
    request.notes = notes ?? request.notes;
    request.dateReported = nextDateReported;
    request.reportedBy = reportedBy || request.reportedBy;

    if (req.file) {
      request.evidenceFile = req.file.path.replace(/\\/g, '/');
    }

    await request.save();

    return res.status(200).json({ status: "success", data: request });
  } catch (error) {
    logger.error({ err: error }, "Error updating sponsor change request");
    return res.status(500).json({ status: "error", message: "Internal server error" });
  }
};
