import platformDb from "../models/index.js";
import logger from "../utils/logger.js";

const MODULES = [
  { key: "admin.dashboard",        label: "Dashboard",        panel: "admin",      sort_order: 1 },
  { key: "admin.cases",            label: "Cases",            panel: "admin",      sort_order: 2 },
  { key: "admin.candidates",       label: "Candidates",       panel: "admin",      sort_order: 3 },
  { key: "admin.caseworkers",      label: "Caseworkers",      panel: "admin",      sort_order: 4 },
  { key: "admin.businesses",       label: "Businesses",       panel: "admin",      sort_order: 5 },
  { key: "admin.finance",          label: "Finance",          panel: "admin",      sort_order: 6 },
  { key: "admin.reports",          label: "Reports",          panel: "admin",      sort_order: 7 },
  { key: "admin.pipeline",         label: "Pipeline",         panel: "admin",      sort_order: 8 },
  { key: "admin.workload",         label: "Workload",         panel: "admin",      sort_order: 9 },
  { key: "admin.documents",        label: "Documents",        panel: "admin",      sort_order: 10 },
  { key: "admin.calendar",         label: "Calendar",         panel: "admin",      sort_order: 11 },
  { key: "admin.messages",         label: "Messages",         panel: "admin",      sort_order: 12 },
  { key: "admin.escalations",      label: "Escalations",      panel: "admin",      sort_order: 13 },
  { key: "admin.audit-logs",       label: "Audit Logs",       panel: "admin",      sort_order: 14 },
  { key: "admin.permissions",      label: "Permissions",      panel: "admin",      sort_order: 15 },
  { key: "admin.settings",         label: "Settings",         panel: "admin",      sort_order: 16 },
  { key: "admin.licence-requests", label: "Licence Requests", panel: "admin",      sort_order: 17 },
  { key: "admin.enquiries",        label: "Enquiries",        panel: "admin",      sort_order: 18 },
  { key: "admin.assign",           label: "Assign",           panel: "admin",      sort_order: 19 },
  { key: "admin.departments",      label: "Departments",      panel: "admin",      sort_order: 20 },

  { key: "caseworker.dashboard",       label: "Dashboard",      panel: "caseworker", sort_order: 1 },
  { key: "caseworker.cases",           label: "Cases",          panel: "caseworker", sort_order: 2 },
  { key: "caseworker.pipeline",        label: "Pipeline",       panel: "caseworker", sort_order: 3 },
  { key: "caseworker.tasks",           label: "Tasks",          panel: "caseworker", sort_order: 4 },
  { key: "caseworker.calendar",        label: "Calendar",       panel: "caseworker", sort_order: 5 },
  { key: "caseworker.documents",       label: "Documents",      panel: "caseworker", sort_order: 6 },
  { key: "caseworker.people",          label: "Clients",        panel: "caseworker", sort_order: 7 },
  { key: "caseworker.messages",        label: "Messages",       panel: "caseworker", sort_order: 8 },
  { key: "caseworker.performance",     label: "Performance",    panel: "caseworker", sort_order: 9 },
  { key: "caseworker.finance",         label: "Finance",        panel: "caseworker", sort_order: 10 },
  { key: "caseworker.licence-reviews", label: "Licence Reviews",panel: "caseworker", sort_order: 11 },

  { key: "candidate.dashboard",          label: "Dashboard",          panel: "candidate", sort_order: 1 },
  { key: "candidate.application",        label: "Application",        panel: "candidate", sort_order: 2 },
  { key: "candidate.document-checklist", label: "Documents",          panel: "candidate", sort_order: 3 },
  { key: "candidate.payments",           label: "Payments",           panel: "candidate", sort_order: 4 },
  { key: "candidate.messages",           label: "Messages",           panel: "candidate", sort_order: 5 },
  { key: "candidate.appointments",       label: "Appointments",       panel: "candidate", sort_order: 6 },
  { key: "candidate.calendar",           label: "Calendar",           panel: "candidate", sort_order: 7 },
  { key: "candidate.application-status", label: "Application Status", panel: "candidate", sort_order: 8 },
  { key: "candidate.account",            label: "My Account",         panel: "candidate", sort_order: 9 },

  { key: "business.dashboard",              label: "Dashboard",              panel: "business", sort_order: 1 },
  { key: "business.profile",               label: "Profile",                panel: "business", sort_order: 2 },
  { key: "business.licence",               label: "Licence",                panel: "business", sort_order: 3 },
  { key: "business.compliance",            label: "Compliance",             panel: "business", sort_order: 4 },
  { key: "business.workers",               label: "Workers",                panel: "business", sort_order: 5 },
  { key: "business.documents",             label: "Documents",              panel: "business", sort_order: 6 },
  { key: "business.messages",              label: "Messages",               panel: "business", sort_order: 7 },
  { key: "business.payment",               label: "Payment",                panel: "business", sort_order: 8 },
  { key: "business.calendar",              label: "Calendar",               panel: "business", sort_order: 9 },
  { key: "business.reporting-obligations", label: "Reporting Obligations",  panel: "business", sort_order: 10 },
  { key: "business.settings",              label: "Settings",               panel: "business", sort_order: 11 },
];

export const seedModules = async () => {
  try {
    for (const mod of MODULES) {
      await platformDb.Module.upsert(mod, { conflictFields: ["key"] });
    }
    logger.info("✔ Modules seeded");
    await seedPlanModules();
  } catch (err) {
    logger.error({ err }, "Module seeder failed");
    throw err;
  }
};

async function seedPlanModules() {
  try {
    const plans = await platformDb.Plan.findAll();
    const modules = await platformDb.Module.findAll({ where: { is_active: true } });

    for (const plan of plans) {
      for (const mod of modules) {
        await platformDb.PlanModule.findOrCreate({
          where: { plan_id: plan.id, module_id: mod.id },
          defaults: { plan_id: plan.id, module_id: mod.id },
        });
      }
    }
    logger.info("✔ Plan modules seeded (all modules assigned to all plans)");
  } catch (err) {
    logger.error({ err }, "Plan modules seeder failed");
    throw err;
  }
}

export default seedModules;
