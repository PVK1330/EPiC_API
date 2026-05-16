import { Router } from 'express';
import candidateAccountRoutes from './Account/candidateAccount.routes.js';
import candidateApplicationRoutes from './Application/candidateApplication.routes.js';
import stripeRoutes from './Payments/stripe.routes.js';
import { verifyTokenAndTenant } from '../../middlewares/authStack.middleware.js';
import { requireCandidate } from '../../middlewares/requireCandidate.middleware.js';

const router = Router();

// All candidate routes require authentication and candidate role
router.use(verifyTokenAndTenant);
router.use(requireCandidate);

router.use('/account', candidateAccountRoutes);
router.use('/application', candidateApplicationRoutes);
router.use('/payments', stripeRoutes);

export default router;
