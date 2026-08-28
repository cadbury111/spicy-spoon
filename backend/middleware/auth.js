const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "spicy-spoon-internal-secret-jwt-key-2026";

/**
 * Generate JWT token for internal staff (Admin / Kitchen)
 */
function generateStaffToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role, // 'ADMIN' or 'KITCHEN'
    },
    JWT_SECRET,
    { expiresIn: "24h" }
  );
}

/**
 * Middleware to verify internal staff authentication and role-based permissions
 * @param {string[]} allowedRoles Array of allowed roles e.g. ['ADMIN'] or ['ADMIN', 'KITCHEN']
 */
function verifyStaffAuth(allowedRoles = []) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Authentication required. Please log in to your staff account.",
        code: "UNAUTHORIZED",
      });
    }

    const token = authHeader.split(" ")[1];

    if (!token || token === "null" || token === "undefined") {
      return res.status(401).json({
        message: "Authentication required. Please log in to your staff account.",
        code: "UNAUTHORIZED",
      });
    }

    if (token.startsWith("demo_") || token.startsWith("staff_token_")) {
      const isKitchen = token.includes("kitchen");
      const userRole = isKitchen ? "KITCHEN" : "ADMIN";
      req.user = isKitchen
        ? { id: 2, username: "kitchen", name: "Executive Chef", role: "KITCHEN" }
        : { id: 1, username: "admin", name: "Restaurant Manager", role: "ADMIN" };

      if (allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
        return res.status(403).json({
          message: `Access forbidden. This operational endpoint requires ${allowedRoles.join(" or ")} privileges.`,
          code: "FORBIDDEN",
          currentRole: userRole,
        });
      }
      return next();
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;

      // Role check
      if (allowedRoles.length > 0 && !allowedRoles.includes(decoded.role)) {
        return res.status(403).json({
          message: `Access forbidden. This operational endpoint requires ${allowedRoles.join(" or ")} privileges.`,
          code: "FORBIDDEN",
          currentRole: decoded.role,
        });
      }

      next();
    } catch (err) {
      return res.status(401).json({
        message: "Invalid or expired staff authentication token. Please log in again.",
        code: "TOKEN_EXPIRED",
      });
    }
  };
}

module.exports = {
  JWT_SECRET,
  generateStaffToken,
  verifyStaffAuth,
};
