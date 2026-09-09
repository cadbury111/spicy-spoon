const http = require("http");
const { app, server } = require("./server");
const db = require("./db/database");

async function runBookingSyncTests() {
  console.log("==================================================");
  console.log("🧪 Running Table Booking Synchronization & Concurrency Test Suite");
  console.log("==================================================");

  const baseUrl = "http://localhost:5000";

  function req(endpoint, method = "GET", body = null, token = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, baseUrl);
      const headers = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers,
      };

      const request = http.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ status: res.statusCode, headers: res.headers, data: parsed });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, data });
          }
        });
      });

      request.on("error", reject);
      if (body) {
        request.write(JSON.stringify(body));
      }
      request.end();
    });
  }

  try {
    if (db.initPromise) {
      await db.initPromise;
    }

    const testYear = 2035;
    const testMonth = String(Math.floor(1 + Math.random() * 12)).padStart(2, "0");
    const testDay = String(Math.floor(1 + Math.random() * 25)).padStart(2, "0");
    const dateA = `${testYear}-${testMonth}-${testDay}`;
    const dateB = `${testYear}-${testMonth}-${String(Number(testDay) + 1).padStart(2, "0")}`;

    console.log(`Test Date A: ${dateA}`);
    console.log(`Test Date B: ${dateB}\n`);

    // -------------------------------------------------------------
    // TEST 1 & 2: Two Browsers / Two Devices Synchronization
    // -------------------------------------------------------------
    console.log("Test 1 & 2 — Two Browsers / Two Devices Sync:");
    console.log("Browser A books Table T1 for 07:30 PM on Date A...");
    const bookT1 = await req("/api/bookings", "POST", {
      table_number: "T1",
      customer_name: "Browser A User",
      customer_phone: "+91 98765 00001",
      customer_email: "userA@example.com",
      booking_date: dateA,
      start_time: "07:30 PM",
      guest_count: 2,
    });

    if (bookT1.status !== 201) {
      throw new Error(`Browser A booking failed: ${JSON.stringify(bookT1.data)}`);
    }
    console.log(`✓ Browser A booking succeeded: Booking #${bookT1.data.booking.booking_number} on Table T1`);

    console.log("Browser B (separate client instance) fetches floor availability for Date A at 07:30 PM...");
    const browserBCheck = await req(`/api/restaurants/spicy-spoon/tables?date=${dateA}&time=07:30%20PM&guests=2`);
    if (browserBCheck.status !== 200) {
      throw new Error(`Browser B failed to fetch tables: ${browserBCheck.status}`);
    }

    const table1State = browserBCheck.data.find((t) => t.table_number === "T1");
    if (!table1State || table1State.isAvailableForSlot !== false) {
      throw new Error(`Synchronization failure! Table T1 appears available to Browser B when it was booked by Browser A. State: ${JSON.stringify(table1State)}`);
    }
    console.log(`✓ Synchronized! Browser B sees Table T1 as UNAVAILABLE (${table1State.slotStatus}): ${table1State.conflictReason}`);

    // -------------------------------------------------------------
    // TEST 3: Simultaneous Booking Race Condition Protection
    // -------------------------------------------------------------
    console.log("\nTest 3 — Simultaneous Concurrent Bookings Collision Defense:");
    console.log("User A and User B concurrently submit booking requests for Table T2 at 07:30 PM on Date A...");

    const payloadUserA = {
      table_number: "T2",
      customer_name: "Simultaneous User A",
      customer_phone: "+91 98765 11111",
      booking_date: dateA,
      start_time: "07:30 PM",
      guest_count: 2,
    };

    const payloadUserB = {
      table_number: "T2",
      customer_name: "Simultaneous User B",
      customer_phone: "+91 98765 22222",
      booking_date: dateA,
      start_time: "07:30 PM",
      guest_count: 2,
    };

    const [resA, resB] = await Promise.all([
      req("/api/bookings", "POST", payloadUserA),
      req("/api/bookings", "POST", payloadUserB),
    ]);

    const statuses = [resA.status, resB.status];
    const successCount = statuses.filter((s) => s === 201).length;
    const conflictCount = statuses.filter((s) => s === 409).length;

    console.log(`Concurrent request responses: Statuses = [User A: ${resA.status}, User B: ${resB.status}]`);

    if (successCount !== 1 || conflictCount !== 1) {
      throw new Error(`Concurrency violation! Expected exactly 1 success (201) and 1 conflict (409), but got ${successCount} successes and ${conflictCount} conflicts.`);
    }

    // Verify only ONE database record exists
    const t2BookingsInDb = await db.query(
      "SELECT * FROM bookings WHERE table_id = (SELECT id FROM restaurant_tables WHERE table_number = 'T2') AND booking_date = ? AND status IN ('CONFIRMED', 'CHECKED_IN', 'PENDING')",
      [dateA]
    );

    if (t2BookingsInDb.length !== 1) {
      throw new Error(`Double booking occurred in database! Found ${t2BookingsInDb.length} rows for Table T2 on ${dateA}.`);
    }
    console.log("✓ Concurrency protection verified! Exactly ONE request succeeded, the other was rejected with 409 Conflict, and exactly ONE record exists in the database.");

    // -------------------------------------------------------------
    // TEST 4: Separate Meals (Breakfast vs Lunch vs Dinner)
    // -------------------------------------------------------------
    console.log("\nTest 4 — Different Meals (Breakfast vs Lunch vs Dinner):");
    console.log("Booking Table T3 for Breakfast (08:30 AM) on Date A...");
    const bookBreakfast = await req("/api/bookings", "POST", {
      table_number: "T3",
      customer_name: "Morning Diner",
      customer_phone: "+91 98765 33333",
      booking_date: dateA,
      start_time: "08:30 AM",
      guest_count: 4,
    });

    if (bookBreakfast.status !== 201) {
      throw new Error(`Breakfast booking failed: ${JSON.stringify(bookBreakfast.data)}`);
    }
    console.log(`✓ Table T3 booked for Breakfast (#${bookBreakfast.data.booking.booking_number}, Meal: ${bookBreakfast.data.booking.meal_type})`);

    // Check Table T3 for Lunch (12:00 PM) on same Date A -> MUST BE AVAILABLE
    const checkLunch = await req(`/api/restaurants/spicy-spoon/tables?date=${dateA}&time=12:00%20PM&guests=4`);
    const t3Lunch = checkLunch.data.find((t) => t.table_number === "T3");
    if (!t3Lunch || !t3Lunch.isAvailableForSlot) {
      throw new Error(`Table T3 was incorrectly blocked for Lunch when only Breakfast was booked! State: ${JSON.stringify(t3Lunch)}`);
    }
    console.log("✓ Table T3 is correctly AVAILABLE for Lunch on the same day!");

    // Check Table T3 for Dinner (07:30 PM) on same Date A -> MUST BE AVAILABLE
    const checkDinner = await req(`/api/restaurants/spicy-spoon/tables?date=${dateA}&time=07:30%20PM&guests=4`);
    const t3Dinner = checkDinner.data.find((t) => t.table_number === "T3");
    if (!t3Dinner || !t3Dinner.isAvailableForSlot) {
      throw new Error(`Table T3 was incorrectly blocked for Dinner when only Breakfast was booked! State: ${JSON.stringify(t3Dinner)}`);
    }
    console.log("✓ Table T3 is correctly AVAILABLE for Dinner on the same day!");

    // Check Table T3 for Breakfast (08:30 AM) on Date A -> MUST BE UNAVAILABLE
    const checkBreakfast = await req(`/api/restaurants/spicy-spoon/tables?date=${dateA}&time=08:30%20AM&guests=4`);
    const t3Breakfast = checkBreakfast.data.find((t) => t.table_number === "T3");
    if (!t3Breakfast || t3Breakfast.isAvailableForSlot !== false) {
      throw new Error(`Table T3 should be UNAVAILABLE for Breakfast slot! State: ${JSON.stringify(t3Breakfast)}`);
    }
    console.log("✓ Table T3 is correctly UNAVAILABLE for Breakfast slot on Date A!");

    // -------------------------------------------------------------
    // TEST 5: Different Date Availability
    // -------------------------------------------------------------
    console.log("\nTest 5 — Date-Specific Availability (Date A vs Date B):");
    console.log(`Table T1 was booked on Date A (${dateA}). Checking Table T1 availability on Date B (${dateB}) at 07:30 PM...`);
    const checkDateB = await req(`/api/restaurants/spicy-spoon/tables?date=${dateB}&time=07:30%20PM&guests=2`);
    const t1DateB = checkDateB.data.find((t) => t.table_number === "T1");
    if (!t1DateB || !t1DateB.isAvailableForSlot) {
      throw new Error(`Table T1 is blocked on Date B (${dateB}) because of a booking on Date A (${dateA})!`);
    }
    console.log(`✓ Table T1 is fully AVAILABLE on Date B (${dateB}). Date-specific availability verified!`);

    // -------------------------------------------------------------
    // TEST 6: Admin Dashboard Synchronization
    // -------------------------------------------------------------
    console.log("\nTest 6 — Admin Dashboard Synchronization:");
    const authRes = await req("/api/auth/login", "POST", { username: "admin", password: "admin123" });
    const adminToken = authRes.data?.token;

    const adminBookingsRes = await req(`/api/bookings?date=${dateA}`, "GET", null, adminToken);
    if (adminBookingsRes.status !== 200) {
      throw new Error("Admin failed to fetch bookings.");
    }
    const adminFoundT1 = adminBookingsRes.data.find((b) => b.table_number === "T1");
    if (!adminFoundT1) {
      throw new Error("Admin dashboard did not see Table T1 booking from database.");
    }
    console.log(`✓ Admin sees booking #${adminFoundT1.booking_number} on Table T1 (Customer: ${adminFoundT1.customer_name})`);

    // -------------------------------------------------------------
    // TEST 7: Anti-Caching Headers Verification
    // -------------------------------------------------------------
    console.log("\nTest 7 — Cache-Control Anti-Stale Data Headers:");
    const cacheHeader = browserBCheck.headers["cache-control"] || "";
    if (!cacheHeader.includes("no-store") || !cacheHeader.includes("no-cache")) {
      throw new Error(`Expected Cache-Control: no-store, no-cache, but got: ${cacheHeader}`);
    }
    console.log(`✓ Anti-caching header verified: "${cacheHeader}"`);

    console.log("\n==================================================");
    console.log("🎉 ALL 7 BOOKING SYNCHRONIZATION TESTS PASSED 100%!");
    console.log("==================================================");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Test failed with error:", err.message);
    process.exit(1);
  }
}

if (!server.listening) {
  server.listen(5000, () => {
    setTimeout(runBookingSyncTests, 300);
  });
} else {
  setTimeout(runBookingSyncTests, 300);
}
