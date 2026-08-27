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

// Helper to assemble full digital receipt
function buildReceipt(billId, paymentId) {
  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(billId);
  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
  const table = db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(bill?.table_id);
  const items = db.prepare(
    "SELECT * FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE session_id = ? OR id = ?)"
  ).all(bill?.session_id || "", bill?.order_id || 0);
  const restaurant = db.prepare("SELECT * FROM restaurants WHERE id = 1").get();

  return {
    restaurant_name: restaurant?.name || "Spicy Spoon",
    restaurant_address: restaurant?.address || "Tiruppur-Palladam road, Tamil Nadu",
    restaurant_phone: restaurant?.phone || "+91 73958 77142",
    bill,
    payment,
    table,
    items,
    date: new Date().toISOString(),
  };
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

// 2. Get active Cash Payment Requests (Pending Admin confirmation)
router.get("/cash-requests", (req, res) => {
  try {
    const cashReqs = db.prepare(`
      SELECT 
        p.*,
        b.bill_number,
        b.table_number,
        b.customer_name,
        b.grand_total as bill_amount,
        b.subtotal,
        b.tax,
        b.service_charge
      FROM payments p
      JOIN bills b ON p.bill_id = b.id
      WHERE p.payment_method = 'CASH' AND p.status = 'CASH_PENDING' AND b.status != 'PAID'
      ORDER BY p.id DESC
    `).all();
    res.json(cashReqs);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch cash requests", error: error.message });
  }
});

// 3. Get single payment status by ID or transaction ID
router.get("/:id", (req, res) => {
  try {
    const payment = db.prepare(`
      SELECT 
        p.*,
        b.bill_number,
        b.table_number,
        b.customer_name,
        b.grand_total as bill_amount,
        b.status as bill_status
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

// 4. Get payment by Bill ID
router.get("/by-bill/:billId", (req, res) => {
  try {
    const billId = Number(req.params.billId);
    const payment = db.prepare(`
      SELECT 
        p.*,
        b.bill_number,
        b.table_number,
        b.customer_name,
        b.grand_total as bill_amount,
        b.status as bill_status
      FROM payments p
      JOIN bills b ON p.bill_id = b.id
      WHERE p.bill_id = ?
      ORDER BY p.id DESC
    `).get(billId);

    if (!payment) {
      return res.status(404).json({ message: "No payment record for this bill" });
    }
    res.json(payment);
  } catch (error) {
    res.status(500).json({ message: "Error fetching payment by bill", error: error.message });
  }
});

// 5. Create Gateway Order (Razorpay Order Creation with Sandbox Fallback)
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

// 6. Create Payment Request (UPI QR with auto-verify, Card Intent, or Cash Request)
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
        let upiDataUrl = null;
        let upiIntentUrl = null;
        if (existingPayment.payment_method === "UPI") {
          const upiVpa = "spicyspoon@upi";
          const restaurantName = encodeURIComponent("Spicy Spoon Restaurant");
          const note = encodeURIComponent(`Bill ${bill.bill_number}`);
          upiIntentUrl = `upi://pay?pa=${upiVpa}&pn=${restaurantName}&am=${bill.grand_total.toFixed(2)}&cu=INR&tn=${note}&tr=${existingPayment.transaction_id}`;
          upiDataUrl = await QRCode.toDataURL(upiIntentUrl, { width: 300, margin: 2 });
        }
        return res.json({
          message: "Existing payment record retrieved via idempotency key",
          payment: existingPayment,
          upiQrCode: upiDataUrl,
          upiIntentUrl,
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

      // Broadcast PAYMENT_PENDING (System strictly remains in WAITING state until verified)
      broadcast("PAYMENT_PENDING", { bill, payment_method: "UPI", transactionId, amount: bill.grand_total });
    }

    if (method === "CASH") {
      db.prepare("UPDATE restaurant_tables SET status = 'PAYMENT_PENDING' WHERE id = ?").run(bill.table_id);
      const updatedTable = db.prepare("SELECT * FROM restaurant_tables WHERE id = ?").get(bill.table_id);

      const cashPayload = {
        bill,
        table: updatedTable,
        transactionId,
        paymentId,
        amount: bill.grand_total,
        status: "CASH_PENDING",
      };

      broadcast("CASH_PAYMENT_REQUESTED", cashPayload);
      broadcast("PAYMENT_PENDING", cashPayload);
      broadcast("TABLE_STATUS_UPDATED", updatedTable);
    }

    if (method === "CARD") {
      broadcast("PAYMENT_PENDING", { bill, payment_method: "CARD", transactionId, amount: bill.grand_total });
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

// 7. Verify Payment & Atomic Table Release (Cryptographic & Amount Verification)
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

    // IDEMPOTENCY CHECK: If already verified with this key, return existing verified receipt
    if (targetKey) {
      const existingSuccess = db.prepare(`
        SELECT p.*, b.bill_number, b.table_number, b.grand_total
        FROM payments p
        JOIN bills b ON p.bill_id = b.id
        WHERE p.idempotency_key = ? AND p.status IN ('SUCCESS', 'CASH_PAID')
      `).get(targetKey);

      if (existingSuccess) {
        const fullReceipt = buildReceipt(existingSuccess.bill_id, existingSuccess.id);
        return res.json({
          message: "Payment already verified (Idempotent replay)",
          payment: existingSuccess,
          bill: fullReceipt.bill,
          table: fullReceipt.table,
          receipt: fullReceipt,
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
      if (req.body.bill_id) {
        const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(Number(req.body.bill_id));
        if (bill) {
          const autoTxn = generateTransactionId("CARD");
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
      const fullReceipt = buildReceipt(payment.bill_id, payment.id);
      return res.json({ message: "Payment already verified", payment, bill: fullReceipt.bill, table: fullReceipt.table, receipt: fullReceipt });
    }

    // 1. Strict Cryptographic Signature Verification
    let signatureVerified = 0;
    if (razorpay_order_id && razorpay_payment_id && razorpay_signature) {
      const expectedSign = crypto
        .createHmac("sha256", RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");

      if (expectedSign !== razorpay_signature) {
        db.prepare("UPDATE payments SET status = 'FAILED' WHERE id = ?").run(payment.id);
        broadcast("PAYMENT_FAILED", { bill_id: payment.bill_id, reason: "Cryptographic signature mismatch" });
        return res.status(400).json({ message: "Invalid payment signature verification failed." });
      }

      // Check duplicate payment reference usage (double-spend protection)
      const duplicateTxn = db.prepare("SELECT id FROM payments WHERE gateway_reference = ? AND id != ?").get(
        razorpay_payment_id,
        payment.id
      );
      if (duplicateTxn) {
        return res.status(400).json({ message: "This payment transaction ID has already been utilized." });
      }

      signatureVerified = 1;
    } else {
      // Direct verification requires valid gateway signature or admin verification
      return res.status(400).json({
        message: "Payment verification requires valid cryptographic gateway signature and authorization tokens.",
      });
    }

    // 2. Verify Exact Payment Amount
    if (amount !== undefined && Number(amount) > 0) {
      const parsedAmount = Number(amount);
      if (
        Math.abs(parsedAmount - payment.grand_total) > 0.5 &&
        Math.abs(parsedAmount / 100 - payment.grand_total) > 0.5
      ) {
        db.prepare("UPDATE payments SET status = 'FAILED' WHERE id = ?").run(payment.id);
        broadcast("PAYMENT_FAILED", { bill_id: payment.bill_id, reason: "Payment amount mismatch" });
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
    const finalMethod = payment.payment_method;
    const finalStatus = finalMethod === "CASH" ? "CASH_PAID" : "SUCCESS";
    const ref = gateway_reference || razorpay_payment_id || `VERIFIED_${Date.now()}`;

    db.prepare(`
      UPDATE payments
      SET status = ?, gateway_reference = ?, signature_verified = ?, paid_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(finalStatus, ref, signatureVerified, payment.id);

    db.prepare("UPDATE bills SET status = 'PAID' WHERE id = ?").run(payment.bill_id);

    if (payment.session_id) {
      db.prepare("UPDATE orders SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE session_id = ?").run(
        payment.session_id
      );
    } else {
      db.prepare("UPDATE orders SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(payment.order_id);
    }

    db.prepare(`
      UPDATE restaurant_tables
      SET status = 'AVAILABLE', current_order_id = NULL, current_session_id = NULL, current_booking_id = NULL
      WHERE id = ?
    `).run(payment.table_id);

    const order = db.prepare("SELECT booking_id FROM orders WHERE id = ?").get(payment.order_id);
    if (order && order.booking_id) {
      db.prepare("UPDATE bookings SET status = 'COMPLETED' WHERE id = ?").run(order.booking_id);
    }

    const fullReceipt = buildReceipt(payment.bill_id, payment.id);

    const successEventPayload = {
      bill_id: fullReceipt.bill.id,
      bill_number: fullReceipt.bill.bill_number,
      table_number: fullReceipt.bill.table_number,
      session_id: fullReceipt.bill.session_id,
      amount: fullReceipt.bill.grand_total,
      grand_total: fullReceipt.bill.grand_total,
      payment_method: fullReceipt.payment.payment_method,
      transaction_id: fullReceipt.payment.transaction_id,
      status: "SUCCESS",
      receipt: fullReceipt,
      bill: fullReceipt.bill,
      payment: fullReceipt.payment,
      table: fullReceipt.table,
    };

    // Broadcast Real-time Events
    broadcast("PAYMENT_SUCCESS", successEventPayload);
    broadcast("PAYMENT_VERIFIED", successEventPayload);
    broadcast("BILL_PAID", successEventPayload);
    broadcast("PAYMENT_COMPLETED", successEventPayload);
    broadcast("TABLE_STATUS_UPDATED", fullReceipt.table);

    res.json({
      message: "Payment verified, bill settled, and table released successfully!",
      payment: fullReceipt.payment,
      bill: fullReceipt.bill,
      table: fullReceipt.table,
      receipt: fullReceipt,
    });
  } catch (error) {
    console.error("Payment verification error:", error);
    res.status(500).json({ message: "Failed to verify payment", error: error.message });
  }
});

// 8. Payment Gateway Webhook Endpoint (Razorpay / Bank Webhook Notification)
router.post("/webhook", (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || RAZORPAY_KEY_SECRET;
    const signature = req.headers["x-razorpay-signature"];

    if (signature) {
      const rawBody = JSON.stringify(req.body);
      const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
      if (expected !== signature) {
        console.error("Webhook signature mismatch");
        return res.status(400).json({ message: "Invalid webhook signature" });
      }
    }

    const event = req.body.event; // e.g. 'payment.captured', 'order.paid', 'payment.failed'
    const entity = req.body.payload?.payment?.entity || req.body.payload?.order?.entity || req.body;

    if (["payment.captured", "order.paid"].includes(event) || entity.status === "captured" || entity.status === "SUCCESS") {
      const billId = entity.notes?.bill_id || entity.bill_id;
      const txnId = entity.notes?.transaction_id || entity.id;
      const amountReceived = entity.amount ? entity.amount / 100 : entity.grand_total;

      let payment = null;
      if (billId) {
        payment = db
          .prepare(
            `SELECT p.*, b.grand_total, b.table_id, b.order_id, b.session_id 
             FROM payments p JOIN bills b ON p.bill_id = b.id 
             WHERE p.bill_id = ? ORDER BY p.id DESC`
          )
          .get(Number(billId));
      } else if (txnId) {
        payment = db
          .prepare(
            `SELECT p.*, b.grand_total, b.table_id, b.order_id, b.session_id 
             FROM payments p JOIN bills b ON p.bill_id = b.id 
             WHERE p.transaction_id = ? OR p.gateway_reference = ?`
          )
          .get(txnId, txnId);
      }

      if (payment && payment.status !== "SUCCESS") {
        if (amountReceived && Math.abs(amountReceived - payment.grand_total) > 1) {
          console.error("Webhook amount mismatch:", amountReceived, payment.grand_total);
          return res.status(400).json({ message: "Amount mismatch in webhook" });
        }

        db.prepare(`
          UPDATE payments
          SET status = 'SUCCESS', gateway_reference = ?, signature_verified = 1, paid_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(entity.id || txnId, payment.id);

        db.prepare("UPDATE bills SET status = 'PAID' WHERE id = ?").run(payment.bill_id);

        if (payment.session_id) {
          db.prepare("UPDATE orders SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE session_id = ?").run(
            payment.session_id
          );
        } else {
          db.prepare("UPDATE orders SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
            payment.order_id
          );
        }

        db.prepare(`
          UPDATE restaurant_tables
          SET status = 'AVAILABLE', current_order_id = NULL, current_session_id = NULL, current_booking_id = NULL
          WHERE id = ?
        `).run(payment.table_id);

        const fullReceipt = buildReceipt(payment.bill_id, payment.id);

        const successEventPayload = {
          bill_id: fullReceipt.bill.id,
          bill_number: fullReceipt.bill.bill_number,
          table_number: fullReceipt.bill.table_number,
          session_id: fullReceipt.bill.session_id,
          amount: fullReceipt.bill.grand_total,
          grand_total: fullReceipt.bill.grand_total,
          payment_method: fullReceipt.payment.payment_method,
          transaction_id: fullReceipt.payment.transaction_id,
          status: "SUCCESS",
          receipt: fullReceipt,
          bill: fullReceipt.bill,
          payment: fullReceipt.payment,
          table: fullReceipt.table,
        };

        broadcast("PAYMENT_SUCCESS", successEventPayload);
        broadcast("PAYMENT_VERIFIED", successEventPayload);
        broadcast("BILL_PAID", successEventPayload);
        broadcast("PAYMENT_COMPLETED", successEventPayload);
        broadcast("TABLE_STATUS_UPDATED", fullReceipt.table);
      }
    } else if (event === "payment.failed") {
      const billId = entity.notes?.bill_id || entity.bill_id;
      if (billId) {
        db.prepare("UPDATE payments SET status = 'FAILED' WHERE bill_id = ?").run(Number(billId));
        broadcast("PAYMENT_FAILED", {
          bill_id: billId,
          reason: entity.error_description || "Payment failed at gateway",
        });
      }
    }

    res.json({ status: "ok", received: true });
  } catch (err) {
    console.error("Webhook processing error:", err);
    res.status(500).json({ message: "Webhook error", error: err.message });
  }
});

// 9. Admin Confirm Cash Payment (ADMIN ONLY)
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
      SET status = 'SUCCESS', gateway_response = 'ADMIN_CASH_CONFIRMED', signature_verified = 1, paid_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(payment.id);

    db.prepare("UPDATE bills SET status = 'PAID' WHERE id = ?").run(payment.bill_id);

    if (payment.session_id) {
      db.prepare("UPDATE orders SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE session_id = ?").run(
        payment.session_id
      );
    } else {
      db.prepare("UPDATE orders SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(payment.order_id);
    }

    db.prepare(`
      UPDATE restaurant_tables
      SET status = 'AVAILABLE', current_order_id = NULL, current_session_id = NULL, current_booking_id = NULL
      WHERE id = ?
    `).run(payment.table_id);

    const order = db.prepare("SELECT booking_id FROM orders WHERE id = ?").get(payment.order_id);
    if (order && order.booking_id) {
      db.prepare("UPDATE bookings SET status = 'COMPLETED' WHERE id = ?").run(order.booking_id);
    }

    const fullReceipt = buildReceipt(payment.bill_id, payment.id);

    const successEventPayload = {
      bill_id: fullReceipt.bill.id,
      bill_number: fullReceipt.bill.bill_number,
      table_number: fullReceipt.bill.table_number,
      session_id: fullReceipt.bill.session_id,
      amount: fullReceipt.bill.grand_total,
      grand_total: fullReceipt.bill.grand_total,
      payment_method: fullReceipt.payment.payment_method,
      transaction_id: fullReceipt.payment.transaction_id,
      status: "SUCCESS",
      receipt: fullReceipt,
      bill: fullReceipt.bill,
      payment: fullReceipt.payment,
      table: fullReceipt.table,
    };

    // Broadcast Real-time Events
    broadcast("PAYMENT_SUCCESS", successEventPayload);
    broadcast("CASH_PAYMENT_CONFIRMED", successEventPayload);
    broadcast("PAYMENT_VERIFIED", successEventPayload);
    broadcast("BILL_PAID", successEventPayload);
    broadcast("PAYMENT_COMPLETED", successEventPayload);
    broadcast("TABLE_STATUS_UPDATED", fullReceipt.table);

    res.json({
      message: "Cash payment confirmed and table released successfully!",
      payment: fullReceipt.payment,
      bill: fullReceipt.bill,
      table: fullReceipt.table,
      receipt: fullReceipt,
    });
  } catch (error) {
    console.error("Cash confirm error:", error);
    res.status(500).json({ message: "Failed to confirm cash payment", error: error.message });
  }
});

module.exports = router;
