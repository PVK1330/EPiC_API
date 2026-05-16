import { Router } from 'express';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
import * as teamsMeetingController from './teamsMeeting.controller.js';

const router = Router();

router.use(verifyTokenAndTenant);

router.get('/upcoming', teamsMeetingController.getUpcomingTeamsMeetings);
router.post('/sync', teamsMeetingController.syncTeamsMeetings);
router.get('/', teamsMeetingController.getTeamsMeetings);
router.post('/', teamsMeetingController.createTeamsMeeting);
router.get('/:id', teamsMeetingController.getTeamsMeetingById);
router.put('/:id', teamsMeetingController.updateTeamsMeeting);
router.delete('/:id', teamsMeetingController.cancelTeamsMeeting);

export default router;
