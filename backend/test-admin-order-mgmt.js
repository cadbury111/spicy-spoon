const http = require("http");
const { app, server } = require("./server");
const db = require("./db/database");

async function runAdminOrderMgmtTestSuite() {
  console.log("===============================================================");
  console.log("🛡️  Running Spicy Spoon Admin Order Management Action Test Suite");
  console.log("===============================================================");

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
    // 0. Setup Staff Tokens
    console.log("\n0. Authenticating Admin and Kitchen Staff Accounts...");
    const adminLogin = await req("/api/auth/login", "POST", { username: "admin", password: "admin123" });
    if (adminLogin.status !== 200 || !adminLogin.data.token) {
      throw new Error(`Admin login failed: ${adminLogin.status}`);
    }
    const adminToken = adminLogin.data.token;
    console.log("✓ Admin authenticated successfully.");

    const kitchenLogin = await req("/api/auth/login", "POST", { username: "kitchen", password: "kitchen123" });
    if (kitchenLogin.status !== 200 || !kitchenLogin.data.token) {
      throw new Error(`Kitchen login failed: ${kitchenLogin.status}`);
    }
    const kitchenToken = kitchenLogin.data.token;
    console.log("✓ Kitchen authenticated successfully.");

    // Fetch sample menu dish
    const menuRes = await req("/api/menu");
    const sampleItem = menuRes.data[0];

    // =========================================================================
    // TEST A — ACCIDENTAL ORDER PLACED & CANCELLED BY ADMIN
    // =========================================================================
    console.log("\n--- TEST A: Accidental Order Placement & Admin Cancellation ---");
    const orderResA = await req("/api/orders", "POST", {
      tableNumber: "T3",
      customer_name: "Accidental Guest",
      items: [{ id: sampleItem.id, name: sampleItem.name, quantity: 1 }],
    });
    if (orderResA.status !== 201) throw new Error("Failed to place test order A");
    const orderA = orderResA.data.order;
    console.log(`✓ Accidental order #${orderA.order_number} created (Status: ${orderA.status}, Table: T3)`);

    // Admin cancels the order
    const cancelResA = await req(`/api/orders/${orderA.id}/cancel`, "PUT", {}, adminToken);
    if (cancelResA.status !== 200) {
      throw new Error(`Expected 200 on cancel, got ${cancelResA.status}: ${JSON.stringify(cancelResA.data)}`);
    }
    if (cancelResA.data.order.status !== "CANCELLED") {
      throw new Error(`Expected status CANCELLED, got ${cancelResA.data.order.status}`);
    }
    console.log(`✓ Admin successfully cancelled order #${orderA.order_number} (Status: CANCELLED)`);

    // Verify in DB
    const dbOrderA = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderA.id);
    if (dbOrderA.status !== "CANCELLED") {
      throw new Error(`DB verification failed: order status is ${dbOrderA.status}`);
    }
    console.log("✓ Verified database order record status updated to CANCELLED.");

    // Verify Active Orders excludes this order
    const activeOrdersRes = await req("/api/orders/active?table_number=T3");
    const foundInActive = (activeOrdersRes.data || []).some((o) => o.id === orderA.id);
    if (foundInActive) {
      throw new Error("Cancelled order should not appear in active orders list");
    }
    console.log("✓ Verified cancelled order is not in active orders list.");

    // Verify Table is released back to AVAILABLE
    const tableT3 = db.prepare("SELECT * FROM restaurant_tables WHERE table_number = 'T3'").get();
    if (tableT3.status !== "AVAILABLE") {
      throw new Error(`Expected Table T3 status AVAILABLE, got ${tableT3.status}`);
    }
    console.log("✓ Verified Table T3 automatically released to AVAILABLE.");

    // =========================================================================
    // TEST B — COMPLETED ORDER DELETION & FINANCIAL RECORD INTEGRITY
    // =========================================================================
    console.log("\n--- TEST B: Completed Order Safe Deletion / Archiving & Financial Integrity ---");
    // Place order, progress through kitchen, generate bill, pay bill
    const orderResB = await req("/api/orders", "POST", {
      tableNumber: "T4",
      customer_name: "Dinner Guest",
      items: [{ id: sampleItem.id, name: sampleItem.name, quantity: 2 }],
    });
    const orderB = orderResB.data.order;
    const sessionB = orderResB.data.session_id;

    // Progress through kitchen to SERVED
    await req(`/api/orders/${orderB.id}/status`, "PUT", { status: "ACCEPTED" }, adminToken);
    await req(`/api/orders/${orderB.id}/status`, "PUT", { status: "PREPARING" }, adminToken);
    await req(`/api/orders/${orderB.id}/status`, "PUT", { status: "READY" }, adminToken);
    await req(`/api/orders/${orderB.id}/status`, "PUT", { status: "SERVED" }, adminToken);

    // Generate bill, create CASH payment request, then Admin confirms cash
    const billGenRes = await req("/api/bills/generate", "POST", { session_id: sessionB, tableNumber: "T4" });
    const billB = billGenRes.data.bill;
    await req("/api/payments/create", "POST", { bill_id: billB.id, payment_method: "CASH" });
    await req("/api/payments/cash-confirm", "POST", { bill_id: billB.id }, adminToken);
    console.log(`✓ Order #${orderB.order_number} completed, invoice #${billB.bill_number} settled (₹${billB.grand_total})`);

    // Admin Deletes Completed Order
    const deleteResB = await req(`/api/orders/${orderB.id}`, "DELETE", null, adminToken);
    if (deleteResB.status !== 200) {
      throw new Error(`Failed to delete completed order: ${deleteResB.status}: ${JSON.stringify(deleteResB.data)}`);
    }
    console.log(`✓ Admin successfully deleted completed order #${orderB.order_number}`);

    // Verify operational orders list excludes this order
    const operationalOrders = await req("/api/orders");
    const foundInOpList = (operationalOrders.data || []).some((o) => o.id === orderB.id);
    if (foundInOpList) {
      throw new Error("Deleted/archived order should NOT appear in operational orders list");
    }
    console.log("✓ Verified order is removed from standard operational order list.");

    // CRITICAL: Verify financial history is intact
    const dbOrderB = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderB.id);
    if (!dbOrderB || dbOrderB.is_archived !== 1) {
      throw new Error("Order record should be preserved with is_archived = 1");
    }
    const dbBillB = db.prepare("SELECT * FROM bills WHERE id = ?").get(billB.id);
    if (!dbBillB || dbBillB.status !== "PAID") {
      throw new Error("Bill record must remain completely intact and PAID");
    }
    const dbPaymentB = db.prepare("SELECT * FROM payments WHERE bill_id = ?").get(billB.id);
    if (!dbPaymentB) {
      throw new Error("Payment transaction record must remain intact");
    }
    console.log("✓ Verified Bill, Payment, and DB relationship remain 100% intact with safe archiving.");

    // =========================================================================
    // TEST C — CUSTOMER & KITCHEN RBAC SECURITY
    // =========================================================================
    console.log("\n--- TEST C: Customer & Kitchen RBAC Security ---");
    // Create new test order
    const orderResC = await req("/api/orders", "POST", {
      tableNumber: "T5",
      customer_name: "Security Test Guest",
      items: [{ id: sampleItem.id, name: sampleItem.name, quantity: 1 }],
    });
    const orderC = orderResC.data.order;

    // 1. Unauthenticated customer trying to Cancel -> 401
    const unauthCancel = await req(`/api/orders/${orderC.id}/cancel`, "PUT");
    if (unauthCancel.status !== 401) {
      throw new Error(`Expected 401 for unauthenticated cancel, got ${unauthCancel.status}`);
    }
    console.log("✓ Unauthenticated customer cancellation rejected (401 Unauthorized)");

    // 2. Unauthenticated customer trying to Delete -> 401
    const unauthDelete = await req(`/api/orders/${orderC.id}`, "DELETE");
    if (unauthDelete.status !== 401) {
      throw new Error(`Expected 401 for unauthenticated delete, got ${unauthDelete.status}`);
    }
    console.log("✓ Unauthenticated customer deletion rejected (401 Unauthorized)");

    // 3. Kitchen trying to Cancel -> 403 Forbidden
    const kitchenCancel = await req(`/api/orders/${orderC.id}/cancel`, "PUT", {}, kitchenToken);
    if (kitchenCancel.status !== 403) {
      throw new Error(`Expected 403 for Kitchen cancel, got ${kitchenCancel.status}`);
    }
    console.log("✓ Kitchen staff cancellation rejected (403 Forbidden)");

    // 4. Kitchen trying to Delete -> 403 Forbidden
    const kitchenDelete = await req(`/api/orders/${orderC.id}`, "DELETE", null, kitchenToken);
    if (kitchenDelete.status !== 403) {
      throw new Error(`Expected 403 for Kitchen delete, got ${kitchenDelete.status}`);
    }
    console.log("✓ Kitchen staff deletion rejected (403 Forbidden)");

    // Clean up order C
    await req(`/api/orders/${orderC.id}/cancel`, "PUT", {}, adminToken);

    // =========================================================================
    // TEST D — ACTIVE UNPAID BILL SAFETY
    // =========================================================================
    console.log("\n--- TEST D: Active Unpaid Bill Deletion Protection ---");
    const orderResD = await req("/api/orders", "POST", {
      tableNumber: "T7",
      customer_name: "Unpaid Bill Diner",
      items: [{ id: sampleItem.id, name: sampleItem.name, quantity: 1 }],
    });
    const orderD = orderResD.data.order;
    const sessionD = orderResD.data.session_id;

    // Progress to SERVED and generate UNPAID bill
    await req(`/api/orders/${orderD.id}/status`, "PUT", { status: "SERVED" }, adminToken);
    const billGenD = await req("/api/bills/generate", "POST", { session_id: sessionD, tableNumber: "T7" });
    const billD = billGenD.data.bill;
    if (billD.status !== "UNPAID") throw new Error("Bill D should be UNPAID");

    // Attempt to delete active / unpaid order -> Must be rejected!
    const deleteUnpaid = await req(`/api/orders/${orderD.id}`, "DELETE", null, adminToken);
    if (deleteUnpaid.status !== 400) {
      throw new Error(`Expected 400 when deleting order with unpaid bill, got ${deleteUnpaid.status}`);
    }
    console.log(`✓ Deletion of active order with unpaid bill rejected (400 Bad Request: "${deleteUnpaid.data.message}")`);

    // Settle bill, then deletion should succeed
    await req("/api/payments/create", "POST", { bill_id: billD.id, payment_method: "CASH" });
    await req("/api/payments/cash-confirm", "POST", { bill_id: billD.id }, adminToken);
    const deletePaid = await req(`/api/orders/${orderD.id}`, "DELETE", null, adminToken);
    if (deletePaid.status !== 200) {
      throw new Error(`Expected 200 after bill settlement, got ${deletePaid.status}`);
    }
    console.log("✓ Order successfully deleted after bill settlement.");

    // =========================================================================
    // TEST E — POST-COMPLETION CANCELLATION RESTRICTION
    // =========================================================================
    console.log("\n--- TEST E: Post-completion Cancellation Restriction ---");
    const orderResE = await req("/api/orders", "POST", {
      tableNumber: "T8",
      customer_name: "Served Guest",
      items: [{ id: sampleItem.id, name: sampleItem.name, quantity: 1 }],
    });
    const orderE = orderResE.data.order;

    // Advance to SERVED
    await req(`/api/orders/${orderE.id}/status`, "PUT", { status: "SERVED" }, adminToken);

    // Try to cancel served order -> Must be rejected with message "This order can no longer be cancelled."
    const cancelServed = await req(`/api/orders/${orderE.id}/cancel`, "PUT", {}, adminToken);
    if (cancelServed.status !== 400 || !cancelServed.data.message.includes("can no longer be cancelled")) {
      throw new Error(`Expected 400 for cancelling SERVED order, got ${cancelServed.status}: ${JSON.stringify(cancelServed.data)}`);
    }
    console.log(`✓ Cancellation of SERVED order correctly rejected: "${cancelServed.data.message}"`);

    // Clean up
    const billGenE = await req("/api/bills/generate", "POST", { session_id: orderResE.data.session_id, tableNumber: "T8" });
    await req("/api/payments/create", "POST", { bill_id: billGenE.data.bill.id, payment_method: "CASH" });
    await req("/api/payments/cash-confirm", "POST", { bill_id: billGenE.data.bill.id }, adminToken);
    await req(`/api/orders/${orderE.id}`, "DELETE", null, adminToken);

    console.log("\n===============================================================");
    console.log("🎉 ALL ADMIN ORDER MANAGEMENT TESTS (A, B, C, D, E) PASSED 100%!");
    console.log("===============================================================");
    process.exit(0);
  } catch (err) {
    console.error("❌ Test Failure:", err);
    process.exit(1);
  }
}

if (!server.listening) {
  server.listen(5000, () => {
    setTimeout(runAdminOrderMgmtTestSuite, 300);
  });
} else {
  setTimeout(runAdminOrderMgmtTestSuite, 300);
}
