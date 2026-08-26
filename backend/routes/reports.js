const express = require("express");
const router = express.Router();
const db = require("../db/database");
const { verifyStaffAuth } = require("../middleware/auth");

// ENFORCE RBAC: All report and analytics endpoints are ADMIN ONLY
router.use(verifyStaffAuth(["ADMIN"]));

/**
 * GET /api/reports/analytics
 * Overall aggregated restaurant analytics (ADMIN ONLY)
 */
router.get("/analytics", (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];

    // 1. Revenue
    const totalRevRow = db
      .prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status IN ('SUCCESS', 'CASH_PAID')`)
      .get();
    const todayRevRow = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status IN ('SUCCESS', 'CASH_PAID') AND DATE(paid_at) = ?`
      )
      .get(today);

    // 2. Orders
    const totalOrdersRow = db.prepare(`SELECT COUNT(*) as count FROM orders`).get();
    const activeOrdersRow = db
      .prepare(`SELECT COUNT(*) as count FROM orders WHERE status NOT IN ('COMPLETED', 'CANCELLED')`)
      .get();

    // 3. Bookings
    const totalBookingsRow = db.prepare(`SELECT COUNT(*) as count FROM bookings`).get();
    const todayBookingsRow = db.prepare(`SELECT COUNT(*) as count FROM bookings WHERE booking_date = ?`).get(today);

    // 4. Revenue by payment method
    const revenueByMethod = db
      .prepare(
        `SELECT payment_method, COALESCE(SUM(amount), 0) as total_amount, COUNT(*) as transaction_count
         FROM payments
         WHERE status IN ('SUCCESS', 'CASH_PAID')
         GROUP BY payment_method`
      )
      .all();

    // 5. Top 5 selling items
    const topItems = db
      .prepare(
        `SELECT oi.name, SUM(oi.quantity) as total_quantity, SUM(oi.total_price) as total_sales
         FROM order_items oi
         JOIN orders o ON oi.order_id = o.id
         WHERE o.status != 'CANCELLED'
         GROUP BY oi.name
         ORDER BY total_quantity DESC
         LIMIT 5`
      )
      .all();

    return res.json({
      summary: {
        totalRevenue: totalRevRow.total,
        todayRevenue: todayRevRow.total,
        totalOrders: totalOrdersRow.count,
        activeOrders: activeOrdersRow.count,
        totalBookings: totalBookingsRow.count,
        todayBookings: todayBookingsRow.count,
      },
      revenueByMethod,
      topItems,
    });
  } catch (err) {
    console.error("Analytics report error:", err);
    return res.status(500).json({ message: "Failed to generate analytics report." });
  }
});

/**
 * GET /api/reports/daily
 * Daily revenue and order trend (ADMIN ONLY)
 */
router.get("/daily", (req, res) => {
  try {
    const days = Number(req.query.days) || 7;
    const dailyStats = db
      .prepare(
        `SELECT DATE(paid_at) as report_date, COALESCE(SUM(amount), 0) as revenue, COUNT(*) as count
         FROM payments
         WHERE status IN ('SUCCESS', 'CASH_PAID')
         GROUP BY DATE(paid_at)
         ORDER BY report_date DESC
         LIMIT ?`
      )
      .all(days);

    return res.json({ dailyStats });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch daily reports." });
  }
});

module.exports = router;
