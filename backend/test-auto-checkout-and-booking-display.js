const http = require("http");
const { app } = require("./server");
const db = require("./db/database");
const {
  timeToMinutes,
  calculateEndTime,
  hasTimeOverlap,
  checkAndReleaseExpiredBookings,
} = require("./utils/bookingManager");

async function runAutoCheckoutAndDisplayVerification() {
  console.log("========================================================================");
  console.log("🕵️ SENIOR QA ENGINEER — TABLE BOOKING DISPLAY & AUTO-CHECKOUT TEST SUITE");
  console.log("========================================================================");

  if (db.ensureInit) {
    await db.ensureInit();
  }

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`✓ Test Server active on port ${port}\n`);

  async function postJson(endpoint, data) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const text = await res.text();
    try {
      return { status: res.status, ok: res.ok, data: JSON.parse(text) };
    } catch {
      return { status: res.status, ok: res.ok, data: text };
    }
  }

  async function getJson(endpoint) {
    const res = await fetch(`${baseUrl}${endpoint}`);
    const text = await res.text();
    try {
      return { status: res.status, ok: res.ok, data: JSON.parse(text) };
    } catch {
      return { status: res.status, ok: res.ok, data: text };
    }
  }

  try {
    const testDate = "2038-06-15";
    await db.execute("DELETE FROM bookings WHERE booking_date = ?", [testDate]);

    // -------------------------------------------------------------
    // TEST 1: User Books Table T1 for a Specific Time Slot
    // -------------------------------------------------------------
    console.log("[TEST 1] Booking Table T1 for 07:30 PM (checkout 09:00 PM)...");
    const bookRes = await postJson("/api/bookings", {
      table_number: "T1",
      customer_name: "Rahul Dravid",
      customer_phone: "+91 91234 56789",
      customer_email: "rahul@cricket.org",
      booking_date: testDate,
      start_time: "07:30 PM",
      guest_count: 2,
      special_notes: "Quiet corner",
    });

    if (bookRes.status !== 201 || !bookRes.data.booking) {
      throw new Error(`Test 1 Failed: Status ${bookRes.status}, body: ${JSON.stringify(bookRes.data)}`);
    }

    const booking = bookRes.data.booking;
    console.log(`✓ Test 1 Passed: Booking created #${booking.booking_number} (${booking.start_time} to ${booking.end_time})`);

    if (booking.start_time !== "07:30 PM" || booking.end_time !== "09:00 PM") {
      throw new Error(`Test 1 Error: Expected 07:30 PM to 09:00 PM, got ${booking.start_time} – ${booking.end_time}`);
    }

    // -------------------------------------------------------------
    // TEST 2: Other Users See Table T1 as Booked for This Specific Time
    // -------------------------------------------------------------
    console.log("\n[TEST 2] Verifying other users see Table T1 as booked for this time...");
    const checkSameSlot = await getJson(`/api/restaurants/spicy-spoon/tables?date=${testDate}&time=07:30%20PM&guests=2`);
    if (checkSameSlot.status !== 200) {
      throw new Error(`Test 2 Failed: Status ${checkSameSlot.status}`);
    }

    const table1State = checkSameSlot.data.find((t) => t.table_number === "T1");
    if (!table1State) throw new Error("Table T1 not found in response");
    if (table1State.isAvailableForSlot !== false) {
      throw new Error(`Table T1 should be UNAVAILABLE for 07:30 PM, got available`);
    }
    if (table1State.slotStatus !== "RESERVED") {
      throw new Error(`Expected slotStatus RESERVED, got ${table1State.slotStatus}`);
    }
    if (!table1State.conflictReason || !table1State.conflictReason.includes("07:30 PM – 09:00 PM")) {
      throw new Error(`Expected conflictReason to include '07:30 PM – 09:00 PM', got: ${table1State.conflictReason}`);
    }
    if (!table1State.booked_time_slot || !table1State.booked_time_slot.includes("07:30 PM – 09:00 PM")) {
      throw new Error(`Expected booked_time_slot to include '07:30 PM – 09:00 PM', got: ${table1State.booked_time_slot}`);
    }
    console.log(`✓ Test 2 Passed: Other users see: "${table1State.conflictReason}" (Booked slot: ${table1State.booked_time_slot})`);

    // -------------------------------------------------------------
    // TEST 3: Overlapping Slot (08:30 PM) is Also Blocked
    // -------------------------------------------------------------
    console.log("\n[TEST 3] Verifying overlapping slot (08:30 PM) is also blocked...");
    const checkOverlap = await getJson(`/api/restaurants/spicy-spoon/tables?date=${testDate}&time=08:30%20PM&guests=2`);
    const table1Overlap = checkOverlap.data.find((t) => t.table_number === "T1");
    if (table1Overlap.isAvailableForSlot !== false) {
      throw new Error("Table T1 should be UNAVAILABLE for overlapping slot 08:30 PM");
    }
    console.log(`✓ Test 3 Passed: Overlapping slot correctly blocked: "${table1Overlap.conflictReason}"`);

    // -------------------------------------------------------------
    // TEST 4: Slot After Checkout Time (09:30 PM) is AVAILABLE
    // -------------------------------------------------------------
    console.log("\n[TEST 4] Verifying slot after checkout time (09:30 PM) is AVAILABLE...");
    const checkAfterCheckout = await getJson(`/api/restaurants/spicy-spoon/tables?date=${testDate}&time=09:30%20PM&guests=2`);
    const table1AfterCheckout = checkAfterCheckout.data.find((t) => t.table_number === "T1");
    if (table1AfterCheckout.isAvailableForSlot !== true) {
      throw new Error(`Table T1 should be AVAILABLE after checkout time (09:30 PM), got conflict: ${table1AfterCheckout.conflictReason}`);
    }
    console.log(`✓ Test 4 Passed: Table T1 is available for 09:30 PM (post-checkout slot)`);

    // -------------------------------------------------------------
    // TEST 5: Admin Sees Table Booked with Exact Time Slot
    // -------------------------------------------------------------
    console.log("\n[TEST 5] Verifying Admin /tables endpoint displays booked time...");
    const adminTables = await getJson(`/api/tables?date=${testDate}`);
    const adminT1 = adminTables.data.find((t) => t.table_number === "T1");
    if (!adminT1) throw new Error("Admin Table T1 not found");
    if (adminT1.booking_start !== "07:30 PM" || adminT1.booking_end !== "09:00 PM") {
      throw new Error(`Admin Table T1 does not have booking_start=07:30 PM, got: ${adminT1.booking_start} – ${adminT1.booking_end}`);
    }
    if (!adminT1.booked_time_slot || !adminT1.booked_time_slot.includes("07:30 PM – 09:00 PM")) {
      throw new Error(`Admin Table T1 booked_time_slot missing or wrong: ${adminT1.booked_time_slot}`);
    }
    console.log(`✓ Test 5 Passed: Admin sees Table T1 booked time: ${adminT1.booked_time_slot} (Checkout: ${adminT1.checkout_time})`);

    // -------------------------------------------------------------
    // TEST 6: Automatic Checkout Engine — Expired Booking Auto-Releases Table
    // -------------------------------------------------------------
    console.log("\n[TEST 6] Testing automatic checkout release when checkout time has passed...");
    const pastDate = "2020-01-01";
    await db.execute("DELETE FROM bookings WHERE booking_date = ?", [pastDate]);

    // Create a past booking on Table T4 and force table into RESERVED state
    const t4 = await db.queryOne("SELECT id FROM restaurant_tables WHERE table_number = 'T4'");
    const expiredBkNumber = `BK-EXP-${Date.now().toString().slice(-4)}`;
    const ins = await db.execute(`
      INSERT INTO bookings (
        booking_number, restaurant_id, table_id, customer_name, customer_phone,
        booking_date, start_time, end_time, meal_type, guest_count, status
      ) VALUES (?, 1, ?, 'Expired Guest', '+91 90000 00000', ?, '12:00 PM', '01:30 PM', 'LUNCH', 2, 'CONFIRMED')
    `, [expiredBkNumber, t4.id, pastDate]);

    const expiredBookingId = ins.lastInsertRowid;
    await db.execute(
      "UPDATE restaurant_tables SET status = 'RESERVED', current_booking_id = ? WHERE id = ?",
      [expiredBookingId, t4.id]
    );

    // Verify table T4 is currently RESERVED before checkout engine
    const preCheck = await db.queryOne("SELECT status, current_booking_id FROM restaurant_tables WHERE id = ?", [t4.id]);
    if (preCheck.status !== "RESERVED") {
      throw new Error(`Setup failed: Table T4 should be RESERVED, got ${preCheck.status}`);
    }
    console.log(`  Table T4 set to RESERVED with expired booking #${expiredBkNumber}`);

    // Run auto-checkout engine
    console.log("  Executing checkAndReleaseExpiredBookings()...");
    const releaseResult = await checkAndReleaseExpiredBookings();
    console.log(`  Auto-checkout processed: ${releaseResult.releasedCount} expired bookings released.`);

    // Verify in database: booking is now COMPLETED
    const updatedBk = await db.queryOne("SELECT status FROM bookings WHERE id = ?", [expiredBookingId]);
    if (updatedBk.status !== "COMPLETED") {
      throw new Error(`Booking should be COMPLETED, got: ${updatedBk.status}`);
    }

    // Verify in database: Table T4 is now AVAILABLE
    const postCheck = await db.queryOne("SELECT status, current_booking_id FROM restaurant_tables WHERE id = ?", [t4.id]);
    if (postCheck.status !== "AVAILABLE" || postCheck.current_booking_id !== null) {
      throw new Error(`Table T4 should be AVAILABLE with null current_booking_id, got status=${postCheck.status}, id=${postCheck.current_booking_id}`);
    }
    console.log("✓ Test 6 Passed: Expired booking automatically updated to COMPLETED and Table T4 automatically reverted to AVAILABLE!");

    // -------------------------------------------------------------
    // TEST 7: Auto-Checkout for Today's Expired Slot
    // -------------------------------------------------------------
    console.log("\n[TEST 7] Testing auto-checkout for today's earlier slot that passed checkout time...");
    const now = new Date();
    const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const todayBkNumber = `BK-TODAY-EXP-${Date.now().toString().slice(-4)}`;

    // Create booking for 05:00 AM – 06:30 AM today (which has already passed)
    const insToday = await db.execute(`
      INSERT INTO bookings (
        booking_number, restaurant_id, table_id, customer_name, customer_phone,
        booking_date, start_time, end_time, meal_type, guest_count, status
      ) VALUES (?, 1, ?, 'Early Morning Guest', '+91 90000 11111', ?, '05:00 AM', '06:30 AM', 'BREAKFAST', 2, 'CONFIRMED')
    `, [todayBkNumber, t4.id, todayLocal]);

    await db.execute(
      "UPDATE restaurant_tables SET status = 'RESERVED', current_booking_id = ? WHERE id = ?",
      [insToday.lastInsertRowid, t4.id]
    );

    // Call sync-checkout endpoint
    const syncRes = await postJson("/api/tables/sync-checkout", {});
    if (syncRes.status !== 200 || syncRes.data.success !== true) {
      throw new Error(`Sync checkout endpoint failed: ${JSON.stringify(syncRes.data)}`);
    }

    const t4TodayCheck = await db.queryOne("SELECT status, current_booking_id FROM restaurant_tables WHERE id = ?", [t4.id]);
    if (t4TodayCheck.status !== "AVAILABLE" || t4TodayCheck.current_booking_id !== null) {
      throw new Error(`Table T4 should be AVAILABLE after today's 06:30 AM checkout, got: ${t4TodayCheck.status}`);
    }
    console.log("✓ Test 7 Passed: Today's passed checkout slot automatically released Table T4 to AVAILABLE via /api/tables/sync-checkout");

    // Clean up
    await db.execute("DELETE FROM bookings WHERE booking_date IN (?, ?)", [testDate, pastDate]);
    await db.execute("DELETE FROM bookings WHERE booking_number = ?", [todayBkNumber]);

    console.log("\n========================================================================");
    console.log("🎉 ALL 7 SENIOR QA TABLE BOOKING & AUTO-CHECKOUT TESTS PASSED (100%)!");
    console.log("========================================================================");

    server.close();
    process.exit(0);
  } catch (err) {
    console.error("\n❌ TEST SUITE FAILED:", err);
    server.close();
    process.exit(1);
  }
}

runAutoCheckoutAndDisplayVerification();
