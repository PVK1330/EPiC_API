# Billing & Subscription System Implementation

## Overview
Complete billing and subscription management system for the EPiC multi-tenant SaaS platform. All subscription logic lives in the platform database, separate from tenant databases.

## Backend Implementation

### Part 1: Database Migrations
**File:** `src/migrations/superadmin/006_subscriptions_billing.sql`

Created three new tables in platform database:
- **subscriptions**: Tracks organisation subscriptions with status, billing periods, Stripe IDs
- **invoices**: Stores invoice records with payment status and gateway references
- **payment_transactions**: Records all payment transactions with metadata

Added columns to organisations table:
- `trial_ends_at`
- `subscription_expires_at`
- `stripe_customer_id`

Implemented PostgreSQL triggers:
1. Auto-expire subscriptions when `current_period_end` passes
2. Mark subscriptions as `past_due` when invoices become overdue
3. Transaction-safe payment processing with automatic rollback

### Part 2: Platform Models
Created Sequelize models:
- `src/models/platform/subscription.model.js`
- `src/models/platform/invoice.model.js`
- `src/models/platform/paymentTransaction.model.js`

Updated `src/models/index.js` with complete associations:
- Organisation → Subscriptions → Invoices → PaymentTransactions
- Plan → Subscriptions

### Part 3: Backend Controllers & Routes

#### Subscription Controller
**File:** `src/modules/Superadmin/subscription.controller.js`
- `getAllSubscriptions` - List all with org and plan joined
- `getSubscriptionByOrg` - Get subscription for specific organisation
- `createSubscription` - Create new subscription
- `updateSubscription` - Update subscription details
- `cancelSubscription` - Cancel subscription
- `renewSubscription` - Renew with automatic invoice generation (transactional)

#### Invoice Controller
**File:** `src/modules/Superadmin/invoice.controller.js`
- `getAllInvoices` - List all with org and plan joined
- `getInvoiceById` - Get single invoice details
- `updateInvoiceStatus` - Update invoice status
- `exportInvoicesPdf` - Export invoices as PDF using existing pdfGenerator service
- `exportFinancials` - Export multi-sheet Excel using existing excelExport utility

#### Payment Controller
**File:** `src/modules/Superadmin/payment.controller.js`
- `getAllTransactions` - List with filters for status and gateway
- `getTransactionById` - Get single transaction
- `getGatewayStatus` - Check Stripe connection health
- `configureGateway` - Save gateway settings
- `getDashboardStats` - Calculate MRR, ARR, churn rate, success rate, refund rate

#### Routes
**File:** `src/modules/Superadmin/superadmin.routes.js`
All routes protected with `verifyToken` and `isSuperAdmin` middleware:
- `/api/superadmin/subscriptions/*`
- `/api/superadmin/invoices/*`
- `/api/superadmin/transactions/*`
- `/api/superadmin/gateway/*`
- `/api/superadmin/dashboard/stats`
- `/api/superadmin/financials/export`

### Part 4: Background Job
**File:** `src/services/subscriptionExpiry.service.js`

Function: `checkAndExpireSubscriptions()`
- Expires subscriptions past `current_period_end`
- Suspends organisation when subscription expires
- Sends expiry notification emails
- Sends warning emails 7 days and 1 day before expiry
- Runs every 6 hours via `setInterval` in `src/server.js`

### Part 5: Login Block for Suspended Organisations

#### Auth Middleware
**File:** `src/middlewares/auth.middleware.js`
- Added subscription check in `verifyToken`
- Blocks access if organisation status is `suspended`
- Blocks access if no active/trial subscription exists
- Exempts superadmin users (role_id 5)

#### Auth Controller
**File:** `src/modules/Auth/auth.controller.js`
- Added subscription check in `login` function
- Returns 403 with message: "Your organisation subscription has expired. Please contact your administrator."
- Checks both organisation status and active subscriptions
- Exempts superadmin users

## Frontend Implementation

### Part 6: React Components & Hooks

#### Services
**File:** `src/services/billingApi.js`
All API calls for billing operations:
- Subscriptions CRUD
- Invoices management
- Transactions listing
- Gateway configuration
- Dashboard stats
- Export functions

#### Custom Hook
**File:** `src/hooks/useBilling.js`
Centralized billing state management:
- `subscriptions`, `invoices`, `transactions` state
- `dashboardStats`, `gatewayStatus` state
- Loading states per operation
- All action methods from billingApi
- Follows exact pattern from `useCaseDetail.js`

#### Updated Pages

**SuperadminBilling.jsx**
- Fully dynamic using `useBilling` hook
- Real-time stats: MRR, ARR, Churn Rate, Active Subscriptions
- Live Revenue Ledger table with invoice data
- Search and filter functionality
- Invoice detail modal with full transaction info
- Export Financials button with Excel download

**SuperadminPayments.jsx**
- Fully dynamic using `useBilling` hook
- Stats: Gross Volume, Net Revenue, Success Rate, Refund Rate
- Three tabs: Transactions, Payouts, Refunds (filtered from transactions)
- Gateway Status panel with live Stripe connection info
- Configure Gateway modal with form state
- Transaction detail modal with complete metadata
- All data from API, no hardcoded values

#### Supporting Services
**File:** `src/services/superadminPlan.service.js`
- Plan CRUD operations for SuperadminPlans page

**File:** `src/services/superadminOrganisation.service.js`
- Organisation CRUD operations
- Impersonation functionality

## Key Features

### Subscription Management
- Automatic expiry based on billing periods
- Trial, active, expired, cancelled, past_due statuses
- Stripe integration ready
- Automatic invoice generation on renewal

### Payment Processing
- Transaction-safe with PostgreSQL triggers
- Automatic status updates across invoices and subscriptions
- Rollback on failure
- Complete audit trail with metadata

### Access Control
- Suspended organisations blocked at login
- Expired subscriptions block access
- Token verification checks subscription status
- Superadmin bypass for all checks

### Reporting & Analytics
- MRR/ARR calculations
- Churn rate tracking
- Success/refund rate metrics
- PDF invoice exports
- Multi-sheet Excel financial exports

### Email Notifications
- Subscription expiry alerts
- 7-day and 1-day warnings
- Uses existing mail service pattern
- Organisation-specific SMTP support

## Database Schema

### subscriptions
```sql
id, organisation_id, plan_id, status, current_period_start, 
current_period_end, trial_ends_at, cancelled_at, 
stripe_subscription_id, stripe_customer_id, createdAt, updatedAt
```

### invoices
```sql
id, organisation_id, subscription_id, invoice_number, amount, 
currency, status, payment_method, payment_gateway, 
stripe_invoice_id, stripe_payment_intent_id, paid_at, due_at, 
createdAt, updatedAt
```

### payment_transactions
```sql
id, organisation_id, invoice_id, reference, amount, currency, 
status, payment_method, gateway, gateway_reference, 
failure_reason, metadata, createdAt, updatedAt
```

## Testing Checklist

### Backend
- [ ] Run migrations: Platform database tables created
- [ ] Seed plans: Plans exist in database
- [ ] Create subscription: New subscription record
- [ ] Renew subscription: Period extended, invoice created
- [ ] Expire subscription: Status changes, org suspended
- [ ] Login with expired subscription: Access blocked
- [ ] Superadmin login: Access allowed regardless
- [ ] Export financials: Excel file downloads
- [ ] Dashboard stats: Correct MRR/ARR calculations

### Frontend
- [ ] SuperadminBilling loads stats
- [ ] Invoice table shows real data
- [ ] Search filters invoices
- [ ] Invoice modal shows details
- [ ] Export button downloads Excel
- [ ] SuperadminPayments loads stats
- [ ] Transaction tabs filter correctly
- [ ] Gateway status shows connection
- [ ] Configure gateway saves settings
- [ ] Transaction modal shows metadata

## Environment Variables
```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

## Migration Command
```bash
npm run migrate
```

## Notes
- All subscription logic in platform database only
- Tenant databases never touched by billing system
- Background job runs every 6 hours
- Email notifications use organisation SMTP when configured
- Superadmin users (role_id 5) bypass all subscription checks
- PostgreSQL triggers ensure data consistency
- Transaction-safe payment processing with automatic rollback
