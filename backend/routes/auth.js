const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const db = require("../db/database");
const { generateStaffToken, verifyStaffAuth } = require("../middleware/auth");

/**
 * POST /api/auth/login
 * Staff login for Admin and Kitchen users
 */
router.post("/login", (req, res) => {
  try {
    const { username, password, role } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "Username and password are required." });
    }

    const trimmedUsername = username.trim();
    let query = "SELECT * FROM staff_users WHERE LOWER(username) = LOWER(?) AND status = 'ACTIVE'";
    const params = [trimmedUsername];

    if (role) {
      query += " AND role = ?";
      params.push(role.toUpperCase());
    }

    const user = db.prepare(query).get(...params);

    if (!user) {
      return res.status(401).json({ message: "Invalid username, role, or inactive staff account." });
    }

    const isValidPassword = bcrypt.compareSync(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ message: "Invalid password. Please verify your credentials." });
    }

    const token = generateStaffToken(user);

    return res.json({
      message: "Staff authentication successful.",
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Staff login error:", err);
    return res.status(500).json({ message: "Internal server authentication error." });
  }
});

/**
 * GET /api/auth/me
 * Get currently authenticated staff user profile
 */
router.get("/me", verifyStaffAuth(), (req, res) => {
  try {
    const user = db
      .prepare("SELECT id, username, name, role, status, created_at FROM staff_users WHERE id = ?")
      .get(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "Staff user not found or deactivated." });
    }

    return res.json({ user });
  } catch (err) {
    return res.status(500).json({ message: "Failed to retrieve user profile." });
  }
});

/**
 * GET /api/auth/staff-list
 * List all staff members (ADMIN only)
 */
router.get("/staff-list", verifyStaffAuth(["ADMIN"]), (req, res) => {
  try {
    const staff = db
      .prepare("SELECT id, username, name, role, status, created_at FROM staff_users ORDER BY created_at DESC")
      .all();
    return res.json(staff);
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch staff list." });
  }
});

/**
 * POST /api/auth/staff
 * Create a new staff account (ADMIN only)
 */
router.post("/staff", verifyStaffAuth(["ADMIN"]), (req, res) => {
  try {
    const { username, password, name, role } = req.body;

    if (!username || !password || !name || !role) {
      return res.status(400).json({ message: "Username, password, name, and role are required." });
    }

    const normalizedRole = role.toUpperCase();
    if (!["ADMIN", "KITCHEN"].includes(normalizedRole)) {
      return res.status(400).json({ message: "Role must be either ADMIN or KITCHEN." });
    }

    const existing = db.prepare("SELECT id FROM staff_users WHERE LOWER(username) = LOWER(?)").get(username.trim());
    if (existing) {
      return res.status(409).json({ message: "A staff account with this username already exists." });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const result = db
      .prepare(`INSERT INTO staff_users (username, password_hash, role, name, status) VALUES (?, ?, ?, ?, 'ACTIVE')`)
      .run(username.trim(), passwordHash, normalizedRole, name.trim());

    return res.status(201).json({
      message: `Staff account created for ${name} (${normalizedRole}).`,
      id: Number(result.lastInsertRowid),
    });
  } catch (err) {
    console.error("Create staff error:", err);
    return res.status(500).json({ message: "Failed to create staff account." });
  }
});

/**
 * PUT /api/auth/staff/:id/status
 * Toggle staff active/inactive status (ADMIN only)
 */
router.put("/staff/:id/status", verifyStaffAuth(["ADMIN"]), (req, res) => {
  try {
    const { status } = req.body;
    const staffId = Number(req.params.id);

    if (staffId === req.user.id && status === "INACTIVE") {
      return res.status(400).json({ message: "You cannot deactivate your own active admin account." });
    }

    db.prepare("UPDATE staff_users SET status = ? WHERE id = ?").run(status, staffId);
    return res.json({ message: `Staff status updated to ${status}.` });
  } catch (err) {
    return res.status(500).json({ message: "Failed to update staff status." });
  }
});

module.exports = router;
