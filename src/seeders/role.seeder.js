import logger from "../utils/logger.js";

const ROLES = [
  { id: 1, name: "candidate" },
  { id: 2, name: "caseworker" },
  { id: 3, name: "admin" },
  { id: 4, name: "business" },
  { id: 5, name: "superadmin" },
];

export async function seedRolesForDb(db) {
  try {
    for (const role of ROLES) {
      await db.Role.findOrCreate({
        where: { id: role.id },
        defaults: role,
      });
    }
    logger.info("✔ Roles seeded");
    await assignDefaultPermissions(db);
  } catch (err) {
    logger.error({ err }, "Role seeder failed");
    throw err;
  }
}

export default seedRolesForDb;

async function assignDefaultPermissions(db) {
  try {
    const { Permission, Role } = db;
    
    // Get all permissions
    const allPermissions = await Permission.findAll();
    
    // SuperAdmin (role_id: 5) - All permissions
    const superAdminRole = await Role.findByPk(5);
    if (superAdminRole) {
      await superAdminRole.setPermissions(allPermissions);
      logger.info('SuperAdmin role assigned all permissions');
    }

    // Admin (role_id: 3) - Most permissions (except platform management if applicable)
    const adminRole = await Role.findByPk(3);
    if (adminRole) {
      // For now, give admin everything, but we might want to exclude superadmin-only perms later
      await adminRole.setPermissions(allPermissions);
      logger.info('Admin role assigned permissions');
    }
    
    // Caseworker (role_id: 2) - Case, Document, Task permissions
    const caseworkerRole = await Role.findByPk(2);
    if (caseworkerRole) {
      const caseworkerPermNames = allPermissions
        .filter(p => 
          p.name.includes('cases') || 
          p.name.includes('documents') || 
          p.name.includes('tasks') ||
          p.name.includes('caseworker')
        )
        .map(p => p.name);
      const caseworkerPerms = allPermissions.filter(p => caseworkerPermNames.includes(p.name));
      await caseworkerRole.setPermissions(caseworkerPerms);
      logger.info('Caseworker role assigned permissions');
    }
    
    // Candidate (role_id: 1) - View own cases and documents
    const candidateRole = await Role.findByPk(1);
    if (candidateRole) {
      const candidatePermNames = allPermissions
        .filter(p => 
          p.name.includes('candidate') ||
          p.name.includes('own') ||
          (p.name.includes('cases') && p.name.includes('view')) ||
          (p.name.includes('documents') && p.name.includes('view'))
        )
        .map(p => p.name);
      const candidatePerms = allPermissions.filter(p => candidatePermNames.includes(p.name));
      await candidateRole.setPermissions(candidatePerms);
      logger.info('Candidate role assigned permissions');
    }
    
    // Sponsor/Business (role_id: 4) - Case, Payment, Report permissions
    const sponsorRole = await Role.findByPk(4);
    if (sponsorRole) {
      const sponsorPermNames = allPermissions
        .filter(p => 
          p.name.includes('sponsors') ||
          p.name.includes('payment') ||
          p.name.includes('report') ||
          (p.name.includes('cases') && p.name.includes('view'))
        )
        .map(p => p.name);
      const sponsorPerms = allPermissions.filter(p => sponsorPermNames.includes(p.name));
      await sponsorRole.setPermissions(sponsorPerms);
      logger.info('Sponsor role assigned permissions');
    }

    logger.info('Role permissions assigned successfully');
  } catch (error) {
    logger.error({ err: error }, 'Error assigning role permissions');
  }
}
