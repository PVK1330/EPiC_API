import platformDb from "../models/index.js";

export default async function seedPlatformAuditLogs() {
  try {
    const existing = await platformDb.PlatformAuditLog.count();
    if (existing > 0) {
      console.log("✔ Platform audit logs already seeded.");
      return;
    }

    const logs = [
      // Authentication
      { category: "Authentication", action: "Admin Login", user: "superadmin@epic.com", org: "Global System", description: "Successful superadmin dashboard login", status: "Success" },
      { category: "Authentication", action: "Failed 2FA", user: "admin@elitevisa.com", org: "Elite Visa Solutions", description: "Invalid 2FA code attempted by tenant administrator", status: "Failed" },
      { category: "Authentication", action: "Password Reset", user: "superadmin@epic.com", org: "Global System", description: "Superadmin password reset successfully completed", status: "Success" },
      { category: "Authentication", action: "Unauthorized Access Attempt", user: "unknown@attacker.com", org: "External System", description: "Failed login attempt from unauthorized IP range", status: "Failed" },

      // Organisation
      { category: "Organisation", action: "Organisation Created", user: "superadmin@epic.com", org: "Elite Visa Solutions", description: "Successfully created tenant Elite Visa Solutions with dedicated physical schema", status: "Success" },
      { category: "Organisation", action: "Organisation Created", user: "superadmin@epic.com", org: "Bridge UK Immigration", description: "Successfully created tenant Bridge UK Immigration", status: "Success" },
      { category: "Organisation", action: "Organisation Suspended", user: "superadmin@epic.com", org: "Global Migrate Pro", description: "Tenant subscription expired; organisation manually suspended", status: "Success" },
      { category: "Organisation", action: "Organisation Plan Changed", user: "superadmin@epic.com", org: "London Legal Partners", description: "Manually upgraded tenant London Legal Partners from Starter to Pro plan", status: "Success" },

      // Billing
      { category: "Billing", action: "Payment Processed", user: "System Scheduler", org: "Elite Visa Solutions", description: "Monthly recurring billing payment of $799.00 processed via Stripe", status: "Success" },
      { category: "Billing", action: "Payment Failed", user: "System Scheduler", org: "Westminster Agency", description: "Stripe recurring charge failed; card declined by bank issuer", status: "Failed" },
      { category: "Billing", action: "Refund Issued", user: "superadmin@epic.com", org: "Bridge UK Immigration", description: "Issued adjustment refund of $150.00 for billing cycle error", status: "Success" },

      // System
      { category: "System", action: "Database Backup", user: "System Daemon", org: "Global System", description: "Daily central database and file upload backups completed to AWS S3 region us-east-1", status: "Success" },
      { category: "System", action: "Cache Purged", user: "superadmin@epic.com", org: "Global System", description: "Flushed platform registry redis instances cache", status: "Success" },
      { category: "System", action: "SMTP Settings Updated", user: "superadmin@epic.com", org: "Global System", description: "Updated global platform SMTP connectivity variables", status: "Success" }
    ];

    await platformDb.PlatformAuditLog.bulkCreate(logs);
    console.log("✔ Platform audit logs seeded successfully.");
  } catch (err) {
    console.error("Platform audit log seeder failed:", err.message);
  }
}
