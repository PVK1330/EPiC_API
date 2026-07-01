import { Router } from 'express';
import candidateAccountRoutes from './Account/candidateAccount.routes.js';
import candidateApplicationRoutes from './Application/candidateApplication.routes.js';
import stripeRoutes from './Payments/stripe.routes.js';
import candidateDocumentRoutes from './Documents/candidateDocument.routes.js';
import decisionLetterRoutes from './DecisionLetter/decisionLetter.routes.js';
import esignatureRoutes from './ESignature/esignature.routes.js';
import { verifyTokenAndTenant } from '../../middlewares/authStack.middleware.js';
import { requireCandidate } from '../../middlewares/requireCandidate.middleware.js';
import { enforcePortalClosureRule } from '../../middlewares/candidatePortalAccess.middleware.js';

const router = Router();

// All candidate routes require authentication, candidate role, and active portal access
router.use(verifyTokenAndTenant);
router.use(requireCandidate);
router.use(enforcePortalClosureRule);

router.use('/account', candidateAccountRoutes);
router.use('/application', candidateApplicationRoutes);
router.use('/documents', candidateDocumentRoutes);
router.use('/payments', stripeRoutes);
router.use('/decision-letter', decisionLetterRoutes);
router.use('/esignature', esignatureRoutes);

export default router;
