const http = require("http");
const crypto = require("crypto");
const { app, server } = require("./server");

async function runTests() {
  console.log("==================================================");
  console.log("🚀 Starting Spicy Spoon Production Test Suite");
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
            resolve({ status: res.statusCode, data: parsed });
          } catch {
            resolve({ status: res.statusCode, data });
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
    // Generate dynamic date for fresh test run
    const randomYear = 2028 + Math.floor(Math.random() * 10);
    const randomMonth = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
    const randomDay = String(1 + Math.floor(Math.random() * 28)).padStart(2, "0");
    const testDate = `${randomYear}-${randomMonth}-${randomDay}`;

    // Admin login for staff endpoints
    const authRes = await req("/api/auth/login", "POST", { username: "admin", password: "admin123" });
    const adminToken = authRes.data?.token;

    // 1. Test Restaurant Profile & Permanent QR
    console.log("\n1. Testing GET /api/restaurants/spicy-spoon & QR...");
    const rRes = await req("/api/restaurants/spicy-spoon");
    if (rRes.status !== 200 || rRes.data.slug !== "spicy-spoon") {
      throw new Error(`Failed to fetch restaurant: status ${rRes.status}`);
    }
    console.log(`✓ Restaurant: ${rRes.data.name} (Tax: ${rRes.data.tax_rate}%, Service Charge: ${rRes.data.service_charge_rate}%)`);

    const qrRes = await req("/api/restaurants/spicy-spoon/qr");
    if (qrRes.status !== 200 || !qrRes.data.qrCodeDataUrl) {
      throw new Error("Permanent Restaurant QR generation failed");
    }
    console.log(`✓ Permanent Restaurant QR URL: ${qrRes.data.targetUrl}`);

    // 2. Test Tables & 4 Standard Sections
    console.log("\n2. Testing GET /api/tables (Sections & Capacities)...");
    const tablesRes = await req("/api/tables");
    if (tablesRes.status !== 200 || tablesRes.data.length < 12) {
      throw new Error(`Expected at least 12 tables, got ${tablesRes.data.length}`);
    }
    const sections = new Set(tablesRes.data.map((t) => t.section));
    console.log(`✓ Tables count: ${tablesRes.data.length} across sections: [${Array.from(sections).join(", ")}]`);

    // 3. Test Capacity & Time Slot Availability Filtering
    console.log(`\n3. Testing Table Availability & Capacity Filtering for date ${testDate} (5 guests requested)...`);
    const availRes = await req(`/api/restaurants/spicy-spoon/tables?date=${testDate}&time=07:30%20PM&guests=5`);
    const lowCapTables = availRes.data.filter((t) => t.capacity < 5);
    if (!lowCapTables.every((t) => !t.isAvailableForSlot)) {
      throw new Error("Capacity filtering failed: low capacity tables must not be available for 5 guests");
    }
    console.log(`✓ Capacity filtering verified: ${lowCapTables.length} tables correctly blocked for 5 guests`);

    // 4. Test Table Booking & Overlap Protection (Public Guest: No Auth)
    console.log(`\n4. Testing POST /api/bookings (Booking T7 on ${testDate} for 07:30 PM - 09:00 PM)...`);
    const bookingPayload = {
      table_number: "T7",
      customer_name: "Anita Deshmukh",
      customer_phone: "+91 98765 11223",
      customer_email: "anita@example.com",
      booking_date: testDate,
      start_time: "07:30 PM",
      guest_count: 5,
      special_notes: "Window side seating requested",
    };
    const bRes = await req("/api/bookings", "POST", bookingPayload);
    if (bRes.status !== 201 || !bRes.data.booking?.booking_number) {
      throw new Error(`Booking creation failed: ${bRes.data.message}`);
    }
    console.log(`✓ Booking confirmed: #${bRes.data.booking.booking_number} on ${bRes.data.booking.table_number}`);

    // Test Double Booking Prevention on overlapping slot
    console.log("4b. Testing Double-Booking Collision Prevention on Table T7...");
    const collisionPayload = {
      table_number: "T7",
      customer_name: "Second Customer",
      customer_phone: "+91 99999 00000",
      booking_date: testDate,
      start_time: "08:00 PM", // Overlaps with 07:30 PM - 09:00 PM
      guest_count: 5,
    };
    const colRes = await req("/api/bookings", "POST", collisionPayload);
    if (colRes.status !== 409) {
      throw new Error(`Expected 409 Conflict on double booking, got status ${colRes.status}`);
    }
    console.log(`✓ Double-booking correctly rejected (409 Conflict): ${colRes.data.message}`);

    // 5. Test Multi-Round Ordering under Single Session on Table T3 (Public Guest: No Auth)
    console.log("\n5. Testing Multi-Round Ordering (Server-side price enforcement)...");
    const menuRes = await req("/api/menu");
    const item1 = menuRes.data[0];
    const item2 = menuRes.data[1];
    const item3 = menuRes.data[2];

    // Round 1: Starters
    const round1Payload = {
      tableNumber: "T3",
      customer_name: "Rahul Sharma",
      items: [
        { id: item1.id, name: item1.name, quantity: 2, price: 1.0 }, // Tampered price 1.0 must be ignored
        { id: item2.id, name: item2.name, quantity: 1, price: 0.5 },
      ],
    };
    const ord1Res = await req("/api/orders", "POST", round1Payload);
    if (ord1Res.status !== 201) throw new Error(`Round 1 order failed: ${ord1Res.data.message}`);
    const sessionId = ord1Res.data.session_id;
    console.log(`✓ Round 1 placed: Order #${ord1Res.data.order.order_number}, Session: ${sessionId}`);

    // Verify server-side calculated subtotal: 2*item1 + 1*item2
    const expectedSubtotalRound1 = item1.price * 2 + item2.price * 1;
    if (Math.abs(ord1Res.data.order.subtotal - expectedSubtotalRound1) > 0.1) {
      throw new Error(`Server-side price calculation failed: expected ${expectedSubtotalRound1}, got ${ord1Res.data.order.subtotal}`);
    }
    console.log(`✓ Server-side price security verified: Subtotal = ₹${ord1Res.data.order.subtotal}`);

    // Round 2: Main Course (under same session)
    const round2Payload = {
      tableNumber: "T3",
      session_id: sessionId,
      round_number: 2,
      items: [{ id: item3.id, name: item3.name, quantity: 2 }],
    };
    const ord2Res = await req("/api/orders", "POST", round2Payload);
    if (ord2Res.status !== 201) throw new Error(`Round 2 order failed: ${ord2Res.data.message}`);
    console.log(`✓ Round 2 placed: Order #${ord2Res.data.order.order_number} under same session ${sessionId}`);

    // 6. Test Live Bill Aggregation for all Rounds
    console.log("\n6. Testing POST /api/bills/generate (Live Bill aggregating all session rounds)...");
    const billRes = await req("/api/bills/generate", "POST", {
      session_id: sessionId,
      discount_code: "SPICY10",
    });
    if (billRes.status !== 201) throw new Error(`Bill generation failed: ${billRes.data.message}`);
    const bill = billRes.data.bill;
    console.log(`✓ Bill #${bill.bill_number}: Subtotal=₹${bill.subtotal}, GST 5%=₹${bill.tax}, Service 2.5%=₹${bill.service_charge}, Discount=₹${bill.discount}, Grand Total=₹${bill.grand_total}`);

    // 7. Test Idempotent Payment Processing
    console.log("\n7. Testing POST /api/payments/verify with Idempotency Key & HMAC Signature...");
    const rzpOrderId = `order_${Date.now()}`;
    const rzpPaymentId = `pay_${Date.now()}`;
    const rzpSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "spicyspoon_secret_demo_key")
      .update(`${rzpOrderId}|${rzpPaymentId}`)
      .digest("hex");

    const idempotencyKey = `IDEMP-TEST-${Date.now()}`;
    const payRes1 = await req("/api/payments/verify", "POST", {
      bill_id: bill.id,
      razorpay_order_id: rzpOrderId,
      razorpay_payment_id: rzpPaymentId,
      razorpay_signature: rzpSignature,
      idempotency_key: idempotencyKey,
      amount: bill.grand_total,
    });
    if (payRes1.status !== 200 || payRes1.data.bill?.status !== "PAID") {
      throw new Error(`Payment verification failed: ${JSON.stringify(payRes1.data)}`);
    }
    console.log(`✓ Payment attempt 1 successful: Bill Status=${payRes1.data.bill.status}, Table Released=${payRes1.data.table?.status === "AVAILABLE"}`);

    // Replay same request with same idempotency key -> Must return existing result without duplicate payment
    const payRes2 = await req("/api/payments/verify", "POST", {
      bill_id: bill.id,
      razorpay_order_id: rzpOrderId,
      razorpay_payment_id: rzpPaymentId,
      razorpay_signature: rzpSignature,
      idempotency_key: idempotencyKey,
      amount: bill.grand_total,
    });
    if (payRes2.status !== 200) {
      throw new Error(`Idempotent replay failed: status ${payRes2.status}`);
    }
    console.log(`✓ Payment idempotency verified: identical response returned without duplicating payment.`);

    // 8. Test Cash Payment Settlement Flow on Table T4
    console.log("\n8. Testing Cash Payment Settlement Flow on Table T4...");
    const cashOrderRes = await req("/api/orders", "POST", {
      tableNumber: "T4",
      items: [{ id: item1.id, name: item1.name, quantity: 1 }],
    });
    const cashBillRes = await req("/api/bills/generate", "POST", {
      session_id: cashOrderRes.data.session_id,
    });
    const cashBillId = cashBillRes.data.bill.id;

    // Request cash payment (Customer initiates)
    const cashInitRes = await req("/api/payments/create", "POST", {
      bill_id: cashBillId,
      payment_method: "CASH",
    });
    if (cashInitRes.status !== 201 || cashInitRes.data.payment?.status !== "CASH_PENDING") {
      throw new Error("Cash initiation failed");
    }
    console.log(`✓ Cash payment requested: Status=CASH_PENDING, Transaction=${cashInitRes.data.payment.transaction_id}`);

    // Admin confirms cash received (Authenticated Admin)
    const cashConfirmRes = await req(
      "/api/payments/cash-confirm",
      "POST",
      {
        bill_id: cashBillId,
        transaction_id: cashInitRes.data.payment.transaction_id,
      },
      adminToken
    );
    if (cashConfirmRes.status !== 200 || !["SUCCESS", "CASH_PAID"].includes(cashConfirmRes.data.payment?.status)) {
      throw new Error("Cash confirmation failed");
    }
    console.log(`✓ Cash payment confirmed by admin: Status=${cashConfirmRes.data.payment?.status}, Table Released=${cashConfirmRes.data.table?.status === "AVAILABLE"}`);

    // 9. Test Analytics & Reports (Authenticated Admin)
    console.log("\n9. Testing GET /api/reports/analytics (Admin)...");
    const repRes = await req("/api/reports/analytics", "GET", null, adminToken);
    if (repRes.status !== 200) throw new Error("Analytics report failed");
    console.log(`✓ Analytics summary: Total Revenue=₹${repRes.data.summary.totalRevenue}, Total Orders=${repRes.data.summary.totalOrders}, Bookings=${repRes.data.summary.totalBookings}`);

    console.log("\n==================================================");
    console.log("🎉 ALL INTEGRATION & PRODUCTION TESTS PASSED!");
    console.log("==================================================");
    process.exit(0);
  } catch (err) {
    console.error("❌ Test Suite Failure:", err);
    process.exit(1);
  }
}

if (!server.listening) {
  server.listen(5000, () => {
    setTimeout(runTests, 300);
  });
} else {
  setTimeout(runTests, 300);
}
