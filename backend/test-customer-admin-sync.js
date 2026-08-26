const http = require("http");
const { app, server } = require("./server");
const db = require("./db/database");

async function testCustomerAdminSync() {
  console.log("==================================================");
  console.log("🔄 Testing Customer -> Admin Order Sync Flow");
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
    // 1. Admin Login
    console.log("1. Authenticating Admin Staff...");
    const authRes = await req("/api/auth/login", "POST", { username: "admin", password: "admin123" });
    const adminToken = authRes.data?.token;
    if (!adminToken) throw new Error("Admin login failed");
    console.log("✓ Admin authenticated");

    // 2. Customer places Order from Customer Portal (No Auth)
    console.log("\n2. Customer placing Order on Table T5...");
    const orderPayload = {
      tableNumber: "T5",
      customer_name: "Test Customer Sync",
      customer_phone: "+91 98765 99887",
      items: [
        { id: 1, name: "Tandoori Chicken", quantity: 1, note: "Extra crispy" },
        { id: 2, name: "Butter Chicken", quantity: 2, note: "Mild spice" },
      ],
    };

    const orderRes = await req("/api/orders", "POST", orderPayload);
    if (orderRes.status !== 201 || !orderRes.data.order) {
      throw new Error(`Order placement failed: ${JSON.stringify(orderRes.data)}`);
    }

    const createdOrder = orderRes.data.order;
    console.log(`✓ Customer placed Order #${createdOrder.order_number} for Table ${createdOrder.table_number || createdOrder.tableNumber} (Total: ₹${createdOrder.total})`);

    // 3. Verify in SQLite Database directly
    console.log("\n3. Verifying persistence directly in SQLite Database...");
    const dbOrder = db.prepare("SELECT * FROM orders WHERE id = ?").get(createdOrder.id);
    if (!dbOrder) throw new Error("Order not found in SQLite orders table");
    const dbItems = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(createdOrder.id);
    if (dbItems.length !== 2) throw new Error(`Expected 2 items in database, found ${dbItems.length}`);
    console.log(`✓ Order verified in SQLite DB: Status=${dbOrder.status}, Items Count=${dbItems.length}`);

    // 4. Verify Admin Portal fetches the order
    console.log("\n4. Admin fetching all orders from /api/orders...");
    const adminOrdersRes = await req("/api/orders", "GET", null, adminToken);
    if (adminOrdersRes.status !== 200 || !Array.isArray(adminOrdersRes.data)) {
      throw new Error("Admin failed to fetch orders");
    }

    const foundInAdmin = adminOrdersRes.data.find((o) => o.id === createdOrder.id || o.order_number === createdOrder.order_number);
    if (!foundInAdmin) {
      throw new Error(`Order #${createdOrder.order_number} NOT FOUND in Admin orders list!`);
    }
    console.log(`✓ Order found in Admin Portal: Order #${foundInAdmin.order_number}, Table ${foundInAdmin.tableNumber || foundInAdmin.table_number}, Items=${foundInAdmin.items?.length}`);

    // 5. Verify Floor Map status updated
    console.log("\n5. Admin checking Floor Map table status for Table T5...");
    const tablesRes = await req("/api/tables", "GET");
    const tableT5 = tablesRes.data.find((t) => t.table_number === "T5");
    if (!tableT5 || tableT5.status !== "ORDER_PLACED") {
      throw new Error(`Table T5 status is ${tableT5?.status}, expected ORDER_PLACED`);
    }
    console.log(`✓ Table T5 status on Floor Map is correctly "${tableT5.status}"`);

    // 6. Test second customer order (Round 2 on same session)
    console.log("\n6. Customer placing Round 2 order on same session...");
    const round2Payload = {
      tableNumber: "T5",
      session_id: orderRes.data.session_id,
      customer_name: "Test Customer Sync",
      round_number: 2,
      items: [
        { id: 10, name: "Gulab Jamun", quantity: 2, note: "Warm" },
      ],
    };
    const round2Res = await req("/api/orders", "POST", round2Payload);
    if (round2Res.status !== 201) throw new Error("Round 2 order placement failed");
    console.log(`✓ Customer placed Round 2 Order #${round2Res.data.order.order_number}`);

    // 7. Verify Admin sees Round 2
    const adminOrdersAfterRound2 = await req("/api/orders", "GET", null, adminToken);
    const round2Found = adminOrdersAfterRound2.data.find((o) => o.id === round2Res.data.order.id);
    if (!round2Found) throw new Error("Round 2 order not found in Admin portal");
    console.log(`✓ Admin sees Round 2 Order #${round2Found.order_number} for Table ${round2Found.tableNumber}`);

    console.log("\n==================================================");
    console.log("🎉 CUSTOMER -> ADMIN ORDER SYNC VERIFIED 100%!");
    console.log("==================================================");
    process.exit(0);
  } catch (err) {
    console.error("❌ Test Failure:", err);
    process.exit(1);
  }
}

if (!server.listening) {
  server.listen(5000, () => {
    setTimeout(testCustomerAdminSync, 300);
  });
} else {
  setTimeout(testCustomerAdminSync, 300);
}
