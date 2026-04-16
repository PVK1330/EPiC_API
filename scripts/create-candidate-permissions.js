import db from '../src/models/index.js';

async function createCandidatePermissions() {
  try {
    console.log('Creating candidate permissions...');

    // Create candidate permissions
    const candidatePermissions = [
      'candidate_create',
      'candidate_view', 
      'candidate_update',
      'candidate_delete',
      'candidate_toggle_status',
      'candidate_reset_password'
    ];
    
    const createdPerms = [];
    for (const permName of candidatePermissions) {
      const [perm, created] = await db.Permission.findOrCreate({
        where: { name: permName },
        defaults: { 
          name: permName, 
          description: permName.replace(/_/g, ' ') + ' permission',
          module: 'candidates',
          action: permName.split('_')[0], // create, view, update, delete, toggle, reset
          resource: 'candidates'
        }
      });
      if (created) {
        createdPerms.push(perm.name);
        console.log('✓ Created permission: ' + perm.name);
      } else {
        console.log('- Permission already exists: ' + perm.name);
      }
    }
    
    // Assign all candidate permissions to admin role
    const adminRole = await db.Role.findByPk(1);
    if (adminRole) {
      const allPermissions = await db.Permission.findAll();
      await adminRole.setPermissions(allPermissions);
      console.log('✓ Assigned all permissions to admin role');
    }
    
    console.log('\nCandidate permissions setup complete!');
    
    // Verify setup
    const verifyPerms = await db.Permission.findAll({
      where: { name: candidatePermissions }
    });
    console.log('\nVerification - Created candidate permissions:');
    verifyPerms.forEach(p => console.log('- ' + p.name + ' (ID: ' + p.id + ')'));
    
  } catch (error) {
    console.error('Error creating candidate permissions:', error.message);
  } finally {
    process.exit(0);
  }
}

createCandidatePermissions();
