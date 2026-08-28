const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");

const dbDir = path.join(__dirname);
let dbPath;

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
if (isServerless) {
  dbPath = path.join("/tmp", "restaurant.db");
  const bundledDbPath = path.join(dbDir, "restaurant.db");
  if (fs.existsSync(bundledDbPath) && !fs.existsSync(dbPath)) {
    try {
      fs.copyFileSync(bundledDbPath, dbPath);
    } catch (e) {}
  }
} else {
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  dbPath = path.join(dbDir, "restaurant.db");
}

const db = new DatabaseSync(dbPath);

// Enable foreign keys
try {
  db.exec("PRAGMA foreign_keys = ON;");
} catch (e) {
  console.warn("PRAGMA foreign_keys warning:", e.message);
}

// ==========================================
// 1. CREATE TABLES SCHEMA
// ==========================================
db.exec(`
  CREATE TABLE IF NOT EXISTS restaurants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    tagline TEXT,
    address TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    opening_time TEXT DEFAULT '11:00 AM',
    closing_time TEXT DEFAULT '11:00 PM',
    booking_duration_mins INTEGER DEFAULT 90,
    buffer_time_mins INTEGER DEFAULT 15,
    tax_rate REAL DEFAULT 5.0,
    service_charge_rate REAL DEFAULT 2.5,
    qr_code_token TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS restaurant_tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER NOT NULL DEFAULT 1,
    table_number TEXT NOT NULL UNIQUE,
    capacity INTEGER NOT NULL,
    section TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'AVAILABLE',
    current_booking_id INTEGER,
    current_order_id INTEGER,
    current_session_id TEXT,
    x_pos INTEGER DEFAULT 0,
    y_pos INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    description TEXT,
    image_url TEXT,
    is_veg INTEGER DEFAULT 0,
    is_spicy INTEGER DEFAULT 0,
    is_available INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_number TEXT NOT NULL UNIQUE,
    restaurant_id INTEGER NOT NULL DEFAULT 1,
    table_id INTEGER NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT,
    booking_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    guest_count INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'CONFIRMED',
    special_notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS guest_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL UNIQUE,
    restaurant_id INTEGER NOT NULL DEFAULT 1,
    table_id INTEGER NOT NULL,
    table_number TEXT NOT NULL,
    booking_id INTEGER,
    customer_name TEXT DEFAULT 'Guest',
    customer_phone TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, COMPLETED, CANCELLED
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT NOT NULL UNIQUE,
    restaurant_id INTEGER NOT NULL DEFAULT 1,
    table_id INTEGER NOT NULL,
    table_number TEXT NOT NULL,
    booking_id INTEGER,
    session_id TEXT NOT NULL DEFAULT 'SESSION-DEFAULT',
    round_number INTEGER DEFAULT 1,
    customer_name TEXT DEFAULT 'Guest',
    customer_phone TEXT,
    status TEXT NOT NULL DEFAULT 'ORDER_PLACED',
    subtotal REAL NOT NULL DEFAULT 0,
    tax REAL NOT NULL DEFAULT 0,
    service_charge REAL NOT NULL DEFAULT 0,
    discount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    menu_item_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    total_price REAL NOT NULL,
    special_instruction TEXT
  );

  CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_number TEXT NOT NULL UNIQUE,
    restaurant_id INTEGER NOT NULL DEFAULT 1,
    table_id INTEGER NOT NULL,
    table_number TEXT NOT NULL,
    session_id TEXT NOT NULL DEFAULT 'SESSION-DEFAULT',
    order_id INTEGER,
    customer_name TEXT DEFAULT 'Guest',
    subtotal REAL NOT NULL,
    tax REAL NOT NULL,
    service_charge REAL NOT NULL,
    discount REAL NOT NULL DEFAULT 0,
    grand_total REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'UNPAID',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id TEXT,
    idempotency_key TEXT,
    bill_id INTEGER NOT NULL,
    order_id INTEGER,
    session_id TEXT,
    payment_method TEXT NOT NULL,
    amount REAL NOT NULL,
    transaction_id TEXT NOT NULL UNIQUE,
    gateway_reference TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    signature_verified INTEGER DEFAULT 0,
    gateway_response TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    paid_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS staff_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL, -- 'ADMIN' or 'KITCHEN'
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS restaurant_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ==========================================
// 2. SAFE SCHEMA MIGRATIONS (For existing DB)
// ==========================================
function safeAddColumn(tableName, columnName, columnDefinition) {
  try {
    const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all();
    const exists = tableInfo.some((col) => col.name === columnName);
    if (!exists) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition};`);
      console.log(`Migrated: Added column ${columnName} to ${tableName}`);
    }
  } catch (err) {
    console.warn(`Migration notice for ${tableName}.${columnName}:`, err.message);
  }
}

safeAddColumn("restaurants", "service_charge_rate", "REAL DEFAULT 2.5");
safeAddColumn("restaurant_tables", "current_session_id", "TEXT");
safeAddColumn("orders", "session_id", "TEXT NOT NULL DEFAULT 'SESSION-DEFAULT'");
safeAddColumn("orders", "round_number", "INTEGER DEFAULT 1");
safeAddColumn("bills", "session_id", "TEXT NOT NULL DEFAULT 'SESSION-DEFAULT'");
safeAddColumn("payments", "payment_id", "TEXT");
safeAddColumn("payments", "idempotency_key", "TEXT");
safeAddColumn("payments", "session_id", "TEXT");
safeAddColumn("payments", "gateway_reference", "TEXT");
safeAddColumn("payments", "signature_verified", "INTEGER DEFAULT 0");

// Unique index for idempotency created AFTER safeAddColumn
try {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency ON payments(idempotency_key);");
} catch (e) {
  console.warn("Index notice:", e.message);
}

// Update service charge default to 2.5% if currently 5.0%
try {
  db.exec("UPDATE restaurants SET service_charge_rate = 2.5 WHERE id = 1 AND service_charge_rate = 5.0;");
} catch (e) {}

// ==========================================
// 3. SEED STAFF USERS (ADMIN & KITCHEN)
// ==========================================
const staffCountQuery = db.prepare("SELECT COUNT(*) as count FROM staff_users");
const staffCount = staffCountQuery.get().count;

if (staffCount === 0) {
  console.log("Seeding staff accounts (Admin & Kitchen)...");
  const insertStaff = db.prepare(`
    INSERT INTO staff_users (username, password_hash, role, name, status)
    VALUES (?, ?, ?, ?, 'ACTIVE')
  `);

  const adminHash = bcrypt.hashSync("admin123", 10);
  const kitchenHash = bcrypt.hashSync("kitchen123", 10);

  insertStaff.run("admin", adminHash, "ADMIN", "Restaurant Manager");
  insertStaff.run("kitchen", kitchenHash, "KITCHEN", "Head Chef (KDS)");
  console.log("✓ Seeded Admin (admin/admin123) and Kitchen (kitchen/kitchen123) accounts.");
}

// ==========================================
// 4. SEED INITIAL DATA IF EMPTY OR UPGRADE SECTIONS
// ==========================================
const restaurantCountQuery = db.prepare("SELECT COUNT(*) as count FROM restaurants");
const restaurantCount = restaurantCountQuery.get().count;

if (restaurantCount === 0) {
  console.log("Seeding initial restaurant data...");

  const insertRestaurant = db.prepare(`
    INSERT INTO restaurants (id, name, slug, tagline, address, phone, email, opening_time, closing_time, booking_duration_mins, buffer_time_mins, tax_rate, service_charge_rate, qr_code_token)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertRestaurant.run(
    1,
    "Spicy Spoon",
    "spicy-spoon",
    "Authentic Flavours. Warm Hospitality.",
    "Tiruppur-Palladam road, Tamil Nadu",
    "+91 73958 77142",
    "contact@spicyspoon.com",
    "11:00 AM",
    "11:00 PM",
    90,
    15,
    5.0,
    2.5,
    "spicy-spoon-qr-token-2026"
  );
}

// Ensure 12 predefined tables across the 4 standard sections
const targetTables = [
  // Main Hall (T1-T4)
  { number: "T1", capacity: 2, section: "Main Hall", x: 1, y: 1 },
  { number: "T2", capacity: 2, section: "Main Hall", x: 2, y: 1 },
  { number: "T3", capacity: 4, section: "Main Hall", x: 1, y: 2 },
  { number: "T4", capacity: 4, section: "Main Hall", x: 2, y: 2 },
  // Window Side (T5-T8)
  { number: "T5", capacity: 4, section: "Window Side", x: 3, y: 1 },
  { number: "T6", capacity: 4, section: "Window Side", x: 4, y: 1 },
  { number: "T7", capacity: 6, section: "Window Side", x: 3, y: 2 },
  { number: "T8", capacity: 6, section: "Window Side", x: 4, y: 2 },
  // Outdoor Patio (T9-T10)
  { number: "T9", capacity: 4, section: "Outdoor Patio", x: 1, y: 3 },
  { number: "T10", capacity: 6, section: "Outdoor Patio", x: 2, y: 3 },
  // VIP Lounge (T11-T12)
  { number: "T11", capacity: 8, section: "VIP Lounge", x: 3, y: 3 },
  { number: "T12", capacity: 8, section: "VIP Lounge", x: 4, y: 3 },
];

const checkTableStmt = db.prepare("SELECT * FROM restaurant_tables WHERE table_number = ?");
const insertTableStmt = db.prepare(`
  INSERT INTO restaurant_tables (table_number, capacity, section, status, x_pos, y_pos)
  VALUES (?, ?, ?, 'AVAILABLE', ?, ?)
`);
const updateTableStmt = db.prepare(`
  UPDATE restaurant_tables
  SET capacity = ?, section = ?, x_pos = ?, y_pos = ?
  WHERE table_number = ?
`);

for (const t of targetTables) {
  const existing = checkTableStmt.get(t.number);
  if (!existing) {
    insertTableStmt.run(t.number, t.capacity, t.section, t.x, t.y);
  } else {
    updateTableStmt.run(t.capacity, t.section, t.x, t.y, t.number);
  }
}

// Seed Menu Items if empty
const menuCount = db.prepare("SELECT COUNT(*) as count FROM menu_items").get().count;
if (menuCount === 0) {
  const insertMenu = db.prepare(`
    INSERT INTO menu_items (name, category, price, description, image_url, is_veg, is_spicy, is_available)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const initialMenu = [
    {
      name: "Tandoori Chicken",
      category: "Starters",
      price: 349,
      description: "Smoky, juicy chicken marinated in aromatic spices and grilled to perfection in clay oven.",
      image_url: "/src/assets/tandoori-chicken.jpg",
      is_veg: 0,
      is_spicy: 1,
      is_available: 1,
    },
    {
      name: "Paneer Tikka",
      category: "Starters",
      price: 249,
      description: "Soft paneer cubes marinated in traditional spices and chargrilled with bell peppers.",
      image_url: "/src/assets/paneer-tikka.jpg",
      is_veg: 1,
      is_spicy: 0,
      is_available: 1,
    },
    {
      name: "Chilli Chicken",
      category: "Starters",
      price: 269,
      description: "Crispy chicken tossed with crunchy peppers, spring onions, and our signature spicy glaze.",
      image_url: "/src/assets/chilli-chicken.jpg",
      is_veg: 0,
      is_spicy: 1,
      is_available: 1,
    },
    {
      name: "Spicy Prawn Fry",
      category: "Seafood Specials",
      price: 379,
      description: "Fresh coastal prawns pan-roasted with hand-ground southern spices and curry leaves.",
      image_url: "/src/assets/prawn-fry.jpg",
      is_veg: 0,
      is_spicy: 1,
      is_available: 1,
    },
    {
      name: "Grilled Fish",
      category: "Seafood Specials",
      price: 349,
      description: "Fresh sear fish steak marinated in lemon herb butter and grilled to juicy tenderness.",
      image_url: "/src/assets/grilled-fish.jpg",
      is_veg: 0,
      is_spicy: 0,
      is_available: 1,
    },
    {
      name: "Butter Chicken",
      category: "Main Course",
      price: 329,
      description: "Tender shredded tandoori chicken simmered in a silky tomato, cashew, and butter gravy.",
      image_url: "/src/assets/butter-chicken.jpg",
      is_veg: 0,
      is_spicy: 0,
      is_available: 1,
    },
    {
      name: "Chicken Biryani",
      category: "Biryani & Rice",
      price: 299,
      description: "Fragrant aged basmati rice slow-cooked on dum with spiced tender chicken cuts & saffron.",
      image_url: "/src/assets/chicken-biryani.jpg",
      is_veg: 0,
      is_spicy: 1,
      is_available: 1,
    },
    {
      name: "Veg Fried Rice",
      category: "Biryani & Rice",
      price: 199,
      description: "Aromatic jasmine rice wok-tossed with fresh farm vegetables, garlic, and light soy sauce.",
      image_url: "/src/assets/veg-fried-rice.jpg",
      is_veg: 1,
      is_spicy: 0,
      is_available: 1,
    },
    {
      name: "Chicken Noodles",
      category: "Main Course",
      price: 249,
      description: "Wok-tossed hakka noodles with shredded chicken, crisp cabbage, and signature seasonings.",
      image_url: "/src/assets/chicken-noodles.jpg",
      is_veg: 0,
      is_spicy: 0,
      is_available: 1,
    },
    {
      name: "Gulab Jamun Delight",
      category: "Desserts",
      price: 149,
      description: "Warm golden khoya dumplings soaked in fragrant cardamom & rose sugar syrup with pistachios.",
      image_url: "/src/assets/gulab-jamun.jpg",
      is_veg: 1,
      is_spicy: 0,
      is_available: 1,
    },
  ];

  for (const m of initialMenu) {
    insertMenu.run(m.name, m.category, m.price, m.description, m.image_url, m.is_veg, m.is_spicy, m.is_available);
  }
}

// Seed default restaurant settings if empty
const settingsCount = db.prepare("SELECT COUNT(*) as count FROM restaurant_settings").get().count;
if (settingsCount === 0) {
  const insertSetting = db.prepare("INSERT INTO restaurant_settings (key, value) VALUES (?, ?)");
  insertSetting.run("restaurant_name", "Spicy Spoon");
  insertSetting.run("tax_rate", "5.0");
  insertSetting.run("service_charge_rate", "2.5");
  insertSetting.run("booking_duration_mins", "90");
  insertSetting.run("payment_mode", process.env.PAYMENT_MODE || "DEV_SANDBOX");
  insertSetting.run("upi_vpa", "cadbury470@oksbi");
}

console.log("Database initialized and verified successfully.");

module.exports = db;
