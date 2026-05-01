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
    const adminPassword =
      process.env.ADMIN_DEFAULT_PASSWORD || generateStrongPassword();
    const hashedPassword = await bcrypt.hash(adminPassword, 12);

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
        status: "active",
      },
    });

    if (created) {
      console.log("✔ Admin user created → admin@elitepic.com");
      console.log("⚠️  Admin password:", adminPassword);
      console.log(
        "⚠️  Please change this password immediately after first login!",
      );
    } else {
      console.log("✔ Admin user already exists");
    }
  } catch (err) {
    console.error("Admin seeder failed:", err.message);
  }
}
