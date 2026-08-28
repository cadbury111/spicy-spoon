const http = require("http");
const express = require("express");
const cors = require("cors");
const db = require("./db/database");
const { initWebSocket } = require("./websocket");

const authRouter = require("./routes/auth");
const sessionsRouter = require("./routes/sessions");
const restaurantsRouter = require("./routes/restaurants");
const tablesRouter = require("./routes/tables");
const bookingsRouter = require("./routes/bookings");
const menuRouter = require("./routes/menu");
const ordersRouter = require("./routes/orders");
const billsRouter = require("./routes/bills");
const paymentsRouter = require("./routes/payments");
const qrRouter = require("./routes/qr");
const reportsRouter = require("./routes/reports");
const settingsRouter = require("./routes/settings");

const app = express();

app.use(cors());
app.use(express.json());

// Health Check / Test Route
app.get("/", (req, res) => {
  res.json({
    message: "Spicy Spoon Backend & Real-time Engine is Running 🔥",
    version: "3.0.0",
    architecture: {
      customer: "Public Guest Access (No Login Required)",
      staff: "Authenticated Access (ADMIN / KITCHEN with RBAC)",
    },
    features: [
      "Guest Table Floor Map & Capacity Booking",
      "Table QR Detection & Guest Dining Sessions",
      "Multi-Round Order Lifecycle (Placed -> Cooking -> Ready -> Served)",
      "Server-Authoritative Live Aggregated Invoices",
      "Idempotent Payment Settlement (UPI / Card / Cash)",
      "Kitchen Display System (KDS)",
      "Admin Operations, Live Floor Map & Staff RBAC",
    ],
  });
});

// API Routes
const routers = [
  { path: "/auth", router: authRouter },
  { path: "/sessions", router: sessionsRouter },
  { path: "/restaurants", router: restaurantsRouter },
  { path: "/tables", router: tablesRouter },
  { path: "/bookings", router: bookingsRouter },
  { path: "/menu", router: menuRouter },
  { path: "/orders", router: ordersRouter },
  { path: "/bills", router: billsRouter },
  { path: "/payments", router: paymentsRouter },
  { path: "/qr", router: qrRouter },
  { path: "/reports", router: reportsRouter },
  { path: "/settings", router: settingsRouter },
];

routers.forEach(({ path, router }) => {
  app.use(`/api${path}`, router);
  app.use(path, router);
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ message: "Internal server error", error: err.message });
});

// Create HTTP Server & Attach WebSocket
const server = http.createServer(app);
initWebSocket(server);

const PORT = process.env.PORT || 5000;
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🔥 Spicy Spoon Server running on http://localhost:${PORT}`);
    console.log(`⚡ WebSocket Server active on ws://localhost:${PORT}`);
    console.log(`====================================================`);
  });
}

module.exports = { app, server };