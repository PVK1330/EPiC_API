const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME || 'epic-crm',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST || 'localhost',
    dialect: 'postgres',
    logging: false
  }
);

(async () => {
  try {
    await sequelize.query(`INSERT INTO users (id, first_name, last_name, email, country_code, mobile, password, role_id, "createdAt", "updatedAt") VALUES (2, 'Sponsor', 'Test', 'sponsor2@elitepic.com', '+1', '1234567891', 'hash', 2, NOW(), NOW()) ON CONFLICT DO NOTHING`);
    await sequelize.query(`INSERT INTO visa_types (id, name, sort_order, "createdAt", "updatedAt") VALUES (1, 'H-1B', 1, NOW(), NOW()) ON CONFLICT DO NOTHING`);
    await sequelize.query(`INSERT INTO petition_types (id, name, sort_order, "createdAt", "updatedAt") VALUES (1, 'Initial', 1, NOW(), NOW()) ON CONFLICT DO NOTHING`);
    console.log('Seeded dependencies successfully!');
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
})();
