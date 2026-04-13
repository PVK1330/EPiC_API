const Stripe = require('stripe');

let stripeInstance = null;

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!stripeInstance) {
    stripeInstance = new Stripe(key);
  }
  return stripeInstance;
}

function stripeReady(res) {
  const stripe = getStripe();
  if (!stripe) {
    res.status(503).json({
      status: 'error',
      message: 'Stripe is not configured. Set STRIPE_SECRET_KEY in your environment.',
      data: null
    });
    return null;
  }
  return stripe;
}

// Create Payment Intent
exports.createPaymentIntent = async (req, res) => {
  try {
    const stripe = stripeReady(res);
    if (!stripe) return;

    const { amount, currency = 'usd', payment_method_id, metadata = {} } = req.body;

    // Validate required fields
    if (!amount) {
      return res.status(400).json({
        status: 'error',
        message: 'Amount is required',
        data: null
      });
    }

    if (amount < 50) { // Minimum 50 cents
      return res.status(400).json({
        status: 'error',
        message: 'Amount must be at least $0.50',
        data: null
      });
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: currency.toLowerCase(),
      payment_method: payment_method_id,
      confirmation_method: 'manual',
      confirm: payment_method_id ? true : false,
      metadata: {
        userId: req.user?.userId || null,
        ...metadata
      },
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never'
      }
    });

    res.status(200).json({
      status: 'success',
      message: 'Payment intent created successfully',
      data: {
        client_secret: paymentIntent.client_secret,
        payment_intent_id: paymentIntent.id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        status: paymentIntent.status
      }
    });

  } catch (error) {
    console.error('Stripe Payment Intent Error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to create payment intent',
      data: null
    });
  }
};

// Confirm Payment
exports.confirmPayment = async (req, res) => {
  try {
    const stripe = stripeReady(res);
    if (!stripe) return;

    const { payment_intent_id, payment_method_id } = req.body;

    if (!payment_intent_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Payment intent ID is required',
        data: null
      });
    }

    // Retrieve payment intent
    const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);

    if (paymentIntent.status === 'succeeded') {
      return res.status(200).json({
        status: 'success',
        message: 'Payment already confirmed',
        data: {
          payment_intent_id: paymentIntent.id,
          status: paymentIntent.status,
          amount: paymentIntent.amount
        }
      });
    }

    // Confirm payment
    const confirmedPayment = await stripe.paymentIntents.confirm(payment_intent_id, {
      payment_method: payment_method_id
    });

    res.status(200).json({
      status: 'success',
      message: 'Payment confirmed successfully',
      data: {
        payment_intent_id: confirmedPayment.id,
        status: confirmedPayment.status,
        amount: confirmedPayment.amount,
        currency: confirmedPayment.currency,
        receipt_email: confirmedPayment.receipt_email
      }
    });

  } catch (error) {
    console.error('Stripe Payment Confirmation Error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to confirm payment',
      data: null
    });
  }
};

// Get Payment Status
exports.getPaymentStatus = async (req, res) => {
  try {
    const stripe = stripeReady(res);
    if (!stripe) return;

    const { payment_intent_id } = req.params;

    if (!payment_intent_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Payment intent ID is required',
        data: null
      });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);

    res.status(200).json({
      status: 'success',
      message: 'Payment status retrieved successfully',
      data: {
        payment_intent_id: paymentIntent.id,
        status: paymentIntent.status,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        created: paymentIntent.created,
        metadata: paymentIntent.metadata,
        charges: paymentIntent.charges?.data || []
      }
    });

  } catch (error) {
    console.error('Stripe Payment Status Error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to retrieve payment status',
      data: null
    });
  }
};

// Cancel Payment
exports.cancelPayment = async (req, res) => {
  try {
    const stripe = stripeReady(res);
    if (!stripe) return;

    const { payment_intent_id } = req.body;

    if (!payment_intent_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Payment intent ID is required',
        data: null
      });
    }

    const canceledPayment = await stripe.paymentIntents.cancel(payment_intent_id);

    res.status(200).json({
      status: 'success',
      message: 'Payment canceled successfully',
      data: {
        payment_intent_id: canceledPayment.id,
        status: canceledPayment.status,
        amount: canceledPayment.amount
      }
    });

  } catch (error) {
    console.error('Stripe Payment Cancellation Error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to cancel payment',
      data: null
    });
  }
};

// Create Setup Intent for saving payment methods
exports.createSetupIntent = async (req, res) => {
  try {
    const stripe = stripeReady(res);
    if (!stripe) return;

    const { customer_id } = req.body;

    const setupIntent = await stripe.setupIntents.create({
      customer: customer_id,
      payment_method_types: ['card'],
      usage: 'off_session'
    });

    res.status(200).json({
      status: 'success',
      message: 'Setup intent created successfully',
      data: {
        client_secret: setupIntent.client_secret,
        setup_intent_id: setupIntent.id
      }
    });

  } catch (error) {
    console.error('Stripe Setup Intent Error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to create setup intent',
      data: null
    });
  }
};

// Stripe Webhook Handler
exports.handleWebhook = async (req, res) => {
  const stripe = stripeReady(res);
  if (!stripe) return;

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.log(`Webhook signature verification failed.`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    // Payment Events
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log('PaymentIntent was successful!', paymentIntent.id);
      // TODO: Update your database, send confirmation email, etc.
      break;

    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object;
      console.log('PaymentIntent failed!', failedPayment.id);
      // TODO: Handle failed payment, notify user, etc.
      break;

    case 'payment_intent.canceled':
      const canceledPayment = event.data.object;
      console.log('PaymentIntent was canceled!', canceledPayment.id);
      // TODO: Handle canceled payment
      break;

    // Invoice Events
    case 'invoice.payment_succeeded':
      const successInvoice = event.data.object;
      console.log('Invoice payment succeeded!', successInvoice.id);
      // TODO: Handle successful invoice payment, extend subscription
      break;

    case 'invoice.payment_failed':
      const failedInvoice = event.data.object;
      console.log('Invoice payment failed!', failedInvoice.id);
      // TODO: Handle failed invoice payment, notify user
      break;

    case 'invoice.upcoming':
      const upcomingInvoice = event.data.object;
      console.log('Invoice upcoming!', upcomingInvoice.id);
      // TODO: Send payment reminder email
      break;

    // Subscription Events
    case 'customer.subscription.created':
      const createdSubscription = event.data.object;
      console.log('Subscription created!', createdSubscription.id);
      // TODO: Handle new subscription, update database
      break;

    case 'customer.subscription.updated':
      const updatedSubscription = event.data.object;
      console.log('Subscription updated!', updatedSubscription.id);
      // TODO: Handle subscription changes, update database
      break;

    case 'customer.subscription.deleted':
      const deletedSubscription = event.data.object;
      console.log('Subscription deleted!', deletedSubscription.id);
      // TODO: Handle subscription cancellation, update database
      break;

    case 'customer.subscription.trial_will_end':
      const trialEnding = event.data.object;
      console.log('Trial ending soon!', trialEnding.id);
      // TODO: Send trial ending reminder
      break;

    // Customer Events
    case 'customer.created':
      const customer = event.data.object;
      console.log('Customer created!', customer.id);
      // TODO: Handle new customer creation
      break;

    case 'customer.updated':
      const updatedCustomer = event.data.object;
      console.log('Customer updated!', updatedCustomer.id);
      // TODO: Handle customer updates
      break;

    case 'customer.deleted':
      const deletedCustomer = event.data.object;
      console.log('Customer deleted!', deletedCustomer.id);
      // TODO: Handle customer deletion
      break;

    // Setup Intent Events
    case 'setup_intent.created':
      const setupIntent = event.data.object;
      console.log('Setup intent created!', setupIntent.id);
      break;

    case 'setup_intent.succeeded':
      const succeededSetup = event.data.object;
      console.log('Setup intent succeeded!', succeededSetup.id);
      // TODO: Handle successful setup intent
      break;

    case 'setup_intent.failed':
      const failedSetup = event.data.object;
      console.log('Setup intent failed!', failedSetup.id);
      // TODO: Handle failed setup intent
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  // Return a 200 response to acknowledge receipt of the event
  res.json({ received: true });
};

// Refund Payment
exports.createRefund = async (req, res) => {
  try {
    const stripe = stripeReady(res);
    if (!stripe) return;

    const { payment_intent_id, amount, reason } = req.body;

    if (!payment_intent_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Payment intent ID is required',
        data: null
      });
    }

    const refund = await stripe.refunds.create({
      payment_intent: payment_intent_id,
      amount: amount ? Math.round(amount * 100) : undefined, // Convert to cents if provided
      reason: reason || 'requested_by_customer'
    });

    res.status(200).json({
      status: 'success',
      message: 'Refund created successfully',
      data: {
        refund_id: refund.id,
        amount: refund.amount,
        currency: refund.currency,
        status: refund.status,
        receipt_url: refund.receipt_url
      }
    });

  } catch (error) {
    console.error('Stripe Refund Error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to create refund',
      data: null
    });
  }
};

// Create Subscription
exports.createSubscription = async (req, res) => {
  try {
    const stripe = stripeReady(res);
    if (!stripe) return;

    const { customer_id, price_id, payment_method_id, metadata = {} } = req.body;

    if (!customer_id || !price_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Customer ID and Price ID are required',
        data: null
      });
    }

    // Attach payment method to customer if provided
    if (payment_method_id) {
      await stripe.paymentMethods.attach(payment_method_id, {
        customer: customer_id,
      });

      // Set as default payment method
      await stripe.customers.update(customer_id, {
        invoice_settings: {
          default_payment_method: payment_method_id,
        },
      });
    }

    // Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customer_id,
      items: [{ price: price_id }],
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription',
        payment_method_types: ['card'],
      },
      expand: ['latest_invoice.payment_intent'],
      metadata: {
        userId: req.user?.userId || null,
        ...metadata
      }
    });

    res.status(200).json({
      status: 'success',
      message: 'Subscription created successfully',
      data: {
        subscription_id: subscription.id,
        client_secret: subscription.latest_invoice.payment_intent.client_secret,
        status: subscription.status,
        current_period_start: subscription.current_period_start,
        current_period_end: subscription.current_period_end,
        latest_invoice_id: subscription.latest_invoice.id
      }
    });

  } catch (error) {
    console.error('Stripe Subscription Creation Error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to create subscription',
      data: null
    });
  }
};

// Renew Subscription
exports.renewSubscription = async (req, res) => {
  try {
    const stripe = stripeReady(res);
    if (!stripe) return;

    const { subscription_id, payment_method_id } = req.body;

    if (!subscription_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Subscription ID is required',
        data: null
      });
    }

    // Retrieve the subscription
    const subscription = await stripe.subscriptions.retrieve(subscription_id);

    if (subscription.status === 'active') {
      return res.status(400).json({
        status: 'error',
        message: 'Subscription is already active',
        data: {
          subscription_id: subscription.id,
          status: subscription.status,
          current_period_end: subscription.current_period_end
        }
      });
    }

    // If payment method provided, update it
    if (payment_method_id) {
      await stripe.paymentMethods.attach(payment_method_id, {
        customer: subscription.customer,
      });

      await stripe.customers.update(subscription.customer, {
        invoice_settings: {
          default_payment_method: payment_method_id,
        },
      });
    }

    // Resume/renew the subscription
    const renewedSubscription = await stripe.subscriptions.update(subscription_id, {
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
    });

    res.status(200).json({
      status: 'success',
      message: 'Subscription renewed successfully',
      data: {
        subscription_id: renewedSubscription.id,
        status: renewedSubscription.status,
        current_period_start: renewedSubscription.current_period_start,
        current_period_end: renewedSubscription.current_period_end,
        client_secret: renewedSubscription.latest_invoice?.payment_intent?.client_secret,
        latest_invoice_id: renewedSubscription.latest_invoice?.id
      }
    });

  } catch (error) {
    console.error('Stripe Subscription Renewal Error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to renew subscription',
      data: null
    });
  }
};

// Cancel Subscription
exports.cancelSubscription = async (req, res) => {
  try {
    const stripe = stripeReady(res);
    if (!stripe) return;

    const { subscription_id, cancel_at_period_end = true } = req.body;

    if (!subscription_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Subscription ID is required',
        data: null
      });
    }

    const canceledSubscription = await stripe.subscriptions.update(subscription_id, {
      cancel_at_period_end: cancel_at_period_end,
    });

    res.status(200).json({
      status: 'success',
      message: cancel_at_period_end ? 
        'Subscription will be canceled at the end of the current period' : 
        'Subscription canceled immediately',
      data: {
        subscription_id: canceledSubscription.id,
        status: canceledSubscription.status,
        cancel_at_period_end: canceledSubscription.cancel_at_period_end,
        current_period_end: canceledSubscription.current_period_end,
        canceled_at: canceledSubscription.canceled_at
      }
    });

  } catch (error) {
    console.error('Stripe Subscription Cancellation Error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to cancel subscription',
      data: null
    });
  }
};

// Get Subscription Status
exports.getSubscriptionStatus = async (req, res) => {
  try {
    const stripe = stripeReady(res);
    if (!stripe) return;

    const { subscription_id } = req.params;

    if (!subscription_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Subscription ID is required',
        data: null
      });
    }

    const subscription = await stripe.subscriptions.retrieve(subscription_id, {
      expand: ['latest_invoice', 'customer.default_payment_method']
    });

    res.status(200).json({
      status: 'success',
      message: 'Subscription status retrieved successfully',
      data: {
        subscription_id: subscription.id,
        status: subscription.status,
        current_period_start: subscription.current_period_start,
        current_period_end: subscription.current_period_end,
        cancel_at_period_end: subscription.cancel_at_period_end,
        canceled_at: subscription.canceled_at,
        ended_at: subscription.ended_at,
        trial_start: subscription.trial_start,
        trial_end: subscription.trial_end,
        customer: subscription.customer,
        items: subscription.items.data,
        latest_invoice: subscription.latest_invoice,
        metadata: subscription.metadata
      }
    });

  } catch (error) {
    console.error('Stripe Subscription Status Error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to retrieve subscription status',
      data: null
    });
  }
};

// Update Subscription (change plan, quantity, etc.)
exports.updateSubscription = async (req, res) => {
  try {
    const stripe = stripeReady(res);
    if (!stripe) return;

    const { subscription_id, price_id, quantity = 1, metadata = {} } = req.body;

    if (!subscription_id || !price_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Subscription ID and Price ID are required',
        data: null
      });
    }

    const updatedSubscription = await stripe.subscriptions.update(subscription_id, {
      items: [{
        id: (await stripe.subscriptions.retrieve(subscription_id)).items.data[0].id,
        price: price_id,
        quantity: quantity
      }],
      metadata: {
        ...metadata
      }
    });

    res.status(200).json({
      status: 'success',
      message: 'Subscription updated successfully',
      data: {
        subscription_id: updatedSubscription.id,
        status: updatedSubscription.status,
        current_period_start: updatedSubscription.current_period_start,
        current_period_end: updatedSubscription.current_period_end,
        items: updatedSubscription.items.data
      }
    });

  } catch (error) {
    console.error('Stripe Subscription Update Error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to update subscription',
      data: null
    });
  }
};