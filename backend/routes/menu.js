const express = require("express");
const router = express.Router();
const db = require("../db/database");
const { broadcast } = require("../websocket");
const { verifyStaffAuth } = require("../middleware/auth");

// Get all menu items
router.get("/", (req, res) => {
  try {
    const { category, available_only } = req.query;
    let queryStr = "SELECT * FROM menu_items WHERE 1=1";
    const params = [];

    if (category) {
      queryStr += " AND category = ?";
      params.push(category);
    }
    if (available_only === "true") {
      queryStr += " AND is_available = 1";
    }

    queryStr += " ORDER BY category ASC, id ASC";

    const items = db.prepare(queryStr).all(...params);
    res.json(items);
  } catch (error) {
    console.error("Error fetching menu:", error);
    res.status(500).json({ message: "Failed to fetch menu items", error: error.message });
  }
});

// Get single menu item
router.get("/:id", (req, res) => {
  try {
    const item = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(Number(req.params.id));
    if (!item) {
      return res.status(404).json({ message: "Menu item not found" });
    }
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: "Error fetching menu item", error: error.message });
  }
});

// Add new menu item (ADMIN ONLY)
router.post("/", verifyStaffAuth(["ADMIN"]), (req, res) => {
  try {
    const { name, category, price, description = "", image_url = "", is_veg = 0, is_spicy = 0 } = req.body;
    if (!name || !category || price === undefined) {
      return res.status(400).json({ message: "Name, category, and price are required" });
    }

    const insert = db.prepare(`
      INSERT INTO menu_items (name, category, price, description, image_url, is_veg, is_spicy, is_available)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const result = insert.run(name, category, Number(price), description, image_url, Number(is_veg), Number(is_spicy));

    const newItem = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(result.lastInsertRowid);
    broadcast("MENU_UPDATED", newItem);

    res.status(201).json({ message: "Menu item added successfully", item: newItem });
  } catch (error) {
    res.status(500).json({ message: "Failed to add menu item", error: error.message });
  }
});

// Update menu item (ADMIN ONLY)
router.put("/:id", verifyStaffAuth(["ADMIN"]), (req, res) => {
  try {
    const itemId = Number(req.params.id);
    const { name, category, price, description, image_url, is_veg, is_spicy, is_available } = req.body;

    const existing = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(itemId);
    if (!existing) {
      return res.status(404).json({ message: "Menu item not found" });
    }

    const update = db.prepare(`
      UPDATE menu_items
      SET name = COALESCE(?, name),
          category = COALESCE(?, category),
          price = COALESCE(?, price),
          description = COALESCE(?, description),
          image_url = COALESCE(?, image_url),
          is_veg = COALESCE(?, is_veg),
          is_spicy = COALESCE(?, is_spicy),
          is_available = COALESCE(?, is_available)
      WHERE id = ?
    `);

    update.run(
      name !== undefined ? name : null,
      category !== undefined ? category : null,
      price !== undefined ? Number(price) : null,
      description !== undefined ? description : null,
      image_url !== undefined ? image_url : null,
      is_veg !== undefined ? Number(is_veg) : null,
      is_spicy !== undefined ? Number(is_spicy) : null,
      is_available !== undefined ? Number(is_available) : null,
      itemId
    );

    const updatedItem = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(itemId);
    broadcast("MENU_UPDATED", updatedItem);

    res.json({ message: "Menu item updated successfully", item: updatedItem });
  } catch (error) {
    res.status(500).json({ message: "Failed to update menu item", error: error.message });
  }
});

module.exports = router;
