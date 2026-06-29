import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import { Op } from "sequelize";
import platformDb from "../../models/index.js";
import catchAsync from "../../utils/catchAsync.js";
import ApiResponse from "../../utils/apiResponse.js";
import logger from "../../utils/logger.js";
import { recordPlatformAuditLog, createPlatformNotification } from "../../services/platformActivity.service.js";
import {
  PLATFORM_MODULES,
  PLATFORM_MODULE_COUNT,
  permissionNamesToModuleIds,
  moduleIdsToPermissionNames,
} from "../../constants/platformModules.js";
import { isPlatformEmailTaken, normalizePlatformEmail } from "../../utils/platformUserEmail.js";
import { generateOrganisationAdminPassword } from "../../services/organisationMail.service.js";
import { sendPlatformStaffWelcomeEmail } from "../../services/platformMail.service.js";
import { isPlatformSuperAdminRole } from "../../utils/tenantScope.js";
import { rowsToXlsxBuffer, sendXlsxDownload } from "../../utils/excelExport.util.js";
import { generatePdfBufferFromDefinition } from "../../services/pdfGenerator.service.js";

const { User, Role, Permission } = platformDb;

const ROLE_DISPLAY_NAMES = {
  5: "Super Admin",
  6: "Support Agent",
  7: "Billing Manager",
  8: "Compliance Officer",
};

function formatRole(role, memberCount = 0) {
  const permNames = (role.permissions || []).map((p) => p.name);
  const moduleIds = permissionNamesToModuleIds(permNames);
  return {
    id: role.id,
    name: role.name,
    display_name: ROLE_DISPLAY_NAMES[role.id] || role.name?.replace(/^platform_/, "").replace(/_/g, " "),
    description: role.description,
    status: role.status,
    scope: role.scope,
    type: role.id === 5 ? "System" : "Custom",
    modules: moduleIds.length,
    moduleIds,
    perms: moduleIds,
    members: memberCount,
  };
}

function formatMember(user) {
  const permNames = (user.role?.permissions || []).map((p) => p.name);
  const moduleIds = permissionNamesToModuleIds(permNames);
  return {
    id: user.id,
    name: [user.first_name, user.last_name].filter(Boolean).join(" ").trim(),
    email: user.email,
    role: ROLE_DISPLAY_NAMES[user.role_id] || user.role?.name?.replace(/^platform_/, "").replace(/_/g, " ") || "—",
    role_id: user.role_id,
    modules: moduleIds.length,
    moduleIds,
    status: user.status === "active" ? "Active" : "Inactive",
    mfa: Boolean(user.two_factor_enabled),
    lastActive: user.updatedAt || user.updated_at || null,
  };
}

async function getPlatformRoleOr404(roleId) {
  const role = await Role.findOne({
    where: { id: roleId, scope: "platform" },
    include: [
      {
        model: Permission,
        as: "permissions",
        through: { attributes: [] },
      },
    ],
  });
  return role;
}

export const listPlatformModules = catchAsync(async (req, res) => {
  return ApiResponse.success(res, "Platform modules", {
    modules: PLATFORM_MODULES,
    module_count: PLATFORM_MODULE_COUNT,
  });
});

// Shared query so the list endpoint and the export endpoints always return the
// exact same set of team members in the same order.
async function fetchTeamMembers() {
  return User.findAll({
    where: { organisation_id: { [Op.is]: null } },
    include: [
      {
        model: Role,
        as: "role",
        attributes: ["id", "name", "scope"],
        include: [
          {
            model: Permission,
            as: "permissions",
            attributes: ["name"],
            through: { attributes: [] },
          },
        ],
      },
    ],
    order: [["id", "ASC"]],
  });
}

export const listTeamMembers = catchAsync(async (req, res) => {
  const members = await fetchTeamMembers();

  return ApiResponse.success(res, "Platform team retrieved", {
    members: members.map(formatMember),
    stats: {
      total: members.length,
      active: members.filter((m) => m.status === "active").length,
      mfa_enabled: members.filter((m) => m.two_factor_enabled).length,
    },
  });
});

// Columns shared by both exports — keyed against the formatMember() output so
// the spreadsheet and the PDF show identical, accurate data.
const TEAM_EXPORT_COLUMNS = [
  { key: "name", header: "Name" },
  { key: "email", header: "Email" },
  { key: "role", header: "Primary Role" },
  { key: "modules", header: "Access Level" },
  { key: "status", header: "Status" },
  { key: "mfa", header: "2FA" },
  { key: "lastActive", header: "Last Active" },
];

function teamMemberToExportRow(member) {
  const m = formatMember(member);
  return {
    name: m.name || "—",
    email: m.email || "—",
    role: m.role || "—",
    modules: `${m.modules} / ${PLATFORM_MODULE_COUNT}`,
    status: m.status,
    mfa: m.mfa ? "On" : "Off",
    lastActive: m.lastActive
      ? new Date(m.lastActive).toLocaleString("en-GB")
      : "—",
  };
}

/**
 * GET /api/superadmin/team/export/excel
 */
export const exportTeamMembersExcel = catchAsync(async (req, res) => {
  const members = await fetchTeamMembers();
  const rows = members.map(teamMemberToExportRow);
  const buffer = rowsToXlsxBuffer(rows, TEAM_EXPORT_COLUMNS);
  sendXlsxDownload(
    res,
    buffer,
    `team_members_${new Date().toISOString().split("T")[0]}.xlsx`,
  );
});

/**
 * GET /api/superadmin/team/export/pdf
 */
export const exportTeamMembersPdf = catchAsync(async (req, res) => {
  const members = await fetchTeamMembers();
  const rows = members.map(teamMemberToExportRow);

  const headerCells = TEAM_EXPORT_COLUMNS.map((c) => ({
    text: c.header,
    style: "th",
  }));
  const bodyRows = rows.map((row) =>
    TEAM_EXPORT_COLUMNS.map((c) => ({
      text: String(row[c.key] ?? ""),
      style: "td",
    })),
  );

  const generatedAt = new Date().toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const docDefinition = {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [32, 40, 32, 44],
    content: [
      { text: "Administrative Team", style: "title" },
      {
        text: `Internal accounts and access levels — ${rows.length} member${rows.length === 1 ? "" : "s"}`,
        style: "subtitle",
        margin: [0, 2, 0, 2],
      },
      { text: `Generated: ${generatedAt}`, style: "meta", margin: [0, 0, 0, 14] },
      rows.length
        ? {
            table: {
              headerRows: 1,
              // Email + Name wider; the rest auto-fit.
              widths: ["*", "*", "auto", "auto", "auto", "auto", "auto"],
              body: [headerCells, ...bodyRows],
            },
            layout: {
              hLineWidth: (i, node) =>
                i === 0 || i === 1 || i === node.table.body.length ? 1 : 0.5,
              vLineWidth: () => 0,
              hLineColor: (i) => (i <= 1 ? "#1d4ed8" : "#e2e8f0"),
              fillColor: (rowIndex) =>
                rowIndex === 0
                  ? "#1d4ed8"
                  : rowIndex % 2 === 0
                    ? "#f8fafc"
                    : null,
              paddingLeft: () => 7,
              paddingRight: () => 7,
              paddingTop: () => 6,
              paddingBottom: () => 6,
            },
          }
        : { text: "No team members found.", style: "td", margin: [0, 20, 0, 0] },
    ],
    footer: (currentPage, pageCount) => ({
      margin: [32, 4, 32, 0],
      columns: [
        { text: "EPiC CRM — Platform Team Export", style: "footer", width: "*" },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          style: "footer",
          alignment: "right",
          width: "auto",
        },
      ],
    }),
    styles: {
      title: { fontSize: 17, bold: true, color: "#1e3a5f" },
      subtitle: { fontSize: 10, color: "#475569" },
      meta: { fontSize: 8, color: "#64748b" },
      th: { fontSize: 9, bold: true, color: "#ffffff" },
      td: { fontSize: 9, color: "#1e293b" },
      footer: { fontSize: 8, color: "#64748b" },
    },
    defaultStyle: { fontSize: 9, color: "#334155" },
  };

  const buffer = await generatePdfBufferFromDefinition(docDefinition);
  const filename = `team_members_${new Date().toISOString().split("T")[0]}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(buffer);
});

export const inviteTeamMember = catchAsync(async (req, res) => {
  const { email, first_name, last_name, role_id, country_code, mobile } = req.body;

  if (!email || !first_name || !last_name || !role_id) {
    return ApiResponse.badRequest(res, "email, first_name, last_name, and role_id are required");
  }

  const role = await getPlatformRoleOr404(parseInt(role_id, 10));
  if (!role) {
    return ApiResponse.badRequest(res, "Invalid platform role");
  }

  const emailNorm = normalizePlatformEmail(email);
  if (await isPlatformEmailTaken(platformDb, emailNorm, null)) {
    return ApiResponse.badRequest(res, "Email already registered on the platform");
  }

  const plain = generateOrganisationAdminPassword();
  const hashed = await bcrypt.hash(plain, 12);

  const user = await User.create({
    email: emailNorm,
    first_name: String(first_name).trim(),
    last_name: String(last_name).trim(),
    country_code: String(country_code || "+44").trim(),
    mobile: mobile ? String(mobile).trim() : `00${Date.now()}${randomInt(10, 100)}`.slice(-15),
    password: hashed,
    role_id: role.id,
    organisation_id: null,
    is_otp_verified: true,
    is_email_verified: true,
    status: "active",
  });

  let welcomeEmail = { sent: false, reason: "not_attempted" };
  try {
    welcomeEmail = await sendPlatformStaffWelcomeEmail({
      staff: user,
      plainPassword: plain,
      roleName: role.name,
    });
  } catch (mailErr) {
    logger.error({ err: mailErr }, "inviteTeamMember email");
    welcomeEmail = { sent: false, reason: mailErr?.message || "send_failed" };
  }

  const withRole = await User.findByPk(user.id, {
    include: [{ model: Role, as: "role", include: [{ model: Permission, as: "permissions", through: { attributes: [] } }] }],
  });

  await recordPlatformAuditLog({
    category: "Authentication",
    action: "Platform User Invited",
    user: req.user?.email || "superadmin@epic.com",
    org: "Global System",
    description: `Invited new platform team member ${user.first_name} ${user.last_name} (${user.email}) as ${role.name}.`,
    status: "Success"
  });

  await createPlatformNotification({
    title: "Team Member Invited",
    desc: `New platform team member ${user.first_name} ${user.last_name} invited with role ${role.name}.`,
    type: "info"
  });

  // RE-10 fix: never return the temporary password in the API response.
  // If email delivery failed the admin must use the resend-invite flow.
  return ApiResponse.created(res, welcomeEmail.sent ? "Team member invited. Login email sent." : "Team member created. Welcome email could not be sent — use resend invite to deliver credentials.", {
    member: formatMember(withRole),
    welcome_email: welcomeEmail,
  });
});

export const updateTeamMember = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = await User.findOne({
    where: { id, organisation_id: { [Op.is]: null } },
  });
  if (!user) {
    return ApiResponse.notFound(res, "Team member not found");
  }

  if (isPlatformSuperAdminRole(user.role_id) && req.user.id === user.id && req.body.status === "inactive") {
    return ApiResponse.badRequest(res, "You cannot deactivate your own superadmin account");
  }

  const updates = {};
  if (req.body.first_name != null) updates.first_name = String(req.body.first_name).trim();
  if (req.body.last_name != null) updates.last_name = String(req.body.last_name).trim();
  if (req.body.status != null) updates.status = req.body.status === "active" ? "active" : "inactive";
  if (req.body.role_id != null) {
    const role = await getPlatformRoleOr404(parseInt(req.body.role_id, 10));
    if (!role) return ApiResponse.badRequest(res, "Invalid platform role");
    updates.role_id = role.id;
  }

  await user.update(updates);

  const refreshed = await User.findByPk(user.id, {
    include: [{ model: Role, as: "role", include: [{ model: Permission, as: "permissions", through: { attributes: [] } }] }],
  });

  await recordPlatformAuditLog({
    category: "Authentication",
    action: "Platform User Updated",
    user: req.user?.email || "superadmin@epic.com",
    org: "Global System",
    description: `Updated properties of platform team member ${refreshed.first_name} ${refreshed.last_name} (${refreshed.email}). Updates: ${Object.keys(updates).join(", ")}`,
    status: "Success"
  });

  return ApiResponse.success(res, "Team member updated", { member: formatMember(refreshed) });
});

export const deleteTeamMember = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = await User.findOne({
    where: { id, organisation_id: { [Op.is]: null } },
  });
  if (!user) {
    return ApiResponse.notFound(res, "Team member not found");
  }

  if (isPlatformSuperAdminRole(user.role_id)) {
    return ApiResponse.badRequest(res, "Super Admin accounts cannot be deleted");
  }
  if (req.user.id === user.id) {
    return ApiResponse.badRequest(res, "You cannot delete your own account");
  }

  const label = `${user.first_name} ${user.last_name} (${user.email})`;
  await user.destroy();

  await recordPlatformAuditLog({
    category: "Authentication",
    action: "Platform User Deleted",
    user: req.user?.email || "superadmin@epic.com",
    org: "Global System",
    description: `Deleted platform team member ${label}.`,
    status: "Success",
  });

  return ApiResponse.success(res, "Team member deleted");
});

export const listPlatformRoles = catchAsync(async (req, res) => {
  const roles = await Role.findAll({
    where: { scope: "platform" },
    include: [
      {
        model: Permission,
        as: "permissions",
        through: { attributes: [] },
      },
    ],
    order: [["id", "ASC"]],
  });

  const counts = await User.findAll({
    attributes: ["role_id", [platformDb.sequelize.fn("COUNT", "id"), "count"]],
    where: { organisation_id: { [Op.is]: null } },
    group: ["role_id"],
    raw: true,
  });
  const countMap = Object.fromEntries(counts.map((c) => [c.role_id, parseInt(c.count, 10) || 0]));

  return ApiResponse.success(res, "Platform roles retrieved", {
    roles: roles.map((r) => formatRole(r, countMap[r.id] || 0)),
  });
});

export const createPlatformRole = catchAsync(async (req, res) => {
  const { name, description, moduleIds } = req.body;
  if (!name?.trim()) {
    return ApiResponse.badRequest(res, "Role name is required");
  }

  const slug = String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const roleName = slug.startsWith("platform_") ? slug : `platform_${slug}`;

  const existing = await Role.findOne({ where: { name: roleName } });
  if (existing) {
    return ApiResponse.badRequest(res, "Role name already exists");
  }

  const permNames = moduleIdsToPermissionNames(moduleIds || []);
  const perms = await Permission.findAll({ where: { name: permNames } });

  const role = await Role.create({
    name: roleName,
    description: description || null,
    status: "active",
    scope: "platform",
  });
  await role.setPermissions(perms);

  const withPerms = await Role.findByPk(role.id, {
    include: [{ model: Permission, as: "permissions", through: { attributes: [] } }],
  });

  await recordPlatformAuditLog({
    category: "System",
    action: "Platform Role Created",
    user: req.user?.email || "superadmin@epic.com",
    org: "Global System",
    description: `Created new platform role ${role.name}`,
    status: "Success"
  });

  return ApiResponse.created(res, "Platform role created", { role: formatRole(withPerms, 0) });
});

export const updatePlatformRole = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const role = await getPlatformRoleOr404(id);
  if (!role) {
    return ApiResponse.notFound(res, "Role not found");
  }
  if (id === 5) {
    return ApiResponse.badRequest(res, "Super Admin role cannot be modified");
  }

  if (req.body.description != null) {
    await role.update({ description: String(req.body.description).trim() || null });
  }
  if (req.body.status != null) {
    await role.update({ status: req.body.status === "active" ? "active" : "inactive" });
  }
  if (req.body.moduleIds != null) {
    const permNames = moduleIdsToPermissionNames(req.body.moduleIds);
    const perms = await Permission.findAll({ where: { name: permNames } });
    await role.setPermissions(perms);
  }

  const memberCount = await User.count({
    where: { role_id: role.id, organisation_id: { [Op.is]: null } },
  });

  const refreshed = await getPlatformRoleOr404(id);

  await recordPlatformAuditLog({
    category: "System",
    action: "Platform Role Updated",
    user: req.user?.email || "superadmin@epic.com",
    org: "Global System",
    description: `Updated properties on platform role ${refreshed.name}`,
    status: "Success"
  });

  return ApiResponse.success(res, "Role updated", { role: formatRole(refreshed, memberCount) });
});

export const deletePlatformRole = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === 5) {
    return ApiResponse.badRequest(res, "Super Admin role cannot be deleted");
  }

  const role = await getPlatformRoleOr404(id);
  if (!role) {
    return ApiResponse.notFound(res, "Role not found");
  }

  const members = await User.count({
    where: { role_id: id, organisation_id: { [Op.is]: null } },
  });
  if (members > 0) {
    return ApiResponse.badRequest(res, "Reassign members before deleting this role");
  }

  const roleName = role.name;
  await role.destroy();

  await recordPlatformAuditLog({
    category: "System",
    action: "Platform Role Deleted",
    user: req.user?.email || "superadmin@epic.com",
    org: "Global System",
    description: `Deleted platform role ${roleName}`,
    status: "Success"
  });

  return ApiResponse.success(res, "Role deleted");
});
