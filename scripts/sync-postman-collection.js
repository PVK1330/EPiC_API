/**
 * Sync EPiC_API.postman_collection.json with current API routes (workflow + key payloads).
 * Run: node scripts/sync-postman-collection.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COLLECTION_PATH = path.join(
  __dirname,
  "../docs/postman/EPiC_API.postman_collection.json",
);

function authHeaders(extra = []) {
  return [
    { key: "Authorization", value: "Bearer {{token}}", type: "text" },
    { key: "Content-Type", value: "application/json", type: "text" },
    {
      key: "X-Organisation-Slug",
      value: "{{organisationSlug}}",
      type: "text",
      description: "Optional tenant slug when not embedded in JWT",
    },
    ...extra,
  ];
}

function jsonBody(obj) {
  return {
    mode: "raw",
    raw: JSON.stringify(obj, null, 2),
    options: { raw: { language: "json" } },
  };
}

function makeRequest(name, method, apiPath, body = null, description = "") {
  const segments = apiPath.replace(/^\//, "").split("/");
  const req = {
    name,
    request: {
      method,
      header: authHeaders(),
      url: {
        raw: `{{baseUrl}}/${segments.join("/")}`,
        host: ["{{baseUrl}}"],
        path: segments,
      },
      description,
    },
    response: [],
  };
  if (body != null) req.request.body = jsonBody(body);
  return req;
}

function makeMultipartRequest(name, method, apiPath, fileField, description = "") {
  const segments = apiPath.replace(/^\//, "").split("/");
  return {
    name,
    request: {
      method,
      header: [{ key: "Authorization", value: "Bearer {{token}}", type: "text" }],
      body: {
        mode: "formdata",
        formdata: [
          {
            key: fileField,
            type: "file",
            src: [],
            description: "Select image file in Postman",
          },
        ],
      },
      url: {
        raw: `{{baseUrl}}/${segments.join("/")}`,
        host: ["{{baseUrl}}"],
        path: segments,
      },
      description,
    },
    response: [],
  };
}

function moduleFolder(name, requests) {
  return { name, item: requests };
}

/** Rebuild Superadmin folder from superadmin.routes.js (platform staff JWT). */
function buildSuperadminFolder() {
  return {
    name: "Superadmin",
    description:
      "Platform superadmin panel APIs. Use a platform staff login token (role 5+). " +
      "Not tenant-scoped — do not send X-Organisation-Slug unless testing impersonation flows.",
    item: [
      moduleFolder("Team & Platform Roles", [
        makeRequest("List Platform Modules", "GET", "api/superadmin/team/modules"),
        makeRequest("List Team Members", "GET", "api/superadmin/team"),
        makeRequest(
          "Invite Team Member",
          "POST",
          "api/superadmin/team",
          {
            email: "billing.manager@epic-platform.test",
            first_name: "Alex",
            last_name: "Billing",
            role_id: 7,
            country_code: "+44",
            mobile: "7700900123",
          },
          "Requires platform.team.manage permission.",
        ),
        makeRequest(
          "Update Team Member",
          "PATCH",
          "api/superadmin/team/{{userId}}",
          { status: "active", role_id: 7 },
        ),
        makeRequest("List Platform Roles", "GET", "api/superadmin/platform-roles"),
        makeRequest(
          "Create Platform Role",
          "POST",
          "api/superadmin/platform-roles",
          {
            name: "Compliance Lead",
            description: "Custom platform role",
            moduleIds: ["organisations", "billing", "audit"],
          },
        ),
        makeRequest(
          "Update Platform Role",
          "PATCH",
          "api/superadmin/platform-roles/{{roleId}}",
          { description: "Updated description", moduleIds: ["organisations", "team"] },
        ),
        makeRequest(
          "Delete Platform Role",
          "DELETE",
          "api/superadmin/platform-roles/{{roleId}}",
        ),
      ]),
      moduleFolder("Announcements", [
        makeRequest(
          "Create Platform Announcement",
          "POST",
          "api/superadmin/announcements",
          {
            target: "all",
            title: "Scheduled maintenance",
            message: "The platform will be unavailable tonight 02:00–04:00 UTC.",
            sendEmail: true,
          },
        ),
        makeRequest(
          "Create Announcement (Selected Orgs)",
          "POST",
          "api/superadmin/announcements",
          {
            target: "selected",
            orgIds: [1, 2],
            title: "Action required",
            message: "Please review your subscription billing details.",
            sendEmail: true,
          },
        ),
      ]),
      moduleFolder("Organisations", [
        makeRequest("List Organisations", "GET", "api/superadmin/organisations"),
        makeRequest(
          "Get Organisation by ID",
          "GET",
          "api/superadmin/organisations/{{orgId}}",
        ),
        makeRequest(
          "Create Organisation",
          "POST",
          "api/superadmin/organisations",
          {
            name: "Acme Immigration Ltd",
            slug: "acme-immigration",
            plan: "professional",
            plan_id: 2,
            status: "trial",
            primaryEmail: "contact@acme.test",
            country: "United Kingdom",
          },
          "Creates org + default trial subscription. Provisions tenant DB if enabled.",
        ),
        makeRequest(
          "Create Organisation with Admin",
          "POST",
          "api/superadmin/organisations/with-admin",
          {
            name: "Beta Legal Services",
            slug: "beta-legal",
            plan: "starter",
            plan_id: 1,
            status: "trial",
            primaryEmail: "office@beta-legal.test",
            country: "United Kingdom",
            adminEmail: "admin@beta-legal.test",
            adminFirstName: "Sam",
            adminLastName: "Admin",
            adminCountryCode: "+44",
            adminMobile: "7700900456",
            password: "ChangeMe!2026",
          },
          "Atomic: org + subscription + tenant admin + welcome email.",
        ),
        makeRequest(
          "Update Organisation",
          "PATCH",
          "api/superadmin/organisations/{{orgId}}",
          {
            name: "Acme Immigration Ltd (Updated)",
            status: "active",
            plan_id: 2,
            primaryEmail: "contact@acme.test",
          },
        ),
        makeRequest(
          "Delete Organisation",
          "DELETE",
          "api/superadmin/organisations/{{orgId}}",
          null,
          "Soft delete; frees admin email/mobile for reuse.",
        ),
        makeRequest(
          "Suspend Organisation",
          "POST",
          "api/superadmin/organisations/{{orgId}}/suspend",
          {},
        ),
        makeRequest(
          "Activate Organisation",
          "POST",
          "api/superadmin/organisations/{{orgId}}/activate",
          {},
        ),
        makeRequest(
          "Create Organisation Admin",
          "POST",
          "api/superadmin/organisations/{{orgId}}/admins",
          {
            email: "newadmin@acme.test",
            first_name: "Jordan",
            last_name: "Lee",
            country_code: "+44",
            mobile: "7700900789",
            password: "ChangeMe!2026",
          },
        ),
        makeRequest(
          "Impersonate Organisation Admin",
          "POST",
          "api/superadmin/organisations/{{orgId}}/impersonate",
          {},
          "Returns short-lived JWT to act as org admin (support/debug).",
        ),
      ]),
      moduleFolder("Plans", [
        makeRequest("List Plans", "GET", "api/superadmin/plans"),
        makeRequest("Get Plan by ID", "GET", "api/superadmin/plans/{{planId}}"),
        makeRequest(
          "Create Plan",
          "POST",
          "api/superadmin/plans",
          {
            name: "Enterprise",
            description: "Full platform access",
            price: 299.99,
            currency: "GBP",
            billing_cycle: "monthly",
            user_quota: 50,
            case_quota: 500,
            storage_quota_gb: 100,
            features: ["priority_support", "api_access"],
            is_public: true,
          },
        ),
        makeRequest(
          "Update Plan",
          "PUT",
          "api/superadmin/plans/{{planId}}",
          { price: 349.99, is_public: true },
        ),
        makeRequest(
          "Delete Plan",
          "DELETE",
          "api/superadmin/plans/{{planId}}",
        ),
        makeRequest(
          "Get Plan Modules",
          "GET",
          "api/superadmin/plans/{{planId}}/modules",
        ),
        makeRequest(
          "Update Plan Modules",
          "PUT",
          "api/superadmin/plans/{{planId}}/modules",
          { module_ids: [1, 2, 3, 4, 5] },
        ),
      ]),
      moduleFolder("Subscriptions", [
        makeRequest("List Subscriptions", "GET", "api/superadmin/subscriptions"),
        makeRequest(
          "Get Subscription by Org",
          "GET",
          "api/superadmin/subscriptions/org/{{orgId}}",
        ),
        makeRequest(
          "Create Subscription",
          "POST",
          "api/superadmin/subscriptions",
          {
            organisation_id: 1,
            plan_id: 2,
            status: "active",
            current_period_start: "2026-05-01",
            current_period_end: "2026-06-01",
            trial_ends_at: null,
          },
        ),
        makeRequest(
          "Update Subscription",
          "PUT",
          "api/superadmin/subscriptions/{{subscriptionId}}",
          { status: "active" },
        ),
        makeRequest(
          "Cancel Subscription",
          "POST",
          "api/superadmin/subscriptions/{{subscriptionId}}/cancel",
          {},
        ),
        makeRequest(
          "Renew Subscription",
          "POST",
          "api/superadmin/subscriptions/{{subscriptionId}}/renew",
          {},
        ),
      ]),
      moduleFolder("Invoices & Financials", [
        makeRequest("List Invoices", "GET", "api/superadmin/invoices"),
        makeRequest(
          "Get Invoice by ID",
          "GET",
          "api/superadmin/invoices/{{invoiceId}}",
        ),
        makeRequest(
          "Update Invoice Status",
          "PATCH",
          "api/superadmin/invoices/{{invoiceId}}/status",
          { status: "paid" },
        ),
        makeRequest(
          "Export Invoices PDF",
          "GET",
          "api/superadmin/invoices/export/pdf",
        ),
        makeRequest(
          "Export Financials",
          "GET",
          "api/superadmin/financials/export",
        ),
      ]),
      moduleFolder("Payments & Dashboard", [
        makeRequest("List Transactions", "GET", "api/superadmin/transactions"),
        makeRequest(
          "Get Transaction by ID",
          "GET",
          "api/superadmin/transactions/{{transactionId}}",
        ),
        makeRequest(
          "Get Gateway Status",
          "GET",
          "api/superadmin/gateway/status",
        ),
        makeRequest(
          "Configure Stripe Gateway",
          "POST",
          "api/superadmin/gateway/configure",
          {
            publishable_key: "pk_test_xxx",
            secret_key: "sk_test_xxx",
            webhook_secret: "whsec_xxx",
            currency: "GBP",
            platform_fee: "2.5",
          },
        ),
        makeRequest(
          "Dashboard Stats",
          "GET",
          "api/superadmin/dashboard/stats",
        ),
        makeRequest("Audit Log (scaffold)", "GET", "api/superadmin/audit-log"),
        makeRequest("Analytics (scaffold)", "GET", "api/superadmin/analytics"),
        makeRequest(
          "SMTP Settings (legacy)",
          "GET",
          "api/superadmin/smtp-settings",
        ),
      ]),
      moduleFolder("Platform Settings", [
        makeRequest(
          "Get Identity Settings",
          "GET",
          "api/superadmin/settings/identity",
        ),
        makeRequest(
          "Update Identity Settings",
          "PATCH",
          "api/superadmin/settings/identity",
          {
            platform_name: "EPiC CRM",
            support_email: "support@epic.test",
            default_locale: "en-GB",
            timezone: "Europe/London",
            maintenance_mode: false,
            signups_enabled: true,
          },
        ),
        makeMultipartRequest(
          "Upload Platform Logo",
          "POST",
          "api/superadmin/settings/identity/logo",
          "logo",
        ),
        makeMultipartRequest(
          "Upload Platform Favicon",
          "POST",
          "api/superadmin/settings/identity/favicon",
          "favicon",
        ),
        makeRequest(
          "Get Connectivity Settings",
          "GET",
          "api/superadmin/settings/connectivity",
        ),
        makeRequest(
          "Update Connectivity Settings",
          "PATCH",
          "api/superadmin/settings/connectivity",
          {
            smtp: {
              host: "smtp.example.com",
              port: 587,
              username: "smtp-user",
              password: "secret",
              encryption: "tls",
            },
          },
        ),
        makeRequest(
          "Test SMTP Connection",
          "POST",
          "api/superadmin/settings/connectivity/smtp/test",
          {},
        ),
        makeRequest(
          "Send SMTP Test Email",
          "POST",
          "api/superadmin/settings/connectivity/smtp/send-test",
          { to: "admin@example.com" },
        ),
        makeRequest(
          "Get Security Settings",
          "GET",
          "api/superadmin/settings/security",
        ),
        makeRequest(
          "Update Security Settings",
          "PATCH",
          "api/superadmin/settings/security",
          {
            mfa_enforced: false,
            ip_whitelist_enabled: false,
            session_persistence: true,
            inactivity_timeout_minutes: 60,
          },
        ),
      ]),
      moduleFolder("Modules", [
        makeRequest("List Modules", "GET", "api/superadmin/modules"),
        makeRequest(
          "Create Module",
          "POST",
          "api/superadmin/modules",
          {
            key: "custom_reports",
            label: "Custom Reports",
            panel: "admin",
            icon: "chart-bar",
            sort_order: 99,
          },
        ),
        makeRequest(
          "Update Module",
          "PUT",
          "api/superadmin/modules/{{moduleId}}",
          { label: "Custom Reports (Updated)", sort_order: 100 },
        ),
        makeRequest(
          "Delete Module",
          "DELETE",
          "api/superadmin/modules/{{moduleId}}",
          null,
          "Soft-deactivates module.",
        ),
      ]),
      moduleFolder("Profile", [
        makeRequest("Get Profile", "GET", "api/superadmin/profile"),
        makeRequest(
          "Update Profile",
          "PATCH",
          "api/superadmin/profile",
          { first_name: "Super", last_name: "Admin" },
        ),
        makeMultipartRequest(
          "Upload Avatar",
          "POST",
          "api/superadmin/profile/avatar",
          "avatar",
        ),
        makeRequest(
          "Change Password",
          "PATCH",
          "api/superadmin/profile/password",
          {
            current_password: "OldPass!123",
            new_password: "NewPass!456",
          },
        ),
        makeRequest(
          "Setup 2FA",
          "POST",
          "api/superadmin/profile/2fa/setup",
          {},
        ),
        makeRequest(
          "Verify 2FA Setup",
          "POST",
          "api/superadmin/profile/2fa/verify",
          { token: "123456" },
        ),
        makeRequest(
          "Disable 2FA",
          "POST",
          "api/superadmin/profile/2fa/disable",
          { password: "CurrentPass!123" },
        ),
      ]),
    ],
  };
}

function findFolder(items, name) {
  for (const item of items || []) {
    if (item.name === name && Array.isArray(item.item)) return item;
    if (item.item) {
      const found = findFolder(item.item, name);
      if (found) return found;
    }
  }
  return null;
}

function findRequest(items, urlIncludes) {
  for (const item of items || []) {
    if (item.request) {
      const raw = (item.request.url?.raw || "").toLowerCase();
      if (raw.includes(urlIncludes.toLowerCase())) return item;
    }
    if (item.item) {
      const found = findRequest(item.item, urlIncludes);
      if (found) return found;
    }
  }
  return null;
}

function upsertRequest(folder, urlKey, requestItem) {
  const idx = folder.item.findIndex((it) => {
    if (!it.request) return false;
    return (it.request.url?.raw || "")
      .toLowerCase()
      .includes(urlKey.toLowerCase());
  });
  if (idx >= 0) {
    folder.item[idx] = { ...folder.item[idx], ...requestItem, name: requestItem.name };
    return "updated";
  }
  folder.item.push(requestItem);
  return "added";
}

function ensureSubfolder(parent, name) {
  let folder = parent.item.find((it) => it.name === name && it.item);
  if (!folder) {
    folder = { name, item: [] };
    parent.item.push(folder);
  }
  return folder;
}

const raw = fs.readFileSync(COLLECTION_PATH, "utf8");
const collection = JSON.parse(raw);

collection.info.name = "EPiC API";
collection.info.description =
  "Official Postman collection for EPiC CMS API (multi-tenant). " +
  "Set {{baseUrl}} (default https://server.elitepic.co.uk), login via Auth → Login, " +
  "then paste JWT into {{token}}. Use {{caseId}}, {{taskId}}, {{documentId}} as needed.";

collection.auth = {
  type: "bearer",
  bearer: [{ key: "token", value: "{{token}}", type: "string" }],
};

const defaults = {
  baseUrl: "https://server.elitepic.co.uk",
  token: "",
  organisationSlug: "",
  caseId: "CAS-000001",
  taskId: "1",
  documentId: "1",
  orgId: "1",
  planId: "1",
  subscriptionId: "1",
  invoiceId: "1",
  transactionId: "1",
  moduleId: "1",
  roleId: "7",
  userId: "1",
};
collection.variable = Object.entries(defaults).map(([key, value]) => {
  const existing = (collection.variable || []).find((v) => v.key === key);
  return existing ? { ...existing, value: existing.value || value } : { key, value };
});

const workflow = findFolder(collection.item, "Workflow");
if (!workflow) {
  collection.item.push({ name: "Workflow", item: [] });
}

const wfRoot = findFolder(collection.item, "Workflow");
const candidateFolder = ensureSubfolder(wfRoot, "Candidate");
const staffFolder = ensureSubfolder(wfRoot, "Staff (Admin & Caseworker)");
const adminFolder = ensureSubfolder(wfRoot, "Admin only");

const workflowRequests = [
  {
    folder: candidateFolder,
    key: "data-capture/submit",
    item: makeRequest(
      "Submit Data Capture",
      "POST",
      "api/workflow/data-capture/submit",
      { confirmed: true },
      "Candidate submits completed data capture form.",
    ),
  },
  {
    folder: candidateFolder,
    key: "ccl/accept",
    item: makeRequest(
      "Accept CCL",
      "POST",
      "api/workflow/ccl/accept",
      {},
      "Candidate accepts Client Care Letter.",
    ),
  },
  {
    folder: candidateFolder,
    key: "ccl/confirm-signed",
    item: makeRequest(
      "Confirm CCL Signed",
      "POST",
      "api/workflow/ccl/confirm-signed",
      { signedAt: new Date().toISOString().split("T")[0] },
    ),
  },
  {
    folder: candidateFolder,
    key: "draft-review",
    item: makeRequest(
      "Submit Draft Review",
      "POST",
      "api/workflow/draft-review",
      { confirmed: true },
    ),
  },
  {
    folder: candidateFolder,
    key: "biometric-availability",
    item: makeRequest(
      "Submit Biometric Availability",
      "POST",
      "api/workflow/biometric-availability",
      {
        location: "London — VAC Centre",
        preferredDates: ["2026-06-15", "2026-06-16"],
        preferredTimes: ["09:00", "14:00"],
        notes: "Weekday mornings preferred",
      },
    ),
  },
  {
    folder: candidateFolder,
    key: "mark-biometric-attended",
    item: makeRequest(
      "Mark Biometric Attended",
      "POST",
      "api/workflow/mark-biometric-attended",
      {},
      "Candidate confirms attendance; advances case to awaiting_decision.",
    ),
  },
  {
    folder: staffFolder,
    key: "data-capture/send",
    item: makeRequest(
      "Send Data Capture Request",
      "POST",
      "api/workflow/cases/{{caseId}}/data-capture/send",
      {},
    ),
  },
  {
    folder: staffFolder,
    key: "ccl/propose",
    item: makeRequest(
      "Propose CCL Fees",
      "POST",
      "api/workflow/cases/{{caseId}}/ccl/propose",
      {
        feeAmount: 1500,
        installments: [{ label: "Full Payment", amount: 1500, dueDate: null }],
        notes: "Standard fee schedule",
      },
    ),
  },
  {
    folder: staffFolder,
    key: "ccl/issue",
    item: makeRequest(
      "Issue CCL",
      "POST",
      "api/workflow/cases/{{caseId}}/ccl/issue",
      {},
    ),
  },
  {
    folder: staffFolder,
    key: "visa-portal-submit",
    item: makeRequest(
      "Record Visa Portal Submission",
      "POST",
      "api/workflow/cases/{{caseId}}/visa-portal-submit",
      {
        reference: "UKVI-REF-123456",
        submittedAt: new Date().toISOString(),
        notes: "Submitted via UKVI portal",
      },
    ),
  },
  {
    folder: staffFolder,
    key: "biometric-slot",
    item: makeRequest(
      "Send Biometric Slot Confirmation",
      "POST",
      "api/workflow/cases/{{caseId}}/biometric-slot",
      {
        location: "London — TLScontact",
        date: "2026-06-20",
        day: "Friday",
        time: "10:30",
        sendEmail: true,
      },
      "Books slot; sends notification and email to candidate.",
    ),
  },
  {
    folder: staffFolder,
    key: "biometric-docs-uploaded",
    item: makeRequest(
      "Record Biometric Docs Uploaded",
      "POST",
      "api/workflow/cases/{{caseId}}/biometric-docs-uploaded",
      { notes: "Uploaded to visa portal" },
    ),
  },
  {
    folder: staffFolder,
    key: "visa-portal-reply",
    item: makeRequest(
      "Record Visa Portal Reply",
      "POST",
      "api/workflow/cases/{{caseId}}/visa-portal-reply",
      { replySummary: "Home Office acknowledged submission" },
    ),
  },
];

const stats = { added: 0, updated: 0 };
for (const { folder, key, item } of workflowRequests) {
  const result = upsertRequest(folder, key, item);
  stats[result]++;
}

// Move existing flat Workflow requests into subfolders if still at root
const subfolderNames = new Set(["Candidate", "Staff (Admin & Caseworker)", "Admin only"]);
const toMove = [];
wfRoot.item = wfRoot.item.filter((it) => {
  if (it.item && subfolderNames.has(it.name)) return true;
  if (it.request) {
    toMove.push(it);
    return false;
  }
  return true;
});
for (const req of toMove) {
  const rawUrl = (req.request.url?.raw || "").toLowerCase();
  if (rawUrl.includes("pending-approvals") || rawUrl.includes("fee-review")) {
    upsertRequest(adminFolder, rawUrl, req);
  } else if (
    rawUrl.includes("cases/") ||
    rawUrl.includes("ccl/pending")
  ) {
    upsertRequest(staffFolder, rawUrl, req);
  } else {
    upsertRequest(candidateFolder, rawUrl, req);
  }
}

// Assign case — CCL fee on assign
function findByName(items, name) {
  for (const item of items || []) {
    if (item.name === name && item.request) return item;
    if (item.item) {
      const found = findByName(item.item, name);
      if (found) return found;
    }
  }
  return null;
}

const assignReq = findByName(collection.item, "Assign Case");
if (assignReq) {
  assignReq.request.body = jsonBody({
    assignTo: [2],
    assignToName: "Jane Caseworker",
    reason: "Initial assignment after enquiry review",
    proposedAmount: 1500,
  });
  assignReq.request.description =
    "Assign caseworker(s). proposedAmount sets admin CCL fee issued to candidate (no separate approval).";
}

// Document reject — rejectionReason required
const cwDocStatus = findByName(
  collection.item,
  "Update Caseworker Documents Status Documentid",
);
if (cwDocStatus) {
  cwDocStatus.request.body = jsonBody({
    status: "rejected",
    rejectionReason: "Document is blurry — please re-upload a clear scan of all pages.",
  });
  cwDocStatus.request.description =
    "rejectionReason is required when status is rejected.";
}

// Normalize my-tasks path variable
const myTasks = findRequest(collection.item, "my-tasks");
if (myTasks && (myTasks.request.url?.raw || "").includes(":taskId")) {
  myTasks.request.url.raw = "{{baseUrl}}/api/workflow/my-tasks/{{taskId}}/complete";
  myTasks.request.url.path = ["api", "workflow", "my-tasks", "{{taskId}}", "complete"];
}

// Replace Superadmin folder with module-aligned requests
const superadminFolder = buildSuperadminFolder();
collection.item = collection.item.filter((it) => it.name !== "Superadmin");
collection.item.push(superadminFolder);
const superadminCount = superadminFolder.item.reduce(
  (n, mod) => n + mod.item.length,
  0,
);

fs.writeFileSync(COLLECTION_PATH, JSON.stringify(collection, null, 2), "utf8");
console.log(`Updated ${COLLECTION_PATH}`);
console.log(`Workflow requests: ${stats.added} added, ${stats.updated} updated`);
console.log(`Superadmin folder rebuilt: ${superadminCount} requests in 10 modules`);
