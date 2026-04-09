const express = require("express");
const router = express.Router();

const auth = require("../controllers/auth.controller");




router.post("/register", auth.register);
router.post("/verify-otp", auth.verifyOTP); // unverified user
router.post("/resend-otp", auth.resendOTP); // unverified user
router.post("/login", auth.login);
router.post("/logout", auth.logout);
router.post("/forgot-password", auth.forgotPassword);
router.post("/verify-reset-otp", auth.verifyResetOTP);
router.post("/set-password", auth.setPassword);
router.post("/resendOtpUser", auth.resendOtpUser); // user table
router.post("/verifyOtpUser", auth.verifyOtpUser); // user table

module.exports = router;