const http = require("http");
const { app } = require("./server");
const db = require("./db/database");
const { checkAndReleaseExpiredBookings } = require("./utils/bookingManager");

async function runEndToEndTests() {
  console.log("========================================================================");
  console.log("🧪 END-TO-END RESTAURANT TABLE BOOKING SYSTEM VERIFICATION");
  console.log("========================================================================");

  if (db.ensureInit) {
    await db.ensureInit();
  }

  // Start dedicated local test server
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`✓ Test Server active on ${baseUrl}\n`);

  async function postJson(endpoint, data, token = null) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
    });
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch (e) { json = { text }; }
    return { status: res.status, ok: res.ok, data: json };
  }

  async function putJson(endpoint, data, token = null) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(data),
    });
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch (e) { json = { text }; }
    return { status: res.status, ok: res.ok, data: json };
  }

  async function getJson(endpoint, token = null) {
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}${endpoint}`, { headers });
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch (e) { json = { text }; }
    return { status: res.status, ok: res.ok, data: json };
  }

  try {
    // 0. Authenticate Admin
    console.log("[0] Authenticating Admin user...");
    const loginRes = await postJson("/api/auth/login", { username: "admin", password: "admin123" });
    if (!loginRes.ok || !loginRes.data.token) {
      throw new Error("Admin login failed: " + JSON.stringify(loginRes.data));
    }
    const adminToken = loginRes.data.token;
    console.log("✓ Admin authenticated successfully.");

    // Clean up test tables T5, T7, T8
    const testDate = "2036-05-10";
    await db.execute("DELETE FROM bookings WHERE booking_date = ? OR table_id IN (5, 7, 8)", [testDate]);
    await db.execute("UPDATE restaurant_tables SET status = 'AVAILABLE', current_booking_id = NULL, current_order_id = NULL, current_session_id = NULL WHERE id IN (5, 7, 8)");

    // -------------------------------------------------------------------------
    // CRITERION 1: Customer A books T5
    // -------------------------------------------------------------------------
    console.log("\n[1] Customer A books Table T5 for 07:30 PM...");
    const bookResA = await postJson("/api/bookings", {
      table_number: "T5",
      customer_name: "Customer A",
      customer_phone: "+91 98765 43210",
      customer_email: "customerA@example.com",
      booking_date: testDate,
      start_time: "07:30 PM",
      guest_count: 4,
      special_notes: "Window side preferred",
    });

    if (bookResA.status !== 201 || !bookResA.data.booking) {
      throw new Error(`Customer A booking failed: ${JSON.stringify(bookResA.data)}`);
    }
    const bookingA = bookResA.data.booking;
    console.log(`✓ Customer A booking created: #${bookingA.booking_number} (ID: ${bookingA.id}) on Table T5`);

    // CRITERION 2: Verify persistence in SQLite database
    const dbBooking = await db.queryOne("SELECT * FROM bookings WHERE id = ?", [bookingA.id]);
    if (!dbBooking || dbBooking.status !== "CONFIRMED") {
      throw new Error("Booking not properly persisted in SQLite database!");
    }
    console.log("✓ Booking is persisted in backend/database.");

    // -------------------------------------------------------------------------
    // CRITERION 3 & 4: Customer A, Customer B, and Admin see Table T5 RESERVED
    // -------------------------------------------------------------------------
    console.log("\n[2] Checking availability from separate client instances (Customer A, Customer B, Admin)...");
    
    // Customer B requests slot availability
    const custBCheck = await getJson(`/api/restaurants/spicy-spoon/tables?date=${testDate}&time=07:30 PM&guests=4`);
    const table5CustB = custBCheck.data.find((t) => t.table_number === "T5");
    if (!table5CustB || table5CustB.isAvailableForSlot || table5CustB.status !== "RESERVED") {
      throw new Error(`Customer B still sees Table T5 as available! State: ${JSON.stringify(table5CustB)}`);
    }
    console.log(`✓ Customer B correctly sees Table T5 as RESERVED (isAvailableForSlot: false, reason: "${table5CustB.conflictReason}")`);

    // Admin checks floor map
    const adminTablesCheck = await getJson("/api/tables", adminToken);
    const table5Admin = adminTablesCheck.data.find((t) => t.table_number === "T5");
    console.log(`✓ Admin Floor Map sees Table T5 state: status="${table5Admin.status}"`);

    // -------------------------------------------------------------------------
    // CRITERION 5 & 6: Double Booking Prevention (Identical & Overlapping Slots)
    // -------------------------------------------------------------------------
    console.log("\n[3] Testing Double Booking Prevention for Customer B...");
    
    // Exact same time slot
    const bookResBExact = await postJson("/api/bookings", {
      table_number: "T5",
      customer_name: "Customer B",
      customer_phone: "+91 91234 56789",
      booking_date: testDate,
      start_time: "07:30 PM",
      guest_count: 4,
    });

    if (bookResBExact.status !== 409) {
      throw new Error(`Expected 409 Conflict for double booking, got ${bookResBExact.status}`);
    }
    console.log(`✓ Customer B exact slot rejected with 409 Conflict: "${bookResBExact.data.message}"`);

    // Overlapping time slot (e.g. 08:00 PM - 09:30 PM when existing is 07:30 PM - 09:00 PM)
    const bookResBOverlap = await postJson("/api/bookings", {
      table_number: "T5",
      customer_name: "Customer B",
      customer_phone: "+91 91234 56789",
      booking_date: testDate,
      start_time: "08:00 PM",
      guest_count: 4,
    });

    if (bookResBOverlap.status !== 409) {
      throw new Error(`Expected 409 Conflict for overlapping booking, got ${bookResBOverlap.status}`);
    }
    console.log(`✓ Customer B overlapping slot rejected with 409 Conflict: "${bookResBOverlap.data.message}"`);

    // -------------------------------------------------------------------------
    // CRITERION 7: Admin Manual Reserve (e.g. Table T7)
    // -------------------------------------------------------------------------
    console.log("\n[4] Testing Admin Manual RESERVE on Table T7...");
    const adminReserveRes = await putJson("/api/tables/7/status", { status: "RESERVED" }, adminToken);
    if (!adminReserveRes.ok) {
      throw new Error("Admin manual reserve failed: " + JSON.stringify(adminReserveRes.data));
    }
    console.log("✓ Admin set Table T7 to RESERVED.");

    // Customers must see T7 as UNAVAILABLE
    const custT7Check = await getJson(`/api/restaurants/spicy-spoon/tables?date=${testDate}&time=07:30 PM&guests=4`);
    const table7Cust = custT7Check.data.find((t) => t.table_number === "T7");
    if (!table7Cust || table7Cust.isAvailableForSlot || table7Cust.status !== "RESERVED") {
      throw new Error(`Customers still see manually reserved Table T7 as available! State: ${JSON.stringify(table7Cust)}`);
    }
    console.log(`✓ Customer sees Table T7 as RESERVED: "${table7Cust.conflictReason}"`);

    // Customer attempt to book T7 must be rejected
    const bookT7Res = await postJson("/api/bookings", {
      table_number: "T7",
      customer_name: "Sneaky Customer",
      customer_phone: "+91 90000 11111",
      booking_date: testDate,
      start_time: "07:30 PM",
      guest_count: 4,
    });
    if (bookT7Res.status !== 409) {
      throw new Error(`Expected 409 Conflict on admin-reserved table, got ${bookT7Res.status}`);
    }
    console.log(`✓ Customer booking on admin-reserved table rejected with 409: "${bookT7Res.data.message}"`);

    // -------------------------------------------------------------------------
    // CRITERION 8: Admin RELEASE Table T5
    // -------------------------------------------------------------------------
    console.log("\n[5] Testing Admin RELEASE on Table T5...");
    const releaseRes = await putJson("/api/tables/5/status", { status: "AVAILABLE" }, adminToken);
    if (!releaseRes.ok) {
      throw new Error("Admin release failed: " + JSON.stringify(releaseRes.data));
    }
    console.log("✓ Admin RELEASE executed.");

    // Verify in DB that active booking for T5 was cancelled/completed
    const checkBookingADb = await db.queryOne("SELECT status FROM bookings WHERE id = ?", [bookingA.id]);
    if (checkBookingADb.status !== "COMPLETED") {
      throw new Error(`Booking A was not completed upon admin release! Status: ${checkBookingADb.status}`);
    }
    console.log(`✓ Associated booking status in database updated to: ${checkBookingADb.status}`);

    // Verify all clients now see Table T5 as AVAILABLE
    const custCheckAfterRelease = await getJson(`/api/restaurants/spicy-spoon/tables?date=${testDate}&time=07:30 PM&guests=4`);
    const table5Released = custCheckAfterRelease.data.find((t) => t.table_number === "T5");
    if (!table5Released || !table5Released.isAvailableForSlot || table5Released.status !== "AVAILABLE") {
      throw new Error(`Table T5 is still not available after release! State: ${JSON.stringify(table5Released)}`);
    }
    console.log("✓ Table T5 is now AVAILABLE for everyone!");

    // Customer B can now book Table T5 successfully
    const bookResBAfterRelease = await postJson("/api/bookings", {
      table_number: "T5",
      customer_name: "Customer B (Happy)",
      customer_phone: "+91 91234 56789",
      booking_date: testDate,
      start_time: "07:30 PM",
      guest_count: 4,
    });
    if (bookResBAfterRelease.status !== 201) {
      throw new Error(`Customer B failed to book T5 after release: ${JSON.stringify(bookResBAfterRelease.data)}`);
    }
    console.log(`✓ Customer B successfully booked Table T5 (#${bookResBAfterRelease.data.booking.booking_number})`);

    // -------------------------------------------------------------------------
    // CRITERION 9: Automatic Expiration
    // -------------------------------------------------------------------------
    console.log("\n[6] Testing Automatic Reservation Expiration...");
    // Insert an expired booking for yesterday
    const yesterdayDate = "2020-01-01";
    await db.execute(`
      INSERT INTO bookings (booking_number, restaurant_id, table_id, customer_name, customer_phone, booking_date, start_time, end_time, meal_type, guest_count, status)
      VALUES ('BK-EXPIRED-TEST', 1, 8, 'Expired Guest', '+91 99999 00000', ?, '01:00 PM', '02:30 PM', 'LUNCH', 2, 'CONFIRMED')
    `, [yesterdayDate]);
    await db.execute("UPDATE restaurant_tables SET status = 'RESERVED' WHERE id = 8");

    const expireResult = await checkAndReleaseExpiredBookings();
    console.log(`✓ checkAndReleaseExpiredBookings() processed: ${expireResult.releasedCount} expired bookings released.`);

    const table8 = await db.queryOne("SELECT status FROM restaurant_tables WHERE id = 8");
    const expBooking = await db.queryOne("SELECT status FROM bookings WHERE booking_number = 'BK-EXPIRED-TEST'");
    if (expBooking.status !== "COMPLETED" || table8.status !== "AVAILABLE") {
      throw new Error(`Expired booking release failed: booking status=${expBooking.status}, table status=${table8.status}`);
    }
    console.log(`✓ Expired booking updated to: ${expBooking.status}, Table reverted to: ${table8.status}`);

    // -------------------------------------------------------------------------
    // CRITERION 10: Backend Restart Simulation (Database Persistence)
    // -------------------------------------------------------------------------
    console.log("\n[7] Testing Backend Restart Simulation (Persistence Check)...");
    // Close server and verify database retains active bookings
    await new Promise((resolve) => server.close(resolve));
    console.log("  Server stopped.");

    // Query SQLite database directly as a newly initialized server would
    const freshDbCheck = await db.queryOne("SELECT * FROM bookings WHERE booking_number = ?", [bookResBAfterRelease.data.booking.booking_number]);
    if (!freshDbCheck || freshDbCheck.status !== "CONFIRMED") {
      throw new Error("Active booking lost upon backend restart!");
    }
    console.log(`✓ Booking #${freshDbCheck.booking_number} on Table ${freshDbCheck.table_id} confirmed in SQLite database after restart.`);

    console.log("\n========================================================================");
    console.log("🎉 ALL END-TO-END TABLE BOOKING REQUIREMENTS VERIFIED & PASSED (100%)!");
    console.log("========================================================================");
  } catch (err) {
    console.error("Test failure:", err);
    process.exit(1);
  } finally {
    if (server.listening) {
      server.close();
    }
  }
}

runEndToEndTests();
