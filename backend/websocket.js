const { WebSocketServer, WebSocket } = require("ws");

let wss = null;

function initWebSocket(server) {
  wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    // Send initial connection confirmation
    ws.send(JSON.stringify({ type: "CONNECTED", message: "Connected to Spicy Spoon live feed" }));

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === "PING") {
          ws.send(JSON.stringify({ type: "PONG" }));
        }
      } catch (e) {
        // ignore malformed msg
      }
    });

    ws.on("error", (err) => {
      console.error("WebSocket client error:", err.message);
    });
  });

  console.log("WebSocket server attached to HTTP server.");
  return wss;
}

const CLOUD_SYNC_TOPIC = "spicy_spoon_cloud_sync_prod_v2";

function broadcast(eventType, payload) {
  const message = JSON.stringify({ type: eventType, data: payload, timestamp: new Date().toISOString() });

  // 1. Direct WebSocket broadcast to local connected clients
  if (wss) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  // 2. Cloud broadcast across all PC and mobile browsers
  try {
    fetch(`https://ntfy.sh/${CLOUD_SYNC_TOPIC}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: eventType,
        data: payload,
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  } catch (err) {}
}

module.exports = { initWebSocket, broadcast };
