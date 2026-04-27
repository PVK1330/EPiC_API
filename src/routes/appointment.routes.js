import { Router } from 'express';
import * as appointmentController from '../controllers/appointment.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(verifyToken);

router.get('/my', appointmentController.getMyAppointments);
router.get('/staff', appointmentController.getAvailableStaff);
router.post('/', appointmentController.createAppointment);
router.patch('/:id/status', appointmentController.updateAppointmentStatus);
router.delete('/:id', appointmentController.deleteAppointment);

export default router;
