import { Router } from 'express';
import * as stripeController from './stripepayment.controller.js';
import { verifyToken } from '../../../middlewares/auth.middleware.js';
import { attachTenantDb } from '../../../middlewares/tenantDb.middleware.js';
const router = Router();

// Webhook Route (no authentication required for webhooks)
router.post("/webhook", stripeController.handleWebhook);

// Apply authentication middleware to all other routes
router.use(verifyToken, attachTenantDb);

import { validate } from '../../../middlewares/validate.middleware.js';
import * as schema from '../../../validations/payment.validation.js';

// Case fee checkout (after admin approves CCL)
router.post("/create-checkout-session", stripeController.createCaseCheckoutSession);
router.get("/verify-session/:session_id", stripeController.verifyCheckoutSession);
router.post("/export-invoice-receipt-pdf", validate(schema.exportInvoiceReceiptSchema), stripeController.exportInvoiceReceiptPdf);

// Payment Intent Routes
router.post("/create-payment-intent", validate(schema.createPaymentIntentSchema), stripeController.createPaymentIntent);
router.post("/confirm-payment", validate(schema.confirmPaymentSchema), stripeController.confirmPayment);
router.get("/payment-status/:payment_intent_id", stripeController.getPaymentStatus);
router.post("/cancel-payment", validate(schema.cancelPaymentSchema), stripeController.cancelPayment);

// Setup Intent for saving payment methods
router.post("/create-setup-intent", validate(schema.createSetupIntentSchema), stripeController.createSetupIntent);

// Refund Route
router.post("/refund", validate(schema.createRefundSchema), stripeController.createRefund);

// Subscription Routes
router.post("/create-subscription", validate(schema.createSubscriptionSchema), stripeController.createSubscription);
router.post("/renew-subscription", validate(schema.renewSubscriptionSchema), stripeController.renewSubscription);
router.post("/cancel-subscription", validate(schema.cancelSubscriptionSchema), stripeController.cancelSubscription);
router.get("/subscription-status/:subscription_id", stripeController.getSubscriptionStatus);
router.post("/update-subscription", validate(schema.updateSubscriptionSchema), stripeController.updateSubscription);

export default router;
