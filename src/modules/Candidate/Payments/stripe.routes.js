import { Router } from 'express';
import * as stripeController from './stripepayment.controller.js';
import { verifyToken } from '../../../middlewares/auth.middleware.js';
import { attachTenantDb } from '../../../middlewares/tenantDb.middleware.js';
const router = Router();

// Webhook Route (no authentication required for webhooks)
router.post("/webhook", stripeController.handleWebhook);

// Apply authentication middleware to all other routes
router.use(verifyToken, attachTenantDb);

// Case fee checkout (after admin approves CCL)
router.post("/create-checkout-session", stripeController.createCaseCheckoutSession);
router.get("/verify-session/:session_id", stripeController.verifyCheckoutSession);
router.post("/export-invoice-receipt-pdf", stripeController.exportInvoiceReceiptPdf);

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

export default router;
