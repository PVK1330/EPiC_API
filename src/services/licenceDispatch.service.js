import path from "path";
import fs from "fs";
import logger from "../utils/logger.js";
import { sendTransactionalEmail } from "./mail.service.js";
import { generateDocumentDispatchTemplate } from "../utils/emailTemplates.js";
import { recordLicenceAudit } from "./licenceAssignment.service.js";
import {
  notifyUser,
  NotificationTypes,
  NotificationPriority,
} from "./notification.service.js";

const PRIVATE_STORAGE_DIR = path.resolve(process.cwd(), "storage/private");

const DOCUMENT_TYPE_LABELS = {
  declaration_form: "Declaration Form",
  credentials: "Credentials Document",
  sponsor_licence: "Sponsor Licence",
  supporting_document: "Supporting Document",
  other: "Document",
};

/**
 * Upload and dispatch a document from admin/caseworker to the sponsor.
 * Saves the file record, sends an email with the file attached, and
 * creates an in-app notification.
 */
export async function dispatchDocument(tenantDb, { application, file, documentType, documentName, message, actorUser, req }) {
  const actorId = actorUser?.userId ?? actorUser?.id ?? null;
  const senderRole = actorUser?.roleId === 5 || actorUser?.role_id === 5 ? "superadmin"
    : actorUser?.roleId === 3 || actorUser?.role_id === 3 ? "admin"
    : "caseworker";

  const relativeFilePath = path.relative(PRIVATE_STORAGE_DIR, file.path);

  const record = await tenantDb.LicenceDispatchDocument.create({
    licenceApplicationId: application.id,
    senderUserId: actorId,
    senderRole,
    documentType: documentType || "supporting_document",
    documentName: documentName || file.originalname,
    filePath: relativeFilePath,
    fileName: file.originalname,
    fileSize: file.size,
    mimeType: file.mimetype,
    message: message || null,
    emailSent: false,
  });

  // Fetch sender details for the email.
  const sender = await tenantDb.User.findByPk(actorId, {
    attributes: ["first_name", "last_name"],
  }).catch(() => null);
  const senderName = sender
    ? `${sender.first_name || ""} ${sender.last_name || ""}`.trim() || "Your caseworker"
    : "Your caseworker";

  // Fetch sponsor email.
  const sponsorUser = await tenantDb.User.findByPk(application.userId, {
    attributes: ["email", "first_name"],
  }).catch(() => null);

  const orgId = req?.organisationContext?.organisation?.id ?? null;
  const companyName = application.companyName || `Application #${application.id}`;

  let emailSent = false;
  if (sponsorUser?.email) {
    try {
      await sendTransactionalEmail({
        organisationId: orgId,
        to: sponsorUser.email,
        subject: `New document from your caseworker — ${documentName || file.originalname}`,
        html: generateDocumentDispatchTemplate({
          recipientName: sponsorUser.first_name || "there",
          companyName,
          senderName,
          senderRole,
          documentName: documentName || file.originalname,
          documentType: documentType || "supporting_document",
          message,
          portalUrl: `${process.env.FRONTEND_URL || ""}/business/licence-process`,
        }),
        attachments: [
          {
            filename: file.originalname,
            path: file.path,
          },
        ],
      });
      emailSent = true;
    } catch (err) {
      logger.error({ err, applicationId: application.id }, "dispatchDocument: email failed");
    }
  }

  if (emailSent) {
    await record.update({ emailSent: true }).catch(() => {});
  }

  // In-app notification to sponsor.
  notifyUser(tenantDb, application.userId, {
    type: NotificationTypes.INFO,
    priority: NotificationPriority.NORMAL,
    title: "New Document from Caseworker",
    message: `${senderName} has sent you a ${DOCUMENT_TYPE_LABELS[documentType] || "document"}: "${documentName || file.originalname}". Check your email or download it from your portal.`,
    category: "licence",
    entityType: "licence_application",
    entityId: application.id,
    actionType: "document_dispatched",
    sendEmail: false,
  }).catch((err) => logger.warn({ err }, "dispatchDocument: in-app notification failed"));

  // Audit trail.
  recordLicenceAudit({
    tenantDb,
    application,
    actorId,
    action: "DOCUMENT_DISPATCHED",
    previousStatus: application.status,
    newStatus: application.status,
    notes: `Document dispatched to sponsor: "${documentName || file.originalname}" (${DOCUMENT_TYPE_LABELS[documentType] || "other"})`,
    req,
  }).catch((err) => logger.warn({ err }, "dispatchDocument: audit failed"));

  return {
    id: record.id,
    documentName: record.documentName,
    documentType: record.documentType,
    emailSent,
    sentAt: record.createdAt,
  };
}

/**
 * List all documents dispatched to a sponsor for a given application.
 */
export async function listDispatchedDocuments(tenantDb, applicationId) {
  const docs = await tenantDb.LicenceDispatchDocument.findAll({
    where: { licenceApplicationId: applicationId },
    include: [
      { model: tenantDb.User, as: "sender", attributes: ["id", "first_name", "last_name"] },
    ],
    order: [["created_at", "DESC"]],
  });

  return docs.map((d) => ({
    id: d.id,
    documentName: d.documentName,
    documentType: d.documentType,
    senderRole: d.senderRole,
    senderName: d.sender
      ? `${d.sender.first_name || ""} ${d.sender.last_name || ""}`.trim()
      : "Unknown",
    message: d.message,
    emailSent: d.emailSent,
    downloadedAt: d.downloadedAt,
    fileSize: d.fileSize,
    mimeType: d.mimeType,
    sentAt: d.createdAt,
  }));
}

/**
 * Stream a dispatch document file to the response (for download).
 * Marks the document as downloaded on first access.
 */
export async function downloadDispatchDocument(tenantDb, { docId, applicationId, res }) {
  const doc = await tenantDb.LicenceDispatchDocument.findOne({
    where: { id: docId, licenceApplicationId: applicationId },
  });

  if (!doc) {
    return { notFound: true };
  }

  const absolutePath = path.join(PRIVATE_STORAGE_DIR, doc.filePath);
  if (!fs.existsSync(absolutePath)) {
    return { notFound: true };
  }

  if (!doc.downloadedAt) {
    await doc.update({ downloadedAt: new Date() }).catch(() => {});
  }

  return { absolutePath, fileName: doc.fileName, mimeType: doc.mimeType };
}
