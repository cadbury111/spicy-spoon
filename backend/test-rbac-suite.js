const http = require("http");
const { app, server } = require("./server");

async function runRbacTestSuite() {
  console.log("==================================================");
  console.log("🔒 Running Spicy Spoon RBAC & Architecture Test Suite");
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
    // 1. Test Public Guest Customer Access (NO LOGIN)
    console.log("\n1. Testing Public Guest Customer Access (No Auth Headers)...");
    const menuRes = await req("/api/menu");
    if (menuRes.status !== 200 || !Array.isArray(menuRes.data)) {
      throw new Error(`Public menu access failed: status ${menuRes.status}`);
    }
    console.log(`✓ Guest accessed public menu successfully (${menuRes.data.length} dishes)`);

    const tablesRes = await req("/api/tables");
    if (tablesRes.status !== 200 || !Array.isArray(tablesRes.data)) {
      throw new Error("Public table list access failed");
    }
    console.log(`✓ Guest accessed table availability successfully (${tablesRes.data.length} tables)`);

    // 2. Test Staff Login
    console.log("\n2. Testing Staff Login Endpoint (POST /api/auth/login)...");
    // Invalid credentials
    const badLogin = await req("/api/auth/login", "POST", { username: "admin", password: "wrongpassword" });
    if (badLogin.status !== 401) {
      throw new Error(`Expected 401 for wrong password, got ${badLogin.status}`);
    }
    console.log("✓ Invalid credentials correctly rejected (401 Unauthorized)");

    // Admin Login
    const adminLogin = await req("/api/auth/login", "POST", { username: "admin", password: "admin123" });
    if (adminLogin.status !== 200 || !adminLogin.data.token || adminLogin.data.user.role !== "ADMIN") {
      throw new Error("Admin login failed");
    }
    const adminToken = adminLogin.data.token;
    console.log(`✓ Admin logged in successfully (Role: ${adminLogin.data.user.role})`);

    // Kitchen Login
    const kitchenLogin = await req("/api/auth/login", "POST", { username: "kitchen", password: "kitchen123" });
    if (kitchenLogin.status !== 200 || !kitchenLogin.data.token || kitchenLogin.data.user.role !== "KITCHEN") {
      throw new Error("Kitchen login failed");
    }
    const kitchenToken = kitchenLogin.data.token;
    console.log(`✓ Kitchen logged in successfully (Role: ${kitchenLogin.data.user.role})`);

    // 3. Test RBAC: Unauthenticated user calling Admin endpoint
    console.log("\n3. Testing RBAC Protection: Unauthenticated access to /api/reports/analytics...");
    const unauthReports = await req("/api/reports/analytics");
    if (unauthReports.status !== 401) {
      throw new Error(`Expected 401 Unauthorized for unauthenticated reports access, got ${unauthReports.status}`);
    }
    console.log("✓ Unauthenticated request rejected (401 Unauthorized)");

    // 4. Test RBAC: Kitchen user calling Admin-only endpoint (Reports)
    console.log("\n4. Testing RBAC Protection: Kitchen staff calling /api/reports/analytics (ADMIN ONLY)...");
    const kitchenReports = await req("/api/reports/analytics", "GET", null, kitchenToken);
    if (kitchenReports.status !== 403) {
      throw new Error(`Expected 403 Forbidden for Kitchen accessing Reports, got ${kitchenReports.status}`);
    }
    console.log("✓ Kitchen role rejected on Admin-only endpoint (403 Forbidden)");

    // 5. Test RBAC: Kitchen user calling Admin-only Cash Confirmation
    console.log("\n5. Testing RBAC Protection: Kitchen staff calling POST /api/payments/cash-confirm (ADMIN ONLY)...");
    const kitchenCash = await req("/api/payments/cash-confirm", "POST", { bill_id: 1 }, kitchenToken);
    if (kitchenCash.status !== 403) {
      throw new Error(`Expected 403 Forbidden for Kitchen calling cash-confirm, got ${kitchenCash.status}`);
    }
    console.log("✓ Kitchen role rejected on Cash Confirmation (403 Forbidden)");

    // 6. Test RBAC: Admin accessing Reports
    console.log("\n6. Testing RBAC Authorization: Admin staff calling /api/reports/analytics...");
    const adminReports = await req("/api/reports/analytics", "GET", null, adminToken);
    if (adminReports.status !== 200 || !adminReports.data.summary) {
      throw new Error(`Expected 200 OK for Admin reports access, got ${adminReports.status}`);
    }
    console.log("✓ Admin accessed Reports successfully (200 OK)");

    // 7. Test RBAC: Kitchen updating Order Status
    console.log("\n7. Testing RBAC Authorization: Kitchen updating order preparation status...");
    // Create guest order first
    const guestOrder = await req("/api/orders", "POST", {
      tableNumber: "T6",
      customer_name: "Anita Guest",
      items: [{ id: menuRes.data[0].id, name: menuRes.data[0].name, quantity: 1 }],
    });
    const orderId = guestOrder.data.order.id;
    const sessionId = guestOrder.data.session_id;

    // Kitchen updates status to PREPARING
    const kitchenUpdate = await req(`/api/orders/${orderId}/status`, "PUT", { status: "PREPARING" }, kitchenToken);
    if (kitchenUpdate.status !== 200 || kitchenUpdate.data.order.status !== "PREPARING") {
      throw new Error(`Kitchen failed to update order status: ${kitchenUpdate.status}`);
    }
    console.log(`✓ Kitchen successfully transitioned order #${orderId} to PREPARING (200 OK)`);

    // 8. Test Guest Session Dashboard
    console.log(`\n8. Testing Public Guest Session Dashboard (GET /api/sessions/${sessionId})...`);
    const sessionRes = await req(`/api/sessions/${sessionId}`);
    if (sessionRes.status !== 200 || !sessionRes.data.session || sessionRes.data.session.customer_name !== "Anita Guest") {
      throw new Error("Guest session lookup failed");
    }
    console.log(`✓ Guest session retrieved: Table ${sessionRes.data.session.table_number}, Guest "${sessionRes.data.session.customer_name}", Subtotal=₹${sessionRes.data.bill.subtotal}`);

    // 9. Test Staff User Management (Admin only)
    console.log("\n9. Testing Staff Management (POST /api/auth/staff)...");
    // Kitchen trying to create staff -> 403 Forbidden
    const kitchenCreateStaff = await req(
      "/api/auth/staff",
      "POST",
      { username: "newcook", password: "password123", name: "Junior Cook", role: "KITCHEN" },
      kitchenToken
    );
    if (kitchenCreateStaff.status !== 403) {
      throw new Error(`Expected 403 when Kitchen creates staff, got ${kitchenCreateStaff.status}`);
    }
    console.log("✓ Kitchen role forbidden from managing staff (403 Forbidden)");

    // Admin creating staff -> 201 Created
    const randomUser = `cook_${Date.now().toString().slice(-4)}`;
    const adminCreateStaff = await req(
      "/api/auth/staff",
      "POST",
      { username: randomUser, password: "password123", name: "Sous Chef", role: "KITCHEN" },
      adminToken
    );
    if (adminCreateStaff.status !== 201) {
      throw new Error(`Admin failed to create staff account: ${adminCreateStaff.data.message}`);
    }
    console.log(`✓ Admin created new staff user "${randomUser}" successfully (201 Created)`);

    console.log("\n==================================================");
    console.log("🎉 ALL RBAC, AUTH & GUEST ARCHITECTURE TESTS PASSED!");
    console.log("==================================================");
    process.exit(0);
  } catch (err) {
    console.error("❌ RBAC Test Failure:", err);
    process.exit(1);
  }
}

if (!server.listening) {
  server.listen(5000, () => {
    setTimeout(runRbacTestSuite, 300);
  });
} else {
  setTimeout(runRbacTestSuite, 300);
}
