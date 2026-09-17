const http = require("http");
const { app } = require("./server");
const vercelHandler = require("../api/index");
const db = require("./db/database");

async function runSeniorQATests() {
  console.log("================================================================");
  console.log("🕵️ SENIOR QA ENGINEER — TABLE BOOKING COMPREHENSIVE VERIFICATION");
  console.log("================================================================");

  if (db.ensureInit) {
    await db.ensureInit();
  }

  // -------------------------------------------------------------
  // Test Setup: Start Real Local HTTP Server (Standard Express)
  // -------------------------------------------------------------
  const localServer = http.createServer(app);
  await new Promise((resolve) => localServer.listen(0, resolve));
  const localPort = localServer.address().port;
  const localBaseUrl = `http://localhost:${localPort}`;
  console.log(`✓ Local Express Server listening on port ${localPort}`);

  // -------------------------------------------------------------
  // Test Setup: Start Vercel Serverless Simulation Server
  // -------------------------------------------------------------
  const vercelServer = http.createServer((req, res) => {
    const originalUrl = req.url;
    req.headers["x-matched-path"] = originalUrl;
    req.url = "/api/index.js";
    vercelHandler(req, res);
  });
  await new Promise((resolve) => vercelServer.listen(0, resolve));
  const vercelPort = vercelServer.address().port;
  const vercelBaseUrl = `http://localhost:${vercelPort}`;
  console.log(`✓ Vercel Serverless Simulation listening on port ${vercelPort}`);

  async function postJson(baseUrl, endpoint, data, rawBody = null) {
    const bodyPayload = rawBody !== null ? rawBody : JSON.stringify(data);
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyPayload,
    });
    const text = await res.text();
    let json = {};
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = { rawText: text };
    }
    return { status: res.status, ok: res.ok, data: json };
  }

  async function getJson(baseUrl, endpoint) {
    const res = await fetch(`${baseUrl}${endpoint}`);
    const text = await res.text();
    let json = {};
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = { rawText: text };
    }
    return { status: res.status, ok: res.ok, data: json };
  }

  try {
    const testDate = "2037-01-20";
    await db.execute("DELETE FROM bookings WHERE booking_date = ?", [testDate]);

    // TEST 1: Standard Local Express POST /api/bookings
    console.log("\n[TEST 1] Local Express POST /api/bookings (Real streaming body)...");
    const test1 = await postJson(localBaseUrl, "/api/bookings", {
      table_number: "T1",
      customer_name: "Amitabh Bachchan",
      customer_phone: "+91 99999 88888",
      customer_email: "amitabh@bollywood.com",
      booking_date: testDate,
      start_time: "07:30 PM",
      guest_count: 2,
      special_notes: "VIP Anniversary Dinner",
    });

    if (test1.status !== 201 || !test1.data.booking) {
      throw new Error(`Test 1 Failed: Status ${test1.status}, body: ${JSON.stringify(test1.data)}`);
    }
    console.log(`✓ Test 1 Passed: Booking created #${test1.data.booking.booking_number} on Table T1 (ID: ${test1.data.booking.id})`);

    // TEST 2: Vercel Serverless Simulated POST /api/bookings
    console.log("\n[TEST 2] Vercel Serverless POST /api/bookings (Simulated rewrite)...");
    const test2 = await postJson(vercelBaseUrl, "/api/bookings", {
      table_number: "T2",
      customer_name: "Shah Rukh Khan",
      customer_phone: "+91 98888 77777",
      customer_email: "srk@redchillies.com",
      booking_date: testDate,
      start_time: "07:30 PM",
      guest_count: 2,
      special_notes: "Center table please",
    });

    if (test2.status !== 201 || !test2.data.booking) {
      throw new Error(`Test 2 Failed: Status ${test2.status}, body: ${JSON.stringify(test2.data)}`);
    }
    console.log(`✓ Test 2 Passed: Booking created #${test2.data.booking.booking_number} on Table T2 via Vercel handler`);

    // TEST 3: Database Persistence Verification
    console.log("\n[TEST 3] Verifying persistence in SQLite / Postgres database...");
    const dbRecordT1 = await db.queryOne("SELECT * FROM bookings WHERE booking_number = ?", [test1.data.booking.booking_number]);
    const dbRecordT2 = await db.queryOne("SELECT * FROM bookings WHERE booking_number = ?", [test2.data.booking.booking_number]);
    if (!dbRecordT1 || dbRecordT1.customer_name !== "Amitabh Bachchan") {
      throw new Error("Test 3 Failed: Table T1 booking missing from database!");
    }
    if (!dbRecordT2 || dbRecordT2.customer_name !== "Shah Rukh Khan") {
      throw new Error("Test 3 Failed: Table T2 booking missing from database!");
    }
    console.log(`✓ Test 3 Passed: Both records properly persisted in 'bookings' table.`);

    // TEST 4: Guest Session Creation
    console.log("\n[TEST 4] Verifying guest dining session creation...");
    const sessionT1 = await db.queryOne("SELECT * FROM guest_sessions WHERE booking_id = ?", [dbRecordT1.id]);
    if (!sessionT1 || sessionT1.status !== "ACTIVE") {
      throw new Error("Test 4 Failed: Guest dining session was not created for booking!");
    }
    console.log(`✓ Test 4 Passed: Guest session '${sessionT1.session_id}' created for Table ${sessionT1.table_number}.`);

    // TEST 5: Double-Booking Collision Guard
    console.log("\n[TEST 5] Testing double-booking collision prevention on Table T1...");
    const collisionTest = await postJson(localBaseUrl, "/api/bookings", {
      table_number: "T1",
      customer_name: "Conflicting Guest",
      customer_phone: "+91 90000 00000",
      customer_email: "conflict@example.com",
      booking_date: testDate,
      start_time: "07:30 PM",
      guest_count: 2,
    });
    if (collisionTest.status !== 409) {
      throw new Error(`Test 5 Failed: Expected 409 Conflict, got ${collisionTest.status}`);
    }
    console.log(`✓ Test 5 Passed: Double booking rejected with 409 Conflict: "${collisionTest.data.message}"`);

    // TEST 6: Table Capacity Exceeded
    console.log("\n[TEST 6] Testing party size exceeding table capacity...");
    const capacityTest = await postJson(localBaseUrl, "/api/bookings", {
      table_number: "T1", // Capacity is 2
      customer_name: "Big Family",
      customer_phone: "+91 91234 56789",
      booking_date: testDate,
      start_time: "08:30 AM",
      guest_count: 10,
    });
    if (capacityTest.status !== 400) {
      throw new Error(`Test 6 Failed: Expected 400 Bad Request for capacity overflow, got ${capacityTest.status}`);
    }
    console.log(`✓ Test 6 Passed: Capacity overflow rejected with 400: "${capacityTest.data.message}"`);

    // TEST 7: Aliased Fields Support (full_name, phone_number, party_size, reservation_time)
    console.log("\n[TEST 7] Testing aliased field names...");
    const aliasTest = await postJson(localBaseUrl, "/api/bookings", {
      table_number: "T3",
      full_name: "Priyanka Chopra",
      phone_number: "+91 97777 66666",
      email: "priyanka@global.com",
      reservation_date: testDate,
      reservation_time: "01:00 PM",
      party_size: 4,
      special_request: "Quiet corner",
    });
    if (aliasTest.status !== 201 || !aliasTest.data.booking) {
      throw new Error(`Test 7 Failed: Aliased fields rejected: Status ${aliasTest.status}, ${JSON.stringify(aliasTest.data)}`);
    }
    console.log(`✓ Test 7 Passed: Booking with aliased payload succeeded (#${aliasTest.data.booking.booking_number})`);

    // TEST 8: Time slot validation with client_mins
    console.log("\n[TEST 8] Testing timezone-safe slot validation for today...");
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const pastSlotTest = await postJson(localBaseUrl, "/api/bookings", {
      table_number: "T6",
      customer_name: "Late Comer",
      customer_phone: "+91 92222 33333",
      booking_date: today,
      start_time: "08:30 AM",
      client_mins: 23 * 60, // Client is at 11:00 PM
      guest_count: 2,
    });
    if (pastSlotTest.status !== 400 || !pastSlotTest.data.message.includes("already passed")) {
      throw new Error(`Test 8 Failed: Past slot for today was not rejected properly: ${JSON.stringify(pastSlotTest.data)}`);
    }
    console.log(`✓ Test 8 Passed: Past slot cleanly rejected with 400: "${pastSlotTest.data.message}"`);

    console.log("\n================================================================");
    console.log("🎉 ALL 8 SENIOR QA BACKEND & VERIFICATION TESTS PASSED (100%)!");
    console.log("================================================================");
  } finally {
    localServer.close();
    vercelServer.close();
  }
}

runSeniorQATests().catch((err) => {
  console.error("QA Test Suite Error:", err);
  process.exit(1);
});
