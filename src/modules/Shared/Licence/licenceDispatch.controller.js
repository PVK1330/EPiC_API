import logger from "../../../utils/logger.js";
import ApiResponse from "../../../utils/apiResponse.js";
import {
  dispatchDocument,
  listDispatchedDocuments,
  downloadDispatchDocument,
} from "../../../services/licenceDispatch.service.js";

/** POST /:id/dispatch-document — admin or caseworker uploads + sends a file to sponsor */
export const dispatchDocumentHandler = async (req, res) => {
  try {
    if (!req.file) {
      return ApiResponse.badRequest(res, "No file uploaded");
    }

    const application = await req.tenantDb.LicenceApplication.findByPk(req.params.id);
    if (!application) return ApiResponse.notFound(res, "Licence application not found");

    const { documentType, documentName, message } = req.body;

    const result = await dispatchDocument(req.tenantDb, {
      application,
      file: req.file,
      documentType,
      documentName,
      message,
      actorUser: req.user,
      req,
    });

    return ApiResponse.success(res, "Document dispatched to sponsor", result);
  } catch (err) {
    logger.error({ err }, "dispatchDocumentHandler failed");
    return ApiResponse.error(res, "Failed to dispatch document", 500, err);
  }
};

/** GET /:id/dispatch-documents — list all dispatched documents (admin/caseworker/sponsor) */
export const listDispatchDocumentsHandler = async (req, res) => {
  try {
    // Sponsors may only list documents for their own applications.
    const userRoleId = req.user?.roleId ?? req.user?.role_id;
    const isSponsor = userRoleId === 4; // 4 = sponsor
    if (isSponsor) {
      const app = await req.tenantDb.LicenceApplication.findOne({
        where: { id: req.params.id, userId: req.user.userId },
        attributes: ["id"],
      });
      if (!app) return ApiResponse.notFound(res, "Application not found");
    }

    const docs = await listDispatchedDocuments(req.tenantDb, req.params.id);
    return ApiResponse.success(res, "Dispatched documents retrieved", docs);
  } catch (err) {
    logger.error({ err }, "listDispatchDocumentsHandler failed");
    return ApiResponse.error(res, "Failed to retrieve dispatched documents", 500, err);
  }
};

/** GET /:id/dispatch-documents/:docId/download — stream the file */
export const downloadDispatchDocumentHandler = async (req, res) => {
  try {
    const result = await downloadDispatchDocument(req.tenantDb, {
      docId: req.params.docId,
      applicationId: req.params.id,
      res,
    });

    if (result.notFound) {
      return ApiResponse.notFound(res, "Document not found");
    }

    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(result.fileName)}"`);
    if (result.mimeType) res.setHeader("Content-Type", result.mimeType);

    const { createReadStream } = await import("fs");
    const stream = createReadStream(result.absolutePath);
    stream.on("error", () => ApiResponse.error(res, "File read failed", 500));
    stream.pipe(res);
  } catch (err) {
    logger.error({ err }, "downloadDispatchDocumentHandler failed");
    return ApiResponse.error(res, "Failed to download document", 500, err);
  }
};
