const express = require("express");
const router = express.Router();

const sponsorsController = require("../controllers/AdminControllers/sponsors.controller");
const { verifyToken } = require("../middlewares/auth.middleware");
const { checkRole } = require("../middlewares/role.middleware");

// Define ROLES constants
const ROLES = {
  ADMIN: 1,
  CASEWORKER: 2,
  CANDIDATE: 3,
  BUSINESS: 4,
};

// Apply authentication middleware to all routes
router.use(verifyToken);

// Apply role-based access control - Only Admin can manage sponsors
router.use(checkRole([ROLES.ADMIN]));

// CREATE Sponsor
router.post("/", sponsorsController.createSponsor);

// READ Operations
router.get("/", sponsorsController.getAllSponsors);
router.get("/:id", sponsorsController.getSponsorById);

// UPDATE Operations
router.put("/:id", sponsorsController.updateSponsor);
router.patch("/:id/toggle-status", sponsorsController.toggleSponsorStatus);
router.patch("/:id/reset-password", sponsorsController.resetSponsorPassword);

// DELETE Operations
router.delete("/:id", sponsorsController.deleteSponsor);

module.exports = router;
