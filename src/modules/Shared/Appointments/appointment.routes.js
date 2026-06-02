import { Router } from 'express';
import * as appointmentController from './appointment.controller.js';
import { verifyTokenAndTenant } from '../../../middlewares/authStack.middleware.js';
const router = Router();

router.use(verifyTokenAndTenant);

import { validate } from '../../../middlewares/validate.middleware.js';
import * as schema from '../../../validations/appointment.validation.js';

router.get('/my', appointmentController.getMyAppointments);
router.get('/staff', appointmentController.getAvailableStaff);
router.post('/', validate(schema.createAppointmentSchema), appointmentController.createAppointment);
router.patch('/:id/status', validate(schema.updateAppointmentStatusSchema), appointmentController.updateAppointmentStatus);
router.delete('/:id', validate(schema.getAppointmentSchema), appointmentController.deleteAppointment);

export default router;
