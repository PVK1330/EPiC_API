/**
 * Section K — Multi-Company Handling: Sponsor Linked Entities
 *
 * Handles the parent/subsidiary relationships between SponsorProfile rows and
 * surfaces a consolidated risk dashboard that aggregates risk data across all
 * entities in a company group.
 *
 * All endpoints require the authenticated user to be a BUSINESS role; the
 * authStack + checkRole guards on the parent Sponsor router enforce this before
 * any handler here is reached.
 */

import logger from '../../../utils/logger.js';
import { Op } from 'sequelize';

/** Extract a validated integer userId from the request. */
const uid = (req) => {
  const n = Number(req.user?.userId);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};

/**
 * Resolve the caller's own SponsorProfile id (integer primary key), not their
 * user id. Returns null when the profile is not found.
 */
async function resolveOwnProfileId(tenantDb, userId) {
  const profile = await tenantDb.SponsorProfile.findOne({
    where: { userId },
    attributes: ['id'],
  });
  return profile?.id ?? null;
}

/**
 * Given a profile id, collect all sponsor profiles that belong to the same
 * company group. Returns an array of SponsorProfile plain objects.
 *
 * Strategy: walk up to find the root parent (if this profile is a child), then
 * collect all children of that root. The depth is intentionally one level to
 * match the current data model (a child cannot itself be a parent).
 */
async function resolveGroupProfiles(tenantDb, profileId) {
  // 1. Check whether this profile is itself a child in a linked-entity row.
  const asChild = await tenantDb.SponsorLinkedEntity.findOne({
    where: { childSponsorProfileId: profileId },
    attributes: ['parentSponsorProfileId'],
  });
  const rootProfileId = asChild ? asChild.parentSponsorProfileId : profileId;

  // 2. Collect the root + all its direct children.
  const childLinks = await tenantDb.SponsorLinkedEntity.findAll({
    where: { parentSponsorProfileId: rootProfileId },
    attributes: ['childSponsorProfileId', 'relationshipType', 'id'],
  });
  const childIds = childLinks.map((l) => l.childSponsorProfileId);
  const allIds = [rootProfileId, ...childIds];

  const profiles = await tenantDb.SponsorProfile.findAll({
    where: { id: { [Op.in]: allIds } },
    include: [
      { model: tenantDb.User, as: 'user', attributes: ['id', 'first_name', 'last_name', 'email'] },
    ],
  });

  // Annotate each profile with its relationship role and link id.
  return profiles.map((p) => {
    const plain = p.get({ plain: true });
    if (p.id === rootProfileId) {
      plain._role = 'parent';
      plain._linkId = null;
    } else {
      const link = childLinks.find((l) => l.childSponsorProfileId === p.id);
      plain._role = link?.relationshipType ?? 'subsidiary';
      plain._linkId = link?.id ?? null;
    }
    return plain;
  });
}

// ── GET /api/business/linked-entities ──────────────────────────────────────

/**
 * Return all entities in the caller's company group (parent + subsidiaries).
 * The caller may be either the parent or one of the subsidiaries.
 */
export const getLinkedEntities = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session' });

    const profileId = await resolveOwnProfileId(req.tenantDb, userId);
    if (!profileId) {
      return res.status(404).json({ status: 'error', message: 'Sponsor profile not found' });
    }

    const groupProfiles = await resolveGroupProfiles(req.tenantDb, profileId);

    const entities = groupProfiles.map((p) => ({
      linkId: p._linkId,
      role: p._role,
      profileId: p.id,
      companyName: p.companyName,
      tradingName: p.tradingName,
      registrationNumber: p.registrationNumber,
      licenceNumber: p.sponsorLicenceNumber,
      licenceStatus: p.licenceStatus,
      riskLevel: p.riskLevel,
      riskPct: p.riskPct,
      sponsoredWorkers: p.sponsoredWorkers,
      activeCases: p.activeCases,
      contact: {
        name: p.user ? `${p.user.first_name || ''} ${p.user.last_name || ''}`.trim() : null,
        email: p.user?.email ?? null,
      },
    }));

    res.status(200).json({ status: 'success', data: entities });
  } catch (err) {
    logger.error({ err }, 'getLinkedEntities error');
    res.status(500).json({ status: 'error', message: 'Internal server error', error: err.message });
  }
};

// ── POST /api/business/linked-entities ─────────────────────────────────────

/**
 * Link another sponsor profile as a subsidiary of the calling sponsor.
 *
 * Body: { childSponsorProfileId: number, relationshipType?: 'subsidiary'|'linked', notes?: string }
 *
 * Rules:
 *  - Caller must be the parent (not already a child themselves).
 *  - Cannot link their own profile.
 *  - Target must not already be a child of any parent.
 */
export const linkSubsidiary = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session' });

    const profileId = await resolveOwnProfileId(req.tenantDb, userId);
    if (!profileId) {
      return res.status(404).json({ status: 'error', message: 'Sponsor profile not found' });
    }

    // Prevent a child acting as a parent.
    const isAlreadyChild = await req.tenantDb.SponsorLinkedEntity.findOne({
      where: { childSponsorProfileId: profileId },
    });
    if (isAlreadyChild) {
      return res.status(400).json({
        status: 'error',
        message: 'Your account is already a subsidiary of another company. Only the parent company can add subsidiaries.',
      });
    }

    const { childSponsorProfileId, relationshipType = 'subsidiary', notes } = req.body;

    if (!childSponsorProfileId) {
      return res.status(400).json({ status: 'error', message: 'childSponsorProfileId is required' });
    }
    const childId = Number(childSponsorProfileId);
    if (!Number.isFinite(childId) || childId <= 0) {
      return res.status(400).json({ status: 'error', message: 'childSponsorProfileId must be a positive integer' });
    }
    if (childId === profileId) {
      return res.status(400).json({ status: 'error', message: 'A sponsor cannot link to itself' });
    }

    // Validate the target exists.
    const childProfile = await req.tenantDb.SponsorProfile.findByPk(childId, {
      attributes: ['id', 'companyName'],
    });
    if (!childProfile) {
      return res.status(404).json({ status: 'error', message: 'Target sponsor profile not found' });
    }

    // Prevent double-linking.
    const existing = await req.tenantDb.SponsorLinkedEntity.findOne({
      where: { childSponsorProfileId: childId },
    });
    if (existing) {
      return res.status(409).json({
        status: 'error',
        message: 'This sponsor is already linked to a parent company',
      });
    }

    const allowed = ['subsidiary', 'linked'];
    if (!allowed.includes(relationshipType)) {
      return res.status(400).json({ status: 'error', message: `relationshipType must be one of: ${allowed.join(', ')}` });
    }

    const link = await req.tenantDb.SponsorLinkedEntity.create({
      parentSponsorProfileId: profileId,
      childSponsorProfileId: childId,
      relationshipType,
      notes: notes ?? null,
    });

    res.status(201).json({
      status: 'success',
      message: `${childProfile.companyName} has been linked as a ${relationshipType}`,
      data: { linkId: link.id, parentProfileId: profileId, childProfileId: childId, relationshipType },
    });
  } catch (err) {
    logger.error({ err }, 'linkSubsidiary error');
    res.status(500).json({ status: 'error', message: 'Internal server error', error: err.message });
  }
};

// ── DELETE /api/business/linked-entities/:id ───────────────────────────────

/**
 * Remove a subsidiary link by its id. Only the parent company may remove a link.
 */
export const unlinkSubsidiary = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session' });

    const profileId = await resolveOwnProfileId(req.tenantDb, userId);
    if (!profileId) {
      return res.status(404).json({ status: 'error', message: 'Sponsor profile not found' });
    }

    const linkId = Number(req.params.id);
    if (!Number.isFinite(linkId) || linkId <= 0) {
      return res.status(400).json({ status: 'error', message: 'Invalid link id' });
    }

    const link = await req.tenantDb.SponsorLinkedEntity.findOne({
      where: { id: linkId, parentSponsorProfileId: profileId },
    });
    if (!link) {
      return res.status(404).json({ status: 'error', message: 'Link not found or you do not have permission to remove it' });
    }

    await link.destroy();

    res.status(200).json({ status: 'success', message: 'Entity unlinked successfully' });
  } catch (err) {
    logger.error({ err }, 'unlinkSubsidiary error');
    res.status(500).json({ status: 'error', message: 'Internal server error', error: err.message });
  }
};

// ── GET /api/business/linked-entities/dashboard ───────────────────────────

/**
 * Consolidated risk dashboard across the entire company group.
 *
 * Aggregates:
 *  - Total sponsored workers and active cases across all entities.
 *  - Per-entity risk level and compliance score.
 *  - A group-level overall risk score (average of riskPct values).
 *  - Count of High/Medium risk entities.
 *  - Workers with visa expiry within 30 / 90 days (from Cases table).
 */
export const getConsolidatedDashboard = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session' });

    const profileId = await resolveOwnProfileId(req.tenantDb, userId);
    if (!profileId) {
      return res.status(404).json({ status: 'error', message: 'Sponsor profile not found' });
    }

    const groupProfiles = await resolveGroupProfiles(req.tenantDb, profileId);

    if (groupProfiles.length === 0) {
      return res.status(200).json({ status: 'success', data: { entities: [], summary: {} } });
    }

    // Collect the user ids that own these profiles so we can query Cases.
    // SponsorProfile.userId is the sponsorId in the Cases table.
    const sponsorUserIds = groupProfiles.map((p) => p.userId).filter(Boolean);

    // Pull all active cases for the entire group in one query.
    const INACTIVE = ['Cancelled', 'Closed', 'Rejected'];
    const cases = await req.tenantDb.Case.findAll({
      where: {
        sponsorId: { [Op.in]: sponsorUserIds },
      },
      include: [
        {
          model: req.tenantDb.CandidateApplication,
          as: 'application',
          attributes: ['visaType', 'visaEndDate'],
          required: false,
        },
      ],
      attributes: ['id', 'sponsorId', 'status'],
    });

    const today = new Date();

    // Build per-entity stats.
    const entitySummaries = groupProfiles.map((p) => {
      const ownCases = cases.filter((c) => c.sponsorId === p.userId);
      const activeCases = ownCases.filter((c) => !INACTIVE.includes(c.status)).length;
      const expiring30 = ownCases.filter((c) => {
        const d = c.application?.visaEndDate;
        if (!d) return false;
        const days = Math.ceil((new Date(d) - today) / 86400000);
        return days >= 0 && days < 30;
      }).length;
      const expiring90 = ownCases.filter((c) => {
        const d = c.application?.visaEndDate;
        if (!d) return false;
        const days = Math.ceil((new Date(d) - today) / 86400000);
        return days >= 0 && days < 90;
      }).length;

      const complianceScore = typeof p.riskPct === 'number' ? Math.max(0, 100 - p.riskPct) : 80;

      return {
        profileId: p.id,
        linkId: p._linkId,
        role: p._role,
        companyName: p.companyName,
        tradingName: p.tradingName,
        licenceStatus: p.licenceStatus,
        riskLevel: p.riskLevel ?? 'Low',
        riskPct: p.riskPct ?? 20,
        complianceScore,
        sponsoredWorkers: p.sponsoredWorkers ?? 0,
        activeCases,
        totalCases: ownCases.length,
        expiring30,
        expiring90,
      };
    });

    // Group-level aggregation.
    const totalWorkers = entitySummaries.reduce((s, e) => s + (e.sponsoredWorkers ?? 0), 0);
    const totalActiveCases = entitySummaries.reduce((s, e) => s + e.activeCases, 0);
    const totalExpiring30 = entitySummaries.reduce((s, e) => s + e.expiring30, 0);
    const totalExpiring90 = entitySummaries.reduce((s, e) => s + e.expiring90, 0);
    const highRiskEntities = entitySummaries.filter((e) => e.riskLevel === 'High').length;
    const mediumRiskEntities = entitySummaries.filter((e) => e.riskLevel === 'Medium').length;
    const avgRiskPct = Math.round(
      entitySummaries.reduce((s, e) => s + (e.riskPct ?? 20), 0) / entitySummaries.length
    );
    const groupComplianceScore = Math.max(0, 100 - avgRiskPct);
    const overallRiskLevel =
      highRiskEntities > 0 ? 'High' : mediumRiskEntities > 0 ? 'Medium' : 'Low';

    res.status(200).json({
      status: 'success',
      data: {
        summary: {
          totalEntities: entitySummaries.length,
          totalWorkers,
          totalActiveCases,
          totalExpiring30,
          totalExpiring90,
          highRiskEntities,
          mediumRiskEntities,
          groupComplianceScore,
          overallRiskLevel,
        },
        entities: entitySummaries,
      },
    });
  } catch (err) {
    logger.error({ err }, 'getConsolidatedDashboard error');
    res.status(500).json({ status: 'error', message: 'Internal server error', error: err.message });
  }
};

// ── GET /api/business/linked-entities/search ──────────────────────────────

/**
 * Search for a sponsor profile by company name or registration number so the
 * frontend can let users find an entity to link. Returns basic identifying
 * fields only — no sensitive data.
 *
 * Query: ?q=<search term>
 */
export const searchSponsorProfiles = async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ status: 'error', message: 'Invalid session' });

    const { q } = req.query;
    if (!q || String(q).trim().length < 2) {
      return res.status(400).json({ status: 'error', message: 'Search term must be at least 2 characters' });
    }

    const term = `%${String(q).trim()}%`;

    const ownProfile = await req.tenantDb.SponsorProfile.findOne({
      where: { userId },
      attributes: ['id'],
    });
    const ownId = ownProfile?.id;

    // Exclude the calling sponsor's own profile.
    const whereClause = {
      [Op.or]: [
        { companyName: { [Op.iLike]: term } },
        { registrationNumber: { [Op.iLike]: term } },
      ],
    };
    if (ownId) whereClause.id = { [Op.ne]: ownId };

    const results = await req.tenantDb.SponsorProfile.findAll({
      where: whereClause,
      attributes: ['id', 'companyName', 'tradingName', 'registrationNumber', 'licenceStatus', 'riskLevel'],
      limit: 20,
    });

    res.status(200).json({ status: 'success', data: results });
  } catch (err) {
    logger.error({ err }, 'searchSponsorProfiles error');
    res.status(500).json({ status: 'error', message: 'Internal server error', error: err.message });
  }
};
