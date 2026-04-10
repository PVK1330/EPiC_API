const express = require("express");
const router = express.Router();

const adminController = require("../controllers/AdminControllers/admin.controller");
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

// Apply role-based access control - Only Admin can manage admins
router.use(checkRole([ROLES.ADMIN]));

// CREATE Admin
router.post("/", adminController.createAdmin);

// READ Operations
router.get("/", adminController.getAllAdmins);
router.get("/:id", adminController.getAdminById);

// UPDATE Operations
router.put("/:id", adminController.updateAdmin);
router.patch("/toggle-status/:id", adminController.toggleAdminStatus);
router.patch("/reset-password/:id", adminController.resetAdminPassword);

// DELETE Operations
router.delete("/:id", adminController.deleteAdmin);

module.exports = router;
