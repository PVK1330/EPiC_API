import { Router } from 'express';
import {
  listSignatureRequests,
  getSignatureRequest,
  submitSignature,
  declineSignature,
} from './esignature.controller.js';

const router = Router();

router.get('/', listSignatureRequests);
router.get('/:id', getSignatureRequest);
router.post('/:id/sign', submitSignature);
router.post('/:id/decline', declineSignature);

export default router;
