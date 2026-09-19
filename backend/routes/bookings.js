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
  getIndiaDateTime,
  getIndiaDateString,
  getIndiaCurrentMinutes,
} = require("../utils/bookingManager");

function generateBookingNumber() {
  const randomNum = Math.floor(100000 + Math.random() * 900000);
  return `BK-${randomNum}`;
}

function determineMealType(timeStr) {
  const mins = timeToMinutes(timeStr) ?? 0;
  if (mins >= 360 && mins <= 690) return "BREAKFAST"; // 06:00 AM - 11:30 AM
  if (mins > 690 && mins < 1020) return "LUNCH";     // 11:31 AM - 04:59 PM
  return "DINNER";                                   // 05:00 PM onwards
}

// Middleware to prevent stale HTTP caching on booking endpoints
function setNoCacheHeaders(res) {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
    "Surrogate-Control": "no-store",
  });
}

// 1. Get all bookings with table details
router.get("/", async (req, res) => {
  try {
    setNoCacheHeaders(res);
    await checkAndReleaseExpiredBookings();
    const { date, status, table_id } = req.query;
    let queryStr = `
      SELECT 
        b.*,
        t.table_number,
        t.capacity as table_capacity,
        t.section as table_section
      FROM bookings b
      LEFT JOIN restaurant_tables t ON b.table_id = t.id
      WHERE 1=1
    `;
    const params = [];

    if (date && date !== "undefined" && date !== "null") {
      queryStr += " AND b.booking_date = ?";
      params.push(date);
    }
    if (status && status !== "undefined" && status !== "null") {
      queryStr += " AND b.status = ?";
      params.push(status);
    }
    if (table_id && table_id !== "undefined" && table_id !== "null" && !isNaN(Number(table_id))) {
      queryStr += " AND b.table_id = ?";
      params.push(Number(table_id));
    }

    queryStr += " ORDER BY b.booking_date DESC, b.start_time ASC, b.id DESC";

    const bookings = await db.query(queryStr, params);
    res.json(bookings);
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).json({ message: "Failed to fetch bookings", error: error.message });
  }
});

// 2. Check real-time availability for slot
router.get("/availability/check", async (req, res) => {
  try {
    setNoCacheHeaders(res);
    await checkAndReleaseExpiredBookings();
    const { date, time, guests } = req.query;
    if (!date || !time) {
      return res.status(400).json({ message: "date and time are required" });
    }

    const calculatedEndTime = calculateEndTime(time);
    const tables = await db.query("SELECT * FROM restaurant_tables ORDER BY id ASC");
    const bookings = await db.query(`
      SELECT * FROM bookings
      WHERE booking_date = ?
        AND status IN ('CONFIRMED', 'CHECKED_IN', 'PENDING')
    `, [date]);

    const results = tables.map((table) => {
      let isAvailable = true;
      let reason = null;

      if (table.status === "OUT_OF_SERVICE") {
        isAvailable = false;
        reason = "Table is currently out of service";
      } else if (table.status === "RESERVED" && !table.current_booking_id) {
        isAvailable = false;
        reason = "Reserved by restaurant management";
      } else if (guests && table.capacity < Number(guests)) {
        isAvailable = false;
        reason = `Capacity is ${table.capacity}, requested ${guests}`;
      }

      if (isAvailable) {
        const tableBookings = bookings.filter((b) => b.table_id === table.id);
        for (const bk of tableBookings) {
          if (hasTimeOverlap(time, calculatedEndTime, bk.start_time, bk.end_time)) {
            isAvailable = false;
            reason = `Booked for this time: ${bk.start_time} – ${bk.end_time}`;
            break;
          }
        }
      }

      return {
        table_id: table.id,
        table_number: table.table_number,
        capacity: table.capacity,
        section: table.section,
        is_available: isAvailable,
        reason,
      };
    });

    res.json({
      date,
      start_time: time,
      end_time: calculatedEndTime,
      tables: results,
    });
  } catch (error) {
    res.status(500).json({ message: "Availability check failed", error: error.message });
  }
});

// 3. Get single booking
router.get("/:id", async (req, res) => {
  try {
    setNoCacheHeaders(res);
    const booking = await db.queryOne(`
      SELECT 
        b.*,
        t.table_number,
        t.capacity as table_capacity,
        t.section as table_section
      FROM bookings b
      JOIN restaurant_tables t ON b.table_id = t.id
      WHERE b.id = ? OR b.booking_number = ?
    `, [Number(req.params.id) || 0, req.params.id]);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    res.json(booking);
  } catch (error) {
    res.status(500).json({ message: "Error fetching booking", error: error.message });
  }
});

// 4. Create new booking with ATOMIC Concurrency & Database-Level Double-Booking Protection
router.post("/", async (req, res) => {
  try {
    await checkAndReleaseExpiredBookings();
    const table_id = req.body.table_id || req.body.tableId;
    const table_number = req.body.table_number || req.body.tableNumber;
    const customer_name = req.body.customer_name || req.body.full_name || req.body.name;
    const customer_phone = req.body.customer_phone || req.body.phone_number || req.body.phone;
    const customer_email = req.body.customer_email || req.body.email || "";
    const booking_date = req.body.booking_date || req.body.reservation_date || req.body.date;
    const start_time = req.body.start_time || req.body.reservation_time || req.body.time;
    const end_time = req.body.end_time;
    const guest_count = req.body.guest_count || req.body.party_size || req.body.guests;
    const special_notes = req.body.special_notes || req.body.special_request || req.body.notes || "";

    // Server-side input validation
    if (!customer_name || !String(customer_name).trim()) {
      return res.status(400).json({ success: false, message: "Customer full name is required" });
    }
    if (!customer_phone || !String(customer_phone).trim()) {
      return res.status(400).json({ success: false, message: "Customer phone number is required" });
    }
    if (!booking_date || !/^\d{4}-\d{2}-\d{2}$/.test(booking_date)) {
      return res.status(400).json({ success: false, message: "Valid booking date (YYYY-MM-DD) is required" });
    }
    
    const todayIst = getIndiaDateString();
    const isToday = booking_date === todayIst;
    const currentMins = getIndiaCurrentMinutes();

    if (booking_date < todayIst) {
      return res.status(400).json({ success: false, message: "Booking date cannot be in the past" });
    }

    const startMins = timeToMinutes(start_time);
    if (startMins === null) {
      return res.status(400).json({ success: false, message: "Valid start time is required (e.g. 07:30 PM)" });
    }

    // Only reject for today if slot has passed by more than 15 minutes
    if (isToday && startMins < currentMins - 15) {
      return res.status(400).json({
        success: false,
        message: "The selected time slot has already passed for today. Please choose an upcoming time slot.",
      });
    }
    if (!guest_count || Number(guest_count) < 1) {
      return res.status(400).json({ success: false, message: "Party size must be at least 1 guest" });
    }

    const calculatedEndTime = end_time || calculateEndTime(start_time);
    const mealType = req.body.meal_type || req.body.mealType || determineMealType(start_time);
    const searchTableKey = table_id || table_number;

    // Atomic Database Transaction
    const { createdBooking, updatedTable, sessionId } = await db.transaction(async (trx) => {
      let targetTable;

      if (searchTableKey) {
        targetTable = await trx.queryOne(
          "SELECT * FROM restaurant_tables WHERE id = ? OR table_number = ?",
          [Number(searchTableKey) || 0, String(searchTableKey)]
        );

        if (!targetTable) {
          const err = new Error(`Selected table ${searchTableKey} does not exist.`);
          err.statusCode = 404;
          throw err;
        }

        // Check admin holds / out of service
        if (targetTable.status === "OUT_OF_SERVICE") {
          const err = new Error(`Table ${targetTable.table_number} is currently out of service. Please choose another table.`);
          err.statusCode = 409;
          throw err;
        }

        if (targetTable.status === "RESERVED" && !targetTable.current_booking_id) {
          const err = new Error(`Table ${targetTable.table_number} is reserved by management. Please choose another table.`);
          err.statusCode = 409;
          throw err;
        }

        // Capacity check
        if (targetTable.capacity < Number(guest_count)) {
          const err = new Error(
            `Selected Table ${targetTable.table_number} has a capacity of ${targetTable.capacity} guests (you requested ${guest_count}). Please select a larger table.`
          );
          err.statusCode = 400;
          throw err;
        }
      } else {
        // Auto-assign table that fits capacity and has no overlap
        const candidates = await trx.query(
          "SELECT * FROM restaurant_tables WHERE capacity >= ? AND status != 'OUT_OF_SERVICE' AND (status != 'RESERVED' OR current_booking_id IS NOT NULL) ORDER BY capacity ASC, id ASC",
          [Number(guest_count)]
        );

        for (const cand of candidates) {
          const overlaps = await trx.query(
            "SELECT * FROM bookings WHERE table_id = ? AND booking_date = ? AND status IN ('CONFIRMED', 'CHECKED_IN', 'PENDING')",
            [cand.id, booking_date]
          );

          const conflict = overlaps.some((eb) =>
            hasTimeOverlap(start_time, calculatedEndTime, eb.start_time, eb.end_time)
          );

          if (!conflict) {
            targetTable = cand;
            break;
          }
        }

        if (!targetTable) {
          const err = new Error(
            "No tables available for the selected date, time, and guest count. Please choose another time slot."
          );
          err.statusCode = 409;
          throw err;
        }
      }

      // Strict Overlap Check on target table & date within the transaction
      const existingBookings = await trx.query(
        "SELECT * FROM bookings WHERE table_id = ? AND booking_date = ? AND status IN ('CONFIRMED', 'CHECKED_IN', 'PENDING')",
        [targetTable.id, booking_date]
      );

      for (const eb of existingBookings) {
        if (hasTimeOverlap(start_time, calculatedEndTime, eb.start_time, eb.end_time)) {
          const err = new Error(
            `Table ${targetTable.table_number} is no longer available for the selected time. Please choose another table or time.`
          );
          err.statusCode = 409;
          err.conflictingBooking = eb;
          throw err;
        }
      }

      // Insert Booking into Centralized Database
      const bookingNumber = generateBookingNumber();
      const insertResult = await trx.execute(`
        INSERT INTO bookings (
          booking_number, restaurant_id, table_id, customer_name, customer_phone, customer_email,
          booking_date, start_time, end_time, meal_type, guest_count, status, special_notes
        )
        VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?)
      `, [
        bookingNumber,
        targetTable.id,
        String(customer_name).trim(),
        String(customer_phone).trim(),
        String(customer_email || "").trim(),
        booking_date,
        start_time,
        calculatedEndTime,
        mealType,
        Number(guest_count),
        special_notes || "",
      ]);

      let newBookingId = insertResult.lastInsertRowid;
      if (!newBookingId) {
        const found = await trx.queryOne("SELECT id FROM bookings WHERE booking_number = ?", [bookingNumber]);
        if (found) newBookingId = found.id;
      }

      // Create linked guest dining session
      const newSessionId = `SESSION-${targetTable.table_number}-${Date.now().toString().slice(-6)}`;
      await trx.execute(`
        INSERT INTO guest_sessions (
          session_id, restaurant_id, table_id, table_number, booking_id, customer_name, customer_phone, status
        ) VALUES (?, 1, ?, ?, ?, ?, ?, 'ACTIVE')
      `, [
        newSessionId,
        targetTable.id,
        targetTable.table_number,
        newBookingId,
        String(customer_name).trim(),
        String(customer_phone).trim(),
      ]);

      // If booking is today, update table status to RESERVED and link booking
      if (isToday) {
        await trx.execute(
          "UPDATE restaurant_tables SET status = 'RESERVED', current_booking_id = ?, current_session_id = ? WHERE id = ?",
          [newBookingId, newSessionId, targetTable.id]
        );
      }

      let booked = await trx.queryOne(`
        SELECT b.*, t.table_number, t.capacity, t.section
        FROM bookings b
        JOIN restaurant_tables t ON b.table_id = t.id
        WHERE b.id = ?
      `, [newBookingId]);

      if (!booked) {
        booked = await trx.queryOne("SELECT * FROM bookings WHERE id = ? OR booking_number = ?", [newBookingId, bookingNumber]);
      }

      if (booked) {
        booked.table_number = targetTable.table_number;
        booked.capacity = targetTable.capacity;
        booked.section = targetTable.section;
      }

      const tableState = await trx.queryOne(
        "SELECT * FROM restaurant_tables WHERE id = ?",
        [targetTable.id]
      );

      return { createdBooking: booked, updatedTable: tableState, sessionId: newSessionId };
    });

    // Real-time broadcast to all connected devices and browsers
    broadcast("TABLE_BOOKED", {
      tableId: updatedTable.id,
      tableNumber: updatedTable.table_number,
      bookingId: createdBooking.id,
      bookingNumber: createdBooking.booking_number,
      bookingDate: createdBooking.booking_date,
      bookingTime: createdBooking.start_time,
      startTime: createdBooking.start_time,
      endTime: createdBooking.end_time,
      checkoutTime: createdBooking.end_time,
      bookedTimeSlot: `${createdBooking.start_time} – ${createdBooking.end_time}`,
      mealType: createdBooking.meal_type || mealType,
      guestCount: createdBooking.guest_count,
      bookingStatus: createdBooking.status,
      customerName: createdBooking.customer_name,
      booking: createdBooking,
      table: updatedTable,
      sessionId,
    });
    broadcast("NEW_BOOKING", createdBooking);
    broadcast("TABLE_STATUS_UPDATED", updatedTable);

    res.status(201).json({
      success: true,
      message: `Table ${updatedTable.table_number} reserved successfully!`,
      booking: createdBooking,
      table: updatedTable,
      session_id: sessionId,
    });
  } catch (error) {
    // Database-level uniqueness collision protection (e.g. concurrent duplicate insert)
    const isConstraintViolation =
      (error.message && (
        error.message.includes("UNIQUE constraint failed") ||
        error.message.includes("idx_unique_active_booking") ||
        error.message.includes("duplicate key value")
      )) ||
      error.code === "23505" ||
      error.code === "SQLITE_CONSTRAINT";

    if (isConstraintViolation) {
      return res.status(409).json({
        success: false,
        message: "This table has already been booked for this slot. Please select another table.",
      });
    }

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
        conflictingBooking: error.conflictingBooking || null,
      });
    }

    console.error("Booking transaction error:", error);
    res.status(500).json({ success: false, message: "Failed to create booking", error: error.message });
  }
});

// 5. Update booking status (ADMIN ONLY)
router.put("/:id/status", verifyStaffAuth(["ADMIN"]), async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const { status } = req.body;

    const validStatuses = ["CONFIRMED", "CHECKED_IN", "CANCELLED", "COMPLETED", "NO_SHOW"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
    }

    const booking = await db.queryOne(
      "SELECT * FROM bookings WHERE id = ? OR booking_number = ?",
      [bookingId || 0, req.params.id]
    );
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    await db.execute("UPDATE bookings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
      status,
      booking.id,
    ]);

    if (status === "CHECKED_IN") {
      await db.execute("UPDATE restaurant_tables SET status = 'OCCUPIED', current_booking_id = ? WHERE id = ?", [
        booking.id,
        booking.table_id,
      ]);
    } else if (["CANCELLED", "COMPLETED", "NO_SHOW"].includes(status)) {
      await db.execute(`
        UPDATE restaurant_tables 
        SET status = CASE WHEN status = 'RESERVED' THEN 'AVAILABLE' ELSE status END,
            current_booking_id = CASE WHEN current_booking_id = ? THEN NULL ELSE current_booking_id END
        WHERE id = ?
      `, [booking.id, booking.table_id]);
    }

    const updatedBooking = await db.queryOne(`
      SELECT b.*, t.table_number, t.capacity, t.section
      FROM bookings b
      JOIN restaurant_tables t ON b.table_id = t.id
      WHERE b.id = ?
    `, [booking.id]);

    const updatedTable = await db.queryOne(
      "SELECT * FROM restaurant_tables WHERE id = ?",
      [booking.table_id]
    );

    broadcast("BOOKING_STATUS_UPDATED", updatedBooking);
    broadcast("TABLE_STATUS_UPDATED", updatedTable);

    res.json({
      message: `Booking status updated to ${status}`,
      booking: updatedBooking,
      table: updatedTable,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to update booking status", error: error.message });
  }
});

module.exports = router;
