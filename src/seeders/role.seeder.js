const db = require("../models");

const seedRoles = async () => {
  const roles = [
    { id: 1, name: "admin" },
    { id: 2, name: "caseworker" },
    { id: 3, name: "candidate" },
    { id: 4, name: "business" },
  ];

  for (let role of roles) {
    await db.Role.findOrCreate({
      where: { id: role.id },
      defaults: role,
    });
  }

  console.log("Roles seeded");
};

module.exports = seedRoles;