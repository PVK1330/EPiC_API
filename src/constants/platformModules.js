/** Superadmin panel modules mapped to platform permission names. */
export const PLATFORM_MODULES = [
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Business intelligence and KPIs",
    permissions: ["platform.dashboard.view"],
  },
  {
    id: "organizations",
    label: "Organisations",
    description: "Tenant and user management",
    permissions: ["platform.organisations.view", "platform.organisations.manage"],
  },
  {
    id: "plans",
    label: "Subscription Plans",
    description: "Pricing and tier configuration",
    permissions: ["platform.plans.view", "platform.plans.manage"],
  },
  {
    id: "payments",
    label: "Financial Hub",
    description: "Stripe and revenue tracking",
    permissions: ["platform.payments.view"],
  },
  {
    id: "billing",
    label: "Invoicing",
    description: "Invoices and usage credits",
    permissions: ["platform.billing.view"],
  },
  {
    id: "audit-logs",
    label: "Audit Logs",
    description: "System and security events",
    permissions: ["platform.audit.view"],
  },
  {
    id: "team",
    label: "Team Management",
    description: "Admin roles and permissions",
    permissions: ["platform.team.view", "platform.team.manage"],
  },
  {
    id: "settings",
    label: "System Settings",
    description: "Global platform configuration",
    permissions: ["platform.settings.view", "platform.settings.manage"],
  },
];

export const PLATFORM_PERMISSIONS = PLATFORM_MODULES.flatMap((m) =>
  m.permissions.map((name) => ({
    name,
    description: `${m.label} — ${m.description}`,
    module: "platform",
    action: name.endsWith(".manage") ? "manage" : "view",
    resource: m.id,
  })),
);

export function permissionNamesToModuleIds(permissionNames = []) {
  const set = new Set(permissionNames);
  return PLATFORM_MODULES.filter((mod) =>
    mod.permissions.some((p) => set.has(p)),
  ).map((m) => m.id);
}

export function moduleIdsToPermissionNames(moduleIds = []) {
  const ids = new Set(moduleIds);
  const names = [];
  for (const mod of PLATFORM_MODULES) {
    if (ids.has(mod.id)) names.push(...mod.permissions);
  }
  return [...new Set(names)];
}

export const PLATFORM_MODULE_COUNT = PLATFORM_MODULES.length;
