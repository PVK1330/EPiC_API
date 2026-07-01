import { Router } from 'express';
import { listSandboxOrgs, createSandbox, triggerSandboxReset, deleteSandbox } from './sandbox.controller.js';

const router = Router();

router.get('/', listSandboxOrgs);
router.post('/', createSandbox);
router.post('/reset', triggerSandboxReset);
router.delete('/:id', deleteSandbox);

export default router;
