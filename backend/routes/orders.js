const express = require("express");
const router = express.Router();
const db = require("../db/database");
const { broadcast } = require("../websocket");
const { verifyStaffAuth } = require("../middleware/auth");

function generateOrderNumber() {
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `ORD-${randomNum}`;
}

function generateSessionId(tableNumber) {
  const clean = String(tableNumber).replace(/^T/i, "");
  return `SESSION-T${clean}-${Date.now().toString().slice(-6)}`;
}

// Get all orders with items
router.get("/", (req, res) => {
  try {
    const { session_id, table_id, table_number, status } = req.query;

    let queryStr = `
      SELECT 
        o.*,
        COALESCE(o.table_number, t.table_number) as resolved_table_number,
        t.section as table_section,
        b.bill_number,
        b.status as bill_status,
        b.grand_total as bill_grand_total
      FROM orders o
      LEFT JOIN restaurant_tables t ON o.table_id = t.id
      LEFT JOIN bills b ON o.session_id = b.session_id OR o.id = b.order_id
      WHERE 1=1
    `;
    const params = [];

    if (session_id && session_id !== "undefined" && session_id !== "null") {
      queryStr += " AND o.session_id = ?";
      params.push(session_id);
    }
    if (table_id && table_id !== "undefined" && table_id !== "null" && !isNaN(Number(table_id))) {
      queryStr += " AND o.table_id = ?";
      params.push(Number(table_id));
    }
    if (table_number && table_number !== "undefined" && table_number !== "null") {
      const cleanNum = String(table_number).replace(/^Table\s*/i, "").trim();
      queryStr += " AND (o.table_number = ? OR o.table_number = ? OR t.table_number = ? OR t.table_number = ?)";
      params.push(cleanNum, `T${cleanNum.replace(/^T/i, "")}`, cleanNum, `T${cleanNum.replace(/^T/i, "")}`);
    }
    if (status && status !== "undefined" && status !== "null") {
      queryStr += " AND o.status = ?";
      params.push(status);
    }

    queryStr += " ORDER BY o.id DESC";

    const orders = db.prepare(queryStr).all(...params);
    const itemsQuery = db.prepare("SELECT * FROM order_items WHERE order_id = ?");

    const ordersWithItems = orders.map((order) => {
      const items = itemsQuery.all(order.id);
      const tblNum = order.table_number || order.resolved_table_number || "T1";
      return {
        ...order,
        table_number: tblNum,
        tableNumber: tblNum,
        items,
      };
    });

    res.json(ordersWithItems);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ message: "Failed to fetch orders", error: error.message });
  }
});

// Get single order by ID or order_number
router.get("/:id", (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const order = db.prepare(`
      SELECT o.*, t.table_number, t.section as table_section
      FROM orders o
      JOIN restaurant_tables t ON o.table_id = t.id
      WHERE o.id = ? OR o.order_number = ?
    `).get(orderId || 0, req.params.id);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(order.id);
    const bill = db.prepare("SELECT * FROM bills WHERE session_id = ? OR order_id = ?").get(order.session_id, order.id);

    res.json({
      ...order,
      items,
      bill,
      tableNumber: order.table_number,
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching order", error: error.message });
  }
});

// Create new order (Multiple Order Rounds supported, server-side price calculation strictly enforced)
router.post("/", (req, res) => {
  try {
    const {
      tableNumber,
      table_id,
      items,
      customer_name = "Guest",
      customer_phone = "",
      booking_id,
      session_id,
      round_number,
    } = req.body;

    if ((!tableNumber && !table_id) || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Invalid order data. Table and items are required." });
    }

    // 1. Resolve Table
    let table;
    if (table_id) {
      table = db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(Number(table_id));
    } else {
      const cleanNum = String(tableNumber).replace(/^Table\s*/i, "").trim();
      table = db.prepare("SELECT * FROM restaurant_tables WHERE table_number = ? OR table_number = ? OR id = ?").get(
        cleanNum,
        `T${cleanNum.replace(/^T/i, "")}`,
        Number(cleanNum) || 0
      );
    }

    if (!table) {
      return res.status(404).json({ message: `Table ${tableNumber || table_id} not found` });
    }

    // 2. Resolve Active Dining Session ID
    let activeSessionId = session_id || table.current_session_id;
    if (!activeSessionId) {
      activeSessionId = generateSessionId(table.table_number);
    }

    // Determine round number
    let calculatedRound = round_number;
    if (!calculatedRound) {
      const priorRounds = db.prepare("SELECT COUNT(*) as count FROM orders WHERE session_id = ?").get(activeSessionId).count;
      calculatedRound = priorRounds + 1;
    }

    // 3. Server-Side Price Calculation (SECURITY: Ignore all frontend prices)
    let subtotal = 0;
    const validatedItems = [];

    for (const rawItem of items) {
      const quantity = Math.max(1, Number(rawItem.quantity) || 1);
      let menuItem;

      if (rawItem.id || rawItem.menu_item_id) {
        menuItem = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(Number(rawItem.id || rawItem.menu_item_id) || 0);
      }
      if (!menuItem && rawItem.name) {
        menuItem = db.prepare("SELECT * FROM menu_items WHERE name = ? COLLATE NOCASE").get(rawItem.name.trim());
      }
      if (!menuItem && rawItem.name) {
        menuItem = db.prepare("SELECT * FROM menu_items WHERE name LIKE ?").get(`%${rawItem.name.trim()}%`);
      }

      if (!menuItem) {
        return res.status(400).json({ message: `Menu item not recognized: ${rawItem.name || rawItem.id}` });
      }

      const unitPrice = Number(menuItem.price);
      const itemTotal = unitPrice * quantity;
      subtotal += itemTotal;

      validatedItems.push({
        menu_item_id: menuItem.id,
        name: menuItem.name,
        quantity,
        unit_price: unitPrice,
        total_price: itemTotal,
        special_instruction: rawItem.special_instruction || rawItem.specialInstruction || rawItem.note || "",
      });
    }

    // 4. Fetch Restaurant Tax Rates
    const restaurant = db.prepare("SELECT * FROM restaurants WHERE id = 1").get();
    const taxRate = restaurant?.tax_rate !== undefined ? restaurant.tax_rate : 5.0;
    const serviceRate = restaurant?.service_charge_rate !== undefined ? restaurant.service_charge_rate : 2.5;

    const tax = Math.round((subtotal * (taxRate / 100)) * 100) / 100;
    const serviceCharge = Math.round((subtotal * (serviceRate / 100)) * 100) / 100;
    const grandTotal = Math.round((subtotal + tax + serviceCharge) * 100) / 100;

    const orderNumber = generateOrderNumber();

    // 5. Insert Order
    const insertOrder = db.prepare(`
      INSERT INTO orders (
        order_number, restaurant_id, table_id, table_number, booking_id, session_id, round_number,
        customer_name, customer_phone, status, subtotal, tax, service_charge, discount, total
      )
      VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 'ORDER_PLACED', ?, ?, ?, 0, ?)
    `);

    const orderResult = insertOrder.run(
      orderNumber,
      table.id,
      table.table_number,
      booking_id ? Number(booking_id) : null,
      activeSessionId,
      Number(calculatedRound),
      customer_name,
      customer_phone,
      subtotal,
      tax,
      serviceCharge,
      grandTotal
    );

    const newOrderId = orderResult.lastInsertRowid;

    // 6. Insert Items
    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, menu_item_id, name, quantity, unit_price, total_price, special_instruction)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const vi of validatedItems) {
      insertItem.run(newOrderId, vi.menu_item_id, vi.name, vi.quantity, vi.unit_price, vi.total_price, vi.special_instruction);
    }

    // 7. Update Table status & bind session
    db.prepare(`
      UPDATE restaurant_tables
      SET status = 'ORDER_PLACED', current_order_id = ?, current_session_id = ?
      WHERE id = ?
    `).run(newOrderId, activeSessionId, table.id);

    const createdOrder = db.prepare("SELECT * FROM orders WHERE id = ?").get(newOrderId);
    const createdItems = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(newOrderId);
    const updatedTable = db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(table.id);

    const fullOrder = {
      ...createdOrder,
      items: createdItems,
      tableNumber: table.table_number,
    };

    broadcast("NEW_ORDER", fullOrder);
    broadcast("TABLE_STATUS_UPDATED", updatedTable);

    res.status(201).json({
      message: `Order #${orderNumber} (Round ${calculatedRound}) placed successfully!`,
      order: fullOrder,
      table: updatedTable,
      session_id: activeSessionId,
    });
  } catch (error) {
    console.error("Order creation error:", error);
    res.status(500).json({ message: "Failed to place order", error: error.message });
  }
});

// Update order status (ADMIN or KITCHEN ONLY)
const handleUpdateOrderStatus = (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const { status } = req.body;

    const validStatuses = [
      "ORDER_PLACED",
      "ACCEPTED",
      "PREPARING",
      "READY",
      "SERVED",
      "COMPLETED",
      "CANCELLED",
      // backward aliases
      "pending",
      "preparing",
      "ready",
      "completed",
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status: ${status}` });
    }

    const order = db.prepare("SELECT * FROM orders WHERE id = ? OR order_number = ?").get(orderId || 0, req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    let canonicalStatus = status.toUpperCase();
    if (status === "pending") canonicalStatus = "ORDER_PLACED";
    if (status === "preparing") canonicalStatus = "PREPARING";
    if (status === "ready") canonicalStatus = "READY";
    if (status === "completed") canonicalStatus = "COMPLETED";

    db.prepare(`
      UPDATE orders
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(canonicalStatus, order.id);

    // Sync Table status
    if (canonicalStatus === "COMPLETED" || canonicalStatus === "CANCELLED") {
      const unpaidOrders = db.prepare(`
        SELECT COUNT(*) as count FROM orders
        WHERE session_id = ? AND status NOT IN ('COMPLETED', 'CANCELLED')
      `).get(order.session_id).count;

      if (unpaidOrders === 0) {
        const bill = db.prepare("SELECT * FROM bills WHERE session_id = ? OR order_id = ?").get(order.session_id, order.id);
        if (!bill || bill.status === "PAID" || canonicalStatus === "CANCELLED") {
          db.prepare(`
            UPDATE restaurant_tables
            SET status = 'AVAILABLE', current_order_id = NULL, current_session_id = NULL
            WHERE id = ?
          `).run(order.table_id);
        }
      }
    } else if (["ORDER_PLACED", "ACCEPTED", "PREPARING", "READY"].includes(canonicalStatus)) {
      db.prepare("UPDATE restaurant_tables SET status = 'OCCUPIED' WHERE id = ? AND status = 'AVAILABLE'").run(order.table_id);
    }

    const updatedOrder = db.prepare("SELECT * FROM orders WHERE id = ?").get(order.id);
    const items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(order.id);
    const updatedTable = db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(order.table_id);

    const fullOrder = {
      ...updatedOrder,
      items,
      tableNumber: updatedOrder.table_number,
    };

    broadcast("ORDER_STATUS_UPDATED", fullOrder);
    broadcast("TABLE_STATUS_UPDATED", updatedTable);

    res.json({
      message: `Order status updated to ${canonicalStatus}`,
      order: fullOrder,
      table: updatedTable,
    });
  } catch (error) {
    console.error("Order status update error:", error);
    res.status(500).json({ message: "Failed to update order status", error: error.message });
  }
};

router.put("/:id", verifyStaffAuth(["ADMIN", "KITCHEN"]), handleUpdateOrderStatus);
router.put("/:id/status", verifyStaffAuth(["ADMIN", "KITCHEN"]), handleUpdateOrderStatus);

// Delete order
router.delete("/:id", (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const order = db.prepare("SELECT * FROM orders WHERE id = ? OR order_number = ?").get(orderId || 0, req.params.id);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    db.prepare("DELETE FROM order_items WHERE order_id = ?").run(order.id);
    db.prepare("DELETE FROM orders WHERE id = ?").run(order.id);

    const activeRemaining = db.prepare("SELECT COUNT(*) as count FROM orders WHERE table_id = ? AND status NOT IN ('COMPLETED', 'CANCELLED')").get(order.table_id).count;
    if (activeRemaining === 0) {
      db.prepare("UPDATE restaurant_tables SET status = 'AVAILABLE', current_order_id = NULL, current_session_id = NULL WHERE id = ?").run(order.table_id);
    }

    const updatedTable = db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(order.table_id);

    broadcast("ORDER_DELETED", { id: order.id });
    broadcast("TABLE_STATUS_UPDATED", updatedTable);

    res.json({ message: "Order deleted successfully", order });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete order", error: error.message });
  }
});

module.exports = router;
