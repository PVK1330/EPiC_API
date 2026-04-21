import { Router } from 'express';
import * as stripeController from '../controllers/CandidateControllers/stripepayment.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';

const router = Router();

// Apply authentication middleware to all routes except webhooks
router.use((req, res, next) => {
  if (req.path === '/webhook') {
    return next(); // Skip auth for webhook
  }
  return verifyToken(req, res, next);
});

// Payment Intent Routes
router.post("/create-payment-intent", stripeController.createPaymentIntent);
router.post("/confirm-payment", stripeController.confirmPayment);
router.get("/payment-status/:payment_intent_id", stripeController.getPaymentStatus);
router.post("/cancel-payment", stripeController.cancelPayment);

// Setup Intent for saving payment methods
router.post("/create-setup-intent", stripeController.createSetupIntent);

// Refund Route
router.post("/refund", stripeController.createRefund);

// Subscription Routes
router.post("/create-subscription", stripeController.createSubscription);
router.post("/renew-subscription", stripeController.renewSubscription);
router.post("/cancel-subscription", stripeController.cancelSubscription);
router.get("/subscription-status/:subscription_id", stripeController.getSubscriptionStatus);
router.post("/update-subscription", stripeController.updateSubscription);

// Webhook Route (no authentication required for webhooks)
router.post("/webhook", stripeController.handleWebhook);

export default router;
