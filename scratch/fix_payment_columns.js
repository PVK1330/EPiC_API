import db from '../src/models/index.js';

async function fixPaymentColumns() {
  try {
    console.log('Starting migration to add missing columns to payment_settings...');
    
    const queryInterface = db.sequelize.getQueryInterface();
    const tableName = 'payment_settings';

    // Columns to add
    const columnsToAdd = [
      { name: 'paypal_client_id', type: db.Sequelize.STRING },
      { name: 'paypal_secret', type: db.Sequelize.STRING },
      { name: 'razorpay_key_id', type: db.Sequelize.STRING },
      { name: 'razorpay_key_secret', type: db.Sequelize.STRING }
    ];

    const tableDefinition = await queryInterface.describeTable(tableName);

    for (const col of columnsToAdd) {
      if (!tableDefinition[col.name]) {
        console.log(`Adding column ${col.name}...`);
        await queryInterface.addColumn(tableName, col.name, {
          type: col.type,
          allowNull: true
        });
        console.log(`Column ${col.name} added successfully.`);
      } else {
        console.log(`Column ${col.name} already exists.`);
      }
    }

    console.log('Migration completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

fixPaymentColumns();
