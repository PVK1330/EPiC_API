/**
 * Section K — Multi-Company Handling: Linked Entities Routes
 *
 * Mounted at /api/business/linked-entities from the parent Sponsor router.
 * The parent router already applies verifyTokenAndTenant + checkRole([ROLES.BUSINESS]).
 */

import { Router } from 'express';
import {
  getLinkedEntities,
  linkSubsidiary,
  unlinkSubsidiary,
  getConsolidatedDashboard,
  searchSponsorProfiles,
} from './sponsorLinkedEntities.controller.js';

const router = Router();

// GET  /api/business/linked-entities/dashboard — must be before /:id to avoid clash
router.get('/dashboard', getConsolidatedDashboard);

// GET  /api/business/linked-entities/search?q=term
router.get('/search', searchSponsorProfiles);

// GET  /api/business/linked-entities — list parent + all subsidiaries in the group
router.get('/', getLinkedEntities);

// POST /api/business/linked-entities — add a new subsidiary/linked entity
router.post('/', linkSubsidiary);

// DELETE /api/business/linked-entities/:id — remove a link by its id
router.delete('/:id', unlinkSubsidiary);

export default router;
