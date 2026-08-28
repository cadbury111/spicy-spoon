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

function hasTimeOverlap(start1, end1, start2, end2) {
  const s1 = timeToMinutes(start1);
  const e1 = timeToMinutes(end1);
  const s2 = timeToMinutes(start2);
  const e2 = timeToMinutes(end2);
  return Math.max(s1, s2) < Math.min(e1, e2);
}

// Get all bookings with table details
router.get("/", (req, res) => {
  try {
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

    const bookings = db.prepare(queryStr).all(...params);
    res.json(bookings);
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).json({ message: "Failed to fetch bookings", error: error.message });
  }
});

// Check real-time availability for slot
router.get("/availability/check", (req, res) => {
  try {
    const { date, time, guests } = req.query;
    if (!date || !time) {
      return res.status(400).json({ message: "date and time are required" });
    }

    const startMin = timeToMinutes(time);
    const endMin = startMin + 90;
    const endH = Math.floor(endMin / 60) % 24;
    const endM = endMin % 60;
    const period = endH >= 12 ? "PM" : "AM";
    const displayH = endH % 12 === 0 ? 12 : endH % 12;
    const calculatedEndTime = `${String(displayH).padStart(2, "0")}:${String(endM).padStart(2, "0")} ${period}`;

    const tables = db.prepare("SELECT * FROM restaurant_tables ORDER BY id ASC").all();

    const results = tables.map((table) => {
      let isAvailable = true;
      let reason = null;

      if (guests && table.capacity < Number(guests)) {
        isAvailable = false;
        reason = `Capacity is ${table.capacity}, requested ${guests}`;
      }

      if (isAvailable) {
        const bookings = db.prepare(`
          SELECT * FROM bookings
          WHERE table_id = ?
            AND booking_date = ?
            AND status IN ('CONFIRMED', 'CHECKED_IN', 'PENDING')
        `).all(table.id, date);

        for (const bk of bookings) {
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

// Get single booking
router.get("/:id", (req, res) => {
  try {
    const booking = db.prepare(`
      SELECT 
        b.*,
        t.table_number,
        t.capacity as table_capacity,
        t.section as table_section
      FROM bookings b
      JOIN restaurant_tables t ON b.table_id = t.id
      WHERE b.id = ? OR b.booking_number = ?
    `).get(Number(req.params.id) || 0, req.params.id);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    res.json(booking);
  } catch (error) {
    res.status(500).json({ message: "Error fetching booking", error: error.message });
  }
});

// Create new booking with ATOMIC SQLite Concurrency & Double-Booking Protection
router.post("/", (req, res) => {
  let transactionActive = false;
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

    if (!customer_name || !customer_phone || !booking_date || !start_time || !guest_count) {
      return res.status(400).json({
        message: "Missing required fields (customer_name, customer_phone, booking_date, start_time, guest_count)",
      });
    }

    // Calculate default end time if missing (90 mins)
    let calculatedEndTime = end_time;
    if (!calculatedEndTime) {
      const startMin = timeToMinutes(start_time);
      const endMin = startMin + 90;
      const endH = Math.floor(endMin / 60) % 24;
      const endM = endMin % 60;
      const period = endH >= 12 ? "PM" : "AM";
      const displayH = endH % 12 === 0 ? 12 : endH % 12;
      calculatedEndTime = `${String(displayH).padStart(2, "0")}:${String(endM).padStart(2, "0")} ${period}`;
    }

    // 1. BEGIN IMMEDIATE ATOMIC TRANSACTION
    db.exec("BEGIN IMMEDIATE;");
    transactionActive = true;

    let targetTable;
    const searchTableKey = table_id || table_number;

    if (searchTableKey) {
      targetTable = db.prepare("SELECT * FROM restaurant_tables WHERE id = ? OR table_number = ?").get(
        Number(searchTableKey) || 0,
        String(searchTableKey)
      );

      if (!targetTable) {
        db.exec("ROLLBACK;");
        transactionActive = false;
        return res.status(404).json({ message: `Selected table ${searchTableKey} does not exist.` });
      }

      // Capacity verification
      if (targetTable.capacity < Number(guest_count)) {
        db.exec("ROLLBACK;");
        transactionActive = false;
        return res.status(400).json({
          message: `Selected Table ${targetTable.table_number} has a capacity of ${targetTable.capacity} guests (you requested ${guest_count}). Please select a larger table.`,
        });
      }
    } else {
      // Auto-assign table that fits capacity and has no overlap
      const candidates = db.prepare(`
        SELECT * FROM restaurant_tables
        WHERE capacity >= ?
        ORDER BY capacity ASC, id ASC
      `).all(Number(guest_count));

      for (const cand of candidates) {
        const overlaps = db.prepare(`
          SELECT * FROM bookings
          WHERE table_id = ?
            AND booking_date = ?
            AND status IN ('CONFIRMED', 'CHECKED_IN', 'PENDING')
        `).all(cand.id, booking_date);

        let conflict = false;
        for (const eb of overlaps) {
          if (hasTimeOverlap(start_time, calculatedEndTime, eb.start_time, eb.end_time)) {
            conflict = true;
            break;
          }
        }

        if (!conflict) {
          targetTable = cand;
          break;
        }
      }

      if (!targetTable) {
        db.exec("ROLLBACK;");
        transactionActive = false;
        return res.status(409).json({
          message: "No tables available for the selected date, time, and guest count. Please choose another time slot.",
        });
      }
    }

    // 2. Strict Overlap Check within the transaction
    const existingBookings = db.prepare(`
      SELECT * FROM bookings
      WHERE table_id = ?
        AND booking_date = ?
        AND status IN ('CONFIRMED', 'CHECKED_IN', 'PENDING')
    `).all(targetTable.id, booking_date);

    for (const eb of existingBookings) {
      if (hasTimeOverlap(start_time, calculatedEndTime, eb.start_time, eb.end_time)) {
        db.exec("ROLLBACK;");
        transactionActive = false;
        return res.status(409).json({
          message: `Sorry, Table ${targetTable.table_number} was just booked by another guest for ${eb.start_time} – ${eb.end_time}. Please select another table.`,
          conflictingBooking: eb,
        });
      }
    }

    // 3. Insert Booking
    const bookingNumber = generateBookingNumber();
    const insertBooking = db.prepare(`
      INSERT INTO bookings (
        booking_number, restaurant_id, table_id, customer_name, customer_phone, customer_email,
        booking_date, start_time, end_time, guest_count, status, special_notes
      )
      VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?)
    `);

    const result = insertBooking.run(
      bookingNumber,
      targetTable.id,
      customer_name.trim(),
      customer_phone.trim(),
      customer_email.trim(),
      booking_date,
      start_time,
      calculatedEndTime,
      Number(guest_count),
      special_notes
    );

    const newBookingId = result.lastInsertRowid;

    // Link booking to table if date is today
    const todayStr = new Date().toISOString().split("T")[0];
    if (booking_date === todayStr) {
      db.prepare(`
        UPDATE restaurant_tables
        SET status = 'RESERVED', current_booking_id = ?
        WHERE id = ?
      `).run(newBookingId, targetTable.id);
    }

    // 4. COMMIT TRANSACTION
    db.exec("COMMIT;");
    transactionActive = false;

    const createdBooking = db.prepare(`
      SELECT b.*, t.table_number, t.capacity, t.section
      FROM bookings b
      JOIN restaurant_tables t ON b.table_id = t.id
      WHERE b.id = ?
    `).get(newBookingId);

    const updatedTable = db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(targetTable.id);

    broadcast("TABLE_BOOKED", {
      tableId: targetTable.id,
      tableNumber: targetTable.table_number,
      bookingId: createdBooking.id,
      bookingNumber: createdBooking.booking_number,
      bookingDate: createdBooking.booking_date,
      bookingTime: createdBooking.start_time,
      endTime: createdBooking.end_time,
      guestCount: createdBooking.guest_count,
      bookingStatus: createdBooking.status,
      booking: createdBooking,
    });
    broadcast("NEW_BOOKING", createdBooking);
    broadcast("TABLE_STATUS_UPDATED", updatedTable);

    res.status(201).json({
      message: `Table ${targetTable.table_number} reserved successfully!`,
      booking: createdBooking,
      table: updatedTable,
    });
  } catch (error) {
    if (transactionActive) {
      try {
        db.exec("ROLLBACK;");
      } catch (e) {}
    }
    console.error("Booking transaction error:", error);
    res.status(500).json({ message: "Failed to create booking", error: error.message });
  }
});

// Update booking status (ADMIN ONLY)
router.put("/:id/status", verifyStaffAuth(["ADMIN"]), (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const { status } = req.body;

    const validStatuses = ["CONFIRMED", "CHECKED_IN", "CANCELLED", "COMPLETED", "NO_SHOW"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
    }

    const booking = db.prepare("SELECT * FROM bookings WHERE id = ? OR booking_number = ?").get(
      bookingId || 0,
      req.params.id
    );
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    db.prepare("UPDATE bookings SET status = ? WHERE id = ?").run(status, booking.id);

    if (status === "CHECKED_IN") {
      db.prepare("UPDATE restaurant_tables SET status = 'OCCUPIED', current_booking_id = ? WHERE id = ?").run(
        booking.id,
        booking.table_id
      );
    } else if (["CANCELLED", "COMPLETED", "NO_SHOW"].includes(status)) {
      db.prepare(`
        UPDATE restaurant_tables 
        SET status = 'AVAILABLE', current_booking_id = NULL
        WHERE id = ? AND current_booking_id = ?
      `).run(booking.table_id, booking.id);
    }

    const updatedBooking = db.prepare(`
      SELECT b.*, t.table_number, t.capacity, t.section
      FROM bookings b
      JOIN restaurant_tables t ON b.table_id = t.id
      WHERE b.id = ?
    `).get(booking.id);

    const updatedTable = db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(booking.table_id);

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
