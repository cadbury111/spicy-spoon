const express = require("express");
const router = express.Router();
const db = require("../db/database");
const QRCode = require("qrcode");
const { broadcast } = require("../websocket");
const { verifyStaffAuth } = require("../middleware/auth");

// Helper to convert 12hr time format "07:30 PM" to minutes from midnight
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

// Check time overlap
function hasTimeOverlap(start1, end1, start2, end2) {
  const s1 = timeToMinutes(start1);
  const e1 = timeToMinutes(end1);
  const s2 = timeToMinutes(start2);
  const e2 = timeToMinutes(end2);
  return Math.max(s1, s2) < Math.min(e1, e2);
}

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

    const processedTables = tables.map((t) => {
      let isAvailableForSlot = true;
      let slotStatus = "AVAILABLE";
      let conflictReason = null;

      // Check capacity
      if (guests && t.capacity < Number(guests)) {
        isAvailableForSlot = false;
        conflictReason = `Capacity is ${t.capacity} (requires ${guests})`;
      }

      // Check time overlap on target date
      if (date && time && requestedEndTime) {
        const bookingsForTable = activeBookings.filter((bk) => bk.table_id === t.id);

        for (const bk of bookingsForTable) {
          if (hasTimeOverlap(time, requestedEndTime, bk.start_time, bk.end_time)) {
            isAvailableForSlot = false;
            slotStatus = "RESERVED";
            conflictReason = `Booked from ${bk.start_time} to ${bk.end_time} (${bk.customer_name})`;
            break;
          }
        }
      }

      return {
        ...t,
        slotStatus,
        isAvailableForSlot,
        conflictReason,
      };
    });

    res.json(processedTables);
  } catch (error) {
    console.error("Error fetching restaurant tables:", error);
    res.status(500).json({ message: "Failed to fetch tables", error: error.message });
  }
});

module.exports = router;
