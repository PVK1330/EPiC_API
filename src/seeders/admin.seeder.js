import platformDb from "../models/index.js";
import bcrypt from "bcryptjs";
import logger from "../utils/logger.js";

/**
 * Platform superadmin only. Organisations are created via POST /api/superadmin/organisations.
 */
export default async function seedAdmin() {
  try {
    const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || "Admin@123";
    const hashedPassword = await bcrypt.hash(adminPassword, 12);

    const email = "superadmin@epic.com";
    const userData = {
      email,
      first_name: "Super",
      last_name: "Admin",
      mobile: "1112223333",
      role_id: 5,
      organisation_id: null,
      country_code: "+44",
      password: hashedPassword,
      is_otp_verified: true,
      is_email_verified: true,
      status: "active",
    };

    const existing = await platformDb.User.findOne({ where: { email } });
    if (existing) {
      await existing.update(userData);
      logger.info(`✔ Superadmin ready: ${email}`);
    } else {
      await platformDb.User.create(userData);
      logger.info(`✔ Superadmin created: ${email}`);
    }
  } catch (err) {
    logger.error({ err }, "Admin seeder failed");
    throw err;
  }
}
