import db from '../src/models/index.js';

async function createAdminCandidatePermissions() {
  try {
    console.log('Creating admin candidate permissions...');

    // Create admin candidate permissions (matching route requirements)
    const adminCandidatePermissions = [
      'admin.candidates.create',
      'admin.candidates.view', 
      'admin.candidates.update',
      'admin.candidates.delete'
    ];
    
    const createdPerms = [];
    for (const permName of adminCandidatePermissions) {
      const [perm, created] = await db.Permission.findOrCreate({
        where: { name: permName },
        defaults: { 
          name: permName, 
          description: permName.replace(/admin\./g, '').replace(/\./g, ' ') + ' permission',
          module: 'admin',
          action: permName.split('.')[2], // create, view, update, delete
          resource: 'candidates'
        }
      });
      if (created) {
        createdPerms.push(perm.name);
        console.log('Created permission: ' + perm.name);
      } else {
        console.log('Permission already exists: ' + perm.name);
      }
    }
    
    // Assign all permissions to admin role
    const adminRole = await db.Role.findByPk(1);
    if (adminRole) {
      const allPermissions = await db.Permission.findAll();
      await adminRole.setPermissions(allPermissions);
      console.log('Assigned all permissions to admin role');
    }
    
    console.log('\nAdmin candidate permissions setup complete!');
    
    // Verify setup
    const verifyPerms = await db.Permission.findAll({
      where: { name: adminCandidatePermissions }
    });
    console.log('\nVerification - Created admin candidate permissions:');
    verifyPerms.forEach(p => console.log('- ' + p.name + ' (ID: ' + p.id + ')'));
    
  } catch (error) {
    console.error('Error creating admin candidate permissions:', error.message);
  } finally {
    process.exit(0);
  }
}

createAdminCandidatePermissions();
