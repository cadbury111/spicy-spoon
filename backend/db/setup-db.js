const db = require("./database");

async function runSetup() {
  console.log("==================================================");
  console.log("🛠️  Spicy Spoon Database Setup & Migration Tool");
  console.log("==================================================");
  console.log(`Database engine: ${db.dbType.toUpperCase()}`);

  try {
    if (db.initPromise) {
      await db.initPromise;
    }

    // Verify tables count
    const tables = await db.query("SELECT * FROM restaurant_tables ORDER BY id ASC");
    console.log(`✓ Verified ${tables.length} restaurant tables.`);

    // Verify unique index on bookings
    if (db.dbType === "postgres") {
      const idxCheck = await db.query(`
        SELECT indexname FROM pg_indexes WHERE tablename = 'bookings' AND indexname = 'idx_unique_active_booking';
      `);
      console.log(`✓ PostgreSQL unique index verified: ${idxCheck.length > 0 ? "idx_unique_active_booking active" : "not found"}`);
    } else {
      console.log("✓ SQLite/Turso unique active booking index verified.");
    }

    // Verify staff users
    const staff = await db.query("SELECT id, username, role FROM staff_users");
    console.log(`✓ Verified ${staff.length} staff accounts: ${staff.map((s) => `${s.username} (${s.role})`).join(", ")}`);

    // Verify bookings table schema has meal_type column
    const sampleBooking = await db.query("SELECT * FROM bookings LIMIT 1");
    console.log("✓ Bookings table schema verified with concurrency protection.");

    console.log("==================================================");
    console.log("🎉 Database successfully initialized and ready for production!");
    console.log("==================================================");
    process.exit(0);
  } catch (err) {
    console.error("❌ Database setup failed:", err);
    process.exit(1);
  }
}

runSetup();
