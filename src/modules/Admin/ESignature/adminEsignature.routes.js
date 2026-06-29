import { Router } from 'express';
import { createSignatureRequest, listAllSignatureRequests } from '../../Candidate/ESignature/esignature.controller.js';

const router = Router();

router.get('/', listAllSignatureRequests);
router.post('/', createSignatureRequest);

export default router;
