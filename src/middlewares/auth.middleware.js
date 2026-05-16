import jwt from "jsonwebtoken";
import platformDb from "../models/index.js";
import ApiResponse from "../utils/apiResponse.js";

/**
 * Global token verification against Platform DB users registry.
 */
export const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return ApiResponse.unauthorized(res, "Missing or invalid authorization header");
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "epic-secret-key");

    const user = await platformDb.User.findByPk(decoded.id);
    if (!user) {
      return ApiResponse.unauthorized(res, "User not found");
    }

    if (user.status !== "active") {
      return ApiResponse.forbidden(res, "User account is " + user.status);
    }

    user.userId = user.id; // Compatibility with legacy modules
    req.user = user;
    next();
  } catch (err) {
    return ApiResponse.unauthorized(res, "Token is invalid or expired");
  }
};
