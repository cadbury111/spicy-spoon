const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");

// Determine database mode from environment
const postgresUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const tursoUrl = process.env.TURSO_DATABASE_URL;

let dbType = "sqlite";
let pgPool = null;
let tursoClient = null;
let sqliteDb = null;

if (postgresUrl) {
  dbType = "postgres";
  const { Pool } = require("pg");
  pgPool = new Pool({
    connectionString: postgresUrl,
    ssl: postgresUrl.includes("localhost") || postgresUrl.includes("127.0.0.1") ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  console.log("✓ Centralized PostgreSQL Database connected via DATABASE_URL / POSTGRES_URL.");
} else if (tursoUrl) {
  dbType = "turso";
  const { createClient } = require("@libsql/client");
  tursoClient = createClient({
    url: tursoUrl,
    authToken: process.env.TURSO_AUTH_TOKEN || "",
  });
  console.log("✓ Centralized Turso (libSQL) Database connected via TURSO_DATABASE_URL.");
} else {
  dbType = "sqlite";
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const dbDir = path.join(__dirname);
  let dbPath;

  if (isServerless) {
    console.warn(
      "⚠️ [DATABASE NOTICE] Running on Vercel without DATABASE_URL or TURSO_DATABASE_URL.\n" +
      "For cross-device booking synchronization across serverless instances, configure DATABASE_URL (PostgreSQL/Neon/Supabase) or TURSO_DATABASE_URL in Vercel Project Settings."
    );
    dbPath = path.join("/tmp", "restaurant.db");
    const bundledDbPath = path.join(dbDir, "restaurant.db");
    if (fs.existsSync(bundledDbPath) && !fs.existsSync(dbPath)) {
      try {
        fs.copyFileSync(bundledDbPath, dbPath);
      } catch (e) { }
    }
  } else {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    dbPath = path.join(dbDir, "restaurant.db");
  }

  try {
    const { DatabaseSync } = require("node:sqlite");
    sqliteDb = new DatabaseSync(dbPath);
    try {
      sqliteDb.exec("PRAGMA foreign_keys = ON;");
    } catch (e) { }
  } catch (err) {
    // If node:sqlite is not available (e.g. Node 20 on Vercel), fall back to @libsql/client file protocol
    console.log("ℹ️ node:sqlite not available, falling back to @libsql/client for SQLite file:", dbPath);
    dbType = "turso";
    const { createClient } = require("@libsql/client");
    tursoClient = createClient({
      url: `file:${dbPath.replace(/\\/g, "/")}`,
    });
  }
}

// Convert ? placeholders to $1, $2 for PostgreSQL
function formatSqlForPg(sql) {
  let paramIndex = 1;
  return sql.replace(/\?/g, () => `$${paramIndex++}`);
}

// ==========================================
// UNIVERSAL ASYNC DATABASE INTERFACE
// ==========================================

let initPromise = null;

async function ensureInit() {
  if (initPromise) {
    try {
      await initPromise;
    } catch (err) {
      console.error("Database schema ensureInit error:", err);
    }
  }
}

async function query(sql, params = []) {
  await ensureInit();
  if (dbType === "postgres") {
    const res = await pgPool.query(formatSqlForPg(sql), params);
    return res.rows;
  } else if (dbType === "turso") {
    const res = await tursoClient.execute({ sql, args: params });
    return res.rows;
  } else {
    return sqliteDb.prepare(sql).all(...params);
  }
}

async function queryOne(sql, params = []) {
  await ensureInit();
  if (dbType === "postgres") {
    const res = await pgPool.query(formatSqlForPg(sql), params);
    return res.rows[0] || null;
  } else if (dbType === "turso") {
    const res = await tursoClient.execute({ sql, args: params });
    return res.rows[0] || null;
  } else {
    return sqliteDb.prepare(sql).get(...params) || null;
  }
}

async function execute(sql, params = []) {
  await ensureInit();
  if (dbType === "postgres") {
    let pgSql = sql;
    const isInsert = /^\s*INSERT\s+INTO/i.test(sql);
    if (isInsert && !/RETURNING/i.test(sql)) {
      pgSql = pgSql.trim().replace(/;$/, "") + " RETURNING id";
    }
    const res = await pgPool.query(formatSqlForPg(pgSql), params);
    const lastInsertRowid = res.rows?.[0]?.id || (res.rowCount > 0 ? 1 : null);
    return { lastInsertRowid, changes: res.rowCount };
  } else if (dbType === "turso") {
    const res = await tursoClient.execute({ sql, args: params });
    return {
      lastInsertRowid: Number(res.lastInsertRowid) || null,
      changes: res.rowsAffected || 0,
    };
  } else {
    const res = sqliteDb.prepare(sql).run(...params);
    return {
      lastInsertRowid: Number(res.lastInsertRowid) || null,
      changes: res.changes || 0,
    };
  }
}

async function transaction(fn) {
  await ensureInit();
  if (dbType === "postgres") {
    const client = await pgPool.connect();
    try {
      await client.query("BEGIN;");
      const trx = {
        query: async (sql, params = []) => {
          const res = await client.query(formatSqlForPg(sql), params);
          return res.rows;
        },
        queryOne: async (sql, params = []) => {
          const res = await client.query(formatSqlForPg(sql), params);
          return res.rows[0] || null;
        },
        execute: async (sql, params = []) => {
          let pgSql = sql;
          if (/^\s*INSERT\s+INTO/i.test(sql) && !/RETURNING/i.test(sql)) {
            pgSql = pgSql.trim().replace(/;$/, "") + " RETURNING id";
          }
          const res = await client.query(formatSqlForPg(pgSql), params);
          return {
            lastInsertRowid: res.rows?.[0]?.id || null,
            changes: res.rowCount,
          };
        },
      };
      const result = await fn(trx);
      await client.query("COMMIT;");
      return result;
    } catch (err) {
      await client.query("ROLLBACK;");
      throw err;
    } finally {
      client.release();
    }
  } else if (dbType === "turso") {
    const tx = await tursoClient.transaction("write");
    try {
      const trx = {
        query: async (sql, params = []) => {
          const res = await tx.execute({ sql, args: params });
          return res.rows;
        },
        queryOne: async (sql, params = []) => {
          const res = await tx.execute({ sql, args: params });
          return res.rows[0] || null;
        },
        execute: async (sql, params = []) => {
          const res = await tx.execute({ sql, args: params });
          return {
            lastInsertRowid: Number(res.lastInsertRowid) || null,
            changes: res.rowsAffected || 0,
          };
        },
      };
      const result = await fn(trx);
      await tx.commit();
      return result;
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  } else {
    // SQLite
    sqliteDb.exec("BEGIN IMMEDIATE;");
    try {
      const trx = {
        query: async (sql, params = []) => sqliteDb.prepare(sql).all(...params),
        queryOne: async (sql, params = []) => sqliteDb.prepare(sql).get(...params) || null,
        execute: async (sql, params = []) => {
          const res = sqliteDb.prepare(sql).run(...params);
          return { lastInsertRowid: Number(res.lastInsertRowid), changes: res.changes };
        },
      };
      const result = await fn(trx);
      sqliteDb.exec("COMMIT;");
      return result;
    } catch (err) {
      try {
        sqliteDb.exec("ROLLBACK;");
      } catch (e) { }
      throw err;
    }
  }
}

// ==========================================
// SEED INITIAL TABLES DATA
// ==========================================
const targetTables = [
  { number: "T1", capacity: 2, section: "Main Hall", x: 1, y: 1 },
  { number: "T2", capacity: 2, section: "Main Hall", x: 2, y: 1 },
  { number: "T3", capacity: 4, section: "Main Hall", x: 1, y: 2 },
  { number: "T4", capacity: 4, section: "Main Hall", x: 2, y: 2 },
  { number: "T5", capacity: 4, section: "Window Side", x: 3, y: 1 },
  { number: "T6", capacity: 4, section: "Window Side", x: 4, y: 1 },
  { number: "T7", capacity: 6, section: "Window Side", x: 3, y: 2 },
  { number: "T8", capacity: 6, section: "Window Side", x: 4, y: 2 },
  { number: "T9", capacity: 4, section: "Outdoor Patio", x: 1, y: 3 },
  { number: "T10", capacity: 6, section: "Outdoor Patio", x: 2, y: 3 },
  { number: "T11", capacity: 8, section: "VIP Lounge", x: 3, y: 3 },
  { number: "T12", capacity: 10, section: "VIP Lounge", x: 4, y: 3 },
];

const initialMenu = [
  { name: "Tandoori Chicken", category: "Starters", price: 349, description: "Smoky, juicy chicken marinated in aromatic spices and grilled to perfection in clay oven.", image_url: "/src/assets/tandoori-chicken.jpg", is_veg: 0, is_spicy: 1, is_available: 1 },
  { name: "Paneer Tikka", category: "Starters", price: 249, description: "Soft paneer cubes marinated in traditional spices and chargrilled with bell peppers.", image_url: "/src/assets/paneer-tikka.jpg", is_veg: 1, is_spicy: 0, is_available: 1 },
  { name: "Chilli Chicken", category: "Starters", price: 269, description: "Crispy chicken tossed with crunchy peppers, spring onions, and our signature spicy glaze.", image_url: "/src/assets/chilli-chicken.jpg", is_veg: 0, is_spicy: 1, is_available: 1 },
  { name: "Spicy Prawn Fry", category: "Seafood Specials", price: 379, description: "Fresh coastal prawns pan-roasted with hand-ground southern spices and curry leaves.", image_url: "/src/assets/prawn-fry.jpg", is_veg: 0, is_spicy: 1, is_available: 1 },
  { name: "Grilled Fish", category: "Seafood Specials", price: 349, description: "Fresh sear fish steak marinated in lemon herb butter and grilled to juicy tenderness.", image_url: "/src/assets/grilled-fish.jpg", is_veg: 0, is_spicy: 0, is_available: 1 },
  { name: "Butter Chicken", category: "Main Course", price: 329, description: "Tender shredded tandoori chicken simmered in a silky tomato, cashew, and butter gravy.", image_url: "/src/assets/butter-chicken.jpg", is_veg: 0, is_spicy: 0, is_available: 1 },
  { name: "Chicken Biryani", category: "Biryani & Rice", price: 299, description: "Fragrant aged basmati rice slow-cooked on dum with spiced tender chicken cuts & saffron.", image_url: "/src/assets/chicken-biryani.jpg", is_veg: 0, is_spicy: 1, is_available: 1 },
  { name: "Veg Fried Rice", category: "Biryani & Rice", price: 199, description: "Aromatic jasmine rice wok-tossed with fresh farm vegetables, garlic, and light soy sauce.", image_url: "/src/assets/veg-fried-rice.jpg", is_veg: 1, is_spicy: 0, is_available: 1 },
  { name: "Chicken Noodles", category: "Main Course", price: 249, description: "Wok-tossed hakka noodles with shredded chicken, crisp cabbage, and signature seasonings.", image_url: "/src/assets/chicken-noodles.jpg", is_veg: 0, is_spicy: 0, is_available: 1 },
  { name: "Gulab Jamun Delight", category: "Desserts", price: 149, description: "Warm golden khoya dumplings soaked in fragrant cardamom & rose sugar syrup with pistachios.", image_url: "/src/assets/gulab-jamun.jpg", is_veg: 1, is_spicy: 0, is_available: 1 },
];

// ==========================================
// SCHEMA INITIALIZATION FOR ALL ENGINES
// ==========================================
async function initSchema() {
  if (dbType === "postgres") {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS restaurants (
        id SERIAL PRIMARY KEY,
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS restaurant_tables (
        id SERIAL PRIMARY KEY,
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS menu_items (
        id SERIAL PRIMARY KEY,
        restaurant_id INTEGER NOT NULL DEFAULT 1,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price REAL NOT NULL,
        description TEXT,
        image_url TEXT,
        is_veg INTEGER DEFAULT 0,
        is_spicy INTEGER DEFAULT 0,
        is_available INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        booking_number TEXT NOT NULL UNIQUE,
        restaurant_id INTEGER NOT NULL DEFAULT 1,
        table_id INTEGER NOT NULL,
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        customer_email TEXT,
        booking_date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        meal_type TEXT DEFAULT 'DINNER',
        guest_count INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'CONFIRMED',
        special_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS guest_sessions (
        id SERIAL PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE,
        restaurant_id INTEGER NOT NULL DEFAULT 1,
        table_id INTEGER NOT NULL,
        table_number TEXT NOT NULL,
        booking_id INTEGER,
        customer_name TEXT DEFAULT 'Guest',
        customer_phone TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
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
        is_archived INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL,
        menu_item_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price REAL NOT NULL,
        total_price REAL NOT NULL,
        special_instruction TEXT
      );

      CREATE TABLE IF NOT EXISTS bills (
        id SERIAL PRIMARY KEY,
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        paid_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS staff_users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS restaurant_settings (
        "key" TEXT PRIMARY KEY,
        "value" TEXT NOT NULL
      );

      -- Strong Database Constraint: Unique active booking per table, date & start_time
      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_booking 
      ON bookings (table_id, booking_date, start_time) 
      WHERE status IN ('CONFIRMED', 'CHECKED_IN', 'PENDING');

      CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency 
      ON payments (idempotency_key);
    `);

    // Seed default Postgres data if empty
    const restCheck = await pgPool.query("SELECT COUNT(*) as count FROM restaurants");
    if (parseInt(restCheck.rows[0].count, 10) === 0) {
      await pgPool.query(`
        INSERT INTO restaurants (id, name, slug, tagline, address, phone, email, opening_time, closing_time, booking_duration_mins, buffer_time_mins, tax_rate, service_charge_rate, qr_code_token)
        VALUES (1, 'Spicy Spoon', 'spicy-spoon', 'Authentic Flavours. Warm Hospitality.', 'Tiruppur-Palladam road, Tamil Nadu', '+91 73958 77142', 'contact@spicyspoon.com', '11:00 AM', '11:00 PM', 90, 15, 5.0, 2.5, 'spicy-spoon-qr-token-2026')
        ON CONFLICT (id) DO NOTHING;
      `);
    }

    const staffCheck = await pgPool.query("SELECT COUNT(*) as count FROM staff_users");
    if (parseInt(staffCheck.rows[0].count, 10) === 0) {
      const adminHash = bcrypt.hashSync("admin123", 10);
      const kitchenHash = bcrypt.hashSync("kitchen123", 10);
      await pgPool.query(`
        INSERT INTO staff_users (username, password_hash, role, name, status)
        VALUES 
          ('admin', $1, 'ADMIN', 'Restaurant Manager', 'ACTIVE'),
          ('kitchen', $2, 'KITCHEN', 'Head Chef (KDS)', 'ACTIVE')
        ON CONFLICT (username) DO NOTHING;
      `, [adminHash, kitchenHash]);
    }

    for (const t of targetTables) {
      await pgPool.query(`
        INSERT INTO restaurant_tables (table_number, capacity, section, status, x_pos, y_pos)
        VALUES ($1, $2, $3, 'AVAILABLE', $4, $5)
        ON CONFLICT (table_number) DO UPDATE SET capacity = $2, section = $3, x_pos = $4, y_pos = $5;
      `, [t.number, t.capacity, t.section, t.x, t.y]);
    }

    const menuCheck = await pgPool.query("SELECT COUNT(*) as count FROM menu_items");
    if (parseInt(menuCheck.rows[0].count, 10) === 0) {
      for (const m of initialMenu) {
        await pgPool.query(`
          INSERT INTO menu_items (name, category, price, description, image_url, is_veg, is_spicy, is_available)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [m.name, m.category, m.price, m.description, m.image_url, m.is_veg, m.is_spicy, m.is_available]);
      }
    }

    const setCheck = await pgPool.query("SELECT COUNT(*) as count FROM restaurant_settings");
    if (parseInt(setCheck.rows[0].count, 10) === 0) {
      const defaultSettings = [
        ["restaurant_name", "Spicy Spoon"],
        ["tax_rate", "5.0"],
        ["service_charge_rate", "2.5"],
        ["booking_duration_mins", "90"],
        ["payment_mode", "DEV_SANDBOX"],
        ["upi_vpa", "cadbury470@oksbi"],
      ];
      for (const [k, v] of defaultSettings) {
        await pgPool.query(`INSERT INTO restaurant_settings ("key", "value") VALUES ($1, $2) ON CONFLICT ("key") DO NOTHING;`, [k, v]);
      }
    }
    console.log("✓ PostgreSQL Database schema & seeds initialized.");
  } else if (dbType === "sqlite") {
    // SQLite Schema
    sqliteDb.exec(`
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
        meal_type TEXT DEFAULT 'DINNER',
        guest_count INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'CONFIRMED',
        special_notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
        status TEXT NOT NULL DEFAULT 'ACTIVE',
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
        is_archived INTEGER DEFAULT 0,
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
        role TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS restaurant_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- Database constraint against duplicate active booking for same table, date & start_time
      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_booking 
      ON bookings (table_id, booking_date, start_time) 
      WHERE status IN ('CONFIRMED', 'CHECKED_IN', 'PENDING');

      CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency 
      ON payments (idempotency_key);
    `);

    // Safe column additions for SQLite
    function safeAddColumn(tableName, columnName, columnDefinition) {
      try {
        const tableInfo = sqliteDb.prepare(`PRAGMA table_info(${tableName})`).all();
        const exists = tableInfo.some((col) => col.name === columnName);
        if (!exists) {
          sqliteDb.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition};`);
        }
      } catch (err) { }
    }

    safeAddColumn("restaurants", "service_charge_rate", "REAL DEFAULT 2.5");
    safeAddColumn("restaurant_tables", "current_session_id", "TEXT");
    safeAddColumn("orders", "session_id", "TEXT NOT NULL DEFAULT 'SESSION-DEFAULT'");
    safeAddColumn("orders", "round_number", "INTEGER DEFAULT 1");
    safeAddColumn("orders", "is_archived", "INTEGER DEFAULT 0");
    safeAddColumn("bills", "session_id", "TEXT NOT NULL DEFAULT 'SESSION-DEFAULT'");
    safeAddColumn("payments", "payment_id", "TEXT");
    safeAddColumn("payments", "idempotency_key", "TEXT");
    safeAddColumn("payments", "session_id", "TEXT");
    safeAddColumn("payments", "gateway_reference", "TEXT");
    safeAddColumn("payments", "signature_verified", "INTEGER DEFAULT 0");
    safeAddColumn("bookings", "meal_type", "TEXT DEFAULT 'DINNER'");
    safeAddColumn("bookings", "updated_at", "DATETIME DEFAULT CURRENT_TIMESTAMP");

    // Seeds
    const staffCount = sqliteDb.prepare("SELECT COUNT(*) as count FROM staff_users").get().count;
    if (staffCount === 0) {
      const insertStaff = sqliteDb.prepare(`
        INSERT INTO staff_users (username, password_hash, role, name, status)
        VALUES (?, ?, ?, ?, 'ACTIVE')
      `);
      const adminHash = bcrypt.hashSync("admin123", 10);
      const kitchenHash = bcrypt.hashSync("kitchen123", 10);
      insertStaff.run("admin", adminHash, "ADMIN", "Restaurant Manager");
      insertStaff.run("kitchen", kitchenHash, "KITCHEN", "Head Chef (KDS)");
    }

    const restaurantCount = sqliteDb.prepare("SELECT COUNT(*) as count FROM restaurants").get().count;
    if (restaurantCount === 0) {
      sqliteDb.prepare(`
        INSERT INTO restaurants (id, name, slug, tagline, address, phone, email, opening_time, closing_time, booking_duration_mins, buffer_time_mins, tax_rate, service_charge_rate, qr_code_token)
        VALUES (1, 'Spicy Spoon', 'spicy-spoon', 'Authentic Flavours. Warm Hospitality.', 'Tiruppur-Palladam road, Tamil Nadu', '+91 73958 77142', 'contact@spicyspoon.com', '11:00 AM', '11:00 PM', 90, 15, 5.0, 2.5, 'spicy-spoon-qr-token-2026')
      `).run();
    }

    const checkTableStmt = sqliteDb.prepare("SELECT * FROM restaurant_tables WHERE table_number = ?");
    const insertTableStmt = sqliteDb.prepare("INSERT INTO restaurant_tables (table_number, capacity, section, status, x_pos, y_pos) VALUES (?, ?, ?, 'AVAILABLE', ?, ?)");
    const updateTableStmt = sqliteDb.prepare("UPDATE restaurant_tables SET capacity = ?, section = ?, x_pos = ?, y_pos = ? WHERE table_number = ?");

    for (const t of targetTables) {
      const existing = checkTableStmt.get(t.number);
      if (!existing) {
        insertTableStmt.run(t.number, t.capacity, t.section, t.x, t.y);
      } else {
        updateTableStmt.run(t.capacity, t.section, t.x, t.y, t.number);
      }
    }

    const menuCount = sqliteDb.prepare("SELECT COUNT(*) as count FROM menu_items").get().count;
    if (menuCount === 0) {
      const insertMenu = sqliteDb.prepare("INSERT INTO menu_items (name, category, price, description, image_url, is_veg, is_spicy, is_available) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      for (const m of initialMenu) {
        insertMenu.run(m.name, m.category, m.price, m.description, m.image_url, m.is_veg, m.is_spicy, m.is_available);
      }
    }

    const settingsCount = sqliteDb.prepare("SELECT COUNT(*) as count FROM restaurant_settings").get().count;
    if (settingsCount === 0) {
      const insertSetting = sqliteDb.prepare("INSERT INTO restaurant_settings (key, value) VALUES (?, ?)");
      insertSetting.run("restaurant_name", "Spicy Spoon");
      insertSetting.run("tax_rate", "5.0");
      insertSetting.run("service_charge_rate", "2.5");
      insertSetting.run("booking_duration_mins", "90");
      insertSetting.run("payment_mode", process.env.PAYMENT_MODE || "DEV_SANDBOX");
      insertSetting.run("upi_vpa", "cadbury470@oksbi");
    }
  }
}

// Automatically initialize schema
initPromise = initSchema().catch((err) => {
  console.error("Database initialization error:", err);
});

// Export unified interface with synchronous SQLite compatibility
module.exports = {
  dbType,
  query,
  queryOne,
  execute,
  transaction,
  initPromise,
  ensureInit,
  // Synchronous SQLite compatibility for remaining synchronous routes & tests:
  prepare: (sql) => {
    if (sqliteDb) return sqliteDb.prepare(sql);
    return {
      all: (...params) => {
        throw new Error("Synchronous prepare().all() is not supported in remote DB mode. Use await db.query() instead.");
      },
      get: (...params) => {
        throw new Error("Synchronous prepare().get() is not supported in remote DB mode. Use await db.queryOne() instead.");
      },
      run: (...params) => {
        throw new Error("Synchronous prepare().run() is not supported in remote DB mode. Use await db.execute() instead.");
      },
    };
  },
  exec: (sql) => {
    if (sqliteDb) return sqliteDb.exec(sql);
    return execute(sql);
  },
  rawSqlite: sqliteDb,
  pgPool,
  tursoClient,
};
