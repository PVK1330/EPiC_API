const express = require("express");
const router = express.Router();

const auth = require("../controllers/auth.controller");

const ROLES = {
  ADMIN: 1,
  CASEWORKER: 2,
  CANDIDATE: 3,
  BUSINESS: 4,
};

router.post("/register", auth.register);
router.post("/verify-otp", auth.verifyOTP);
router.post("/resend-otp", auth.resendOTP);
router.post("/login", auth.login);
router.post("/forgot-password", auth.forgotPassword);
router.post("/reset-password", auth.resetPassword);

module.exports = router;