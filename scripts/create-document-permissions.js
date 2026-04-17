import db from '../src/models/index.js';

async function createDocumentPermissions() {
  try {
    console.log('Creating document permissions...');

    // Create document permissions
    const documentPermissions = [
      'document_upload',
      'document_view', 
      'document_update',
      'document_delete',
      'document_review',
      'document_download'
    ];
    
    const createdPerms = [];
    for (const permName of documentPermissions) {
      const [perm, created] = await db.Permission.findOrCreate({
        where: { name: permName },
        defaults: { 
          name: permName, 
          description: permName.replace(/_/g, ' ') + ' permission',
          module: 'documents',
          action: permName.split('_')[0], // upload, view, update, delete, review, download
          resource: 'documents'
        }
      });
      if (created) {
        createdPerms.push(perm.name);
        console.log('✓ Created permission: ' + perm.name);
      } else {
        console.log('- Permission already exists: ' + perm.name);
      }
    }
    
    // Assign all permissions to admin role
    const adminRole = await db.Role.findByPk(1);
    if (adminRole) {
      const allPermissions = await db.Permission.findAll();
      await adminRole.setPermissions(allPermissions);
      console.log('✓ Assigned all permissions to admin role');
    }
    
    console.log('\nDocument permissions setup complete!');
    
    // Verify setup
    const verifyPerms = await db.Permission.findAll({
      where: { name: documentPermissions }
    });
    console.log('\nVerification - Created permissions:');
    verifyPerms.forEach(p => console.log('- ' + p.name));
    
  } catch (error) {
    console.error('Error creating permissions:', error.message);
  } finally {
    process.exit(0);
  }
}

createDocumentPermissions();
