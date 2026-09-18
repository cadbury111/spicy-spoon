const express = require("express");
const router = express.Router();
const db = require("../db/database");
const { broadcast } = require("../websocket");
const { verifyStaffAuth } = require("../middleware/auth");
const {
  timeToMinutes,
  calculateEndTime,
  hasTimeOverlap,
  checkAndReleaseExpiredBookings,
} = require("../utils/bookingManager");

function setNoCacheHeaders(res) {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
    "Surrogate-Control": "no-store",
  });
}

// Get all tables with current status and active booking/order info
router.get("/", async (req, res) => {
  try {
    setNoCacheHeaders(res);
    await checkAndReleaseExpiredBookings();
    const { date, time, guests, section } = req.query;

    const now = new Date();
    const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const todayUtc = now.toISOString().split("T")[0];
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const targetDate = (date && date !== "undefined" && date !== "null") ? date : todayLocal;

    let queryStr = `
      SELECT 
        t.*,
        COALESCE(act_b.id, b.id) as resolved_booking_id,
        COALESCE(act_b.booking_number, b.booking_number) as booking_number,
        COALESCE(act_b.customer_name, b.customer_name) as booking_customer,
        COALESCE(act_b.customer_phone, b.customer_phone) as booking_phone,
        COALESCE(act_b.booking_date, b.booking_date) as booking_date,
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

    const tables = await db.query(queryStr, params);

    let requestedEndTime = null;
    if (time) {
      requestedEndTime = calculateEndTime(time);
    }

    // Fetch active bookings for target date and today
    const dateBookings = await db.query(`
      SELECT * FROM bookings
      WHERE booking_date IN (?, ?, ?)
        AND status IN ('CONFIRMED', 'CHECKED_IN', 'PENDING')
      ORDER BY start_time ASC
    `, [targetDate, todayLocal, todayUtc]);

    const processedTables = tables.map((t) => {
      let isAvailableForSlot = true;
      let slotStatus = "AVAILABLE";
      let conflictReason = null;
      let bookedStart = null;
      let bookedEnd = null;

      // Filter reservations for this table
      const tableTodayBookings = dateBookings.filter(
        (bk) => (bk.table_id === t.id || bk.table_number === t.table_number) &&
                (bk.booking_date === todayLocal || bk.booking_date === todayUtc)
      );

      // Find if table is in an active reservation slot right now
      const currentActiveBooking = tableTodayBookings.find((bk) => {
        const s = timeToMinutes(bk.start_time);
        const e = timeToMinutes(bk.end_time);
        return s !== null && e !== null && currentMins >= s - 45 && currentMins < e;
      });

      // Find upcoming booking later today
      const upcomingBooking = tableTodayBookings.find((bk) => {
        const s = timeToMinutes(bk.start_time);
        return s !== null && s > currentMins;
      });

      const activeOrUpcoming = currentActiveBooking || upcomingBooking || (tableTodayBookings.length > 0 ? tableTodayBookings[0] : null);

      // Determine live floor status for Admin / Waiter / Floor Map
      let liveStatus = "AVAILABLE";
      let liveOrderNumber = null;
      let liveBookingCustomer = null;
      let liveBookingStart = null;
      let liveBookingEnd = null;
      let liveBookingPhone = null;
      let liveBookingNumber = null;

      // 1. If table has an active dining order in progress (PLACED / ACCEPTED / COOKING / READY / SERVED)
      if (t.order_status && !["COMPLETED", "CANCELLED", "PAID"].includes(t.order_status)) {
        liveStatus = t.order_status === "ORDER_PLACED" ? "ORDER_PLACED" : "OCCUPIED";
        liveOrderNumber = t.order_number;
      } else if (t.status === "PAYMENT_PENDING") {
        liveStatus = "PAYMENT_PENDING";
        liveOrderNumber = t.order_number;
      } else if (currentActiveBooking) {
        // Table is currently reserved in active window
        liveStatus = "RESERVED";
        liveBookingCustomer = currentActiveBooking.customer_name;
        liveBookingStart = currentActiveBooking.start_time;
        liveBookingEnd = currentActiveBooking.end_time;
        liveBookingPhone = currentActiveBooking.customer_phone;
        liveBookingNumber = currentActiveBooking.booking_number;
      } else if (t.status === "RESERVED" && activeOrUpcoming) {
        liveStatus = "RESERVED";
        liveBookingCustomer = activeOrUpcoming.customer_name;
        liveBookingStart = activeOrUpcoming.start_time;
        liveBookingEnd = activeOrUpcoming.end_time;
        liveBookingPhone = activeOrUpcoming.customer_phone;
        liveBookingNumber = activeOrUpcoming.booking_number;
      } else if (t.status && t.status !== "AVAILABLE" && t.status !== "COMPLETED") {
        liveStatus = t.status;
      }

      // If active booking was found, populate reservation metadata
      const resolvedCustomer = liveBookingCustomer || activeOrUpcoming?.customer_name || t.booking_customer || null;
      const resolvedStart = liveBookingStart || activeOrUpcoming?.start_time || t.booking_start || null;
      const resolvedEnd = liveBookingEnd || activeOrUpcoming?.end_time || t.booking_end || null;
      const resolvedPhone = liveBookingPhone || activeOrUpcoming?.customer_phone || t.booking_phone || null;
      const resolvedNumber = liveBookingNumber || activeOrUpcoming?.booking_number || t.booking_number || null;

      // Check slot capacity
      if (guests && t.capacity < Number(guests)) {
        isAvailableForSlot = false;
        conflictReason = `Capacity is ${t.capacity} (requires ${guests})`;
      }

      // Check time overlap on target date for reservation booking
      if (date && time && requestedEndTime) {
        const bookingsForTargetDate = dateBookings.filter(
          (bk) => (bk.table_id === t.id || bk.table_number === t.table_number) && bk.booking_date === targetDate
        );

        for (const bk of bookingsForTargetDate) {
          if (hasTimeOverlap(time, requestedEndTime, bk.start_time, bk.end_time)) {
            isAvailableForSlot = false;
            slotStatus = "RESERVED";
            conflictReason = `Booked for this time: ${bk.start_time} – ${bk.end_time}`;
            bookedStart = bk.start_time;
            bookedEnd = bk.end_time;
            break;
          }
        }
      }

      return {
        ...t,
        status: liveStatus,
        order_number: liveOrderNumber,
        booking_customer: resolvedCustomer,
        booking_phone: resolvedPhone,
        booking_number: resolvedNumber,
        booking_start: resolvedStart,
        booking_end: resolvedEnd,
        checkout_time: resolvedEnd,
        booked_time_slot: resolvedStart && resolvedEnd ? `${resolvedStart} – ${resolvedEnd}` : null,
        upcoming_reservation: upcomingBooking ? {
          customer: upcomingBooking.customer_name,
          start_time: upcomingBooking.start_time,
          end_time: upcomingBooking.end_time,
          checkout_time: upcomingBooking.end_time,
          guest_count: upcomingBooking.guest_count,
        } : null,
        slotStatus,
        isAvailableForSlot,
        conflictReason,
        booked_start: bookedStart,
        booked_end: bookedEnd,
      };
    });

    res.json(processedTables);
  } catch (error) {
    console.error("Error fetching tables:", error);
    res.status(500).json({ message: "Failed to fetch tables", error: error.message });
  }
});

// Get single table
router.get("/:id", async (req, res) => {
  try {
    setNoCacheHeaders(res);
    const tableId = Number(req.params.id);
    const table = await db.queryOne(`
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
    `, [tableId || 0, req.params.id]);

    if (!table) {
      return res.status(404).json({ message: "Table not found" });
    }
    res.json(table);
  } catch (error) {
    res.status(500).json({ message: "Error fetching table", error: error.message });
  }
});

// Update table status (ADMIN ONLY)
router.put("/:id/status", verifyStaffAuth(["ADMIN"]), async (req, res) => {
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

    if (status === "AVAILABLE") {
      await db.execute(`
        UPDATE restaurant_tables
        SET status = ?, current_booking_id = NULL, current_order_id = NULL, current_session_id = NULL
        WHERE id = ? OR table_number = ?
      `, [status, tableId || 0, req.params.id]);
    } else {
      await db.execute(`
        UPDATE restaurant_tables
        SET status = ?,
            current_booking_id = COALESCE(?, current_booking_id),
            current_order_id = COALESCE(?, current_order_id),
            current_session_id = COALESCE(?, current_session_id)
        WHERE id = ? OR table_number = ?
      `, [
        status,
        current_booking_id !== undefined ? current_booking_id : null,
        current_order_id !== undefined ? current_order_id : null,
        current_session_id !== undefined ? current_session_id : null,
        tableId || 0,
        req.params.id,
      ]);
    }

    const updatedTable = await db.queryOne(
      "SELECT * FROM restaurant_tables WHERE id = ? OR table_number = ?",
      [tableId || 0, req.params.id]
    );

    broadcast("TABLE_STATUS_UPDATED", updatedTable);

    res.json({ message: "Table status updated successfully", table: updatedTable });
  } catch (error) {
    console.error("Error updating table status:", error);
    res.status(500).json({ message: "Failed to update table status", error: error.message });
  }
});

// Create new table (ADMIN ONLY)
router.post("/", verifyStaffAuth(["ADMIN"]), async (req, res) => {
  try {
    const { table_number, capacity, section, x_pos = 0, y_pos = 0 } = req.body;
    if (!table_number || !capacity || !section) {
      return res.status(400).json({ message: "Table number, capacity, and section are required" });
    }

    const result = await db.execute(`
      INSERT INTO restaurant_tables (table_number, capacity, section, status, x_pos, y_pos)
      VALUES (?, ?, ?, 'AVAILABLE', ?, ?)
    `, [table_number, Number(capacity), section, Number(x_pos), Number(y_pos)]);

    const newTable = await db.queryOne(
      "SELECT * FROM restaurant_tables WHERE id = ?",
      [result.lastInsertRowid]
    );
    broadcast("TABLE_CREATED", newTable);

    res.status(201).json({ message: "Table created successfully", table: newTable });
  } catch (error) {
    if (error.message && (error.message.includes("UNIQUE constraint failed") || error.code === "23505")) {
      return res.status(409).json({ message: "A table with this number already exists" });
    }
    res.status(500).json({ message: "Failed to create table", error: error.message });
  }
});

module.exports = router;
