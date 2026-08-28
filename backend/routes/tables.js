const express = require("express");
const router = express.Router();
const db = require("../db/database");
const { broadcast } = require("../websocket");
const { verifyStaffAuth } = require("../middleware/auth");

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return 0;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function hasTimeOverlap(start1, end1, start2, end2) {
  const s1 = timeToMinutes(start1);
  const e1 = timeToMinutes(end1);
  const s2 = timeToMinutes(start2);
  const e2 = timeToMinutes(end2);
  return Math.max(s1, s2) < Math.min(e1, e2);
}

// Get all tables with current status and active booking/order info
router.get("/", (req, res) => {
  try {
    const { date, time, guests, section } = req.query;

    let queryStr = `
      SELECT 
        t.*,
        COALESCE(act_b.id, b.id) as resolved_booking_id,
        COALESCE(act_b.booking_number, b.booking_number) as booking_number,
        COALESCE(act_b.customer_name, b.customer_name) as booking_customer,
        COALESCE(act_b.start_time, b.start_time) as booking_start,
        COALESCE(act_b.end_time, b.end_time) as booking_end,
        COALESCE(act_b.guest_count, b.guest_count) as booking_guests,
        COALESCE(act_o.id, o.id) as resolved_order_id,
        COALESCE(act_o.order_number, o.order_number) as order_number,
        COALESCE(act_o.customer_name, o.customer_name) as order_customer,
        COALESCE(act_o.status, o.status) as order_status,
        COALESCE(act_o.total, o.total) as order_total,
        COALESCE(act_o.session_id, t.current_session_id) as resolved_session_id
      FROM restaurant_tables t
      LEFT JOIN bookings b ON t.current_booking_id = b.id
      LEFT JOIN orders o ON t.current_order_id = o.id
      LEFT JOIN (
        SELECT b1.* FROM bookings b1
        JOIN (
          SELECT table_id, MAX(id) as max_id FROM bookings
          WHERE status IN ('CONFIRMED', 'CHECKED_IN', 'PENDING')
          GROUP BY table_id
        ) latest_b ON b1.id = latest_b.max_id
      ) act_b ON t.id = act_b.table_id
      LEFT JOIN (
        SELECT o1.* FROM orders o1
        JOIN (
          SELECT table_id, MAX(id) as max_id FROM orders
          WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'PAID')
          GROUP BY table_id
        ) latest_o ON o1.id = latest_o.max_id
      ) act_o ON t.id = act_o.table_id
      WHERE 1=1
    `;
    const params = [];
    if (section) {
      queryStr += " AND t.section = ?";
      params.push(section);
    }
    queryStr += " ORDER BY t.id ASC";

    const tables = db.prepare(queryStr).all(...params);

    let requestedEndTime = null;
    if (time) {
      const startMin = timeToMinutes(time);
      const endMin = startMin + 90;
      const endH = Math.floor(endMin / 60) % 24;
      const endM = endMin % 60;
      const period = endH >= 12 ? "PM" : "AM";
      const displayH = endH % 12 === 0 ? 12 : endH % 12;
      requestedEndTime = `${String(displayH).padStart(2, "0")}:${String(endM).padStart(2, "0")} ${period}`;
    }

    const todayStr = new Date().toISOString().split("T")[0];

    const processedTables = tables.map((t) => {
      let isAvailableForSlot = true;
      let slotStatus = "AVAILABLE";
      let conflictReason = null;

      // Determine live floor status for Admin / Floor Map
      let liveStatus = "AVAILABLE";
      let liveOrderNumber = null;
      let liveBookingCustomer = null;

      // 1. If table has an active dining order in progress (PLACED / ACCEPTED / COOKING / READY / SERVED)
      if (t.order_status && !["COMPLETED", "CANCELLED", "PAID"].includes(t.order_status)) {
        liveStatus = t.order_status === "ORDER_PLACED" ? "ORDER_PLACED" : "OCCUPIED";
        liveOrderNumber = t.order_number;
      } else if (t.status === "PAYMENT_PENDING") {
        liveStatus = "PAYMENT_PENDING";
        liveOrderNumber = t.order_number;
      } else if (t.booking_number && (!date || t.booking_date === todayStr)) {
        // 2. If table is reserved for today
        liveStatus = "RESERVED";
        liveBookingCustomer = t.booking_customer;
      } else if (t.status && t.status !== "AVAILABLE" && t.status !== "COMPLETED") {
        liveStatus = t.status;
      }

      // Check slot capacity
      if (guests && t.capacity < Number(guests)) {
        isAvailableForSlot = false;
        conflictReason = `Capacity is ${t.capacity} (requires ${guests})`;
      }

      // Check time overlap on target date for reservation booking
      if (date && time && requestedEndTime) {
        const bookingsForTable = db.prepare(`
          SELECT * FROM bookings
          WHERE table_id = ?
            AND booking_date = ?
            AND status IN ('CONFIRMED', 'CHECKED_IN', 'PENDING')
        `).all(t.id, date);

        for (const bk of bookingsForTable) {
          if (hasTimeOverlap(time, requestedEndTime, bk.start_time, bk.end_time)) {
            isAvailableForSlot = false;
            slotStatus = "RESERVED";
            conflictReason = `Booked (${bk.start_time} - ${bk.end_time})`;
            break;
          }
        }
      }

      return {
        ...t,
        status: liveStatus,
        order_number: liveOrderNumber,
        booking_customer: liveBookingCustomer,
        slotStatus,
        isAvailableForSlot,
        conflictReason,
      };
    });

    res.json(processedTables);
  } catch (error) {
    console.error("Error fetching tables:", error);
    res.status(500).json({ message: "Failed to fetch tables", error: error.message });
  }
});

// Get single table
router.get("/:id", (req, res) => {
  try {
    const tableId = Number(req.params.id);
    const query = db.prepare(`
      SELECT 
        t.*,
        b.booking_number,
        b.customer_name as booking_customer,
        b.start_time as booking_start,
        b.end_time as booking_end,
        o.order_number,
        o.status as order_status,
        o.total as order_total
      FROM restaurant_tables t
      LEFT JOIN bookings b ON t.current_booking_id = b.id
      LEFT JOIN orders o ON t.current_order_id = o.id
      WHERE t.id = ? OR t.table_number = ?
    `);
    const table = query.get(tableId || 0, req.params.id);
    if (!table) {
      return res.status(404).json({ message: "Table not found" });
    }
    res.json(table);
  } catch (error) {
    res.status(500).json({ message: "Error fetching table", error: error.message });
  }
});

// Update table status (ADMIN ONLY)
router.put("/:id/status", verifyStaffAuth(["ADMIN"]), (req, res) => {
  try {
    const tableId = Number(req.params.id);
    const { status, current_booking_id, current_order_id, current_session_id } = req.body;

    const validStatuses = [
      "AVAILABLE",
      "RESERVED",
      "OCCUPIED",
      "ORDER_PLACED",
      "PAYMENT_PENDING",
      "COMPLETED",
      "OUT_OF_SERVICE",
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
    }

    let updateStmt;
    if (status === "AVAILABLE") {
      updateStmt = db.prepare(`
        UPDATE restaurant_tables
        SET status = ?, current_booking_id = NULL, current_order_id = NULL, current_session_id = NULL
        WHERE id = ? OR table_number = ?
      `);
      updateStmt.run(status, tableId || 0, req.params.id);
    } else {
      updateStmt = db.prepare(`
        UPDATE restaurant_tables
        SET status = ?,
            current_booking_id = COALESCE(?, current_booking_id),
            current_order_id = COALESCE(?, current_order_id),
            current_session_id = COALESCE(?, current_session_id)
        WHERE id = ? OR table_number = ?
      `);
      updateStmt.run(
        status,
        current_booking_id !== undefined ? current_booking_id : null,
        current_order_id !== undefined ? current_order_id : null,
        current_session_id !== undefined ? current_session_id : null,
        tableId || 0,
        req.params.id
      );
    }

    const updatedTable = db.prepare("SELECT * FROM restaurant_tables WHERE id = ? OR table_number = ?").get(
      tableId || 0,
      req.params.id
    );

    broadcast("TABLE_STATUS_UPDATED", updatedTable);

    res.json({ message: "Table status updated successfully", table: updatedTable });
  } catch (error) {
    console.error("Error updating table status:", error);
    res.status(500).json({ message: "Failed to update table status", error: error.message });
  }
});

// Create new table (ADMIN ONLY)
router.post("/", verifyStaffAuth(["ADMIN"]), (req, res) => {
  try {
    const { table_number, capacity, section, x_pos = 0, y_pos = 0 } = req.body;
    if (!table_number || !capacity || !section) {
      return res.status(400).json({ message: "Table number, capacity, and section are required" });
    }

    const insertStmt = db.prepare(`
      INSERT INTO restaurant_tables (table_number, capacity, section, status, x_pos, y_pos)
      VALUES (?, ?, ?, 'AVAILABLE', ?, ?)
    `);
    const result = insertStmt.run(table_number, Number(capacity), section, Number(x_pos), Number(y_pos));

    const newTable = db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(result.lastInsertRowid);
    broadcast("TABLE_CREATED", newTable);

    res.status(201).json({ message: "Table created successfully", table: newTable });
  } catch (error) {
    if (error.message.includes("UNIQUE constraint failed")) {
      return res.status(409).json({ message: "A table with this number already exists" });
    }
    res.status(500).json({ message: "Failed to create table", error: error.message });
  }
});

module.exports = router;
