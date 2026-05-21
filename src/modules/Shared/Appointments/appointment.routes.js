import { Router } from 'express';
import * as appointmentController from './appointment.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
const router = Router();

router.use(verifyTokenAndTenant);

router.get('/my', appointmentController.getMyAppointments);
router.get('/staff', appointmentController.getAvailableStaff);
router.post('/', appointmentController.createAppointment);
router.patch('/:id/status', appointmentController.updateAppointmentStatus);
router.delete('/:id', appointmentController.deleteAppointment);

export default router;
