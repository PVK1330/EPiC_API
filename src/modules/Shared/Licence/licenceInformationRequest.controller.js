import logger from "../../../utils/logger.js";
import {
  createInfoRequest,
  listInfoRequests,
  getInfoRequest,
  addComment,
  sponsorRespond,
  closeInfoRequest,
} from "../../../services/licenceInformationRequest.service.js";

// Role IDs: 2=CASEWORKER, 3=ADMIN, 4=SPONSOR, 5=SUPERADMIN
function resolveAuthorRole(user) {
  const n = Number(user?.roleId ?? user?.role_id);
  if (n === 4) return "sponsor";
  if (n === 2) return "caseworker";
  return "admin";
}

/** POST /:id/info-requests — raise a new information request (caseworker / admin) */
export const createInfoRequestHandler = async (req, res) => {
  try {
    const { subject, details, requestedDocuments, internalNote } = req.body;
    if (!subject?.trim()) {
      return res.status(400).json({ status: "error", message: "subject is required" });
    }
    const result = await createInfoRequest(
      req.tenantDb,
      { applicationId: req.params.id, subject, details, requestedDocuments, internalNote },
      req.user,
      req,
    );
    return res.status(201).json({ status: "success", data: result });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code >= 500) logger.error({ err }, "createInfoRequest failed");
    return res.status(code).json({ status: "error", message: err.message });
  }
};

/** GET /:id/info-requests — list all requests for an application */
export const listInfoRequestsHandler = async (req, res) => {
  try {
    const data = await listInfoRequests(req.tenantDb, req.params.id);
    return res.status(200).json({ status: "success", data });
  } catch (err) {
    logger.error({ err }, "listInfoRequests failed");
    return res.status(500).json({ status: "error", message: "Failed to list information requests" });
  }
};

/** GET /:id/info-requests/:requestId — single request with full comment thread */
export const getInfoRequestHandler = async (req, res) => {
  try {
    const data = await getInfoRequest(req.tenantDb, req.params.requestId, req.params.id);
    if (!data) return res.status(404).json({ status: "error", message: "Information request not found" });
    return res.status(200).json({ status: "success", data });
  } catch (err) {
    logger.error({ err }, "getInfoRequest failed");
    return res.status(500).json({ status: "error", message: "Failed to fetch information request" });
  }
};

/** POST /:id/info-requests/:requestId/comments — add a comment */
export const addCommentHandler = async (req, res) => {
  try {
    const { comment, isInternal } = req.body;
    if (!comment?.trim()) {
      return res.status(400).json({ status: "error", message: "comment is required" });
    }
    const authorRole = resolveAuthorRole(req.user);
    const data = await addComment(req.tenantDb, {
      requestId: req.params.requestId,
      applicationId: req.params.id,
      authorId: req.user?.userId,
      authorRole,
      comment,
      isInternal: Boolean(isInternal),
    });
    return res.status(201).json({ status: "success", data });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code >= 500) logger.error({ err }, "addComment failed");
    return res.status(code).json({ status: "error", message: err.message });
  }
};

/** PATCH /:id/info-requests/:requestId/close — caseworker / admin closes a request */
export const closeInfoRequestHandler = async (req, res) => {
  try {
    const { notes } = req.body;
    const data = await closeInfoRequest(
      req.tenantDb,
      {
        applicationId: req.params.id,
        requestId: req.params.requestId,
        closedById: req.user?.userId,
        notes,
      },
      req.user,
      req,
    );
    return res.status(200).json({ status: "success", data });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code >= 500) logger.error({ err }, "closeInfoRequest failed");
    return res.status(code).json({ status: "error", message: err.message });
  }
};

/** POST /:id/info-requests/:requestId/respond — sponsor submits a response */
export const sponsorRespondHandler = async (req, res) => {
  try {
    const { sponsorResponse } = req.body;
    if (!sponsorResponse?.trim()) {
      return res.status(400).json({ status: "error", message: "sponsorResponse is required" });
    }
    const data = await sponsorRespond(
      req.tenantDb,
      {
        applicationId: req.params.id,
        requestId: req.params.requestId,
        sponsorResponse,
      },
      req.user,
      req,
    );
    return res.status(200).json({ status: "success", data });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code >= 500) logger.error({ err }, "sponsorRespond failed");
    return res.status(code).json({ status: "error", message: err.message });
  }
};
