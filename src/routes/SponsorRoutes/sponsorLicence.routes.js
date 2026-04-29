import express from "express";
import { 
    submitLicenceApplication, 
    getMyLicenceApplications, 
    getLicenceApplicationDetails,
    updateLicenceApplication,
    deleteMyLicenceApplication,
    renewLicenceApplication,
    getLicenceDocuments
} from "../../controllers/SponsorControllers/sponsorLicence.controller.js";
import { verifyToken } from "../../middlewares/auth.middleware.js";
import { upload } from "../../middlewares/upload.middleware.js";

const router = express.Router();

router.use(verifyToken);

router.post("/apply", upload.array("documents", 10), submitLicenceApplication);
router.get("/my-applications", getMyLicenceApplications);
router.get("/details/:id", getLicenceApplicationDetails);
router.put("/update/:id", upload.array("documents", 10), updateLicenceApplication);
router.delete("/delete/:id", deleteMyLicenceApplication);
router.post("/renew/:id", renewLicenceApplication);
router.get("/documents", getLicenceDocuments);

export default router;
