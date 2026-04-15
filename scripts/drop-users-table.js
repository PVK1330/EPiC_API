import 'dotenv/config';
import db from '../src/models/index.js';

async function dropUsersTable() {
  try {
    console.log('Connecting to database...');
    await db.sequelize.authenticate();
    console.log('Database connected successfully.');

    console.log('Dropping users table...');
    await db.sequelize.query('DROP TABLE IF EXISTS users CASCADE');
    console.log('Users table dropped successfully.');

    await db.sequelize.close();
    console.log('Database connection closed.');
    process.exit(0);
  } catch (error) {
    console.error('Error dropping table:', error);
    process.exit(1);
  }
}

dropUsersTable();
