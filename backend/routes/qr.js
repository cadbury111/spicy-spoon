const express = require("express");
const router = express.Router();
const db = require("../db/database");
const QRCode = require("qrcode");
const { verifyStaffAuth } = require("../middleware/auth");

// Get Permanent Restaurant QR
router.get("/restaurant/:id", async (req, res) => {
  try {
    const restaurant = db.prepare("SELECT * FROM restaurants WHERE id = ? OR slug = ?").get(
      Number(req.params.id) || 0,
      req.params.id
    );

    if (!restaurant) {
      return res.status(404).json({ message: "Restaurant not found" });
    }

    const host = req.get("host") || "localhost:5173";
    const protocol = req.protocol === "https" || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const targetUrl = `${protocol}://${host}/#/restaurant/${restaurant.slug}`;

    const qrDataUrl = await QRCode.toDataURL(targetUrl, {
      width: 400,
      margin: 2,
      color: { dark: "#1b100a", light: "#ffffff" },
    });

    const qrSvg = await QRCode.toString(targetUrl, {
      type: "svg",
      margin: 2,
      color: { dark: "#1b100a", light: "#ffffff" },
    });

    res.json({
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        slug: restaurant.slug,
        address: restaurant.address,
        phone: restaurant.phone,
      },
      targetUrl,
      qrCodeDataUrl: qrDataUrl,
      qrCodeSvg: qrSvg,
      token: restaurant.qr_code_token,
    });
  } catch (error) {
    console.error("Restaurant QR generation error:", error);
    res.status(500).json({ message: "Failed to generate QR code", error: error.message });
  }
});

// Get Table-Specific QR code
router.get("/table/:tableId", async (req, res) => {
  try {
    const tableParam = req.params.tableId;
    const cleanNumber = String(tableParam).replace(/^Table\s*/i, "").trim();

    const table = db.prepare("SELECT * FROM restaurant_tables WHERE id = ? OR table_number = ? OR table_number = ?").get(
      Number(cleanNumber) || 0,
      cleanNumber,
      `T${cleanNumber.replace(/^T/i, "")}`
    );

    if (!table) {
      return res.status(404).json({ message: "Table not found" });
    }

    const restaurant = db.prepare("SELECT slug FROM restaurants WHERE id = 1").get();
    const slug = restaurant?.slug || "spicy-spoon";

    const host = req.get("host") || "localhost:5173";
    const protocol = req.protocol === "https" || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    // Target URL matches Phase 4 specification: /#/restaurant/spicy-spoon/table/T5
    const targetUrl = `${protocol}://${host}/#/restaurant/${slug}/table/${table.table_number}`;

    const qrDataUrl = await QRCode.toDataURL(targetUrl, {
      width: 400,
      margin: 2,
      color: { dark: "#1b100a", light: "#ffffff" },
    });

    const qrSvg = await QRCode.toString(targetUrl, {
      type: "svg",
      margin: 2,
      color: { dark: "#1b100a", light: "#ffffff" },
    });

    res.json({
      table: {
        id: table.id,
        table_number: table.table_number,
        section: table.section,
        capacity: table.capacity,
        status: table.status,
      },
      targetUrl,
      qrCodeDataUrl: qrDataUrl,
      qrCodeSvg: qrSvg,
    });
  } catch (error) {
    console.error("Table QR generation error:", error);
    res.status(500).json({ message: "Failed to generate table QR code", error: error.message });
  }
});

// Regenerate Restaurant QR token (ADMIN ONLY)
router.post("/regenerate", verifyStaffAuth(["ADMIN"]), (req, res) => {
  try {
    const newToken = `spicy-spoon-qr-${Date.now()}`;
    db.prepare("UPDATE restaurants SET qr_code_token = ? WHERE id = 1").run(newToken);

    res.json({
      message: "Restaurant QR code token regenerated successfully",
      token: newToken,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to regenerate QR code", error: error.message });
  }
});

module.exports = router;
