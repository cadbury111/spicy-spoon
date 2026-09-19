const express = require("express");
const router = express.Router();
const db = require("../db/database");
const QRCode = require("qrcode");
const { broadcast } = require("../websocket");
const { verifyStaffAuth } = require("../middleware/auth");
const {
  timeToMinutes,
  calculateEndTime,
  hasTimeOverlap,
  getIndiaDateString,
  getIndiaCurrentMinutes,
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

// 1. Get Restaurant by slug or ID
router.get("/:slug", async (req, res) => {
  try {
    const slugOrId = req.params.slug;
    const restaurant = await db.queryOne(
      "SELECT * FROM restaurants WHERE slug = ? OR id = ?",
      [slugOrId, Number(slugOrId) || 0]
    );

    if (!restaurant) {
      return res.status(404).json({ message: "Restaurant not found" });
    }

    res.json(restaurant);
  } catch (error) {
    console.error("Error fetching restaurant:", error);
    res.status(500).json({ message: "Failed to fetch restaurant", error: error.message });
  }
});

// 2. Get Restaurant QR Code
router.get("/:slug/qr", async (req, res) => {
  try {
    const slugOrId = req.params.slug;
    const restaurant = await db.queryOne(
      "SELECT * FROM restaurants WHERE slug = ? OR id = ?",
      [slugOrId, Number(slugOrId) || 0]
    );

    if (!restaurant) {
      return res.status(404).json({ message: "Restaurant not found" });
    }

    const host = req.get("host") || "localhost:5173";
    const protocol = req.protocol === "https" || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const targetUrl = `${protocol}://${host}/#/restaurant/${restaurant.slug}`;

    const qrDataUrl = await QRCode.toDataURL(targetUrl, {
      width: 400,
      margin: 2,
      color: { dark: "#1b100a", light: "#ffffff" },
    });

    const qrSvg = await QRCode.toString(targetUrl, {
      type: "svg",
      margin: 2,
      color: { dark: "#1b100a", light: "#ffffff" },
    });

    res.json({
      restaurant,
      targetUrl,
      qrCodeDataUrl: qrDataUrl,
      qrCodeSvg: qrSvg,
      token: restaurant.qr_code_token,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to generate restaurant QR", error: error.message });
  }
});

// 3. Regenerate Restaurant QR token (ADMIN ONLY)
router.post("/:slug/qr/regenerate", verifyStaffAuth(["ADMIN"]), async (req, res) => {
  try {
    const slugOrId = req.params.slug;
    const newToken = `spicy-spoon-qr-${Date.now()}`;
    await db.execute(
      "UPDATE restaurants SET qr_code_token = ? WHERE slug = ? OR id = ?",
      [newToken, slugOrId, Number(slugOrId) || 0]
    );

    const restaurant = await db.queryOne(
      "SELECT * FROM restaurants WHERE slug = ? OR id = ?",
      [slugOrId, Number(slugOrId) || 0]
    );

    const host = req.get("host") || "localhost:5173";
    const protocol = req.protocol === "https" || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const targetUrl = `${protocol}://${host}/#/restaurant/${restaurant.slug}`;

    const qrDataUrl = await QRCode.toDataURL(targetUrl, { width: 400, margin: 2 });
    const qrSvg = await QRCode.toString(targetUrl, { type: "svg", margin: 2 });

    res.json({
      message: "QR Code regenerated successfully",
      token: newToken,
      targetUrl,
      qrCodeDataUrl: qrDataUrl,
      qrCodeSvg: qrSvg,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to regenerate QR code", error: error.message });
  }
});

// 4. Get Tables with Availability Filtering for Visual Booking Map
router.get("/:slug/tables", async (req, res) => {
  try {
    setNoCacheHeaders(res);
    await checkAndReleaseExpiredBookings();
    const { date, time, guests } = req.query;

    const tables = await db.query(`
      SELECT 
        t.*,
        b.booking_number,
        b.customer_name as booking_customer,
        b.start_time as booking_start,
        b.end_time as booking_end,
        b.guest_count as booking_guests,
        o.order_number,
        o.customer_name as order_customer,
        o.status as order_status,
        o.total as order_total
      FROM restaurant_tables t
      LEFT JOIN bookings b ON t.current_booking_id = b.id
      LEFT JOIN orders o ON t.current_order_id = o.id
      ORDER BY t.id ASC
    `);

    let requestedEndTime = null;
    if (time) {
      requestedEndTime = calculateEndTime(time);
    }

    // Query active bookings for the specified date
    let activeBookings = [];
    if (date) {
      activeBookings = await db.query(`
        SELECT * FROM bookings
        WHERE booking_date = ?
          AND status IN ('CONFIRMED', 'CHECKED_IN', 'PENDING')
      `, [date]);
    }

    const todayIst = getIndiaDateString();
    const currentMins = getIndiaCurrentMinutes();

    const processedTables = tables.map((t) => {
      let isAvailableForSlot = true;
      let slotStatus = "AVAILABLE";
      let conflictReason = null;
      let bookedStart = null;
      let bookedEnd = null;
      let bookedCustomer = null;

      // 1. Check capacity
      if (guests && t.capacity < Number(guests)) {
        isAvailableForSlot = false;
        conflictReason = `Capacity is ${t.capacity} (requires ${guests})`;
      }

      // 2. Check administrative overrides / non-available states
      if (t.status === "OUT_OF_SERVICE") {
        isAvailableForSlot = false;
        slotStatus = "OUT_OF_SERVICE";
        conflictReason = "Table is currently out of service";
      } else if (t.status === "RESERVED" && !t.current_booking_id) {
        // Table was manually marked RESERVED by Admin
        isAvailableForSlot = false;
        slotStatus = "RESERVED";
        conflictReason = "Reserved by restaurant management";
      } else if (date === todayIst && ["OCCUPIED", "ORDER_PLACED", "PAYMENT_PENDING"].includes(t.status)) {
        const slotStartMin = timeToMinutes(time);
        if (slotStartMin !== null && currentMins >= slotStartMin - 30 && currentMins <= slotStartMin + 90) {
          isAvailableForSlot = false;
          slotStatus = t.status === "PAYMENT_PENDING" ? "PAYMENT_PENDING" : "OCCUPIED";
          conflictReason = "Table is currently occupied";
        }
      }

      // 3. Check time overlap on target date from bookings database
      if (date && time && requestedEndTime) {
        const bookingsForTable = activeBookings.filter(
          (bk) => String(bk.table_id) === String(t.id) || (bk.table_number && t.table_number && String(bk.table_number) === String(t.table_number))
        );

        for (const bk of bookingsForTable) {
          if (hasTimeOverlap(time, requestedEndTime, bk.start_time, bk.end_time)) {
            isAvailableForSlot = false;
            slotStatus = "RESERVED";
            conflictReason = `Booked for this time: ${bk.start_time} – ${bk.end_time}`;
            bookedStart = bk.start_time;
            bookedEnd = bk.end_time;
            bookedCustomer = bk.customer_name;
            break;
          }
        }
      }

      const effectiveStatus = !isAvailableForSlot
        ? (slotStatus !== "AVAILABLE" ? slotStatus : "RESERVED")
        : (t.status === "AVAILABLE" ? "AVAILABLE" : t.status);

      return {
        ...t,
        tableNumber: t.table_number,
        table_number: t.table_number,
        seats: t.capacity,
        capacity: t.capacity,
        status: effectiveStatus,
        slotStatus,
        isAvailableForSlot,
        conflictReason,
        booked_start: bookedStart,
        booked_end: bookedEnd,
        checkout_time: bookedEnd,
        booked_time_slot: bookedStart && bookedEnd ? `${bookedStart} – ${bookedEnd}` : null,
        booked_customer: bookedCustomer,
      };
    });

    res.json(processedTables);
  } catch (error) {
    console.error("Error fetching restaurant tables:", error);
    res.status(500).json({ message: "Failed to fetch tables", error: error.message });
  }
});

module.exports = router;
