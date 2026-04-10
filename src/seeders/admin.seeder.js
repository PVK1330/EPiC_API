const db = require("../models");
const bcrypt = require("bcryptjs");

const seedAdmin = async () => {
  try {
    // Hash password
    const hashedPassword = await bcrypt.hash("admin123", 12);

    // Create admin user
    const [admin, created] = await db.User.findOrCreate({
      where: { email: "admin@elitepic.com" },
      defaults: {
        first_name: "Super",
        last_name: "Admin",
        email: "admin@elitepic.com",
        country_code: "+1",
        mobile: "1234567890",
        password: hashedPassword,
        role_id: 1,
        is_otp_verified: true,
        is_email_verified: true,
        status: 'active'
      }
    });

    if (created) {
      console.log("Admin user created successfully");
      console.log("Email: admin@elitepic.com");
      console.log("Password: admin123");
    } else {
      console.log("Admin user already exists");
    }

  } catch (error) {
    console.error("Error seeding admin:", error);
  }
};

module.exports = seedAdmin;
