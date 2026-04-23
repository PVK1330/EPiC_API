import db from "../models/index.js";

const ROLES = [
  { id: 1, name: "admin" },
  { id: 2, name: "caseworker" },
  { id: 3, name: "candidate" },
  { id: 4, name: "business" },
];

export default async function seedRoles() {
  try {
    for (const role of ROLES) {
      await db.Role.findOrCreate({
        where: { id: role.id },
        defaults: role,
      });
    }
    console.log("✔ Roles seeded");
    
    // Assign default permissions to roles
    await assignDefaultPermissions();
  } catch (err) {
    console.error("Role seeder failed:", err.message);
  }
}

async function assignDefaultPermissions() {
  try {
    const { Permission, Role, RolePermission } = db;
    
    // Get all permissions
    const allPermissions = await Permission.findAll();
    
    // Admin (role_id: 1) - All permissions
    const adminRole = await Role.findByPk(1);
    if (adminRole) {
      await adminRole.setPermissions(allPermissions);
      console.log('Admin role assigned all permissions');
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
      console.log('Caseworker role assigned permissions');
    }
    
    // Candidate (role_id: 3) - View own cases and documents
    const candidateRole = await Role.findByPk(3);
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
      console.log('Candidate role assigned permissions');
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
      console.log('Sponsor role assigned permissions');
    }
    
    console.log('Role permissions assigned successfully');
  } catch (error) {
    console.error('Error assigning role permissions:', error);
  }
}
