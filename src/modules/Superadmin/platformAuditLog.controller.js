import { Op } from "sequelize";
import { localDateStr } from "../../utils/dateHelpers.js";
import platformDb from "../../models/index.js";
import catchAsync from "../../utils/catchAsync.js";
import ApiResponse from "../../utils/apiResponse.js";
import { rowsToXlsxBuffer, sendXlsxDownload } from "../../utils/excelExport.util.js";

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
  try {
    const logs = await platformDb.PlatformAuditLog.findAll({
      order: [["created_at", "DESC"]],
    });

    const columns = [
      { key: "id", header: "ID" },
      { key: "category", header: "Category" },
      { key: "action", header: "Action" },
      { key: "user", header: "Initiated By" },
      { key: "org", header: "Organisation" },
      { key: "timestamp", header: "Timestamp" },
      { key: "status", header: "Status" },
      { key: "description", header: "Description" },
    ];

    const rows = logs.map((log) => ({
      id: log.id,
      category: log.category || "",
      action: log.action || "",
      user: log.user || "",
      org: log.org || "",
      timestamp: log.created_at ? new Date(log.created_at).toLocaleString() : "",
      status: log.status || "",
      description: log.description || "",
    }));

    const buffer = rowsToXlsxBuffer(rows, columns);
    sendXlsxDownload(
      res,
      buffer,
      `EPiC_Platform_Audit_Logs_${localDateStr()}.xlsx`,
    );
  } catch (err) {
    return ApiResponse.error(res, "Failed to export platform audit logs", 500, err);
  }
});
