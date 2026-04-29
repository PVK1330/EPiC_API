import { Router } from 'express';
import { verifyToken } from '../middlewares/auth.middleware.js';
import * as teamsMeetingController from '../controllers/teamsMeeting.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/upcoming', teamsMeetingController.getUpcomingTeamsMeetings);
router.post('/sync', teamsMeetingController.syncTeamsMeetings);
router.get('/', teamsMeetingController.getTeamsMeetings);
router.post('/', teamsMeetingController.createTeamsMeeting);
router.get('/:id', teamsMeetingController.getTeamsMeetingById);
router.put('/:id', teamsMeetingController.updateTeamsMeeting);
router.delete('/:id', teamsMeetingController.cancelTeamsMeeting);

export default router;
