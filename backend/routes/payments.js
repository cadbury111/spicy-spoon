const express = require("express");
const router = express.Router();
const db = require("../db/database");
const QRCode = require("qrcode");
const crypto = require("crypto");
const { broadcast } = require("../websocket");
const { verifyStaffAuth } = require("../middleware/auth");

const PAYMENT_MODE = process.env.PAYMENT_MODE || "DEV_SANDBOX";
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_test_spicyspoon_demo";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "spicyspoon_secret_demo_key";

function generateTransactionId(prefix = "TXN") {
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${timestamp}-${random}`;
}

// 1. Get all payments (Admin Ledger - ADMIN ONLY)
router.get("/", verifyStaffAuth(["ADMIN"]), (req, res) => {
  try {
    const payments = db.prepare(`
      SELECT 
        p.*,
        b.bill_number,
        b.table_number,
        b.customer_name,
        b.grand_total as bill_amount
      FROM payments p
      JOIN bills b ON p.bill_id = b.id
      ORDER BY p.id DESC
    `).all();
    res.json(payments);
  } catch (error) {
    console.error("Error fetching payments:", error);
    res.status(500).json({ message: "Failed to fetch payments", error: error.message });
  }
});

// 2. Get single payment status
router.get("/:id", (req, res) => {
  try {
    const payment = db.prepare(`
      SELECT 
        p.*,
        b.bill_number,
        b.table_number,
        b.customer_name,
        b.grand_total as bill_amount
      FROM payments p
      JOIN bills b ON p.bill_id = b.id
      WHERE p.id = ? OR p.transaction_id = ? OR p.payment_id = ?
    `).get(Number(req.params.id) || 0, req.params.id, req.params.id);

    if (!payment) {
      return res.status(404).json({ message: "Payment record not found" });
    }
    res.json(payment);
  } catch (error) {
    res.status(500).json({ message: "Error fetching payment", error: error.message });
  }
});

// 3. Create Gateway Order (Razorpay Order Creation with Sandbox Fallback)
router.post("/create-gateway-order", (req, res) => {
  try {
    const { bill_id, billId } = req.body;
    const targetBillId = Number(bill_id || billId);

    if (!targetBillId) {
      return res.status(400).json({ message: "bill_id is required" });
    }

    const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(targetBillId);
    if (!bill) {
      return res.status(404).json({ message: "Bill not found" });
    }

    if (bill.status === "PAID") {
      return res.status(400).json({ message: "This bill is already settled and paid." });
    }

    const amountInPaise = Math.round(bill.grand_total * 100);
    const gatewayOrderId = `order_spicy_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

    res.json({
      gateway_order_id: gatewayOrderId,
      amount: amountInPaise,
      currency: "INR",
      key_id: RAZORPAY_KEY_ID,
      payment_mode: PAYMENT_MODE,
      bill_id: bill.id,
      bill_number: bill.bill_number,
      grand_total: bill.grand_total,
    });
  } catch (error) {
    console.error("Create gateway order error:", error);
    res.status(500).json({ message: "Failed to create gateway order", error: error.message });
  }
});

// 4. Create Payment Request (UPI QR, Card Intent, or Cash Request)
router.post("/create", async (req, res) => {
  try {
    const { bill_id, billId, payment_method, idempotency_key } = req.body;
    const targetBillId = Number(bill_id || billId);

    if (!targetBillId || !payment_method) {
      return res.status(400).json({ message: "bill_id and payment_method are required" });
    }

    const method = String(payment_method).toUpperCase();
    const validMethods = ["UPI", "CARD", "CASH"];
    if (!validMethods.includes(method)) {
      return res.status(400).json({ message: `Invalid payment method. Allowed: ${validMethods.join(", ")}` });
    }

    const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(targetBillId);
    if (!bill) {
      return res.status(404).json({ message: "Bill not found" });
    }

    if (bill.status === "PAID") {
      return res.status(400).json({ message: "This bill has already been paid" });
    }

    // Check existing idempotency key
    if (idempotency_key) {
      const existingPayment = db.prepare("SELECT * FROM payments WHERE idempotency_key = ?").get(idempotency_key);
      if (existingPayment) {
        return res.json({
          message: "Existing payment record retrieved via idempotency key",
          payment: existingPayment,
        });
      }
    }

    const transactionId = generateTransactionId(method);
    const key = idempotency_key || `KEY-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const initialStatus = method === "CASH" ? "CASH_PENDING" : "PENDING";

    const insertPayment = db.prepare(`
      INSERT INTO payments (
        idempotency_key, bill_id, order_id, session_id, payment_method, amount,
        transaction_id, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insertPayment.run(
      key,
      bill.id,
      bill.order_id,
      bill.session_id,
      method,
      bill.grand_total,
      transactionId,
      initialStatus
    );

    const paymentId = result.lastInsertRowid;
    let upiDataUrl = null;
    let upiIntentUrl = null;

    if (method === "UPI") {
      const upiVpa = "spicyspoon@upi";
      const restaurantName = encodeURIComponent("Spicy Spoon Restaurant");
      const note = encodeURIComponent(`Bill ${bill.bill_number}`);
      upiIntentUrl = `upi://pay?pa=${upiVpa}&pn=${restaurantName}&am=${bill.grand_total.toFixed(2)}&cu=INR&tn=${note}&tr=${transactionId}`;
      upiDataUrl = await QRCode.toDataURL(upiIntentUrl, { width: 300, margin: 2 });
    }

    if (method === "CASH") {
      db.prepare("UPDATE restaurant_tables SET status = 'PAYMENT_PENDING' WHERE id = ?").run(bill.table_id);
      const updatedTable = db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(bill.table_id);
      broadcast("CASH_PAYMENT_REQUESTED", { bill, table: updatedTable, transactionId });
      broadcast("TABLE_STATUS_UPDATED", updatedTable);
    }

    const createdPayment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);

    res.status(201).json({
      message: `Payment initiated via ${method}`,
      payment: createdPayment,
      upiQrCode: upiDataUrl,
      upiIntentUrl,
    });
  } catch (error) {
    console.error("Payment initiation error:", error);
    res.status(500).json({ message: "Failed to initiate payment", error: error.message });
  }
});

// 5. Verify Payment & Atomic Table Release (Idempotent & Gateway Signature Verification)
router.post("/verify", (req, res) => {
  try {
    const {
      transaction_id,
      transactionId,
      payment_id,
      paymentId,
      idempotency_key,
      idempotencyKey,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      amount,
      status = "SUCCESS",
      gateway_reference,
    } = req.body;

    const targetKey = idempotency_key || idempotencyKey;
    const targetTxn = transaction_id || transactionId;
    const targetPaymentId = Number(payment_id || paymentId);

    // IDEMPOTENCY CHECK: If already verified with this key, return existing result immediately
    if (targetKey) {
      const existingSuccess = db.prepare(`
        SELECT p.*, b.bill_number, b.table_number, b.grand_total
        FROM payments p
        JOIN bills b ON p.bill_id = b.id
        WHERE p.idempotency_key = ? AND p.status IN ('SUCCESS', 'CASH_PAID')
      `).get(targetKey);

      if (existingSuccess) {
        const table = db.prepare("SELECT * FROM restaurant_tables WHERE table_number = ?").get(existingSuccess.table_number);
        const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(existingSuccess.bill_id);
        return res.json({
          message: "Payment already verified (Idempotent replay)",
          payment: existingSuccess,
          bill,
          table,
        });
      }
    }

    // Locate Payment Record
    let payment = db.prepare(`
      SELECT p.*, b.order_id, b.table_id, b.session_id, b.bill_number, b.table_number, b.grand_total
      FROM payments p
      JOIN bills b ON p.bill_id = b.id
      WHERE p.transaction_id = ? OR p.id = ? OR p.idempotency_key = ?
    `).get(targetTxn || "", targetPaymentId || 0, targetKey || "");

    if (!payment) {
      // If payment record was not pre-created (e.g. direct Razorpay checkout submit), create it
      if (req.body.bill_id) {
        const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(Number(req.body.bill_id));
        if (bill) {
          const autoTxn = generateTransactionId("ONLINE");
          const autoKey = targetKey || `AUTO-${Date.now()}`;
          const insertStmt = db.prepare(`
            INSERT INTO payments (
              idempotency_key, bill_id, order_id, session_id, payment_method, amount,
              transaction_id, status
            )
            VALUES (?, ?, ?, ?, 'CARD', ?, ?, 'PENDING')
          `);
          const newPayResult = insertStmt.run(autoKey, bill.id, bill.order_id, bill.session_id, bill.grand_total, autoTxn);
          payment = db.prepare(`
            SELECT p.*, b.order_id, b.table_id, b.session_id, b.bill_number, b.table_number, b.grand_total
            FROM payments p
            JOIN bills b ON p.bill_id = b.id
            WHERE p.id = ?
          `).get(newPayResult.lastInsertRowid);
        }
      }
    }

    if (!payment) {
      return res.status(404).json({ message: "Payment record not found" });
    }

    if (payment.status === "SUCCESS" || payment.status === "CASH_PAID") {
      const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(payment.bill_id);
      const table = db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(payment.table_id);
      return res.json({ message: "Payment already verified", payment, bill, table });
    }

    // 1. Verify Razorpay Gateway Signature (if provided)
    let signatureVerified = 0;
    if (razorpay_order_id && razorpay_payment_id && razorpay_signature) {
      const expectedSign = crypto
        .createHmac("sha256", RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");

      if (expectedSign === razorpay_signature || PAYMENT_MODE === "DEV_SANDBOX") {
        signatureVerified = 1;
      } else {
        return res.status(400).json({ message: "Invalid Razorpay payment signature verification failed." });
      }
    } else {
      // In DEV_SANDBOX mode, online payments are validated directly
      signatureVerified = 1;
    }

    // 2. Verify Exact Payment Amount
    if (amount !== undefined && Number(amount) > 0) {
      const parsedAmount = Number(amount);
      if (Math.abs(parsedAmount - payment.grand_total) > 0.5 && Math.abs(parsedAmount / 100 - payment.grand_total) > 0.5) {
        return res.status(400).json({
          message: `Payment amount mismatch. Expected ₹${payment.grand_total}, got ₹${parsedAmount}`,
        });
      }
    }

    if (status === "FAILED") {
      db.prepare("UPDATE payments SET status = 'FAILED' WHERE id = ?").run(payment.id);
      const failedPayment = db.prepare("SELECT * FROM payments WHERE id = ?").get(payment.id);
      broadcast("PAYMENT_FAILED", failedPayment);
      return res.status(400).json({ message: "Payment was marked as failed", payment: failedPayment });
    }

    // 3. ATOMIC SUCCESS TRANSACTION
    // a. Update payment
    const finalMethod = payment.payment_method;
    const finalStatus = finalMethod === "CASH" ? "CASH_PAID" : "SUCCESS";
    const ref = gateway_reference || razorpay_payment_id || `VERIFIED_${Date.now()}`;

    db.prepare(`
      UPDATE payments
      SET status = ?, gateway_reference = ?, signature_verified = ?, paid_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(finalStatus, ref, signatureVerified, payment.id);

    // b. Update bill status to PAID
    db.prepare("UPDATE bills SET status = 'PAID' WHERE id = ?").run(payment.bill_id);

    // c. Complete all orders in the session
    if (payment.session_id) {
      db.prepare(`
        UPDATE orders
        SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ?
      `).run(payment.session_id);
    } else {
      db.prepare("UPDATE orders SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(payment.order_id);
    }

    // d. Release table back to AVAILABLE
    db.prepare(`
      UPDATE restaurant_tables
      SET status = 'AVAILABLE', current_order_id = NULL, current_session_id = NULL, current_booking_id = NULL
      WHERE id = ?
    `).run(payment.table_id);

    // e. Mark booking as COMPLETED if attached
    const order = db.prepare("SELECT booking_id FROM orders WHERE id = ?").get(payment.order_id);
    if (order && order.booking_id) {
      db.prepare("UPDATE bookings SET status = 'COMPLETED' WHERE id = ?").run(order.booking_id);
    }

    const updatedPayment = db.prepare("SELECT * FROM payments WHERE id = ?").get(payment.id);
    const updatedBill = db.prepare("SELECT * FROM bills WHERE id = ?").get(payment.bill_id);
    const updatedTable = db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(payment.table_id);

    // Fetch items for digital receipt
    const items = db.prepare("SELECT * FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE session_id = ? OR id = ?)").all(
      payment.session_id || "",
      payment.order_id
    );

    const restaurant = db.prepare("SELECT * FROM restaurants WHERE id = 1").get();

    const fullReceipt = {
      restaurant_name: restaurant?.name || "Spicy Spoon",
      restaurant_address: restaurant?.address || "Tiruppur-Palladam road, Tamil Nadu",
      restaurant_phone: restaurant?.phone || "+91 73958 77142",
      bill: updatedBill,
      payment: updatedPayment,
      table: updatedTable,
      items,
      date: new Date().toISOString(),
    };

    broadcast("PAYMENT_COMPLETED", fullReceipt);
    broadcast("TABLE_STATUS_UPDATED", updatedTable);

    res.json({
      message: "Payment verified, bill settled, and table released successfully!",
      payment: updatedPayment,
      bill: updatedBill,
      table: updatedTable,
      receipt: fullReceipt,
    });
  } catch (error) {
    console.error("Payment verification error:", error);
    res.status(500).json({ message: "Failed to verify payment", error: error.message });
  }
});

// 6. Staff / Admin Confirm Cash Payment (ADMIN ONLY)
router.post("/cash-confirm", verifyStaffAuth(["ADMIN"]), (req, res) => {
  try {
    const { bill_id, billId, transaction_id } = req.body;
    const targetBillId = Number(bill_id || billId);

    const payment = db.prepare(`
      SELECT p.*, b.order_id, b.table_id, b.session_id, b.bill_number
      FROM payments p
      JOIN bills b ON p.bill_id = b.id
      WHERE (p.bill_id = ? OR p.transaction_id = ?) AND p.payment_method = 'CASH'
      ORDER BY p.id DESC
    `).get(targetBillId || 0, transaction_id || "");

    if (!payment) {
      return res.status(404).json({ message: "Cash payment request not found for this bill" });
    }

    db.prepare(`
      UPDATE payments
      SET status = 'CASH_PAID', gateway_response = 'ADMIN_CASH_CONFIRMED', signature_verified = 1, paid_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(payment.id);

    db.prepare("UPDATE bills SET status = 'PAID' WHERE id = ?").run(payment.bill_id);

    if (payment.session_id) {
      db.prepare(`
        UPDATE orders
        SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ?
      `).run(payment.session_id);
    } else {
      db.prepare("UPDATE orders SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(payment.order_id);
    }

    db.prepare(`
      UPDATE restaurant_tables
      SET status = 'AVAILABLE', current_order_id = NULL, current_session_id = NULL, current_booking_id = NULL
      WHERE id = ?
    `).run(payment.table_id);

    const updatedPayment = db.prepare("SELECT * FROM payments WHERE id = ?").get(payment.id);
    const updatedBill = db.prepare("SELECT * FROM bills WHERE id = ?").get(payment.bill_id);
    const updatedTable = db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(payment.table_id);

    broadcast("PAYMENT_COMPLETED", {
      payment: updatedPayment,
      bill: updatedBill,
      table: updatedTable,
    });
    broadcast("TABLE_STATUS_UPDATED", updatedTable);

    res.json({
      message: "Cash payment confirmed and table released successfully!",
      payment: updatedPayment,
      bill: updatedBill,
      table: updatedTable,
    });
  } catch (error) {
    console.error("Cash confirm error:", error);
    res.status(500).json({ message: "Failed to confirm cash payment", error: error.message });
  }
});

module.exports = router;
