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
app.use("/api/auth", authRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/restaurants", restaurantsRouter);
app.use("/api/tables", tablesRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/menu", menuRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/bills", billsRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/qr", qrRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/settings", settingsRouter);

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