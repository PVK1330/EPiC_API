import { Router } from 'express';
import { getCandidateDecisionLetters, getDecisionStatus } from './decisionLetter.controller.js';

const router = Router();

router.get('/', getCandidateDecisionLetters);
router.get('/status', getDecisionStatus);

export default router;
