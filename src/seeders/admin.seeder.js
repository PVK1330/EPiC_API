import db from "../models/index.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// Generate a strong random password
function generateStrongPassword(length = 16) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?";
  const password = crypto
    .randomBytes(length)
    .toString("base64")
    .slice(0, length)
    .split("")
    .map((char, index) =>
      chars.indexOf(char) === -1 ? chars[index % chars.length] : char,
    )
    .join("");

  // Ensure at least one uppercase, lowercase, number, and special character
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password);

  if (!hasUpper || !hasLower || !hasNumber || !hasSpecial) {
    return generateStrongPassword(length);
  }

  return password;
}

export default async function seedAdmin() {
  try {
    const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || "Admin@123";
    const hashedPassword = await bcrypt.hash(adminPassword, 12);

    const testUsers = [
      {
        email: "superadmin@epic.com",
        first_name: "Super",
        last_name: "Admin",
        mobile: "1112223333",
        role_id: 5,
      },
      {
        email: "admin@elitepic.com",
        first_name: "Elite",
        last_name: "Admin",
        mobile: "4445556666",
        role_id: 3,
      },
      {
        email: "caseworker@epic.com",
        first_name: "John",
        last_name: "Caseworker",
        mobile: "2223334444",
        role_id: 2,
      },
      {
        email: "sponsor@epic.com",
        first_name: "Elite",
        last_name: "Sponsor",
        mobile: "5556667777",
        role_id: 4,
      },
      {
        email: "candidate@epic.com",
        first_name: "Jane",
        last_name: "Candidate",
        mobile: "8889990000",
        role_id: 1,
      },
    ];

    for (const u of testUsers) {
      const [user, created] = await db.User.findOrCreate({
        where: { email: u.email },
        defaults: {
          ...u,
          country_code: "+44",
          password: hashedPassword,
          is_otp_verified: true,
          is_email_verified: true,
          status: "active",
        },
      });

      if (!created) {
        // Enforce the test password even if the user already existed
        await user.update({ password: hashedPassword, role_id: u.role_id });
        console.log(`✔ Updated existing user: ${u.email} (Password set to Admin@123)`);
      } else {
        console.log(`✔ Created new user: ${u.email} / Admin@123`);
      }
    }

  } catch (err) {
    console.error("Admin seeder failed:", err.message);
  }
}
