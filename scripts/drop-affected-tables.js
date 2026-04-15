import 'dotenv/config';
import db from '../src/models/index.js';

async function dropAffectedTables() {
  try {
    console.log('Connecting to database...');
    await db.sequelize.authenticate();
    console.log('Database connected successfully.');

    console.log('Dropping escalations table...');
    await db.sequelize.query('DROP TABLE IF EXISTS escalations CASCADE');
    console.log('Escalations table dropped successfully.');

    console.log('Dropping cases table...');
    await db.sequelize.query('DROP TABLE IF EXISTS cases CASCADE');
    console.log('Cases table dropped successfully.');

    await db.sequelize.close();
    console.log('Database connection closed.');
    process.exit(0);
  } catch (error) {
    console.error('Error dropping tables:', error);
    process.exit(1);
  }
}

dropAffectedTables();
