import db from "../models/index.js";

const ROLES = [
  { id: 1, name: "admin" },
  { id: 2, name: "caseworker" },
  { id: 3, name: "candidate" },
  { id: 4, name: "business" },
];

export default async function seedRoles() {
  try {
    for (const role of ROLES) {
      await db.Role.findOrCreate({
        where: { id: role.id },
        defaults: role,
      });
    }
    console.log("✔ Roles seeded");
  } catch (err) {
    console.error("Role seeder failed:", err.message);
  }
}
