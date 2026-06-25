import { Router } from "express";
import { verifyTokenAndTenant } from "../../../middlewares/authStack.middleware.js";
import { checkRole, ROLES } from "../../../middlewares/role.middleware.js";
import * as calendarController from "./calendar.controller.js";

const router = Router();

router.use(verifyTokenAndTenant);
router.use(checkRole([ROLES.ADMIN, ROLES.CASEWORKER, ROLES.CANDIDATE, ROLES.BUSINESS]));

router.get("/workflow-events", calendarController.getWorkflowEvents);

export default router;
