const express = require("express");
const router = express.Router();
const db = require("../db/database");
const { broadcast } = require("../websocket");
const { verifyStaffAuth } = require("../middleware/auth");

function generateBookingNumber() {
  const randomNum = Math.floor(100000 + Math.random() * 900000);
  return `BK-${randomNum}`;
}

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

function calculateEndTime(startTimeStr) {
  const startMin = timeToMinutes(startTimeStr);
  const endMin = startMin + 90;
  const endH = Math.floor(endMin / 60) % 24;
  const endM = endMin % 60;
  const period = endH >= 12 ? "PM" : "AM";
  const displayH = endH % 12 === 0 ? 12 : endH % 12;
  return `${String(displayH).padStart(2, "0")}:${String(endM).padStart(2, "0")} ${period}`;
}

function determineMealType(timeStr) {
  const mins = timeToMinutes(timeStr);
  if (mins >= 360 && mins <= 690) return "BREAKFAST"; // 06:00 AM - 11:30 AM
  if (mins > 690 && mins < 1020) return "LUNCH";     // 11:31 AM - 04:59 PM
  return "DINNER";                                   // 05:00 PM onwards
}

function hasTimeOverlap(start1, end1, start2, end2) {
  const s1 = timeToMinutes(start1);
  const e1 = timeToMinutes(end1);
  const s2 = timeToMinutes(start2);
  const e2 = timeToMinutes(end2);
  return Math.max(s1, s2) < Math.min(e1, e2);
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

      if (guests && table.capacity < Number(guests)) {
        isAvailable = false;
        reason = `Capacity is ${table.capacity}, requested ${guests}`;
      }

      if (isAvailable) {
        const tableBookings = bookings.filter((b) => b.table_id === table.id);
        for (const bk of tableBookings) {
          if (hasTimeOverlap(time, calculatedEndTime, bk.start_time, bk.end_time)) {
            isAvailable = false;
            reason = `Booked from ${bk.start_time} to ${bk.end_time}`;
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
    const {
      table_id,
      table_number,
      customer_name,
      customer_phone,
      customer_email = "",
      booking_date,
      start_time,
      end_time,
      guest_count,
      special_notes = "",
    } = req.body;

    // Server-side input validation
    if (!customer_name || !String(customer_name).trim()) {
      return res.status(400).json({ success: false, message: "Customer name is required" });
    }
    if (!customer_phone || !String(customer_phone).trim()) {
      return res.status(400).json({ success: false, message: "Customer phone is required" });
    }
    if (!booking_date || !/^\d{4}-\d{2}-\d{2}$/.test(booking_date)) {
      return res.status(400).json({ success: false, message: "Valid booking date (YYYY-MM-DD) is required" });
    }
    if (!start_time || !timeToMinutes(start_time)) {
      return res.status(400).json({ success: false, message: "Valid start time is required" });
    }
    if (!guest_count || Number(guest_count) < 1) {
      return res.status(400).json({ success: false, message: "Guest count must be at least 1" });
    }

    const calculatedEndTime = end_time || calculateEndTime(start_time);
    const mealType = determineMealType(start_time);
    const searchTableKey = table_id || table_number;

    // Atomic Database Transaction
    const { createdBooking, updatedTable } = await db.transaction(async (trx) => {
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
          "SELECT * FROM restaurant_tables WHERE capacity >= ? ORDER BY capacity ASC, id ASC",
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
            `Sorry, Table ${targetTable.table_number} was just booked by another guest for ${eb.start_time} – ${eb.end_time}. Please select another table.`
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

      const newBookingId = insertResult.lastInsertRowid;

      // Link booking to table if date is today
      const todayStr = new Date().toISOString().split("T")[0];
      if (booking_date === todayStr) {
        await trx.execute(
          "UPDATE restaurant_tables SET status = 'RESERVED', current_booking_id = ? WHERE id = ?",
          [newBookingId, targetTable.id]
        );
      }

      const booked = await trx.queryOne(`
        SELECT b.*, t.table_number, t.capacity, t.section
        FROM bookings b
        JOIN restaurant_tables t ON b.table_id = t.id
        WHERE b.id = ?
      `, [newBookingId]);

      const tableState = await trx.queryOne(
        "SELECT * FROM restaurant_tables WHERE id = ?",
        [targetTable.id]
      );

      return { createdBooking: booked, updatedTable: tableState };
    });

    // Real-time broadcast to all connected devices and browsers
    broadcast("TABLE_BOOKED", {
      tableId: updatedTable.id,
      tableNumber: updatedTable.table_number,
      bookingId: createdBooking.id,
      bookingNumber: createdBooking.booking_number,
      bookingDate: createdBooking.booking_date,
      bookingTime: createdBooking.start_time,
      endTime: createdBooking.end_time,
      mealType: createdBooking.meal_type || mealType,
      guestCount: createdBooking.guest_count,
      bookingStatus: createdBooking.status,
      booking: createdBooking,
    });
    broadcast("NEW_BOOKING", createdBooking);
    broadcast("TABLE_STATUS_UPDATED", updatedTable);

    res.status(201).json({
      success: true,
      message: `Table ${updatedTable.table_number} reserved successfully!`,
      booking: createdBooking,
      table: updatedTable,
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
        SET status = 'AVAILABLE', current_booking_id = NULL
        WHERE id = ? AND current_booking_id = ?
      `, [booking.table_id, booking.id]);
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
