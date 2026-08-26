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

function broadcast(eventType, payload) {
  if (!wss) return;
  const message = JSON.stringify({ type: eventType, data: payload, timestamp: new Date().toISOString() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

module.exports = { initWebSocket, broadcast };
