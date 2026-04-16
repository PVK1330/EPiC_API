import 'dotenv/config';
import app from './app.js';
import db from './models/index.js';
import seedRoles from './seeders/role.seeder.js';
import seedAdmin from './seeders/admin.seeder.js';

const PORT = process.env.PORT || 5000;

db.sequelize.sync().then(async () => {
  console.log('Database connected');
  await seedRoles();
  await seedAdmin(); 
  
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to connect to database:', err);
  process.exit(1);
});



// require("dotenv").config();
// const app = require("./app");
// const db = require("./models");
// const seedRoles = require("./seeders/role.seeder");
// const seedAdmin = require("./seeders/admin.seeder");

// const PORT = process.env.PORT || 5000;

// db.sequelize.sync({ alter: true }).then(async () => {
//   console.log("Database connected");

//   // RUN SEEDER HERE
//   await seedRoles();
//   await seedAdmin();

//   app.listen(PORT, () => {
//     console.log(`Server running on port ${PORT}`);
//   });
// });