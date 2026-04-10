const express = require("express");
const router = express.Router();

const candidateController = require("../controllers/AdminControllers/candidate.controller");
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

// Apply role-based access control - Only Admin can manage candidates
router.use(checkRole([ROLES.ADMIN]));

// CREATE Candidate
router.post("/", candidateController.createCandidate);

// READ Operations
router.get("/", candidateController.getAllCandidates);
router.get("/:id", candidateController.getCandidateById);

// UPDATE Operations
router.put("/:id", candidateController.updateCandidate);
router.patch("/:id/toggle-status", candidateController.toggleCandidateStatus);
router.patch("/:id/reset-password", candidateController.resetCandidatePassword);

// DELETE Operations
router.delete("/:id", candidateController.deleteCandidate);

module.exports = router;
