const express = require("express");
const router = express.Router();
const db = require("../db/database");
const { broadcast } = require("../websocket");
const { verifyStaffAuth } = require("../middleware/auth");

// Get settings
router.get("/", (req, res) => {
  try {
    const restaurant = db.prepare("SELECT * FROM restaurants WHERE id = 1").get();
    if (!restaurant) {
      return res.status(404).json({ message: "Restaurant profile not found" });
    }
    res.json(restaurant);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch settings", error: error.message });
  }
});

// Update settings (ADMIN ONLY)
router.put("/", verifyStaffAuth(["ADMIN"]), (req, res) => {
  try {
    const {
      name,
      tagline,
      address,
      phone,
      email,
      opening_time,
      closing_time,
      booking_duration_mins,
      buffer_time_mins,
      tax_rate,
      service_charge_rate,
    } = req.body;

    const update = db.prepare(`
      UPDATE restaurants
      SET name = COALESCE(?, name),
          tagline = COALESCE(?, tagline),
          address = COALESCE(?, address),
          phone = COALESCE(?, phone),
          email = COALESCE(?, email),
          opening_time = COALESCE(?, opening_time),
          closing_time = COALESCE(?, closing_time),
          booking_duration_mins = COALESCE(?, booking_duration_mins),
          buffer_time_mins = COALESCE(?, buffer_time_mins),
          tax_rate = COALESCE(?, tax_rate),
          service_charge_rate = COALESCE(?, service_charge_rate)
      WHERE id = 1
    `);

    update.run(
      name || null,
      tagline || null,
      address || null,
      phone || null,
      email || null,
      opening_time || null,
      closing_time || null,
      booking_duration_mins !== undefined ? Number(booking_duration_mins) : null,
      buffer_time_mins !== undefined ? Number(buffer_time_mins) : null,
      tax_rate !== undefined ? Number(tax_rate) : null,
      service_charge_rate !== undefined ? Number(service_charge_rate) : null
    );

    const updated = db.prepare("SELECT * FROM restaurants WHERE id = 1").get();
    broadcast("SETTINGS_UPDATED", updated);

    res.json({ message: "Settings updated successfully", settings: updated });
  } catch (error) {
    console.error("Error updating settings:", error);
    res.status(500).json({ message: "Failed to update settings", error: error.message });
  }
});

module.exports = router;
