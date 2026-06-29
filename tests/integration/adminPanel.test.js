/**
 * EPiC CMS — Org Admin Panel Module-Wise Tests
 * Uses Node.js built-in test runner (node --test).
 * Pure logic — no DB connection required.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const ROLES = { CANDIDATE: 1, CASEWORKER: 2, ADMIN: 3, BUSINESS: 4, SUPERADMIN: 5 };

function checkRole(allowedRoles, userRoleId) {
  return allowedRoles.includes(userRoleId);
}

function paginatePage(items, page = 1, limit = 20) {
  const start = (page - 1) * limit;
  return {
    data: items.slice(start, start + limit),
    total: items.length,
    page,
    limit,
    totalPages: Math.ceil(items.length / limit),
  };
}

function applyDateFilter(items, startDate, endDate, dateField = "created_at") {
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  return items.filter((item) => {
    const d = new Date(item[dateField]);
    if (start && d < start) return false;
    if (end && d > end) return false;
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 1: DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

function computeDashboardStats(cases, tasks) {
  const openCases = cases.filter((c) => c.status !== "Closed" && c.status !== "Rejected");
  const overdueTasks = tasks.filter(
    (t) => !t.completed && t.due_date && new Date(t.due_date) < new Date()
  );
  const closedThisMonth = cases.filter((c) => {
    if (c.status !== "Closed" || !c.closed_at) return false;
    const now = new Date();
    const d = new Date(c.closed_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  return {
    totalCases: cases.length,
    openCases: openCases.length,
    overdueTasks: overdueTasks.length,
    closedThisMonth: closedThisMonth.length,
  };
}

function computeDueOverdueTasks(tasks, horizonHours = 48) {
  const cutoff = new Date(Date.now() + horizonHours * 60 * 60 * 1000);
  const now = new Date();
  return tasks.filter((t) => {
    if (t.completed) return false;
    if (!t.due_date) return false;
    const due = new Date(t.due_date);
    return due <= cutoff;
  }).map((t) => ({
    ...t,
    isOverdue: new Date(t.due_date) < now,
  }));
}

function buildQuickActions(stats) {
  return [
    stats.openCases > 0 ? "view_open_cases" : null,
    stats.overdueTasks > 0 ? "resolve_overdue_tasks" : null,
  ].filter(Boolean);
}

describe("Dashboard — Stats Computation", () => {
  const now = new Date().toISOString();
  const cases = [
    { id: 1, status: "In Progress", closed_at: null },
    { id: 2, status: "Closed", closed_at: now },
    { id: 3, status: "Closed", closed_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString() },
    { id: 4, status: "Rejected", closed_at: null },
    { id: 5, status: "Approved", closed_at: null },
  ];
  const tasks = [
    { id: 1, completed: false, due_date: new Date(Date.now() - 1000).toISOString() }, // overdue
    { id: 2, completed: false, due_date: new Date(Date.now() + 9999999).toISOString() }, // future
    { id: 3, completed: true, due_date: new Date(Date.now() - 1000).toISOString() }, // completed overdue
  ];

  it("total case count is correct", () => {
    const stats = computeDashboardStats(cases, tasks);
    assert.equal(stats.totalCases, 5);
  });

  it("only non-Closed, non-Rejected cases are 'open'", () => {
    const stats = computeDashboardStats(cases, tasks);
    assert.equal(stats.openCases, 2); // In Progress + Approved
  });

  it("overdue task count excludes completed tasks", () => {
    const stats = computeDashboardStats(cases, tasks);
    assert.equal(stats.overdueTasks, 1); // only the uncompleted past-due task
  });

  it("closed this month counts only current-month closures", () => {
    const stats = computeDashboardStats(cases, tasks);
    assert.equal(stats.closedThisMonth, 1); // the one closed_at=now
  });
});

describe("Dashboard — Due/Overdue Tasks", () => {
  const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const soon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const far = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  const tasks = [
    { id: 1, completed: false, due_date: past },   // overdue
    { id: 2, completed: false, due_date: soon },   // due within 48h
    { id: 3, completed: false, due_date: far },    // outside window
    { id: 4, completed: true, due_date: past },    // completed, skip
  ];

  it("includes overdue tasks (past due date, not completed)", () => {
    const result = computeDueOverdueTasks(tasks);
    assert.ok(result.some((t) => t.id === 1));
  });

  it("includes tasks due within 48 hours", () => {
    const result = computeDueOverdueTasks(tasks);
    assert.ok(result.some((t) => t.id === 2));
  });

  it("excludes tasks beyond 48-hour horizon", () => {
    const result = computeDueOverdueTasks(tasks);
    assert.ok(!result.some((t) => t.id === 3));
  });

  it("excludes completed tasks even if overdue", () => {
    const result = computeDueOverdueTasks(tasks);
    assert.ok(!result.some((t) => t.id === 4));
  });

  it("marks past-due tasks as isOverdue=true", () => {
    const result = computeDueOverdueTasks(tasks);
    const overdue = result.find((t) => t.id === 1);
    assert.ok(overdue?.isOverdue);
  });

  it("marks future-due tasks as isOverdue=false", () => {
    const result = computeDueOverdueTasks(tasks);
    const future = result.find((t) => t.id === 2);
    assert.ok(!future?.isOverdue);
  });
});

describe("Dashboard — Quick Actions", () => {
  it("shows view_open_cases action when open cases exist", () => {
    const actions = buildQuickActions({ openCases: 3, overdueTasks: 0 });
    assert.ok(actions.includes("view_open_cases"));
  });

  it("shows resolve_overdue_tasks when overdue tasks exist", () => {
    const actions = buildQuickActions({ openCases: 0, overdueTasks: 2 });
    assert.ok(actions.includes("resolve_overdue_tasks"));
  });

  it("returns empty array when nothing pending", () => {
    const actions = buildQuickActions({ openCases: 0, overdueTasks: 0 });
    assert.equal(actions.length, 0);
  });

  it("returns both actions when both conditions met", () => {
    const actions = buildQuickActions({ openCases: 1, overdueTasks: 1 });
    assert.equal(actions.length, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 2: CASE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

const CASE_STATUSES = ["Lead", "Pending", "In Progress", "Submitted", "Approved", "Rejected", "Closed", "Decision"];
const CASE_STAGE_TRANSITIONS = {
  Lead: ["Pending", "Closed"],
  Pending: ["In Progress", "Closed"],
  "In Progress": ["Submitted", "Closed"],
  Submitted: ["Decision", "Approved", "Rejected", "Closed"],
  Decision: ["Approved", "Rejected"],
  Approved: ["Closed"],
  Rejected: ["Closed"],
  Closed: ["In Progress"], // reopen
};

function isValidCaseTransition(fromStatus, toStatus) {
  return CASE_STAGE_TRANSITIONS[fromStatus]?.includes(toStatus) ?? false;
}

function filterCases(cases, { status, search, caseworkerId } = {}) {
  let result = [...cases];
  if (status) result = result.filter((c) => c.status === status);
  if (search) {
    const q = search.toLowerCase();
    result = result.filter(
      (c) =>
        c.caseRef?.toLowerCase().includes(q) ||
        c.candidateName?.toLowerCase().includes(q)
    );
  }
  if (caseworkerId) result = result.filter((c) => c.assigned_caseworker_id === caseworkerId);
  return result;
}

function buildPipelineView(cases) {
  return CASE_STATUSES.reduce((acc, status) => {
    acc[status] = cases.filter((c) => c.status === status);
    return acc;
  }, {});
}

function assignCase(caseRecord, caseworkerIds) {
  if (!caseworkerIds || caseworkerIds.length === 0) {
    throw new Error("At least one caseworker required");
  }
  return { ...caseRecord, assigned_caseworkers: caseworkerIds };
}

describe("Cases — Status Machine", () => {
  it("Lead can transition to Pending", () => {
    assert.ok(isValidCaseTransition("Lead", "Pending"));
  });

  it("Lead can be closed directly", () => {
    assert.ok(isValidCaseTransition("Lead", "Closed"));
  });

  it("Submitted can transition to Approved", () => {
    assert.ok(isValidCaseTransition("Submitted", "Approved"));
  });

  it("Submitted can transition to Rejected", () => {
    assert.ok(isValidCaseTransition("Submitted", "Rejected"));
  });

  it("Approved cannot go back to In Progress", () => {
    assert.ok(!isValidCaseTransition("Approved", "In Progress"));
  });

  it("Closed case can be reopened to In Progress", () => {
    assert.ok(isValidCaseTransition("Closed", "In Progress"));
  });

  it("Rejected cannot go to Approved directly", () => {
    assert.ok(!isValidCaseTransition("Rejected", "Approved"));
  });

  it("Decision can go to Approved or Rejected", () => {
    assert.ok(isValidCaseTransition("Decision", "Approved"));
    assert.ok(isValidCaseTransition("Decision", "Rejected"));
  });
});

describe("Cases — Filtering", () => {
  const cases = [
    { id: 1, caseRef: "CAS-001", status: "In Progress", candidateName: "Alice Jones", assigned_caseworker_id: 10 },
    { id: 2, caseRef: "CAS-002", status: "Closed", candidateName: "Bob Smith", assigned_caseworker_id: 11 },
    { id: 3, caseRef: "CAS-003", status: "In Progress", candidateName: "Carol Wang", assigned_caseworker_id: 10 },
  ];

  it("filter by status returns matching cases", () => {
    const result = filterCases(cases, { status: "In Progress" });
    assert.equal(result.length, 2);
  });

  it("filter by search matches caseRef", () => {
    const result = filterCases(cases, { search: "CAS-002" });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 2);
  });

  it("filter by search matches candidateName (case insensitive)", () => {
    const result = filterCases(cases, { search: "alice" });
    assert.equal(result.length, 1);
    assert.equal(result[0].candidateName, "Alice Jones");
  });

  it("filter by caseworkerId returns only assigned cases", () => {
    const result = filterCases(cases, { caseworkerId: 10 });
    assert.equal(result.length, 2);
  });

  it("combined filters narrow results correctly", () => {
    const result = filterCases(cases, { status: "In Progress", caseworkerId: 10 });
    assert.equal(result.length, 2);
  });

  it("no filter returns all cases", () => {
    const result = filterCases(cases, {});
    assert.equal(result.length, 3);
  });
});

describe("Cases — Pipeline View", () => {
  const cases = [
    { id: 1, status: "Lead" },
    { id: 2, status: "In Progress" },
    { id: 3, status: "In Progress" },
    { id: 4, status: "Approved" },
  ];

  const pipeline = buildPipelineView(cases);

  it("pipeline contains all defined status columns", () => {
    CASE_STATUSES.forEach((s) => assert.ok(s in pipeline, `Missing column: ${s}`));
  });

  it("Lead column has 1 case", () => {
    assert.equal(pipeline["Lead"].length, 1);
  });

  it("In Progress column has 2 cases", () => {
    assert.equal(pipeline["In Progress"].length, 2);
  });

  it("empty columns contain empty arrays (not undefined)", () => {
    assert.ok(Array.isArray(pipeline["Pending"]));
    assert.equal(pipeline["Pending"].length, 0);
  });
});

describe("Cases — Assignment", () => {
  const caseRecord = { id: 1, status: "In Progress" };

  it("assigns multiple caseworkers", () => {
    const result = assignCase(caseRecord, [10, 11]);
    assert.deepEqual(result.assigned_caseworkers, [10, 11]);
  });

  it("throws when no caseworkers provided", () => {
    assert.throws(() => assignCase(caseRecord, []), /At least one caseworker/);
  });

  it("original case record is not mutated", () => {
    assignCase(caseRecord, [10]);
    assert.ok(!("assigned_caseworkers" in caseRecord));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 3: CANDIDATES
// ═══════════════════════════════════════════════════════════════════════════════

function validateCandidateCreate({ first_name, last_name, email, mobile }) {
  const errors = [];
  if (!first_name?.trim()) errors.push("first_name is required");
  if (!last_name?.trim()) errors.push("last_name is required");
  if (!email?.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) errors.push("valid email is required");
  if (mobile && !/^\+?\d{7,15}$/.test(mobile.replace(/\s/g, ""))) {
    errors.push("mobile must be a valid phone number");
  }
  return { valid: errors.length === 0, errors };
}

function validatePasswordReset(newPassword) {
  if (!newPassword || newPassword.length < 8) return { ok: false, reason: "Password must be at least 8 characters" };
  if (!/[A-Z]/.test(newPassword)) return { ok: false, reason: "Password must contain an uppercase letter" };
  if (!/[0-9]/.test(newPassword)) return { ok: false, reason: "Password must contain a number" };
  return { ok: true };
}

function assignCandidateBusiness(candidate, businessId) {
  return { ...candidate, business_id: businessId ?? null };
}

describe("Candidates — Create Validation", () => {
  it("valid payload passes", () => {
    const result = validateCandidateCreate({
      first_name: "Alice",
      last_name: "Jones",
      email: "alice@test.com",
      mobile: "+447700900001",
    });
    assert.ok(result.valid);
  });

  it("missing first_name fails", () => {
    const result = validateCandidateCreate({ first_name: "", last_name: "Jones", email: "a@b.com" });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => /first_name/.test(e)));
  });

  it("invalid email fails", () => {
    const result = validateCandidateCreate({ first_name: "A", last_name: "B", email: "not-an-email" });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => /email/.test(e)));
  });

  it("mobile is optional — empty passes", () => {
    const result = validateCandidateCreate({ first_name: "A", last_name: "B", email: "a@b.com" });
    assert.ok(result.valid);
  });

  it("invalid mobile format fails", () => {
    const result = validateCandidateCreate({ first_name: "A", last_name: "B", email: "a@b.com", mobile: "abc" });
    assert.ok(!result.valid);
  });
});

describe("Candidates — Password Reset Validation", () => {
  it("strong password passes", () => {
    assert.ok(validatePasswordReset("Password1!").ok);
  });

  it("password shorter than 8 chars fails", () => {
    assert.ok(!validatePasswordReset("Short1").ok);
  });

  it("password without uppercase fails", () => {
    assert.ok(!validatePasswordReset("password1").ok);
  });

  it("password without number fails", () => {
    assert.ok(!validatePasswordReset("Password!").ok);
  });

  it("empty password fails", () => {
    assert.ok(!validatePasswordReset("").ok);
  });
});

describe("Candidates — Business Assignment", () => {
  const candidate = { id: 1, first_name: "Alice", business_id: null };

  it("assigns a business to candidate", () => {
    const result = assignCandidateBusiness(candidate, 99);
    assert.equal(result.business_id, 99);
  });

  it("unassigning (null) clears business_id", () => {
    const assigned = assignCandidateBusiness(candidate, 5);
    const unassigned = assignCandidateBusiness(assigned, null);
    assert.equal(unassigned.business_id, null);
  });

  it("original candidate is not mutated", () => {
    assignCandidateBusiness(candidate, 7);
    assert.equal(candidate.business_id, null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 4: ADMIN USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

function validateAdminCreate({ email, role_id }) {
  const errors = [];
  if (!email?.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) errors.push("valid email required");
  if (![ROLES.ADMIN, ROLES.CASEWORKER].includes(role_id)) errors.push("role must be ADMIN or CASEWORKER");
  return { valid: errors.length === 0, errors };
}

function toggleAdminStatus(admin) {
  return { ...admin, is_active: !admin.is_active };
}

function canDeleteAdmin(adminToDelete, requestingUserId) {
  if (adminToDelete.id === requestingUserId) return false; // cannot delete self
  return true;
}

function filterAdmins(admins, { search, role_id, is_active } = {}) {
  let result = [...admins];
  if (search) {
    const q = search.toLowerCase();
    result = result.filter(
      (a) =>
        a.email?.toLowerCase().includes(q) ||
        a.first_name?.toLowerCase().includes(q) ||
        a.last_name?.toLowerCase().includes(q)
    );
  }
  if (role_id !== undefined) result = result.filter((a) => a.role_id === role_id);
  if (is_active !== undefined) result = result.filter((a) => a.is_active === is_active);
  return result;
}

describe("Admin Users — Create Validation", () => {
  it("valid admin email and role passes", () => {
    const result = validateAdminCreate({ email: "admin@epic.com", role_id: ROLES.ADMIN });
    assert.ok(result.valid);
  });

  it("caseworker role is valid for admin module", () => {
    const result = validateAdminCreate({ email: "cw@epic.com", role_id: ROLES.CASEWORKER });
    assert.ok(result.valid);
  });

  it("candidate role is not valid for admin creation", () => {
    const result = validateAdminCreate({ email: "c@epic.com", role_id: ROLES.CANDIDATE });
    assert.ok(!result.valid);
  });

  it("invalid email fails", () => {
    const result = validateAdminCreate({ email: "not-an-email", role_id: ROLES.ADMIN });
    assert.ok(!result.valid);
  });
});

describe("Admin Users — Toggle Status", () => {
  it("active admin becomes inactive", () => {
    const result = toggleAdminStatus({ id: 1, is_active: true });
    assert.equal(result.is_active, false);
  });

  it("inactive admin becomes active", () => {
    const result = toggleAdminStatus({ id: 1, is_active: false });
    assert.equal(result.is_active, true);
  });

  it("toggle is idempotent when called twice", () => {
    const toggled = toggleAdminStatus(toggleAdminStatus({ id: 1, is_active: true }));
    assert.equal(toggled.is_active, true);
  });
});

describe("Admin Users — Delete Guard", () => {
  it("admin cannot delete themselves", () => {
    assert.ok(!canDeleteAdmin({ id: 5 }, 5));
  });

  it("admin can delete a different admin", () => {
    assert.ok(canDeleteAdmin({ id: 6 }, 5));
  });
});

describe("Admin Users — Filtering", () => {
  const admins = [
    { id: 1, first_name: "Alice", last_name: "A", email: "alice@epic.com", role_id: 3, is_active: true },
    { id: 2, first_name: "Bob", last_name: "B", email: "bob@epic.com", role_id: 2, is_active: false },
    { id: 3, first_name: "Carol", last_name: "C", email: "carol@epic.com", role_id: 3, is_active: true },
  ];

  it("filter by role returns correct subset", () => {
    const result = filterAdmins(admins, { role_id: ROLES.ADMIN });
    assert.equal(result.length, 2);
  });

  it("filter active only returns active admins", () => {
    const result = filterAdmins(admins, { is_active: true });
    assert.equal(result.length, 2);
  });

  it("search by email is case insensitive", () => {
    const result = filterAdmins(admins, { search: "BOB" });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 5: FINANCE
// ═══════════════════════════════════════════════════════════════════════════════

const TRANSACTION_STATUSES = ["pending", "paid", "refunded", "failed", "cancelled"];

function computeFinanceSummary(transactions) {
  const paid = transactions.filter((t) => t.status === "paid");
  const outstanding = transactions.filter((t) => t.status === "pending");
  const refunded = transactions.filter((t) => t.status === "refunded");
  return {
    totalRevenue: paid.reduce((s, t) => s + t.amount, 0),
    totalOutstanding: outstanding.reduce((s, t) => s + t.amount, 0),
    totalRefunded: refunded.reduce((s, t) => s + t.amount, 0),
    transactionCount: transactions.length,
  };
}

function isValidTransactionStatusTransition(from, to) {
  const allowed = {
    pending: ["paid", "failed", "cancelled"],
    paid: ["refunded"],
    failed: ["pending"],
    refunded: [],
    cancelled: [],
  };
  return allowed[from]?.includes(to) ?? false;
}

function validateInvoiceCreate({ amount, candidate_id, description }) {
  const errors = [];
  if (!amount || amount <= 0) errors.push("amount must be positive");
  if (!candidate_id) errors.push("candidate_id is required");
  if (!description?.trim()) errors.push("description is required");
  return { valid: errors.length === 0, errors };
}

function buildReconciliationSummary(transactions) {
  const byStatus = TRANSACTION_STATUSES.reduce((acc, s) => {
    const group = transactions.filter((t) => t.status === s);
    acc[s] = { count: group.length, total: group.reduce((sum, t) => sum + t.amount, 0) };
    return acc;
  }, {});
  return byStatus;
}

describe("Finance — Summary Computation", () => {
  const transactions = [
    { id: 1, amount: 500, status: "paid" },
    { id: 2, amount: 300, status: "paid" },
    { id: 3, amount: 200, status: "pending" },
    { id: 4, amount: 100, status: "refunded" },
  ];

  it("total revenue is sum of paid transactions", () => {
    const summary = computeFinanceSummary(transactions);
    assert.equal(summary.totalRevenue, 800);
  });

  it("outstanding is sum of pending transactions", () => {
    const summary = computeFinanceSummary(transactions);
    assert.equal(summary.totalOutstanding, 200);
  });

  it("refunded is sum of refunded transactions", () => {
    const summary = computeFinanceSummary(transactions);
    assert.equal(summary.totalRefunded, 100);
  });

  it("transaction count is total", () => {
    const summary = computeFinanceSummary(transactions);
    assert.equal(summary.transactionCount, 4);
  });

  it("empty transaction list produces all zeros", () => {
    const summary = computeFinanceSummary([]);
    assert.equal(summary.totalRevenue, 0);
    assert.equal(summary.totalOutstanding, 0);
  });
});

describe("Finance — Transaction Status Machine", () => {
  it("pending → paid is valid", () => {
    assert.ok(isValidTransactionStatusTransition("pending", "paid"));
  });

  it("pending → cancelled is valid", () => {
    assert.ok(isValidTransactionStatusTransition("pending", "cancelled"));
  });

  it("paid → refunded is valid", () => {
    assert.ok(isValidTransactionStatusTransition("paid", "refunded"));
  });

  it("paid → pending is invalid", () => {
    assert.ok(!isValidTransactionStatusTransition("paid", "pending"));
  });

  it("refunded → paid is invalid (terminal state)", () => {
    assert.ok(!isValidTransactionStatusTransition("refunded", "paid"));
  });

  it("cancelled is a terminal state (no valid transitions)", () => {
    TRANSACTION_STATUSES.forEach((s) => {
      assert.ok(!isValidTransactionStatusTransition("cancelled", s));
    });
  });

  it("failed → pending allows retry", () => {
    assert.ok(isValidTransactionStatusTransition("failed", "pending"));
  });
});

describe("Finance — Invoice Validation", () => {
  it("valid invoice payload passes", () => {
    const result = validateInvoiceCreate({ amount: 500, candidate_id: 1, description: "Visa fee" });
    assert.ok(result.valid);
  });

  it("zero amount fails", () => {
    const result = validateInvoiceCreate({ amount: 0, candidate_id: 1, description: "fee" });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => /amount/.test(e)));
  });

  it("negative amount fails", () => {
    const result = validateInvoiceCreate({ amount: -50, candidate_id: 1, description: "fee" });
    assert.ok(!result.valid);
  });

  it("missing candidate_id fails", () => {
    const result = validateInvoiceCreate({ amount: 100, candidate_id: null, description: "fee" });
    assert.ok(!result.valid);
  });

  it("empty description fails", () => {
    const result = validateInvoiceCreate({ amount: 100, candidate_id: 1, description: "  " });
    assert.ok(!result.valid);
  });
});

describe("Finance — Reconciliation Summary", () => {
  const transactions = [
    { amount: 100, status: "paid" },
    { amount: 200, status: "paid" },
    { amount: 50, status: "pending" },
    { amount: 30, status: "refunded" },
  ];

  it("reconciliation includes all statuses", () => {
    const summary = buildReconciliationSummary(transactions);
    TRANSACTION_STATUSES.forEach((s) => assert.ok(s in summary));
  });

  it("paid group has correct total", () => {
    const summary = buildReconciliationSummary(transactions);
    assert.equal(summary.paid.total, 300);
    assert.equal(summary.paid.count, 2);
  });

  it("failed group has zero total when no failures", () => {
    const summary = buildReconciliationSummary(transactions);
    assert.equal(summary.failed.total, 0);
    assert.equal(summary.failed.count, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 6: REPORTING
// ═══════════════════════════════════════════════════════════════════════════════

function getCaseAnalytics(cases) {
  const byStatus = {};
  CASE_STATUSES.forEach((s) => { byStatus[s] = 0; });
  cases.forEach((c) => { if (c.status in byStatus) byStatus[c.status]++; });
  const successRate = cases.length
    ? Math.round((cases.filter((c) => c.status === "Approved").length / cases.length) * 100)
    : 0;
  return { byStatus, total: cases.length, successRate };
}

function getWorkloadReport(caseworkers, cases) {
  return caseworkers.map((cw) => {
    const assigned = cases.filter((c) => c.assigned_caseworker_id === cw.id);
    const open = assigned.filter((c) => c.status !== "Closed" && c.status !== "Rejected");
    return { caseworkerId: cw.id, name: cw.name, total: assigned.length, open: open.length };
  });
}

function applyReportDateFilter(cases, startDate, endDate) {
  return applyDateFilter(cases, startDate, endDate, "created_at");
}

describe("Reporting — Case Analytics", () => {
  const cases = [
    { status: "Approved" },
    { status: "Approved" },
    { status: "Rejected" },
    { status: "In Progress" },
  ];

  it("analytics counts each status correctly", () => {
    const result = getCaseAnalytics(cases);
    assert.equal(result.byStatus["Approved"], 2);
    assert.equal(result.byStatus["Rejected"], 1);
    assert.equal(result.byStatus["In Progress"], 1);
  });

  it("success rate is percentage of approved cases", () => {
    const result = getCaseAnalytics(cases);
    assert.equal(result.successRate, 50); // 2/4 = 50%
  });

  it("empty case list has 0% success rate", () => {
    const result = getCaseAnalytics([]);
    assert.equal(result.successRate, 0);
  });

  it("total reflects all cases", () => {
    const result = getCaseAnalytics(cases);
    assert.equal(result.total, 4);
  });
});

describe("Reporting — Workload Report", () => {
  const caseworkers = [
    { id: 10, name: "Sarah" },
    { id: 11, name: "James" },
  ];
  const cases = [
    { status: "In Progress", assigned_caseworker_id: 10 },
    { status: "Closed", assigned_caseworker_id: 10 },
    { status: "In Progress", assigned_caseworker_id: 11 },
  ];

  it("reports correct total cases per caseworker", () => {
    const report = getWorkloadReport(caseworkers, cases);
    const sarah = report.find((r) => r.caseworkerId === 10);
    assert.equal(sarah.total, 2);
  });

  it("open count excludes Closed cases", () => {
    const report = getWorkloadReport(caseworkers, cases);
    const sarah = report.find((r) => r.caseworkerId === 10);
    assert.equal(sarah.open, 1);
  });

  it("caseworker with no cases has total=0", () => {
    const report = getWorkloadReport([{ id: 99, name: "New" }], cases);
    assert.equal(report[0].total, 0);
  });
});

describe("Reporting — Date Range Filtering", () => {
  const cases = [
    { id: 1, created_at: "2026-01-15T10:00:00Z" },
    { id: 2, created_at: "2026-03-01T10:00:00Z" },
    { id: 3, created_at: "2026-06-01T10:00:00Z" },
  ];

  it("start date filter excludes older records", () => {
    const result = applyReportDateFilter(cases, "2026-02-01", null);
    assert.ok(!result.some((c) => c.id === 1));
    assert.equal(result.length, 2);
  });

  it("end date filter excludes newer records", () => {
    const result = applyReportDateFilter(cases, null, "2026-04-01");
    assert.ok(!result.some((c) => c.id === 3));
    assert.equal(result.length, 2);
  });

  it("date range returns only records in window", () => {
    const result = applyReportDateFilter(cases, "2026-02-01", "2026-04-01");
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 2);
  });

  it("no date filter returns all records", () => {
    const result = applyReportDateFilter(cases, null, null);
    assert.equal(result.length, 3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 7: AUDIT LOGS
// ═══════════════════════════════════════════════════════════════════════════════

function filterAuditLogs(logs, { userId, action, startDate, endDate } = {}) {
  let result = [...logs];
  if (userId) result = result.filter((l) => l.user_id === userId);
  if (action) result = result.filter((l) => l.action === action);
  if (startDate || endDate) result = applyDateFilter(result, startDate, endDate, "timestamp");
  return result;
}

function getAuditStats(logs) {
  const byAction = logs.reduce((acc, l) => {
    acc[l.action] = (acc[l.action] || 0) + 1;
    return acc;
  }, {});
  return { total: logs.length, byAction };
}

function paginateAuditLogs(logs, page = 1, limit = 50) {
  return paginatePage(logs, page, limit);
}

describe("Audit Logs — Filtering", () => {
  const logs = [
    { id: 1, user_id: 1, action: "case.create", timestamp: "2026-01-01T10:00:00Z" },
    { id: 2, user_id: 2, action: "case.update", timestamp: "2026-01-02T10:00:00Z" },
    { id: 3, user_id: 1, action: "user.login", timestamp: "2026-02-01T10:00:00Z" },
    { id: 4, user_id: 3, action: "case.create", timestamp: "2026-03-01T10:00:00Z" },
  ];

  it("filter by userId returns only that user's logs", () => {
    const result = filterAuditLogs(logs, { userId: 1 });
    assert.equal(result.length, 2);
    result.forEach((l) => assert.equal(l.user_id, 1));
  });

  it("filter by action returns matching logs", () => {
    const result = filterAuditLogs(logs, { action: "case.create" });
    assert.equal(result.length, 2);
  });

  it("date range filter works on audit logs", () => {
    const result = filterAuditLogs(logs, { startDate: "2026-02-01", endDate: "2026-03-31" });
    assert.equal(result.length, 2);
  });

  it("combined user + action filter returns intersection", () => {
    const result = filterAuditLogs(logs, { userId: 1, action: "case.create" });
    assert.equal(result.length, 1);
  });

  it("no filters returns all logs", () => {
    const result = filterAuditLogs(logs, {});
    assert.equal(result.length, 4);
  });
});

describe("Audit Logs — Stats", () => {
  const logs = [
    { action: "case.create" },
    { action: "case.create" },
    { action: "user.login" },
  ];

  it("total count is correct", () => {
    const stats = getAuditStats(logs);
    assert.equal(stats.total, 3);
  });

  it("action breakdown counts are correct", () => {
    const stats = getAuditStats(logs);
    assert.equal(stats.byAction["case.create"], 2);
    assert.equal(stats.byAction["user.login"], 1);
  });
});

describe("Audit Logs — Pagination", () => {
  const logs = Array.from({ length: 105 }, (_, i) => ({ id: i + 1 }));

  it("first page returns 50 items (default limit)", () => {
    const result = paginateAuditLogs(logs, 1, 50);
    assert.equal(result.data.length, 50);
  });

  it("last page returns remaining 5 items", () => {
    const result = paginateAuditLogs(logs, 3, 50);
    assert.equal(result.data.length, 5);
  });

  it("total pages calculated correctly", () => {
    const result = paginateAuditLogs(logs, 1, 50);
    assert.equal(result.totalPages, 3);
  });

  it("total count always reflects full dataset", () => {
    const result = paginateAuditLogs(logs, 2, 50);
    assert.equal(result.total, 105);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 8: SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

function validateSmtpSettings({ host, port, username, password }) {
  const errors = [];
  if (!host?.trim()) errors.push("SMTP host is required");
  if (!port || port < 1 || port > 65535) errors.push("SMTP port must be 1-65535");
  if (!username?.trim()) errors.push("SMTP username is required");
  if (!password?.trim()) errors.push("SMTP password is required");
  return { valid: errors.length === 0, errors };
}

function validateSlaRule({ visa_type_id, max_days, escalation_days }) {
  const errors = [];
  if (!visa_type_id) errors.push("visa_type_id is required");
  if (!max_days || max_days <= 0) errors.push("max_days must be positive");
  if (escalation_days !== undefined && escalation_days >= max_days) {
    errors.push("escalation_days must be less than max_days");
  }
  return { valid: errors.length === 0, errors };
}

function validateVisaType({ name, code }) {
  const errors = [];
  if (!name?.trim()) errors.push("visa type name is required");
  if (code && !/^[A-Z0-9_-]{2,20}$/.test(code)) errors.push("code must be 2-20 alphanumeric chars");
  return { valid: errors.length === 0, errors };
}

describe("Settings — SMTP Configuration", () => {
  it("valid SMTP settings pass", () => {
    const result = validateSmtpSettings({ host: "smtp.gmail.com", port: 587, username: "user@org.com", password: "secret" });
    assert.ok(result.valid);
  });

  it("missing host fails", () => {
    const result = validateSmtpSettings({ host: "", port: 587, username: "u", password: "p" });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => /host/.test(e)));
  });

  it("invalid port (0) fails", () => {
    const result = validateSmtpSettings({ host: "smtp.test.com", port: 0, username: "u", password: "p" });
    assert.ok(!result.valid);
  });

  it("port 65535 is valid (max)", () => {
    const result = validateSmtpSettings({ host: "smtp.test.com", port: 65535, username: "u", password: "p" });
    assert.ok(result.valid);
  });

  it("port 65536 is invalid (above max)", () => {
    const result = validateSmtpSettings({ host: "smtp.test.com", port: 65536, username: "u", password: "p" });
    assert.ok(!result.valid);
  });
});

describe("Settings — SLA Rules", () => {
  it("valid SLA rule passes", () => {
    const result = validateSlaRule({ visa_type_id: 1, max_days: 90, escalation_days: 75 });
    assert.ok(result.valid);
  });

  it("escalation_days >= max_days fails", () => {
    const result = validateSlaRule({ visa_type_id: 1, max_days: 30, escalation_days: 30 });
    assert.ok(!result.valid);
  });

  it("missing visa_type_id fails", () => {
    const result = validateSlaRule({ visa_type_id: null, max_days: 30 });
    assert.ok(!result.valid);
  });

  it("max_days=0 fails", () => {
    const result = validateSlaRule({ visa_type_id: 1, max_days: 0 });
    assert.ok(!result.valid);
  });

  it("no escalation_days is allowed", () => {
    const result = validateSlaRule({ visa_type_id: 1, max_days: 60 });
    assert.ok(result.valid);
  });
});

describe("Settings — Visa Types", () => {
  it("valid visa type name passes", () => {
    const result = validateVisaType({ name: "Tier 2 General", code: "T2G" });
    assert.ok(result.valid);
  });

  it("empty name fails", () => {
    const result = validateVisaType({ name: "", code: "T2G" });
    assert.ok(!result.valid);
  });

  it("code with lowercase fails pattern", () => {
    const result = validateVisaType({ name: "Visa A", code: "t2g" });
    assert.ok(!result.valid);
  });

  it("code can be omitted", () => {
    const result = validateVisaType({ name: "Skilled Worker" });
    assert.ok(result.valid);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 9: ROLES & RBAC
// ═══════════════════════════════════════════════════════════════════════════════

function canUserPerformAction(userPermissions, requiredPermission) {
  return userPermissions.includes(requiredPermission);
}

function buildRbacMatrix(roles, permissions, rolePermissions) {
  return roles.map((role) => {
    const perms = rolePermissions
      .filter((rp) => rp.role_id === role.id)
      .map((rp) => permissions.find((p) => p.id === rp.permission_id)?.key)
      .filter(Boolean);
    return { role: role.name, permissions: perms };
  });
}

function clonePermissions(sourcePerms, targetRoleId) {
  return sourcePerms.map((p) => ({ ...p, role_id: targetRoleId }));
}

function getOrphanPermissions(permissions, rolePermissions) {
  const usedIds = new Set(rolePermissions.map((rp) => rp.permission_id));
  return permissions.filter((p) => !usedIds.has(p.id));
}

describe("RBAC — Permission Check", () => {
  const userPermissions = ["case.view", "case.create", "candidate.view"];

  it("user with permission can perform action", () => {
    assert.ok(canUserPerformAction(userPermissions, "case.view"));
  });

  it("user without permission is denied", () => {
    assert.ok(!canUserPerformAction(userPermissions, "admin.delete"));
  });

  it("empty permissions array always denies", () => {
    assert.ok(!canUserPerformAction([], "case.view"));
  });
});

describe("RBAC — Matrix Build", () => {
  const roles = [{ id: 1, name: "Admin" }, { id: 2, name: "Caseworker" }];
  const permissions = [
    { id: 10, key: "case.view" },
    { id: 11, key: "case.delete" },
  ];
  const rolePermissions = [
    { role_id: 1, permission_id: 10 },
    { role_id: 1, permission_id: 11 },
    { role_id: 2, permission_id: 10 },
  ];

  const matrix = buildRbacMatrix(roles, permissions, rolePermissions);

  it("admin has both permissions", () => {
    const admin = matrix.find((r) => r.role === "Admin");
    assert.equal(admin.permissions.length, 2);
  });

  it("caseworker has only view permission", () => {
    const cw = matrix.find((r) => r.role === "Caseworker");
    assert.ok(cw.permissions.includes("case.view"));
    assert.ok(!cw.permissions.includes("case.delete"));
  });
});

describe("RBAC — Clone Permissions", () => {
  const sourcePerms = [
    { role_id: 1, permission_id: 10 },
    { role_id: 1, permission_id: 11 },
  ];

  it("cloned permissions have new role_id", () => {
    const cloned = clonePermissions(sourcePerms, 2);
    cloned.forEach((p) => assert.equal(p.role_id, 2));
  });

  it("clone preserves permission_ids", () => {
    const cloned = clonePermissions(sourcePerms, 2);
    assert.equal(cloned[0].permission_id, 10);
    assert.equal(cloned[1].permission_id, 11);
  });

  it("source permissions are not mutated", () => {
    clonePermissions(sourcePerms, 2);
    sourcePerms.forEach((p) => assert.equal(p.role_id, 1));
  });
});

describe("RBAC — Orphan Detection", () => {
  const permissions = [
    { id: 1, key: "a" },
    { id: 2, key: "b" },
    { id: 3, key: "c" },
  ];
  const rolePermissions = [
    { role_id: 1, permission_id: 1 },
    { role_id: 2, permission_id: 2 },
  ];

  it("identifies unassigned permissions as orphans", () => {
    const orphans = getOrphanPermissions(permissions, rolePermissions);
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0].id, 3);
  });

  it("no orphans when all permissions are assigned", () => {
    const rp = [
      { role_id: 1, permission_id: 1 },
      { role_id: 1, permission_id: 2 },
      { role_id: 1, permission_id: 3 },
    ];
    const orphans = getOrphanPermissions(permissions, rp);
    assert.equal(orphans.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 10: TASKS
// ═══════════════════════════════════════════════════════════════════════════════

function validateTaskCreate({ title, due_date, assigned_to_id }) {
  const errors = [];
  if (!title?.trim()) errors.push("title is required");
  if (due_date && new Date(due_date) < new Date()) errors.push("due_date cannot be in the past");
  if (!assigned_to_id) errors.push("assigned_to_id is required");
  return { valid: errors.length === 0, errors };
}

function isTaskOverdue(task) {
  if (task.completed) return false;
  if (!task.due_date) return false;
  return new Date(task.due_date) < new Date();
}

function filterTasks(tasks, { assignedTo, completed, caseId } = {}) {
  let result = [...tasks];
  if (assignedTo !== undefined) result = result.filter((t) => t.assigned_to_id === assignedTo);
  if (completed !== undefined) result = result.filter((t) => t.completed === completed);
  if (caseId !== undefined) result = result.filter((t) => t.case_id === caseId);
  return result;
}

describe("Tasks — Create Validation", () => {
  const futureDate = new Date(Date.now() + 86400000).toISOString();

  it("valid task payload passes", () => {
    const result = validateTaskCreate({ title: "Review documents", due_date: futureDate, assigned_to_id: 1 });
    assert.ok(result.valid);
  });

  it("missing title fails", () => {
    const result = validateTaskCreate({ title: "", due_date: futureDate, assigned_to_id: 1 });
    assert.ok(!result.valid);
  });

  it("past due_date fails", () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const result = validateTaskCreate({ title: "Task", due_date: past, assigned_to_id: 1 });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => /past/.test(e)));
  });

  it("no due_date is allowed (open-ended task)", () => {
    const result = validateTaskCreate({ title: "Task", assigned_to_id: 1 });
    assert.ok(result.valid);
  });

  it("missing assigned_to_id fails", () => {
    const result = validateTaskCreate({ title: "Task", assigned_to_id: null });
    assert.ok(!result.valid);
  });
});

describe("Tasks — Overdue Detection", () => {
  it("uncompleted task with past due date is overdue", () => {
    const task = { completed: false, due_date: new Date(Date.now() - 1000).toISOString() };
    assert.ok(isTaskOverdue(task));
  });

  it("completed task is never overdue", () => {
    const task = { completed: true, due_date: new Date(Date.now() - 1000).toISOString() };
    assert.ok(!isTaskOverdue(task));
  });

  it("task with future due date is not overdue", () => {
    const task = { completed: false, due_date: new Date(Date.now() + 86400000).toISOString() };
    assert.ok(!isTaskOverdue(task));
  });

  it("task with no due_date is not overdue", () => {
    const task = { completed: false, due_date: null };
    assert.ok(!isTaskOverdue(task));
  });
});

describe("Tasks — Filtering", () => {
  const tasks = [
    { id: 1, assigned_to_id: 1, completed: false, case_id: 10 },
    { id: 2, assigned_to_id: 2, completed: true, case_id: 10 },
    { id: 3, assigned_to_id: 1, completed: false, case_id: 11 },
  ];

  it("filter by assignedTo returns correct tasks", () => {
    const result = filterTasks(tasks, { assignedTo: 1 });
    assert.equal(result.length, 2);
  });

  it("filter by completed=false returns open tasks", () => {
    const result = filterTasks(tasks, { completed: false });
    assert.equal(result.length, 2);
  });

  it("filter by caseId returns case-specific tasks", () => {
    const result = filterTasks(tasks, { caseId: 10 });
    assert.equal(result.length, 2);
  });

  it("combined filter narrows results", () => {
    const result = filterTasks(tasks, { assignedTo: 1, caseId: 10 });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 11: SPONSORS & WORKERS
// ═══════════════════════════════════════════════════════════════════════════════

function validateSponsorCreate({ company_name, email, phone }) {
  const errors = [];
  if (!company_name?.trim()) errors.push("company_name is required");
  if (!email?.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) errors.push("valid email is required");
  if (phone && !/^\+?\d{7,15}$/.test(phone.replace(/\s/g, ""))) {
    errors.push("phone must be a valid phone number");
  }
  return { valid: errors.length === 0, errors };
}

const WORKER_STAGES = ["applied", "documents_submitted", "vetted", "visa_processing", "visa_granted", "visa_rejected"];

function isValidWorkerStageAdvance(currentStage, nextStage) {
  const currentIdx = WORKER_STAGES.indexOf(currentStage);
  const nextIdx = WORKER_STAGES.indexOf(nextStage);
  if (currentIdx < 0 || nextIdx < 0) return false;
  return nextIdx === currentIdx + 1;
}

function getWorkerStageProgress(stage) {
  const idx = WORKER_STAGES.indexOf(stage);
  return idx < 0 ? 0 : Math.round(((idx + 1) / WORKER_STAGES.length) * 100);
}

describe("Sponsors — Create Validation", () => {
  it("valid sponsor passes", () => {
    const result = validateSponsorCreate({ company_name: "TechCorp Ltd", email: "hr@techcorp.com", phone: "+447700900001" });
    assert.ok(result.valid);
  });

  it("missing company_name fails", () => {
    const result = validateSponsorCreate({ company_name: "", email: "hr@techcorp.com" });
    assert.ok(!result.valid);
  });

  it("invalid email fails", () => {
    const result = validateSponsorCreate({ company_name: "TechCorp", email: "not-email" });
    assert.ok(!result.valid);
  });

  it("phone is optional", () => {
    const result = validateSponsorCreate({ company_name: "TechCorp", email: "hr@tc.com" });
    assert.ok(result.valid);
  });
});

describe("Workers — Stage Advancement", () => {
  it("can advance from applied to documents_submitted", () => {
    assert.ok(isValidWorkerStageAdvance("applied", "documents_submitted"));
  });

  it("cannot skip stages", () => {
    assert.ok(!isValidWorkerStageAdvance("applied", "vetted"));
  });

  it("cannot go backwards", () => {
    assert.ok(!isValidWorkerStageAdvance("vetted", "applied"));
  });

  it("final stage cannot advance further", () => {
    assert.ok(!isValidWorkerStageAdvance("visa_granted", "visa_granted"));
  });

  it("invalid stage name returns false", () => {
    assert.ok(!isValidWorkerStageAdvance("invalid_stage", "documents_submitted"));
  });
});

describe("Workers — Stage Progress", () => {
  it("first stage returns non-zero progress", () => {
    const progress = getWorkerStageProgress("applied");
    assert.ok(progress > 0);
  });

  it("visa_rejected final stage returns 100%", () => {
    const progress = getWorkerStageProgress("visa_rejected");
    assert.equal(progress, 100);
  });

  it("invalid stage returns 0%", () => {
    const progress = getWorkerStageProgress("unknown_stage");
    assert.equal(progress, 0);
  });

  it("progress increases with each stage", () => {
    const p1 = getWorkerStageProgress("applied");
    const p2 = getWorkerStageProgress("vetted");
    assert.ok(p2 > p1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 12: ANNOUNCEMENTS
// ═══════════════════════════════════════════════════════════════════════════════

function validateAnnouncement({ title, message, target_roles }) {
  const errors = [];
  if (!title?.trim()) errors.push("title is required");
  if (!message?.trim()) errors.push("message is required");
  if (!Array.isArray(target_roles) || target_roles.length === 0) {
    errors.push("at least one target_role is required");
  }
  return { valid: errors.length === 0, errors };
}

function isAnnouncementVisible(announcement, userRoleId) {
  if (!announcement.target_roles?.length) return true; // broadcast to all
  return announcement.target_roles.includes(userRoleId);
}

describe("Announcements — Validation", () => {
  it("valid announcement passes", () => {
    const result = validateAnnouncement({ title: "System Update", message: "Maintenance tonight", target_roles: [1, 2] });
    assert.ok(result.valid);
  });

  it("missing title fails", () => {
    const result = validateAnnouncement({ title: "", message: "msg", target_roles: [1] });
    assert.ok(!result.valid);
  });

  it("empty target_roles array fails", () => {
    const result = validateAnnouncement({ title: "T", message: "M", target_roles: [] });
    assert.ok(!result.valid);
  });

  it("non-array target_roles fails", () => {
    const result = validateAnnouncement({ title: "T", message: "M", target_roles: 1 });
    assert.ok(!result.valid);
  });
});

describe("Announcements — Visibility", () => {
  it("announcement targeting role 1 is visible to candidate", () => {
    const ann = { target_roles: [1] };
    assert.ok(isAnnouncementVisible(ann, ROLES.CANDIDATE));
  });

  it("announcement targeting role 3 is not visible to candidate", () => {
    const ann = { target_roles: [3] };
    assert.ok(!isAnnouncementVisible(ann, ROLES.CANDIDATE));
  });

  it("broadcast announcement (no roles) is visible to all", () => {
    const ann = { target_roles: [] };
    assert.ok(isAnnouncementVisible(ann, ROLES.CANDIDATE));
    assert.ok(isAnnouncementVisible(ann, ROLES.ADMIN));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 13: LICENCE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

const LICENCE_STATUSES = ["draft", "submitted", "under_review", "additional_info_required", "approved", "rejected", "revoked"];

function isValidLicenceTransition(from, to) {
  const allowed = {
    draft: ["submitted"],
    submitted: ["under_review"],
    under_review: ["additional_info_required", "approved", "rejected"],
    additional_info_required: ["under_review"],
    approved: ["revoked"],
    rejected: [],
    revoked: [],
  };
  return allowed[from]?.includes(to) ?? false;
}

function getLicenceProgress(status) {
  const order = ["draft", "submitted", "under_review", "approved"];
  const idx = order.indexOf(status);
  return idx < 0 ? null : { step: idx + 1, total: order.length, percent: Math.round(((idx + 1) / order.length) * 100) };
}

describe("Licence — Status Transitions", () => {
  it("draft can be submitted", () => {
    assert.ok(isValidLicenceTransition("draft", "submitted"));
  });

  it("submitted moves to under_review", () => {
    assert.ok(isValidLicenceTransition("submitted", "under_review"));
  });

  it("under_review can request additional info", () => {
    assert.ok(isValidLicenceTransition("under_review", "additional_info_required"));
  });

  it("additional_info_required returns to under_review after response", () => {
    assert.ok(isValidLicenceTransition("additional_info_required", "under_review"));
  });

  it("under_review can be approved", () => {
    assert.ok(isValidLicenceTransition("under_review", "approved"));
  });

  it("approved licence can be revoked", () => {
    assert.ok(isValidLicenceTransition("approved", "revoked"));
  });

  it("rejected is a terminal state", () => {
    LICENCE_STATUSES.forEach((s) => {
      assert.ok(!isValidLicenceTransition("rejected", s));
    });
  });

  it("cannot skip from draft to approved", () => {
    assert.ok(!isValidLicenceTransition("draft", "approved"));
  });
});

describe("Licence — Progress Tracking", () => {
  it("draft is step 1 of 4", () => {
    const progress = getLicenceProgress("draft");
    assert.equal(progress.step, 1);
    assert.equal(progress.total, 4);
  });

  it("approved is 100%", () => {
    const progress = getLicenceProgress("approved");
    assert.equal(progress.percent, 100);
  });

  it("rejected/revoked returns null (off main track)", () => {
    assert.equal(getLicenceProgress("rejected"), null);
    assert.equal(getLicenceProgress("revoked"), null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 14: TIMELINE
// ═══════════════════════════════════════════════════════════════════════════════

function buildTimelineEntry({ entity_type, entity_id, action, user_id, metadata = {} }) {
  const errors = [];
  if (!entity_type) errors.push("entity_type required");
  if (!entity_id) errors.push("entity_id required");
  if (!action) errors.push("action required");
  if (!user_id) errors.push("user_id required");
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    entry: {
      entity_type,
      entity_id,
      action,
      user_id,
      metadata,
      timestamp: new Date().toISOString(),
    },
  };
}

function filterTimelineByEntity(entries, entityType, entityId) {
  return entries.filter((e) => e.entity_type === entityType && e.entity_id === entityId);
}

describe("Timeline — Entry Creation", () => {
  it("valid entry creates successfully", () => {
    const result = buildTimelineEntry({ entity_type: "case", entity_id: 1, action: "status.change", user_id: 5 });
    assert.ok(result.ok);
    assert.ok(result.entry.timestamp);
  });

  it("missing entity_type fails", () => {
    const result = buildTimelineEntry({ entity_id: 1, action: "create", user_id: 5 });
    assert.ok(!result.ok);
  });

  it("metadata defaults to empty object", () => {
    const result = buildTimelineEntry({ entity_type: "case", entity_id: 1, action: "view", user_id: 5 });
    assert.deepEqual(result.entry.metadata, {});
  });

  it("custom metadata is preserved", () => {
    const result = buildTimelineEntry({ entity_type: "case", entity_id: 1, action: "update", user_id: 5, metadata: { from: "Pending", to: "In Progress" } });
    assert.equal(result.entry.metadata.from, "Pending");
  });
});

describe("Timeline — Filtering", () => {
  const entries = [
    { entity_type: "case", entity_id: 1, action: "create" },
    { entity_type: "case", entity_id: 2, action: "update" },
    { entity_type: "candidate", entity_id: 1, action: "login" },
  ];

  it("filter by case entity returns only case entries", () => {
    const result = filterTimelineByEntity(entries, "case", 1);
    assert.equal(result.length, 1);
    assert.equal(result[0].action, "create");
  });

  it("filter by candidate returns candidate entries", () => {
    const result = filterTimelineByEntity(entries, "candidate", 1);
    assert.equal(result.length, 1);
  });

  it("no match returns empty array", () => {
    const result = filterTimelineByEntity(entries, "sponsor", 99);
    assert.equal(result.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 15: WORKLOAD MONITORING
// ═══════════════════════════════════════════════════════════════════════════════

function computeWorkloadAlerts(caseworkers, cases, threshold = 10) {
  return caseworkers.reduce((alerts, cw) => {
    const open = cases.filter(
      (c) => c.assigned_caseworker_id === cw.id && c.status !== "Closed" && c.status !== "Rejected"
    );
    if (open.length >= threshold) {
      alerts.push({ caseworkerId: cw.id, name: cw.name, openCases: open.length, severity: open.length >= threshold * 1.5 ? "high" : "medium" });
    }
    return alerts;
  }, []);
}

function getWorkloadTrend(weeklyCounts) {
  if (weeklyCounts.length < 2) return "stable";
  const last = weeklyCounts[weeklyCounts.length - 1];
  const prev = weeklyCounts[weeklyCounts.length - 2];
  if (last > prev * 1.1) return "increasing";
  if (last < prev * 0.9) return "decreasing";
  return "stable";
}

describe("Workload — Alert Detection", () => {
  const caseworkers = [
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
  ];
  const cases = [
    ...Array.from({ length: 12 }, (_, i) => ({ id: i, status: "In Progress", assigned_caseworker_id: 1 })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: 100 + i, status: "In Progress", assigned_caseworker_id: 2 })),
  ];

  it("caseworker over threshold triggers alert", () => {
    const alerts = computeWorkloadAlerts(caseworkers, cases, 10);
    assert.ok(alerts.some((a) => a.caseworkerId === 1));
  });

  it("caseworker under threshold has no alert", () => {
    const alerts = computeWorkloadAlerts(caseworkers, cases, 10);
    assert.ok(!alerts.some((a) => a.caseworkerId === 2));
  });

  it("medium severity when between threshold and 1.5x", () => {
    const alerts = computeWorkloadAlerts(caseworkers, cases, 10);
    const alice = alerts.find((a) => a.caseworkerId === 1);
    assert.equal(alice.severity, "medium"); // 12 cases, threshold=10, 1.5x=15; 12 < 15 → medium
  });

  it("closed cases do not count toward workload", () => {
    const mixedCases = [
      { id: 200, status: "Closed", assigned_caseworker_id: 2 },
      ...Array.from({ length: 5 }, (_, i) => ({ id: 300 + i, status: "In Progress", assigned_caseworker_id: 2 })),
    ];
    const alerts = computeWorkloadAlerts([{ id: 2, name: "Bob" }], mixedCases, 6);
    assert.equal(alerts.length, 0);
  });
});

describe("Workload — Trend Analysis", () => {
  it("increasing trend detected when last > prev by > 10%", () => {
    assert.equal(getWorkloadTrend([100, 110, 125]), "increasing");
  });

  it("decreasing trend detected when last < prev by > 10%", () => {
    assert.equal(getWorkloadTrend([100, 110, 95]), "decreasing");
  });

  it("stable trend when change is within 10%", () => {
    assert.equal(getWorkloadTrend([100, 100, 105]), "stable");
  });

  it("single data point returns stable", () => {
    assert.equal(getWorkloadTrend([100]), "stable");
  });

  it("empty array returns stable", () => {
    assert.equal(getWorkloadTrend([]), "stable");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE 16: PAGINATION (shared utility used across all modules)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Pagination — Core Utility", () => {
  const items = Array.from({ length: 55 }, (_, i) => ({ id: i + 1 }));

  it("page 1 with limit 20 returns first 20 items", () => {
    const result = paginatePage(items, 1, 20);
    assert.equal(result.data.length, 20);
    assert.equal(result.data[0].id, 1);
  });

  it("last page returns remaining items", () => {
    const result = paginatePage(items, 3, 20);
    assert.equal(result.data.length, 15); // 55 - 40
  });

  it("total count is always the full dataset size", () => {
    const result = paginatePage(items, 2, 20);
    assert.equal(result.total, 55);
  });

  it("totalPages rounds up", () => {
    const result = paginatePage(items, 1, 20);
    assert.equal(result.totalPages, 3);
  });

  it("page beyond data returns empty array", () => {
    const result = paginatePage(items, 10, 20);
    assert.equal(result.data.length, 0);
  });
});
