import {
  PLATFORM_MODULES,
  PLATFORM_PERMISSIONS,
  moduleIdsToPermissionNames,
} from "../constants/platformModules.js";

const PLATFORM_ROLE_DEFAULTS = [
  {
    id: 6,
    name: "platform_support",
    description: "Support Agent — organisations and dashboard",
    moduleIds: ["dashboard", "organizations"],
  },
  {
    id: 7,
    name: "platform_billing",
    description: "Billing Manager — payments, billing, audit",
    moduleIds: ["dashboard", "payments", "billing", "audit-logs"],
  },
  {
    id: 8,
    name: "platform_compliance",
    description: "Compliance Officer — audit and settings",
    moduleIds: ["dashboard", "audit-logs", "settings"],
  },
];

export async function seedPlatformRbacForDb(db) {
  const { Role, Permission } = db;

  await db.sequelize.query(
  );
  await db.sequelize.query(
    `UPDATE roles SET scope = 'platform' WHERE id = 5 OR name = 'superadmin'`,
  );

  for (const perm of PLATFORM_PERMISSIONS) {
    await Permission.findOrCreate({
      where: { name: perm.name },
      defaults: perm,
    });
  }

  for (const roleDef of PLATFORM_ROLE_DEFAULTS) {
    const [role] = await Role.findOrCreate({
      where: { id: roleDef.id },
      defaults: {
        id: roleDef.id,
        name: roleDef.name,
        description: roleDef.description,
        status: "active",
        scope: "platform",
      },
    });
    await role.update({
      description: roleDef.description,
      status: "active",
      scope: "platform",
    });

    const permNames = moduleIdsToPermissionNames(roleDef.moduleIds);
    const perms = await Permission.findAll({ where: { name: permNames } });
    await role.setPermissions(perms);
  }

  const superAdmin = await Role.findByPk(5);
  if (superAdmin) {
    await superAdmin.update({ scope: "platform" });
    const allPlatformPerms = await Permission.findAll({
      where: { module: "platform" },
    });
    const existing = await superAdmin.getPermissions();
    const merged = [...existing];
    const names = new Set(existing.map((p) => p.name));
    for (const p of allPlatformPerms) {
      if (!names.has(p.name)) merged.push(p);
    }
    await superAdmin.setPermissions(merged);
  }

  console.log("✔ Platform RBAC seeded");
}

export { PLATFORM_MODULES };
