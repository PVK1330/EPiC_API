import db from '../src/models/index.js';

async function addUserFileNameColumn() {
  try {
    await db.sequelize.query(`
      ALTER TABLE documents 
      ADD COLUMN userFileName VARCHAR(255) NULL 
      AFTER documentName
    `);
    
    console.log('✓ userFileName column added to documents table');
  } catch (error) {
    console.error('Migration error:', error.message);
  } finally {
    process.exit(0);
  }
}

addUserFileNameColumn();
