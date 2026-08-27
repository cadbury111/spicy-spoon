const express = require("express");
const router = express.Router();
const db = require("../db/database");
const { broadcast } = require("../websocket");

function generateBillNumber() {
  const year = new Date().getFullYear();
  const randomNum = Math.floor(10000 + Math.random() * 90000);
  return `INV-${year}-${randomNum}`;
}

// Get all bills
router.get("/", (req, res) => {
  try {
    const bills = db.prepare(`
      SELECT 
        b.*,
        t.section as table_section,
        p.payment_method,
        p.transaction_id,
        p.paid_at,
        p.status as payment_status
      FROM bills b
      LEFT JOIN restaurant_tables t ON b.table_id = t.id
      LEFT JOIN payments p ON b.id = p.bill_id AND p.status IN ('SUCCESS', 'CASH_PAID')
      ORDER BY b.id DESC
    `).all();

    res.json(bills);
  } catch (error) {
    console.error("Error fetching bills:", error);
    res.status(500).json({ message: "Failed to fetch bills", error: error.message });
  }
});

// Get Live Bill for Active Session or Table (before payment)
router.get("/live", (req, res) => {
  try {
    const { tableId, tableNumber, sessionId } = req.query;

    let targetSessionId = sessionId;
    let table;

    if (!targetSessionId) {
      if (tableId) {
        table = db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(Number(tableId));
      } else if (tableNumber) {
        const clean = String(tableNumber).replace(/^Table\s*/i, "").trim();
        table = db.prepare("SELECT * FROM restaurant_tables WHERE table_number = ? OR table_number = ?").get(
          clean,
          `T${clean.replace(/^T/i, "")}`
        );
      }

      if (table && table.current_session_id) {
        targetSessionId = table.current_session_id;
      }
    }

    if (!targetSessionId && !table) {
      return res.status(400).json({ message: "tableId, tableNumber, or sessionId is required" });
    }

    // Check if finalized bill already exists
    let existingBill = null;
    if (targetSessionId) {
      existingBill = db.prepare("SELECT * FROM bills WHERE session_id = ? ORDER BY id DESC").get(targetSessionId);
    }

    // Find all active unpaid orders for this active dining session
    let activeOrders = [];
    if (targetSessionId) {
      activeOrders = db.prepare(`
        SELECT * FROM orders
        WHERE session_id = ? AND status NOT IN ('CANCELLED', 'COMPLETED', 'PAID')
        ORDER BY id ASC
      `).all(targetSessionId);
    } else if (table) {
      activeOrders = db.prepare(`
        SELECT * FROM orders
        WHERE table_id = ? AND status NOT IN ('COMPLETED', 'CANCELLED', 'PAID')
        ORDER BY id ASC
      `).all(table.id);
    }

    if (activeOrders.length === 0 && (!existingBill || existingBill.status === 'PAID')) {
      return res.status(404).json({ message: "No active orders found for this table session" });
    }

    // Aggregate items across all rounds
    const allItems = [];
    let subtotal = 0;

    for (const ord of activeOrders) {
      const items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(ord.id);
      for (const item of items) {
        allItems.push({
          ...item,
          order_number: ord.order_number,
          round_number: ord.round_number,
        });
        subtotal += item.total_price;
      }
    }

    const restaurant = db.prepare("SELECT * FROM restaurants WHERE id = 1").get();
    const taxRate = restaurant?.tax_rate !== undefined ? restaurant.tax_rate : 5.0;
    const serviceRate = restaurant?.service_charge_rate !== undefined ? restaurant.service_charge_rate : 2.5;

    const tax = Math.round((subtotal * (taxRate / 100)) * 100) / 100;
    const serviceCharge = Math.round((subtotal * (serviceRate / 100)) * 100) / 100;
    const grandTotal = Math.round((subtotal + tax + serviceCharge) * 100) / 100;

    const refTable = table || (activeOrders[0] ? db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(activeOrders[0].table_id) : null);

    res.json({
      session_id: targetSessionId || existingBill?.session_id,
      bill: existingBill || {
        bill_number: "LIVE-ESTIMATE",
        table_id: refTable?.id,
        table_number: refTable?.table_number,
        subtotal,
        tax,
        service_charge: serviceCharge,
        discount: 0,
        grand_total: grandTotal,
        status: "UNPAID",
      },
      orders: activeOrders,
      items: allItems,
      restaurant: {
        name: restaurant?.name || "Spicy Spoon",
        address: restaurant?.address || "Tiruppur-Palladam road, Tamil Nadu",
        phone: restaurant?.phone || "+91 73958 77142",
        tax_rate: taxRate,
        service_charge_rate: serviceRate,
      },
    });
  } catch (error) {
    console.error("Live bill error:", error);
    res.status(500).json({ message: "Failed to fetch live bill", error: error.message });
  }
});

// Get single bill by ID or Bill Number
router.get("/:id", (req, res) => {
  try {
    const bill = db.prepare(`
      SELECT 
        b.*,
        t.table_number,
        t.section as table_section,
        r.name as restaurant_name,
        r.address as restaurant_address,
        r.phone as restaurant_phone,
        r.email as restaurant_email
      FROM bills b
      JOIN restaurant_tables t ON b.table_id = t.id
      JOIN restaurants r ON b.restaurant_id = r.id
      WHERE b.id = ? OR b.bill_number = ? OR b.session_id = ?
    `).get(Number(req.params.id) || 0, req.params.id, req.params.id);

    if (!bill) {
      return res.status(404).json({ message: "Bill not found" });
    }

    // Fetch all items from all orders associated with this session or order
    let items = [];
    if (bill.session_id) {
      const orders = db.prepare("SELECT id, order_number, round_number FROM orders WHERE session_id = ?").all(bill.session_id);
      for (const o of orders) {
        const oItems = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(o.id);
        for (const oi of oItems) {
          items.push({ ...oi, order_number: o.order_number, round_number: o.round_number });
        }
      }
    }

    if (items.length === 0 && bill.order_id) {
      items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(bill.order_id);
    }

    const payment = db.prepare("SELECT * FROM payments WHERE bill_id = ? ORDER BY id DESC").get(bill.id);

    res.json({
      ...bill,
      items,
      payment,
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching bill", error: error.message });
  }
});

// Generate or Finalize Bill from Database Orders
router.post("/generate", (req, res) => {
  try {
    const { session_id, order_id, orderId, table_id, tableNumber, discount_code } = req.body;

    let targetSessionId = session_id;
    let targetOrderId = Number(order_id || orderId);
    let table;

    if (!targetSessionId && !targetOrderId) {
      if (table_id) {
        table = db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(Number(table_id));
      } else if (tableNumber) {
        const clean = String(tableNumber).replace(/^Table\s*/i, "").trim();
        table = db.prepare("SELECT * FROM restaurant_tables WHERE table_number = ? OR table_number = ?").get(
          clean,
          `T${clean.replace(/^T/i, "")}`
        );
      }

      if (table && table.current_session_id) {
        targetSessionId = table.current_session_id;
      }
    }

    // Find orders to aggregate (only active unpaid orders)
    let ordersToBill = [];
    if (targetSessionId) {
      ordersToBill = db.prepare(`
        SELECT * FROM orders
        WHERE session_id = ? AND status NOT IN ('CANCELLED', 'COMPLETED', 'PAID')
      `).all(targetSessionId);
    } else if (targetOrderId) {
      const singleOrder = db.prepare("SELECT * FROM orders WHERE id = ?").get(targetOrderId);
      if (singleOrder && !['CANCELLED', 'COMPLETED', 'PAID'].includes(singleOrder.status)) {
        targetSessionId = singleOrder.session_id;
        ordersToBill = db.prepare(`
          SELECT * FROM orders
          WHERE session_id = ? AND status NOT IN ('CANCELLED', 'COMPLETED', 'PAID')
        `).all(targetSessionId);
        if (ordersToBill.length === 0) ordersToBill = [singleOrder];
      }
    } else if (table) {
      ordersToBill = db.prepare(`
        SELECT * FROM orders
        WHERE table_id = ? AND status NOT IN ('CANCELLED', 'COMPLETED', 'PAID')
      `).all(table.id);
    }

    if (ordersToBill.length === 0) {
      return res.status(404).json({ message: "No active orders found to generate bill." });
    }

    const firstOrder = ordersToBill[0];
    const tableIdVal = firstOrder.table_id;
    const tableNumberVal = firstOrder.table_number;
    const customerNameVal = firstOrder.customer_name || "Guest";

    // Check if bill already generated for this session
    let existingBill = db.prepare("SELECT * FROM bills WHERE session_id = ?").get(targetSessionId);

    // Aggregate items and recalculate strict totals from DB
    const allItems = [];
    let subtotal = 0;

    for (const ord of ordersToBill) {
      const items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(ord.id);
      for (const item of items) {
        allItems.push({
          ...item,
          order_number: ord.order_number,
          round_number: ord.round_number,
        });
        subtotal += item.total_price;
      }
    }

    // Fetch Restaurant rates
    const restaurant = db.prepare("SELECT * FROM restaurants WHERE id = 1").get();
    const taxRate = restaurant?.tax_rate !== undefined ? restaurant.tax_rate : 5.0;
    const serviceRate = restaurant?.service_charge_rate !== undefined ? restaurant.service_charge_rate : 2.5;

    const tax = Math.round((subtotal * (taxRate / 100)) * 100) / 100;
    const serviceCharge = Math.round((subtotal * (serviceRate / 100)) * 100) / 100;

    // Apply optional discount coupon
    let discount = 0;
    if (discount_code && ["SPICY10", "WELCOME10", "FLAVOUR10"].includes(String(discount_code).toUpperCase())) {
      discount = Math.round((subtotal * 0.1) * 100) / 100;
    }

    const grandTotal = Math.round((subtotal + tax + serviceCharge - discount) * 100) / 100;

    let finalBillId;

    if (existingBill) {
      // Update existing bill with new items/rounds
      db.prepare(`
        UPDATE bills
        SET subtotal = ?, tax = ?, service_charge = ?, discount = ?, grand_total = ?
        WHERE id = ?
      `).run(subtotal, tax, serviceCharge, discount, grandTotal, existingBill.id);
      finalBillId = existingBill.id;
    } else {
      const billNumber = generateBillNumber();
      const insertBill = db.prepare(`
        INSERT INTO bills (
          bill_number, restaurant_id, table_id, table_number, session_id, order_id, customer_name,
          subtotal, tax, service_charge, discount, grand_total, status
        )
        VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNPAID')
      `);

      const result = insertBill.run(
        billNumber,
        tableIdVal,
        tableNumberVal,
        targetSessionId,
        firstOrder.id,
        customerNameVal,
        subtotal,
        tax,
        serviceCharge,
        discount,
        grandTotal
      );
      finalBillId = result.lastInsertRowid;
    }

    // Update Table status to PAYMENT_PENDING
    db.prepare("UPDATE restaurant_tables SET status = 'PAYMENT_PENDING' WHERE id = ?").run(tableIdVal);

    const createdBill = db.prepare("SELECT * FROM bills WHERE id = ?").get(finalBillId);
    const updatedTable = db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(tableIdVal);
    const payment = db.prepare("SELECT * FROM payments WHERE bill_id = ? ORDER BY id DESC").get(finalBillId);

    const fullBill = {
      ...createdBill,
      restaurant_name: restaurant?.name || "Spicy Spoon",
      restaurant_address: restaurant?.address || "Tiruppur-Palladam road, Tamil Nadu",
      restaurant_phone: restaurant?.phone || "+91 73958 77142",
      items: allItems,
      orders: ordersToBill,
      payment,
    };

    broadcast("BILL_GENERATED", fullBill);
    broadcast("TABLE_STATUS_UPDATED", updatedTable);

    res.status(201).json({
      message: "Bill generated successfully!",
      bill: fullBill,
      table: updatedTable,
    });
  } catch (error) {
    console.error("Bill generation error:", error);
    res.status(500).json({ message: "Failed to generate bill", error: error.message });
  }
});

module.exports = router;
