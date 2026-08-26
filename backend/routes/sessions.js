const express = require("express");
const router = express.Router();
const db = require("../db/database");

/**
 * GET /api/sessions/:sessionId
 * Fetch public guest dining session dashboard data (No customer login required)
 */
router.get("/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;

    // 1. Fetch Guest Session details
    let session = db.prepare("SELECT * FROM guest_sessions WHERE session_id = ?").get(sessionId);

    // 2. Fetch associated orders
    const orders = db
      .prepare("SELECT * FROM orders WHERE session_id = ? ORDER BY round_number ASC, created_at ASC")
      .all(sessionId);

    // If session record wasn't created separately, reconstruct from existing orders/table
    if (!session) {
      if (orders.length === 0) {
        return res.status(404).json({ message: "Guest session not found or has expired." });
      }

      const firstOrder = orders[0];
      const table = db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(firstOrder.table_id);

      session = {
        session_id: sessionId,
        table_number: firstOrder.table_number || (table ? table.table_number : "T1"),
        table_id: firstOrder.table_id,
        customer_name: firstOrder.customer_name || "Guest Customer",
        customer_phone: firstOrder.customer_phone || "",
        status: table && table.status === "AVAILABLE" ? "COMPLETED" : "ACTIVE",
        created_at: firstOrder.created_at,
      };
    }

    // Attach items to each order round
    const getOrderItemsStmt = db.prepare(`
      SELECT oi.*, mi.image_url, mi.category 
      FROM order_items oi
      LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
      WHERE oi.order_id = ?
    `);

    const enrichedOrders = orders.map((ord) => ({
      ...ord,
      items: getOrderItemsStmt.all(ord.id),
    }));

    // 3. Fetch latest active bill for session if any
    const bill = db.prepare("SELECT * FROM bills WHERE session_id = ? ORDER BY id DESC").get(sessionId);

    // Calculate live aggregates if no paid bill exists yet
    const unpaidOrders = enrichedOrders.filter((o) => !["CANCELLED"].includes(o.status));
    let subtotal = 0;
    unpaidOrders.forEach((o) => {
      o.items.forEach((item) => {
        subtotal += Number(item.total_price);
      });
    });

    const tax = Math.round(subtotal * 0.05 * 100) / 100;
    const serviceCharge = Math.round(subtotal * 0.025 * 100) / 100;
    const discount = bill ? Number(bill.discount || 0) : 0;
    const grandTotal = Math.round((subtotal + tax + serviceCharge - discount) * 100) / 100;

    // 4. Fetch table details
    const tableInfo = db.prepare("SELECT * FROM restaurant_tables WHERE table_number = ?").get(session.table_number);

    return res.json({
      session: {
        ...session,
        section: tableInfo?.section || "Main Hall",
      },
      orders: enrichedOrders,
      bill: bill || {
        subtotal,
        tax,
        service_charge: serviceCharge,
        discount,
        grand_total: grandTotal,
        status: "UNPAID",
      },
      summary: {
        totalRounds: enrichedOrders.length,
        totalItemsCount: enrichedOrders.reduce((sum, o) => sum + o.items.reduce((iSum, i) => iSum + i.quantity, 0), 0),
        activeStage: enrichedOrders.length > 0 ? enrichedOrders[enrichedOrders.length - 1].status : "TABLE_ASSIGNED",
      },
    });
  } catch (err) {
    console.error("Fetch guest session error:", err);
    return res.status(500).json({ message: "Failed to retrieve guest session data." });
  }
});

module.exports = router;
