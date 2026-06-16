import logger from "../../../utils/logger.js";
import {
  grantLicence,
  rejectLicence,
  getGrantRecord,
} from "../../../services/licenceGrant.service.js";

/** POST /:id/grant — admin grants the licence (Decision Pending → Licence Granted) */
export const grantLicenceHandler = async (req, res) => {
  try {
    const { notes, expiryDate, sponsorType, rating, cosAllocation } = req.body;
    const result = await grantLicence(
      req.tenantDb,
      {
        applicationId: req.params.id,
        approvedById: req.user?.userId,
        notes,
        expiryDate,
        sponsorType,
        rating,
        cosAllocation,
      },
      req.user,
      req,
    );
    return res.status(200).json({
      status: "success",
      message: `Sponsor licence granted — ${result.licenceNumber}`,
      data: {
        applicationId: Number(req.params.id),
        status: result.application.status,
        licenceNumber: result.licenceNumber,
        grantRecord: result.grantRecord,
      },
    });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code >= 500) logger.error({ err }, "grantLicenceHandler failed");
    return res.status(code).json({ status: "error", message: err.message });
  }
};

/** POST /:id/reject-final — admin rejects at Decision Pending (Licence Rejected) */
export const rejectLicenceHandler = async (req, res) => {
  try {
    const { rejectionReason, notes } = req.body;
    const result = await rejectLicence(
      req.tenantDb,
      {
        applicationId: req.params.id,
        rejectionReason,
        notes,
        rejectedById: req.user?.userId,
      },
      req.user,
      req,
    );
    return res.status(200).json({
      status: "success",
      message: "Sponsor licence application rejected",
      data: {
        applicationId: Number(req.params.id),
        status: result.application.status,
        rejectionReason: result.application.rejectionReason,
      },
    });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code >= 500) logger.error({ err }, "rejectLicenceHandler failed");
    return res.status(code).json({ status: "error", message: err.message });
  }
};

/** GET /:id/grant-record — retrieve the formal grant record for an application */
export const getGrantRecordHandler = async (req, res) => {
  try {
    const record = await getGrantRecord(req.tenantDb, req.params.id);
    if (!record) {
      return res.status(404).json({ status: "error", message: "No grant record found for this application" });
    }
    return res.status(200).json({ status: "success", data: record });
  } catch (err) {
    logger.error({ err }, "getGrantRecordHandler failed");
    return res.status(500).json({ status: "error", message: "Failed to retrieve grant record" });
  }
};
