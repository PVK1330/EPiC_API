const express = require("express");
const router = express.Router();

const caseworkerController = require("../controllers/AdminControllers/caseworker.controller");
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

// Apply role-based access control - Only Admin can manage caseworkers
router.use(checkRole([ROLES.ADMIN]));

// CREATE Caseworker
router.post("/", caseworkerController.createCaseworker);

// READ Operations
router.get("/", caseworkerController.getAllCaseworkers);
router.get("/:id", caseworkerController.getCaseworkerById);

// UPDATE Operations
router.put("/:id", caseworkerController.updateCaseworker);
router.patch("/:id/toggle-status", caseworkerController.toggleCaseworkerStatus);
router.patch("/:id/reset-password", caseworkerController.resetCaseworkerPassword);

// DELETE Operations
router.delete("/:id", caseworkerController.deleteCaseworker);

module.exports = router;
