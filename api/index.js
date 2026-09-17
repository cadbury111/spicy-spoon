const { app } = require("../backend/server");

module.exports = (req, res) => {
  // Enable CORS headers for cross-origin or same-origin serverless environments
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-matched-path, Cache-Control, Pragma");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Restore the original request path if rewritten by Vercel serverless engine
  let reconstructedUrl = "";
  if (req.url && req.url.includes("__path=")) {
    try {
      const parsedUrl = new URL(req.url, "http://localhost");
      const pathArg = parsedUrl.searchParams.get("__path");
      if (pathArg) {
        parsedUrl.searchParams.delete("__path");
        const remainingQuery = parsedUrl.searchParams.toString();
        reconstructedUrl = `/api/${pathArg.replace(/^\/+/, "")}${remainingQuery ? `?${remainingQuery}` : ""}`;
      }
    } catch (e) { }
  }

  if (reconstructedUrl) {
    req.url = reconstructedUrl;
  } else {
    const matchedPath =
      req.headers["x-matched-path"] ||
      req.headers["x-vercel-matched-path"] ||
      req.headers["x-forwarded-uri"] ||
      req.headers["x-original-url"] ||
      req.headers["x-now-route-matches"];

    if (matchedPath && !matchedPath.includes("index.js")) {
      const queryPart = req.url && req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
      req.url = matchedPath + (matchedPath.includes("?") ? "" : queryPart);
    } else if (req.url && req.url.startsWith("/api/index.js")) {
      req.url = req.url.replace("/api/index.js", "/api") || "/api";
    } else if (req.url && req.url.startsWith("/index.js")) {
      req.url = req.url.replace("/index.js", "/api") || "/api";
    }
  }

  return app(req, res);
};
