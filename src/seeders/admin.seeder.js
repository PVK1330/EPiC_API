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

    // The seeded superadmin's email may have been changed after first boot. In that case the
    // default mobile is already taken by that account, and creating a new row would violate
    // idx_users_mobile_unique and abort startup. Leave the existing account untouched.
    if (!existing) {
      const mobileOwner = await platformDb.User.findOne({
        where: { country_code: userData.country_code, mobile: userData.mobile },
      });
      if (mobileOwner) {
        logger.warn(
          { userId: mobileOwner.id, email: mobileOwner.email },
          `Superadmin seed skipped: ${userData.country_code} ${userData.mobile} already belongs to another account`,
        );
        return;
      }
    }

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
