const http = require("http");
const vercelHandler = require("../api/index");
const db = require("./db/database");

async function testVercelProduction() {
  console.log("==================================================");
  console.log("🚀 Testing Vercel Production Booking & Serverless Simulation");
  console.log("==================================================");

  if (db.ensureInit) {
    await db.ensureInit();
  }

  // Simulate Vercel Serverless environment where req.url is rewritten to /api/index.js
  // and x-matched-path carries the incoming request path
  const server = http.createServer((req, res) => {
    const originalUrl = req.url;
    req.headers["x-matched-path"] = originalUrl;
    req.url = "/api/index.js"; // Exactly how Vercel rewrites incoming requests!
    vercelHandler(req, res);
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  console.log(`✓ Vercel Serverless Simulation active on port ${port}`);

  async function postJson(endpoint, data) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
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

  async function getJson(endpoint) {
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
    const testDate = "2036-08-15";
    await db.execute("DELETE FROM bookings WHERE booking_date = ?", [testDate]);

    // 1. Fetch tables via Vercel rewrite
    console.log("\n1. Fetching floor availability via simulated Vercel Serverless rewrite...");
    const tablesRes = await getJson(`/api/restaurants/spicy-spoon/tables?date=${testDate}&time=07:30%20PM&guests=2`);
    if (!tablesRes.ok || !Array.isArray(tablesRes.data) || tablesRes.data.length === 0) {
      throw new Error(`Failed to fetch tables via Vercel rewrite: ${JSON.stringify(tablesRes)}`);
    }
    console.log(`✓ Successfully retrieved ${tablesRes.data.length} tables through Vercel handler`);

    // 2. Normal Booking on Table T4
    console.log("\n2. Submitting Table T4 reservation via Vercel POST /api/bookings...");
    const bookT4 = await postJson("/api/bookings", {
      table_number: "T4",
      customer_name: "Rahul Dravid",
      customer_phone: "+91 98765 43210",
      customer_email: "rahul@example.com",
      booking_date: testDate,
      start_time: "07:30 PM",
      guest_count: 4,
      special_notes: "Window side if possible",
    });

    if (bookT4.status !== 201 || !bookT4.data.booking) {
      throw new Error(`Booking Table T4 failed: Status ${bookT4.status}, ${JSON.stringify(bookT4.data)}`);
    }
    console.log(`✓ Booking succeeded: #${bookT4.data.booking.booking_number} on Table T4 (Meal: ${bookT4.data.booking.meal_type})`);

    // 3. Verify Database Persistence
    console.log("\n3. Verifying database record persistence...");
    const dbBooking = await db.queryOne("SELECT * FROM bookings WHERE booking_number = ?", [bookT4.data.booking.booking_number]);
    if (!dbBooking || dbBooking.customer_name !== "Rahul Dravid") {
      throw new Error("Booking was NOT persisted in the database!");
    }
    console.log(`✓ Confirmed in Database: Booking ID ${dbBooking.id}, Customer: ${dbBooking.customer_name}, Table ID: ${dbBooking.table_id}`);

    // 4. Verify Immediate Table Unavailability for other users
    console.log("\n4. Verifying Table T4 is now marked UNAVAILABLE for 07:30 PM slot...");
    const checkAfterBook = await getJson(`/api/restaurants/spicy-spoon/tables?date=${testDate}&time=07:30%20PM&guests=2`);
    const table4After = checkAfterBook.data.find((t) => t.table_number === "T4");
    if (!table4After || table4After.isAvailableForSlot !== false) {
      throw new Error(`Table T4 should be unavailable but is: ${JSON.stringify(table4After)}`);
    }
    console.log(`✓ Table T4 availability updated: isAvailableForSlot = ${table4After.isAvailableForSlot}, Reason: ${table4After.conflictReason}`);

    // 5. Test Double Booking Protection (Concurrency Collision)
    console.log("\n5. Testing double booking collision rejection...");
    const duplicateBook = await postJson("/api/bookings", {
      table_number: "T4",
      customer_name: "Another Guest",
      customer_phone: "+91 91111 22222",
      customer_email: "another@example.com",
      booking_date: testDate,
      start_time: "07:30 PM",
      guest_count: 2,
    });
    if (duplicateBook.status !== 409) {
      throw new Error(`Expected 409 Conflict for double booking, got status ${duplicateBook.status}: ${JSON.stringify(duplicateBook.data)}`);
    }
    console.log(`✓ Double booking safely rejected with 409 Conflict: "${duplicateBook.data.message}"`);

    // 6. Test Breakfast / Lunch / Dinner Separation
    console.log("\n6. Testing meal slot separation on same table T5...");
    const bookBreakfast = await postJson("/api/bookings", {
      table_number: "T5",
      customer_name: "Morning Guest",
      customer_phone: "+91 90000 11111",
      booking_date: testDate,
      start_time: "08:30 AM",
      meal_type: "BREAKFAST",
      guest_count: 2,
    });
    if (bookBreakfast.status !== 201) {
      throw new Error(`Breakfast booking failed: ${JSON.stringify(bookBreakfast.data)}`);
    }
    console.log(`✓ Table T5 booked for Breakfast (#${bookBreakfast.data.booking.booking_number}, Meal: ${bookBreakfast.data.booking.meal_type})`);

    // Check that T5 is STILL AVAILABLE for Lunch on that day
    const checkLunch = await getJson(`/api/restaurants/spicy-spoon/tables?date=${testDate}&time=01:00%20PM&guests=2`);
    const t5Lunch = checkLunch.data.find((t) => t.table_number === "T5");
    if (!t5Lunch || t5Lunch.isAvailableForSlot !== true) {
      throw new Error("Breakfast booking incorrectly blocked Lunch slot on Table T5!");
    }
    console.log(`✓ Table T5 is AVAILABLE for Lunch (01:00 PM) despite Breakfast reservation!`);

    // Check that T5 is STILL AVAILABLE for Dinner on that day
    const checkDinner = await getJson(`/api/restaurants/spicy-spoon/tables?date=${testDate}&time=07:30%20PM&guests=2`);
    const t5Dinner = checkDinner.data.find((t) => t.table_number === "T5");
    if (!t5Dinner || t5Dinner.isAvailableForSlot !== true) {
      throw new Error("Breakfast booking incorrectly blocked Dinner slot on Table T5!");
    }
    console.log(`✓ Table T5 is AVAILABLE for Dinner (07:30 PM) despite Breakfast reservation!`);

    // 7. Verify Admin Dashboard Booking View
    console.log("\n7. Verifying Admin Dashboard bookings view...");
    const adminBookings = await getJson(`/api/bookings?date=${testDate}`);
    if (!adminBookings.ok || !Array.isArray(adminBookings.data)) {
      throw new Error(`Admin failed to fetch bookings: ${JSON.stringify(adminBookings)}`);
    }
    const foundT4 = adminBookings.data.find((b) => b.table_number === "T4");
    const foundT5 = adminBookings.data.find((b) => b.table_number === "T5");
    if (!foundT4 || !foundT5) {
      throw new Error("Admin bookings list is missing newly created bookings!");
    }
    console.log(`✓ Admin sees ${adminBookings.data.length} bookings for date ${testDate}, including Table T4 (${foundT4.customer_name}) and Table T5 (${foundT5.customer_name})`);

    console.log("\n==================================================");
    console.log("🎉 ALL VERCEL PRODUCTION SERVERLESS TESTS PASSED 100%!");
    console.log("==================================================");
  } finally {
    server.close();
  }
}

testVercelProduction().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
