// Universal Root Entrypoint for Render, Vercel, and Cloud Hosting Environments
const { app, server } = require("./backend/server");

const PORT = process.env.PORT || 5000;

if (!server.listening && process.env.NODE_ENV !== "test") {
  server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🔥 Spicy Spoon Production Server running on port ${PORT}`);
    console.log(`⚡ WebSocket Server active on ws://localhost:${PORT}`);
    console.log(`====================================================`);
  });
}

module.exports = { app, server };
