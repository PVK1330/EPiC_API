require("dotenv").config();
const app = require("./app");
const db = require("./models");
const seedRoles = require("./seeders/role.seeder");

const PORT = process.env.PORT || 5000;

db.sequelize.sync({ alter: true }).then(async () => {
  console.log("Database connected");

  // ✅ RUN SEEDER HERE
  await seedRoles();

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});