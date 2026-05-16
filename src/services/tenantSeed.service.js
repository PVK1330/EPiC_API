import seedPermissionsForDb from "../seeders/permission.seeder.js";
import { seedApplicationFieldSettingsForDb } from "../seeders/applicationFieldSettings.seeder.js";

const TENANT_ROLES = [
  { id: 1, name: "candidate" },
  { id: 2, name: "caseworker" },
  { id: 3, name: "admin" },
  { id: 4, name: "business" },
  { id: 5, name: "superadmin" },
];

const DEFAULT_VISA_TYPES = [
  "Skilled Worker",
  "Indefinite Leave to Remain (ILR)",
  "Spouse / Partner",
  "Graduate",
  "Student",
  "Visitor",
  "Global Talent",
];

const DEFAULT_PETITION_TYPES = [
  "New application",
  "Extension",
  "Switching category",
  "Administrative review",
];

/**
 * Seed roles, permissions, reference data into a freshly provisioned tenant database.
 * @param {ReturnType<import('./tenantDb.service.js').getTenantDb>} tenantDb
 */
export async function seedTenantDefaults(tenantDb) {
  for (const role of TENANT_ROLES) {
    await tenantDb.Role.findOrCreate({
      where: { id: role.id },
      defaults: role,
    });
  }
  await seedPermissionsForDb(tenantDb);

  const { VisaType, PetitionType, SlaSetting } = tenantDb;

  for (let i = 0; i < DEFAULT_VISA_TYPES.length; i++) {
    const name = DEFAULT_VISA_TYPES[i];
    await VisaType.findOrCreate({
      where: { name },
      defaults: { name, sort_order: i + 1 },
    });
  }

  for (let i = 0; i < DEFAULT_PETITION_TYPES.length; i++) {
    const name = DEFAULT_PETITION_TYPES[i];
    await PetitionType.findOrCreate({
      where: { name },
      defaults: { name, sort_order: i + 1 },
    });
  }

  await SlaSetting.findOrCreate({
    where: { id: 1 },
    defaults: {
      skilled_worker_days: 45,
      ilr_days: 30,
      student_visa_days: 60,
      escalation_stuck_days: 3,
      missing_docs_escalation_days: 7,
    },
  });

  await ensureApplicationFieldTables(tenantDb);
  await seedApplicationFieldSettingsForDb(tenantDb);
}

/** Ensure application field tables exist (migration + Sequelize sync safety net). */
async function ensureApplicationFieldTables(tenantDb) {
  if (!tenantDb?.sequelize) return;
  const { ApplicationFieldSetting, ApplicationCustomField } = tenantDb;
  if (ApplicationFieldSetting) {
    await ApplicationFieldSetting.sync();
  }
  if (ApplicationCustomField) {
    await ApplicationCustomField.sync();
  }
}

/**
 * Mirror platform organisation row into tenant DB so user.organisation_id FK is valid.
 * @param {ReturnType<import('./tenantDb.service.js').getTenantDb>} tenantDb
 * @param {import('../models/platform/organisation.model.js').default|object} platformOrg
 */
export async function seedTenantOrganisation(tenantDb, platformOrg) {
  if (!platformOrg || !tenantDb?.Organisation) return;

  const plain =
    typeof platformOrg.get === "function"
      ? platformOrg.get({ plain: true })
      : { ...platformOrg };

  const payload = {
    name: plain.name,
    slug: plain.slug,
    plan_id: plain.plan_id,
    status: plain.status,
    primaryEmail: plain.primaryEmail,
    country: plain.country ?? null,
    database_name: plain.database_name ?? null,
  };

  const existing = await tenantDb.Organisation.findByPk(plain.id);
  if (existing) {
    await existing.update(payload);
    return existing;
  }

  await tenantDb.Organisation.create({
    id: plain.id,
    ...payload,
  });

  try {
    await tenantDb.sequelize.query(
      `SELECT setval(
        pg_get_serial_sequence('organisations', 'id'),
        GREATEST((SELECT COALESCE(MAX(id), 1) FROM organisations), 1)
      )`,
    );
  } catch {
    /* non-fatal if sequence name differs */
  }

  return tenantDb.Organisation.findByPk(plain.id);
}
