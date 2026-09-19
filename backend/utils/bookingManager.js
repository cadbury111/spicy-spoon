const db = require("../db/database");
const { broadcast } = require("../websocket");

/**
 * Converts 12-hour or 24-hour time string to minutes from midnight (0 - 1439).
 * E.g. "07:30 PM" -> 1170, "08:30 AM" -> 510, "19:30" -> 1170
 */
function timeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return null;
  const match12 = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = parseInt(match12[2], 10);
    const period = match12[3].toUpperCase();
    if (period === "PM" && hours !== 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }
  const match24 = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hours = parseInt(match24[1], 10);
    const minutes = parseInt(match24[2], 10);
    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      return hours * 60 + minutes;
    }
  }
  return null;
}

/**
 * Calculates end / checkout time based on start time and duration (default 90 mins).
 */
function calculateEndTime(startTimeStr, durationMins = 90) {
  const startMin = timeToMinutes(startTimeStr) ?? 0;
  const endMin = startMin + durationMins;
  const endH = Math.floor(endMin / 60) % 24;
  const endM = endMin % 60;
  const period = endH >= 12 ? "PM" : "AM";
  const displayH = endH % 12 === 0 ? 12 : endH % 12;
  return `${String(displayH).padStart(2, "0")}:${String(endM).padStart(2, "0")} ${period}`;
}

/**
 * Checks whether two time intervals overlap.
 */
function hasTimeOverlap(start1, end1, start2, end2) {
  const s1 = timeToMinutes(start1) ?? 0;
  const e1 = timeToMinutes(end1) ?? 0;
  const s2 = timeToMinutes(start2) ?? 0;
  const e2 = timeToMinutes(end2) ?? 0;
  return Math.max(s1, s2) < Math.min(e1, e2);
}

/**
 * Checks and automatically releases any bookings whose checkout time has elapsed.
 * 1. Checks reservations in CONFIRMED, CHECKED_IN, or PENDING.
 * 2. If booking date is in the past OR (booking is today AND current clock time >= end_time / checkout):
 *    - Updates booking status to 'COMPLETED'.
 *    - If associated table has no unpaid active dining orders, resets status to 'AVAILABLE'
 *      and clears current_booking_id.
 *    - Broadcasts real-time WebSocket events TABLE_STATUS_UPDATED and BOOKING_STATUS_UPDATED.
 */
async function checkAndReleaseExpiredBookings(customNow = null) {
  try {
    const now = customNow instanceof Date ? customNow : new Date();
    const todayUtc = now.toISOString().split("T")[0];
    const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const currentMins = now.getHours() * 60 + now.getMinutes();

    const activeBookings = await db.query(`
      SELECT b.*, t.table_number, t.status as table_current_status
      FROM bookings b
      LEFT JOIN restaurant_tables t ON b.table_id = t.id
      WHERE b.status IN ('CONFIRMED', 'CHECKED_IN', 'PENDING')
    `);

    if (!Array.isArray(activeBookings) || activeBookings.length === 0) {
      return { releasedCount: 0, releasedTables: [], releasedBookings: [] };
    }

    const releasedTables = [];
    const releasedBookings = [];

    for (const bk of activeBookings) {
      const isPastDate = bk.booking_date < todayUtc && bk.booking_date < todayLocal;
      let isPastCheckout = false;

      if (isPastDate) {
        isPastCheckout = true;
      } else if (bk.booking_date === todayUtc || bk.booking_date === todayLocal) {
        const endMins = timeToMinutes(bk.end_time);
        if (endMins !== null && currentMins >= endMins) {
          isPastCheckout = true;
        }
      }

      if (isPastCheckout) {
        // Mark booking as completed
        try {
          await db.execute(
            "UPDATE bookings SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [bk.id]
          );
        } catch (e) {
          await db.execute(
            "UPDATE bookings SET status = 'COMPLETED' WHERE id = ?",
            [bk.id]
          );
        }

        const updatedBooking = { ...bk, status: "COMPLETED" };
        releasedBookings.push(updatedBooking);

        // Check if table currently holds this booking
        const table = await db.queryOne(
          "SELECT * FROM restaurant_tables WHERE id = ?",
          [bk.table_id]
        );

        if (table) {
          // Check if table has an active dining order in progress
          const activeOrder = await db.queryOne(`
            SELECT * FROM orders
            WHERE table_id = ? AND status NOT IN ('COMPLETED', 'CANCELLED', 'PAID')
            ORDER BY id DESC LIMIT 1
          `, [table.id]);

          let nextStatus = "AVAILABLE";
          let shouldClearSession = true;

          if (activeOrder) {
            nextStatus = activeOrder.status === "ORDER_PLACED" ? "ORDER_PLACED" : "OCCUPIED";
            shouldClearSession = false;
          } else if (table.status === "PAYMENT_PENDING") {
            nextStatus = "PAYMENT_PENDING";
            shouldClearSession = false;
          }

          // If table was reserved for this booking or currently marked RESERVED / BOOKED, reset it
          const isAssignedToThisBooking =
            table.current_booking_id === bk.id ||
            table.status === "RESERVED" ||
            table.status === "BOOKED";

          if (isAssignedToThisBooking) {
            await db.execute(`
              UPDATE restaurant_tables
              SET status = ?,
                  current_booking_id = CASE WHEN current_booking_id = ? THEN NULL ELSE current_booking_id END,
                  current_session_id = CASE WHEN ? THEN NULL ELSE current_session_id END
              WHERE id = ?
            `, [nextStatus, bk.id, shouldClearSession ? 1 : 0, table.id]);

            const updatedTable = await db.queryOne(
              "SELECT * FROM restaurant_tables WHERE id = ?",
              [table.id]
            );

            releasedTables.push(updatedTable);
            broadcast("TABLE_STATUS_UPDATED", updatedTable);
          }
        }

        broadcast("BOOKING_STATUS_UPDATED", updatedBooking);
      }
    }

    return {
      releasedCount: releasedBookings.length,
      releasedTables,
      releasedBookings,
    };
  } catch (error) {
    console.error("Error in checkAndReleaseExpiredBookings:", error);
    return { releasedCount: 0, releasedTables: [], releasedBookings: [], error: error.message };
  }
}

module.exports = {
  timeToMinutes,
  calculateEndTime,
  hasTimeOverlap,
  checkAndReleaseExpiredBookings,
};
