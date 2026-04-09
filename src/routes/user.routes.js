const express = require("express");
const router = express.Router();

const userController = require("../controllers/user.controller");
const { verifyToken } = require("../middlewares/auth.middleware");

const ROLES = {
  ADMIN: 1,
  CASEWORKER: 2,
  CANDIDATE: 3, 
  BUSINESS: 4,
};


// Get user profile - accessible for all authenticated users
router.get("/profile", verifyToken, userController.profile);

// Edit user profile - accessible for all authenticated users
router.put("/profile", verifyToken, userController.editProfile);


module.exports = router;