/**
 * Turn Sequelize / Postgres errors into a clear API message.
 */
export function formatDbError(err) {
  if (!err) return "Request failed";

  if (err.name === "SequelizeUniqueConstraintError") {
    const item = err.errors?.[0];
    const field = item?.path || item?.fields?.[0];
    if (field === "slug") return "Subdomain is already in use.";
    if (field === "email") return "Email is already registered.";
    if (field === "filename") {
      return "Tenant database setup conflict. Please retry in a few seconds.";
    }
    return item?.message || "A duplicate value already exists.";
  }

  if (err.name === "SequelizeValidationError" && err.errors?.length) {
    return err.errors.map((e) => e.message).join("; ");
  }

  if (err.name === "SequelizeForeignKeyConstraintError") {
    return "Invalid reference (e.g. plan not found). Run platform seed/migrations.";
  }

  return err.message || "Request failed";
}
