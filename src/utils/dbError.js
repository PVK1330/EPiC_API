/**
 * Turn Sequelize / Postgres errors into a clear API message.
 */
export function formatDbError(err) {
  if (!err) return "Request failed";

  if (err.name === "SequelizeUniqueConstraintError") {
    const item = err.errors?.[0];
    const rawPath = (item?.path || item?.fields?.[0] || err.parent?.constraint || "").toLowerCase();
    const message = (item?.message || "").toLowerCase();

    if (rawPath.includes("email") || message.includes("email")) {
      return "This email address is already registered.";
    }
    if (rawPath.includes("userid") || rawPath.includes("user_id") || message.includes("userid") || message.includes("user_id")) {
      return "An application or profile already exists for this user.";
    }
    if (rawPath.includes("mobile") || message.includes("mobile")) {
      return "Mobile number is already registered.";
    }
    if (rawPath.includes("sponsor") || message.includes("sponsor")) {
      return "A sponsor profile already exists for this user.";
    }
    if (rawPath.includes("caseworker") || message.includes("caseworker")) {
      return "A caseworker profile already exists for this user.";
    }
    if (rawPath.includes("slug") || message.includes("slug")) {
      return "Subdomain is already in use.";
    }
    if (rawPath.includes("filename")) {
      return "Tenant database setup conflict. Please retry in a few seconds.";
    }

    return "A duplicate record already exists.";
  }

  if (err.name === "SequelizeValidationError" && err.errors?.length) {
    return err.errors.map((e) => e.message).join("; ");
  }

  if (err.name === "SequelizeForeignKeyConstraintError") {
    return "Invalid reference. Please check your inputs.";
  }

  return err.message || "Request failed";
}
