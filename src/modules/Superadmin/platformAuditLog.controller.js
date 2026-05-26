import { Op } from "sequelize";
import { localDateStr } from "../../utils/dateHelpers.js";
import platformDb from "../../models/index.js";
import catchAsync from "../../utils/catchAsync.js";
import ApiResponse from "../../utils/apiResponse.js";

/**
 * GET /api/superadmin/audit-log
 * Query params:
 *   - category: string (Authentication, Organisation, Billing, System, or All)
 *   - search: string (action, user, org, description)
 *   - page: integer (default 1)
 *   - limit: integer (default 10)
 */
export const listPlatformAuditLogs = catchAsync(async (req, res) => {
  const { category, search, page = 1, limit = 10 } = req.query || {};

  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 10;
  const offsetNum = (pageNum - 1) * limitNum;

  const where = {};

  if (category && category !== "All") {
    where.category = category;
  }

  if (search?.trim()) {
    const searchPattern = `%${search.trim()}%`;
    where[Op.or] = [
      { action: { [Op.iLike]: searchPattern } },
      { user: { [Op.iLike]: searchPattern } },
      { org: { [Op.iLike]: searchPattern } },
      { description: { [Op.iLike]: searchPattern } }
    ];
  }

  const { count, rows } = await platformDb.PlatformAuditLog.findAndCountAll({
    where,
    order: [["created_at", "DESC"]],
    limit: limitNum,
    offset: offsetNum
  });

  return ApiResponse.success(res, "Platform audit logs retrieved", {
    logs: rows,
    pagination: {
      total: count,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(count / limitNum)
    }
  });
});

/**
 * GET /api/superadmin/audit-log/export-csv
 */
export const exportPlatformAuditLogsCsv = catchAsync(async (req, res) => {
  const logs = await platformDb.PlatformAuditLog.findAll({
    order: [["created_at", "DESC"]]
  });

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=EPiC_Platform_Audit_Logs_${localDateStr()}.csv`);

  let csvContent = "ID,Category,Action,Initiated By,Organisation,Timestamp,Status,Description\n";

  for (const log of logs) {
    const timeStr = log.created_at ? new Date(log.created_at).toLocaleString() : "";
    
    // Escape double quotes in CSV fields
    const escapeCsv = (str) => {
      if (str == null) return "";
      const s = String(str).replace(/"/g, '""');
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
    };

    csvContent += [
      log.id,
      escapeCsv(log.category),
      escapeCsv(log.action),
      escapeCsv(log.user),
      escapeCsv(log.org),
      escapeCsv(timeStr),
      escapeCsv(log.status),
      escapeCsv(log.description)
    ].join(",") + "\n";
  }

  return res.status(200).send(csvContent);
});
