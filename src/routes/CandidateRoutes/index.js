import { Router } from 'express';
import candidateAccountRoutes from './candidateAccount.routes.js';
import candidateApplicationRoutes from './candidateApplication.routes.js';
import stripeRoutes from './stripe.routes.js';
import { verifyToken } from '../../middlewares/auth.middleware.js';
import { requireCandidate } from '../../middlewares/requireCandidate.middleware.js';

const router = Router();

// All candidate routes require authentication and candidate role
router.use(verifyToken);
router.use(requireCandidate);

router.use('/account', candidateAccountRoutes);
router.use('/application', candidateApplicationRoutes);
router.use('/payments', stripeRoutes);

export default router;
