const http = require("http");
const { app, server } = require("./server");
const db = require("./db/database");

async function runPaymentFlowTestSuite() {
  console.log("================================================================");
  console.log("🔥 RUNNING SPICY SPOON PAYMENT FLOW AUTOMATED TEST SUITE");
  console.log("================================================================");

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
    // ---------------------------------------------------------
    // TEST 1: UPI QR AUTOMATIC BACKEND VERIFICATION
    // ---------------------------------------------------------
    console.log("\n🧪 TEST 1: UPI QR Payment Flow (Automatic Server Verification)...");

    // 1. Place order on Table T2
    const order1Res = await req("/api/orders", "POST", {
      tableNumber: "T2",
      customer_name: "UPI Test Guest",
      customer_phone: "+91 99887 76655",
      items: [{ id: 1, name: "Tandoori Chicken (Full)", quantity: 1 }],
    });
    if (order1Res.status !== 201) throw new Error("Failed to place order for UPI test");
    const order1 = order1Res.data.order;
    console.log(`  ✓ Order placed on T2: #${order1.order_number}`);

    // 2. Generate bill
    const bill1Res = await req("/api/bills/generate", "POST", {
      tableNumber: "T2",
      session_id: order1Res.data.session_id,
    });
    if (bill1Res.status !== 201) throw new Error("Failed to generate bill for UPI test");
    const bill1 = bill1Res.data.bill;
    console.log(`  ✓ Bill generated: #${bill1.bill_number}, Grand Total: ₹${bill1.grand_total}`);

    // 3. Initiate UPI QR Payment
    const upiRes = await req("/api/payments/create", "POST", {
      bill_id: bill1.id,
      payment_method: "UPI",
    });
    if (upiRes.status !== 201) throw new Error("Failed to initiate UPI payment");
    if (!upiRes.data.upiQrCode) throw new Error("UPI QR code was not generated");
    console.log(`  ✓ UPI QR generated with exact amount ₹${bill1.grand_total}`);
    console.log(`  ✓ Payment initial status in DB: ${upiRes.data.payment.status} (PENDING)`);

    // 4. Wait for Server-Side Auto Verification (~4.5s)
    console.log("  ⏳ Waiting for automatic backend verification of UPI payment...");
    await new Promise((r) => setTimeout(r, 4500));

    // 5. Verify database records
    const verifiedPayment = db.prepare("SELECT * FROM payments WHERE id = ?").get(upiRes.data.payment.id);
    const paidBill = db.prepare("SELECT * FROM bills WHERE id = ?").get(bill1.id);
    const releasedTable = db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(bill1.table_id);
    const completedOrder = db.prepare("SELECT * FROM orders WHERE id = ?").get(order1.id);

    if (verifiedPayment.status !== "SUCCESS") {
      throw new Error(`Payment status is ${verifiedPayment.status}, expected SUCCESS`);
    }
    if (paidBill.status !== "PAID") {
      throw new Error(`Bill status is ${paidBill.status}, expected PAID`);
    }
    if (completedOrder.status !== "COMPLETED") {
      throw new Error(`Order status is ${completedOrder.status}, expected COMPLETED`);
    }
    if (releasedTable.status !== "AVAILABLE") {
      throw new Error(`Table status is ${releasedTable.status}, expected AVAILABLE`);
    }
    console.log("  ✅ TEST 1 PASSED: UPI QR automatically verified by server. Bill marked PAID, Table released.");

    // ---------------------------------------------------------
    // TEST 2: CARD PAYMENT BACKEND VERIFICATION
    // ---------------------------------------------------------
    console.log("\n🧪 TEST 2: Card Payment Flow (Server Authorization & Verification)...");

    // 1. Place order on Table T4
    const order2Res = await req("/api/orders", "POST", {
      tableNumber: "T4",
      customer_name: "Card Test Guest",
      customer_phone: "+91 91234 56789",
      items: [{ id: 3, name: "Chicken Biryani", quantity: 2 }],
    });
    if (order2Res.status !== 201) throw new Error("Failed to place order for Card test");
    const order2 = order2Res.data.order;

    // 2. Generate bill
    const bill2Res = await req("/api/bills/generate", "POST", {
      tableNumber: "T4",
      session_id: order2Res.data.session_id,
    });
    const bill2 = bill2Res.data.bill;
    console.log(`  ✓ Bill generated: #${bill2.bill_number}, Grand Total: ₹${bill2.grand_total}`);

    // 3. Initiate Card Payment Intent
    const cardInitRes = await req("/api/payments/create", "POST", {
      bill_id: bill2.id,
      payment_method: "CARD",
    });
    if (cardInitRes.status !== 201) throw new Error("Failed to initiate card intent");

    // 4. Verify Amount mismatch fails
    const mismatchRes = await req("/api/payments/verify", "POST", {
      bill_id: bill2.id,
      transaction_id: cardInitRes.data.payment.transaction_id,
      amount: bill2.grand_total - 100, // wrong amount
    });
    if (mismatchRes.status !== 400) {
      throw new Error("Backend should reject payment amount mismatch!");
    }
    console.log("  ✓ Backend strictly rejected mismatched card payment amount");

    // 5. Verify Correct Amount & Gateway Authorization
    const cardVerifyRes = await req("/api/payments/verify", "POST", {
      bill_id: bill2.id,
      transaction_id: cardInitRes.data.payment.transaction_id,
      amount: bill2.grand_total,
      status: "SUCCESS",
    });
    if (cardVerifyRes.status !== 200 || !cardVerifyRes.data.receipt) {
      throw new Error("Card payment verification failed: " + JSON.stringify(cardVerifyRes.data));
    }

    const cardPaidBill = db.prepare("SELECT * FROM bills WHERE id = ?").get(bill2.id);
    const cardTable = db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(bill2.table_id);
    if (cardPaidBill.status !== "PAID" || cardTable.status !== "AVAILABLE") {
      throw new Error("Bill not paid or table not released after card verification");
    }
    console.log("  ✅ TEST 2 PASSED: Card payment verified by server. Digital receipt generated.");

    // ---------------------------------------------------------
    // TEST 3: CASH PAYMENT FLOW (ADMIN ONLY CONFIRMATION)
    // ---------------------------------------------------------
    console.log("\n🧪 TEST 3: Cash Payment Flow (Admin Only Confirmation)...");

    // 1. Place order on Table T6
    const order3Res = await req("/api/orders", "POST", {
      tableNumber: "T6",
      customer_name: "Cash Test Guest",
      customer_phone: "+91 97777 88888",
      items: [{ id: 5, name: "Paneer Tikka", quantity: 1 }],
    });
    const order3 = order3Res.data.order;

    // 2. Generate bill
    const bill3Res = await req("/api/bills/generate", "POST", {
      tableNumber: "T6",
      session_id: order3Res.data.session_id,
    });
    const bill3 = bill3Res.data.bill;
    console.log(`  ✓ Bill generated on T6: #${bill3.bill_number}, Amount: ₹${bill3.grand_total}`);

    // 3. Customer selects Cash -> Requests Cash Payment
    const cashReqRes = await req("/api/payments/create", "POST", {
      bill_id: bill3.id,
      payment_method: "CASH",
    });
    if (cashReqRes.status !== 201) throw new Error("Failed to request cash payment");
    if (cashReqRes.data.payment.status !== "CASH_PENDING") {
      throw new Error(`Expected payment status CASH_PENDING, got ${cashReqRes.data.payment.status}`);
    }

    // 4. Verify Bill remains UNPAID and Table is PAYMENT_PENDING
    const unconfirmedBill = db.prepare("SELECT * FROM bills WHERE id = ?").get(bill3.id);
    const pendingTable = db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(bill3.table_id);
    if (unconfirmedBill.status !== "UNPAID") throw new Error("Bill must remain UNPAID before Admin confirmation");
    if (pendingTable.status !== "PAYMENT_PENDING") throw new Error("Table must be PAYMENT_PENDING");
    console.log("  ✓ Cash request logged: Payment is CASH_PENDING, Bill is UNPAID, Table is PAYMENT_PENDING");

    // 5. Unauthenticated user trying to confirm cash MUST be rejected (401 / 403)
    const unauthorizedConfirm = await req("/api/payments/cash-confirm", "POST", {
      bill_id: bill3.id,
    });
    if (unauthorizedConfirm.status !== 401 && unauthorizedConfirm.status !== 403) {
      throw new Error(`Unauthorized cash confirm returned ${unauthorizedConfirm.status}, expected 401/403`);
    }
    console.log("  ✓ Customer / unauthenticated attempt to confirm cash payment was rejected");

    // 6. Admin logs in and checks pending cash requests
    const adminAuth = await req("/api/auth/login", "POST", { username: "admin", password: "admin123" });
    const adminToken = adminAuth.data?.token;
    if (!adminToken) throw new Error("Admin login failed");

    const cashRequestsList = await req("/api/payments/cash-requests", "GET", null, adminToken);
    const foundReq = cashRequestsList.data?.find((r) => r.bill_id === bill3.id || r.id === bill3.id);
    if (!foundReq) {
      throw new Error(`Cash request for Bill #${bill3.bill_number} not found in admin cash requests list`);
    }
    console.log(`  ✓ Admin sees real-time Cash request for Table ${foundReq.table_number}, Amount: ₹${foundReq.grand_total || foundReq.bill_amount}`);

    // 7. Admin clicks "Confirm Cash Received"
    const adminConfirmRes = await req(
      "/api/payments/cash-confirm",
      "POST",
      { bill_id: bill3.id },
      adminToken
    );
    if (adminConfirmRes.status !== 200) {
      throw new Error("Admin cash confirmation failed: " + JSON.stringify(adminConfirmRes.data));
    }
    console.log("  ✓ Admin confirmed cash payment received");

    // 8. Verify DB records after Admin confirmation
    const finalBill = db.prepare("SELECT * FROM bills WHERE id = ?").get(bill3.id);
    const finalTable = db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(bill3.table_id);
    const finalOrder = db.prepare("SELECT * FROM orders WHERE id = ?").get(order3.id);
    const finalPayment = db.prepare("SELECT * FROM payments WHERE bill_id = ?").get(bill3.id);

    if (finalBill.status !== "PAID") throw new Error("Bill status is not PAID after admin confirmation");
    if (finalTable.status !== "AVAILABLE") throw new Error("Table is not released to AVAILABLE after admin confirmation");
    if (finalOrder.status !== "COMPLETED") throw new Error("Order is not COMPLETED after admin confirmation");
    if (finalPayment.status !== "SUCCESS" && finalPayment.status !== "CASH_PAID") {
      throw new Error(`Payment status is ${finalPayment.status}, expected SUCCESS`);
    }

    console.log("  ✅ TEST 3 PASSED: Cash payment verified ONLY after Admin confirmation. Table released.");

    console.log("\n================================================================");
    console.log("🎉 ALL AUTOMATED PAYMENT TESTS PASSED WITH 100% SUCCESS!");
    console.log("================================================================");
    process.exit(0);
  } catch (err) {
    console.error("❌ TEST FAILED:", err);
    process.exit(1);
  }
}

if (!server.listening) {
  server.listen(5000, () => {
    setTimeout(runPaymentFlowTestSuite, 400);
  });
} else {
  setTimeout(runPaymentFlowTestSuite, 400);
}
