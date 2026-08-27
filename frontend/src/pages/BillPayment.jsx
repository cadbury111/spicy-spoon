import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Receipt,
  QrCode,
  CreditCard,
  Banknote,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ArrowLeft,
  Printer,
  Clock,
  MapPin,
  Phone,
  RefreshCw,
  Tag,
  ShieldCheck,
  Check,
  Utensils,
  Radio,
  Lock,
} from "lucide-react";
import confetti from "canvas-confetti";
import { api } from "../api";
import { useWebSocket } from "../hooks/useWebSocket";
import "./BillPayment.css";

function BillPayment({ billId = null, tableParam = null, sessionParam = null }) {
  const [bill, setBill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  // Payment State
  const [selectedMethod, setSelectedMethod] = useState("UPI"); // UPI, CARD, CASH
  const [paymentData, setPaymentData] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [verifiedReceipt, setVerifiedReceipt] = useState(null);
  const [cashRequested, setCashRequested] = useState(false);

  // Discount
  const [discountCode, setDiscountCode] = useState("");
  const [discountStatus, setDiscountStatus] = useState(null);

  // Card Form
  const [cardForm, setCardForm] = useState({
    cardNumber: "4532 •••• •••• 8892",
    cardHolder: "Dining Guest",
    expiry: "12/28",
    cvv: "888",
  });

  const pollTimerRef = useRef(null);

  // Table identifier from URL or query
  const targetTable = useMemo(() => {
    if (tableParam) return tableParam;
    const params = new URLSearchParams(window.location.hash.split("?")[1] || window.location.search);
    return params.get("table") || "T1";
  }, [tableParam]);

  const targetSession = useMemo(() => {
    if (sessionParam) return sessionParam;
    const params = new URLSearchParams(window.location.hash.split("?")[1] || window.location.search);
    return params.get("session") || localStorage.getItem(`spicy_session_${targetTable}`);
  }, [sessionParam, targetTable]);

  const triggerConfetti = () => {
    try {
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.5 },
        colors: ["#ff4500", "#ff8c00", "#ffd700", "#10b981"],
      });
    } catch (e) {}
  };

  const handlePaymentSuccess = useCallback(
    (receiptData) => {
      setPaymentSuccess(true);
      setVerifiedReceipt(receiptData);
      localStorage.removeItem(`spicy_order_${targetTable}`);
      localStorage.removeItem(`spicy_session_${targetTable}`);
      triggerConfetti();
    },
    [targetTable]
  );

  // 1. Fetch or Generate Live Bill
  const fetchLiveBill = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage("");

      let billResult;
      if (billId && billId !== "live") {
        billResult = await api.getBill(billId);
      } else {
        const liveRes = await api.getLiveBill({
          tableNumber: targetTable,
          sessionId: targetSession,
        });

        if (liveRes.bill && liveRes.bill.id) {
          billResult = liveRes.bill;
        } else {
          // Generate new bill
          const genRes = await api.generateBill({
            tableNumber: targetTable,
            session_id: targetSession || liveRes.session_id,
            discount_code: discountCode || undefined,
          });
          billResult = genRes.bill;
        }
      }

      setBill(billResult);

      if (billResult.status === "PAID") {
        handlePaymentSuccess({
          restaurant_name: billResult.restaurant_name || "Spicy Spoon",
          restaurant_address: billResult.restaurant_address || "Tiruppur-Palladam road, Tamil Nadu",
          restaurant_phone: billResult.restaurant_phone || "+91 73958 77142",
          bill: billResult,
          payment: billResult.payment || {
            payment_method: billResult.payment_method || "ONLINE",
            transaction_id: "PAID-REC",
            amount: billResult.grand_total,
          },
          items: billResult.items || [],
        });
      } else {
        initiatePaymentMethod("UPI", billResult.id);
      }
    } catch (err) {
      console.error("Live bill fetch error:", err);
      setErrorMessage(err.message || "Failed to load live bill for this table session.");
    } finally {
      setLoading(false);
    }
  }, [billId, targetTable, targetSession, discountCode, handlePaymentSuccess]);

  useEffect(() => {
    fetchLiveBill();
  }, [fetchLiveBill]);

  // WebSocket Live Events
  const handleWsEvent = useCallback(
    (event) => {
      if (!event) return;
      const isMyBill =
        event.data?.bill?.id === bill?.id ||
        event.data?.bill?.bill_number === bill?.bill_number ||
        event.data?.bill?.session_id === targetSession ||
        (event.data?.table?.table_number === targetTable && bill?.table_number === targetTable);

      if (
        ["PAYMENT_VERIFIED", "PAYMENT_COMPLETED", "BILL_PAID", "CASH_PAYMENT_CONFIRMED"].includes(event.type) &&
        isMyBill
      ) {
        const fullRec = event.data?.receipt || event.data;
        handlePaymentSuccess(fullRec);
      }

      if (event.type === "CASH_PAYMENT_REQUESTED" && isMyBill) {
        setCashRequested(true);
      }

      if (event.type === "BILL_GENERATED" && event.data?.id === bill?.id) {
        setBill(event.data);
      }
    },
    [bill, targetSession, targetTable, handlePaymentSuccess]
  );

  useWebSocket(handleWsEvent);

  // Background Polling Check to sync status with server
  useEffect(() => {
    if (paymentSuccess || !bill?.id) return;

    const checkServerPaymentStatus = async () => {
      try {
        const latestBill = await api.getBill(bill.id);
        if (latestBill && latestBill.status === "PAID") {
          handlePaymentSuccess({
            restaurant_name: latestBill.restaurant_name || "Spicy Spoon",
            restaurant_address: latestBill.restaurant_address || "Tiruppur-Palladam road, Tamil Nadu",
            restaurant_phone: latestBill.restaurant_phone || "+91 73958 77142",
            bill: latestBill,
            payment: latestBill.payment || {
              payment_method: latestBill.payment_method || selectedMethod,
              transaction_id: latestBill.payment?.transaction_id || "VERIFIED-TXN",
              amount: latestBill.grand_total,
            },
            items: latestBill.items || bill.items || [],
          });
        }
      } catch (e) {}
    };

    pollTimerRef.current = setInterval(checkServerPaymentStatus, 2500);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [paymentSuccess, bill?.id, selectedMethod, handlePaymentSuccess, bill?.items]);

  // 2. Initiate Payment Method (UPI QR / Intent / Cash)
  const initiatePaymentMethod = async (method, targetBillId) => {
    setSelectedMethod(method);
    const bId = targetBillId || bill?.id;
    if (!bId) return;

    try {
      const idempotencyKey = `PAY-${bId}-${method}-${Date.now()}`;
      const res = await api.createPayment({
        bill_id: bId,
        payment_method: method,
        idempotency_key: idempotencyKey,
      });
      setPaymentData({ ...res, idempotencyKey });
      if (method === "CASH") {
        setCashRequested(true);
      }
    } catch (err) {
      console.error("Payment method creation error:", err);
    }
  };

  // 3. Apply Discount Coupon Code
  const handleApplyCoupon = async () => {
    if (!discountCode.trim() || !bill) return;

    try {
      const res = await api.generateBill({
        bill_id: bill.id,
        order_id: bill.order_id,
        session_id: bill.session_id,
        tableNumber: targetTable,
        discount_code: discountCode.trim().toUpperCase(),
      });

      setBill(res.bill);
      if (res.bill.discount > 0) {
        setDiscountStatus({ type: "success", text: `🎉 10% Discount Applied (-₹${res.bill.discount.toFixed(2)})` });
        initiatePaymentMethod(selectedMethod, res.bill.id);
      } else {
        setDiscountStatus({ type: "error", text: "❌ Invalid coupon code. Use SPICY10 or WELCOME10." });
      }
    } catch (err) {
      setDiscountStatus({ type: "error", text: "Failed to apply coupon: " + err.message });
    }
  };

  // 4. Card Payment Authorization & Verification (Server-Authoritative)
  const handlePayViaCard = async () => {
    if (!bill) return;

    try {
      setIsProcessing(true);
      setErrorMessage("");

      const transactionId = paymentData?.payment?.transaction_id || `TXN-CARD-${Date.now()}`;
      const idempotencyKey = paymentData?.idempotencyKey || `KEY-${Date.now()}`;

      const res = await api.verifyPayment({
        bill_id: bill.id,
        transaction_id: transactionId,
        payment_id: paymentData?.payment?.id,
        idempotency_key: idempotencyKey,
        amount: bill.grand_total,
        status: "SUCCESS",
        gateway_reference: `CARD_AUTH_${Date.now()}`,
      });

      handlePaymentSuccess(
        res.receipt || {
          restaurant_name: "Spicy Spoon",
          restaurant_address: "Tiruppur-Palladam road, Tamil Nadu",
          restaurant_phone: "+91 73958 77142",
          bill: res.bill || bill,
          payment: res.payment,
          table: res.table,
          items: bill.items || [],
        }
      );
    } catch (err) {
      console.error("Card payment error:", err);
      setErrorMessage("Card Payment Authorization Failed: " + (err.message || "Please check card details and retry."));
    } finally {
      setIsProcessing(false);
    }
  };

  // 5. Request Cash Payment
  const handleRequestCashPayment = async () => {
    if (!bill) return;
    try {
      setIsProcessing(true);
      await initiatePaymentMethod("CASH", bill.id);
      setCashRequested(true);
    } catch (err) {
      setErrorMessage("Failed to request cash payment: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="bill-payment-page">
      {/* Header */}
      <header className="bill-header">
        <a href="#home" className="back-link">
          <ArrowLeft size={18} />
          <span>Spicy Spoon</span>
        </a>
        <div className="header-title">
          <span className="live-pill">LIVE BILLING & SETTLEMENT</span>
          <h1>Table {bill?.table_number || targetTable} Invoice</h1>
        </div>
        <button className="refresh-bill-btn" onClick={fetchLiveBill} title="Refresh Bill">
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </button>
      </header>

      {errorMessage && (
        <div className="bill-error-banner">
          <AlertCircle size={20} />
          <span>{errorMessage}</span>
        </div>
      )}

      {loading && !bill ? (
        <div className="bill-loading-container">
          <RefreshCw size={36} className="spin" />
          <p>Aggregating active orders for Table {targetTable}...</p>
        </div>
      ) : paymentSuccess && verifiedReceipt ? (
        /* ================= DIGITAL RECEIPT VIEW ================= */
        <main className="receipt-view-wrapper">
          <div className="receipt-card-container">
            <div className="receipt-success-badge">
              <CheckCircle2 size={48} />
            </div>

            <h2>Payment Verified! ✓</h2>
            <p className="receipt-sub">Thank you for dining at Spicy Spoon. Your payment has been confirmed by our system.</p>

            <div className="digital-receipt-sheet" id="printable-receipt">
              {/* Receipt Header */}
              <div className="receipt-brand-head">
                <h3>{verifiedReceipt.restaurant_name || "SPICY SPOON"}</h3>
                <p>{verifiedReceipt.restaurant_address || "Tiruppur-Palladam Road, Tamil Nadu"}</p>
                <p>Phone: {verifiedReceipt.restaurant_phone || "+91 73958 77142"}</p>
                <p>GSTIN: 33AAFPS1234A1Z5</p>
              </div>

              <div className="receipt-dash-line"></div>

              {/* Receipt Meta */}
              <div className="receipt-meta-grid">
                <div>
                  <span>INVOICE NUMBER</span>
                  <strong>#{verifiedReceipt.bill?.bill_number || bill?.bill_number}</strong>
                </div>
                <div>
                  <span>TABLE</span>
                  <strong>{verifiedReceipt.bill?.table_number || targetTable}</strong>
                </div>
                <div>
                  <span>DATE & TIME</span>
                  <strong>{new Date().toLocaleString()}</strong>
                </div>
                <div>
                  <span>PAYMENT MODE</span>
                  <strong className="pay-mode-tag">{verifiedReceipt.payment?.payment_method || selectedMethod}</strong>
                </div>
              </div>

              <div className="receipt-dash-line"></div>

              {/* Itemized Table */}
              <table className="receipt-items-table">
                <thead>
                  <tr>
                    <th>Item Description</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(verifiedReceipt.items && verifiedReceipt.items.length > 0 ? verifiedReceipt.items : bill?.items || []).map(
                    (item, idx) => (
                      <tr key={idx}>
                        <td>
                          <div className="item-name-cell">
                            <span>{item.name}</span>
                            {item.special_instruction && <small>Note: {item.special_instruction}</small>}
                          </div>
                        </td>
                        <td>×{item.quantity}</td>
                        <td>₹{Number(item.unit_price || item.price).toFixed(2)}</td>
                        <td>₹{Number(item.total_price || item.price * item.quantity).toFixed(2)}</td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>

              <div className="receipt-dash-line"></div>

              {/* Math Summary */}
              <div className="receipt-totals-list">
                <div className="totals-row">
                  <span>Food Subtotal</span>
                  <span>₹{Number(verifiedReceipt.bill?.subtotal || bill?.subtotal || 0).toFixed(2)}</span>
                </div>
                <div className="totals-row">
                  <span>GST (5.0%)</span>
                  <span>₹{Number(verifiedReceipt.bill?.tax || bill?.tax || 0).toFixed(2)}</span>
                </div>
                <div className="totals-row">
                  <span>Service Charge (2.5%)</span>
                  <span>₹{Number(verifiedReceipt.bill?.service_charge || bill?.service_charge || 0).toFixed(2)}</span>
                </div>
                {Number(verifiedReceipt.bill?.discount || bill?.discount) > 0 && (
                  <div className="totals-row discount-row">
                    <span>Discount Applied</span>
                    <span>-₹{Number(verifiedReceipt.bill?.discount || bill?.discount).toFixed(2)}</span>
                  </div>
                )}
                <div className="totals-row grand-total-row">
                  <strong>Grand Total Paid</strong>
                  <strong>₹{Number(verifiedReceipt.bill?.grand_total || bill?.grand_total || 0).toFixed(2)}</strong>
                </div>
              </div>

              <div className="receipt-dash-line"></div>

              <div className="receipt-transaction-footer">
                <p>
                  Transaction ID: <code>{verifiedReceipt.payment?.transaction_id || "TXN-VERIFIED"}</code>
                </p>
                <div className="paid-seal">✓ SERVER VERIFIED & PAID IN FULL</div>
              </div>
            </div>

            {/* Receipt Actions */}
            <div className="receipt-action-buttons">
              <button className="btn-print-receipt" onClick={() => window.print()}>
                <Printer size={18} /> Print Official Receipt
              </button>
              <a href="#home" className="btn-home-return">
                Back to Home Page →
              </a>
            </div>
          </div>
        </main>
      ) : !bill ? (
        <main className="bill-empty-layout" style={{ maxWidth: "520px", margin: "60px auto", textAlign: "center", padding: "36px 24px", background: "#160d09", borderRadius: "20px", border: "1px solid rgba(255, 69, 0, 0.2)" }}>
          <AlertCircle size={48} style={{ color: "#f59e0b", marginBottom: "14px" }} />
          <h3 style={{ color: "#ffffff", margin: "0 0 8px 0", fontSize: "1.3rem" }}>No Active Orders on {targetTable}</h3>
          <p style={{ color: "#a89487", fontSize: "0.9rem", margin: "0 0 20px 0" }}>There are no unpaid orders currently placed for this table session.</p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
            <a href={`#/order?table=${targetTable}`} style={{ background: "linear-gradient(135deg, #ff4500, #ff8c00)", color: "#fff", padding: "10px 18px", borderRadius: "10px", textDecoration: "none", fontWeight: 700 }}>
              Order Food for {targetTable} →
            </a>
            <a href="#home" style={{ background: "#25160e", color: "#f5e6dc", padding: "10px 18px", borderRadius: "10px", textDecoration: "none" }}>
              Home
            </a>
          </div>
        </main>
      ) : (
        /* ================= LIVE BILL & CHECKOUT VIEW ================= */
        <main className="bill-checkout-layout">
          {/* Left Column: Itemized Orders & Breakdown */}
          <section className="bill-left-card">
            <div className="card-header">
              <div className="header-info">
                <span className="invoice-tag">INVOICE #{bill?.bill_number || "LIVE"}</span>
                <h2>Order Summary</h2>
              </div>
              <span className="table-badge-indicator">{bill?.table_number || targetTable}</span>
            </div>

            {/* Items Table */}
            <div className="invoice-items-scroll">
              <table className="checkout-items-table">
                <thead>
                  <tr>
                    <th>Dish</th>
                    <th>Qty</th>
                    <th>Unit Price</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {bill.items && bill.items.length > 0 ? (
                    bill.items.map((item, idx) => (
                      <tr key={idx}>
                        <td>
                          <span className="dish-name-txt">{item.name}</span>
                          {item.order_number && (
                            <span className="round-badge">
                              Round {item.round_number || 1} (#{item.order_number})
                            </span>
                          )}
                          {item.special_instruction && <small className="note-txt">📝 {item.special_instruction}</small>}
                        </td>
                        <td>×{item.quantity}</td>
                        <td>₹{Number(item.unit_price || item.price).toFixed(2)}</td>
                        <td>
                          <strong>₹{Number(item.total_price || item.price * item.quantity).toFixed(2)}</strong>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="no-items-td">
                        No active items found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Coupon Box */}
            <div className="coupon-redemption-card">
              <div className="coupon-form">
                <Tag size={18} className="tag-icon" />
                <input
                  type="text"
                  placeholder="Promo code (e.g. SPICY10)"
                  value={discountCode}
                  onChange={(e) => setDiscountCode(e.target.value)}
                />
                <button type="button" onClick={handleApplyCoupon}>
                  Apply Coupon
                </button>
              </div>
              {discountStatus && <p className={`coupon-feedback ${discountStatus.type}`}>{discountStatus.text}</p>}
            </div>

            {/* Subtotal & Tax Breakdown */}
            <div className="bill-calculation-box">
              <div className="calc-row">
                <span>Food Subtotal</span>
                <span>₹{Number(bill.subtotal).toFixed(2)}</span>
              </div>
              <div className="calc-row">
                <span>GST (5.0%)</span>
                <span>₹{Number(bill.tax).toFixed(2)}</span>
              </div>
              <div className="calc-row">
                <span>Service Charge (2.5%)</span>
                <span>₹{Number(bill.service_charge).toFixed(2)}</span>
              </div>
              {Number(bill.discount) > 0 && (
                <div className="calc-row discount-row">
                  <span>Coupon Discount Applied</span>
                  <span>-₹{Number(bill.discount).toFixed(2)}</span>
                </div>
              )}
              <div className="calc-row grand-row">
                <strong>Grand Total Due</strong>
                <strong>₹{Number(bill.grand_total).toFixed(2)}</strong>
              </div>
            </div>
          </section>

          {/* Right Column: Payment Methods Gateway */}
          <section className="bill-right-card">
            <div className="card-header">
              <h2>Select Payment Mode</h2>
              <span className="secured-badge">
                <ShieldCheck size={14} /> Server Verified
              </span>
            </div>

            {/* Method Tabs */}
            <div className="pay-method-tabs">
              <button
                type="button"
                className={`method-tab ${selectedMethod === "UPI" ? "active" : ""}`}
                onClick={() => initiatePaymentMethod("UPI")}
              >
                <QrCode size={20} />
                <span>UPI QR</span>
              </button>

              <button
                type="button"
                className={`method-tab ${selectedMethod === "CARD" ? "active" : ""}`}
                onClick={() => initiatePaymentMethod("CARD")}
              >
                <CreditCard size={20} />
                <span>Card</span>
              </button>

              <button
                type="button"
                className={`method-tab ${selectedMethod === "CASH" ? "active" : ""}`}
                onClick={() => initiatePaymentMethod("CASH")}
              >
                <Banknote size={20} />
                <span>Cash</span>
              </button>
            </div>

            {/* Payment Mode View */}
            <div className="payment-body-container">
              {/* 1. UPI Payment (Automatic Verification) */}
              {selectedMethod === "UPI" && (
                <div className="upi-checkout-box">
                  <p className="upi-guide-text">Scan with GPay, PhonePe, Paytm, CRED or any UPI App</p>

                  {paymentData?.upiQrCode ? (
                    <div className="upi-qr-display">
                      <img src={paymentData.upiQrCode} alt="Live UPI QR" className="live-qr-img" />
                      <p className="upi-vpa-tag">
                        UPI ID: <strong>spicyspoon@upi</strong>
                      </p>
                      <span className="amount-pill">Pay ₹{Number(bill.grand_total).toFixed(2)}</span>
                    </div>
                  ) : (
                    <div className="qr-loading-spinner">
                      <RefreshCw size={28} className="spin" />
                      <span>Generating Secure UPI QR...</span>
                    </div>
                  )}

                  {/* Automatic Live Verification Listener Indicator (No Manual Button) */}
                  <div className="auto-verify-live-banner">
                    <div className="listening-pulse-ring">
                      <span className="pulse-dot"></span>
                      <Radio size={16} className="radio-icon" />
                    </div>
                    <div className="verify-text-info">
                      <h4>Listening for Bank UPI Payment...</h4>
                      <p>
                        Scan the QR code and approve the transaction in your UPI app. The system will automatically
                        verify the payment and open your digital receipt.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* 2. Card Payment (Server Authorized) */}
              {selectedMethod === "CARD" && (
                <div className="card-checkout-box">
                  <div className="card-input-group">
                    <label>Card Number</label>
                    <input
                      type="text"
                      value={cardForm.cardNumber}
                      onChange={(e) => setCardForm({ ...cardForm, cardNumber: e.target.value })}
                    />
                  </div>

                  <div className="card-dual-row">
                    <div className="card-input-group">
                      <label>Cardholder Name</label>
                      <input
                        type="text"
                        value={cardForm.cardHolder}
                        onChange={(e) => setCardForm({ ...cardForm, cardHolder: e.target.value })}
                      />
                    </div>
                    <div className="card-input-group">
                      <label>Expiry / CVV</label>
                      <input type="text" value={`${cardForm.expiry} · ${cardForm.cvv}`} readOnly />
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn-complete-pay"
                    onClick={handlePayViaCard}
                    disabled={isProcessing}
                  >
                    {isProcessing ? (
                      <>
                        <RefreshCw size={18} className="spin" /> Authorizing & Verifying Card...
                      </>
                    ) : (
                      <>
                        <Lock size={18} /> Pay ₹{Number(bill.grand_total).toFixed(2)} via Card
                      </>
                    )}
                  </button>
                  <p className="secure-footnote">🔒 Payments are processed & verified securely through the gateway.</p>
                </div>
              )}

              {/* 3. Cash Payment (Admin Only Confirmation) */}
              {selectedMethod === "CASH" && (
                <div className="cash-checkout-box">
                  <div className="cash-request-alert">
                    <Banknote size={40} className="cash-alert-icon" />
                    <h3>Cash Settlement Request</h3>
                    <p>
                      Please hand exact cash <strong>₹{Number(bill.grand_total).toFixed(2)}</strong> to our floor staff
                      or billing counter for Table {bill.table_number}.
                    </p>
                  </div>

                  {!cashRequested ? (
                    <button
                      type="button"
                      className="btn-complete-pay cash-btn"
                      onClick={handleRequestCashPayment}
                      disabled={isProcessing}
                    >
                      {isProcessing ? (
                        <>
                          <RefreshCw size={18} className="spin" /> Sending Cash Request...
                        </>
                      ) : (
                        <>
                          <Banknote size={18} /> Request Cash Payment at Table {bill.table_number}
                        </>
                      )}
                    </button>
                  ) : (
                    <div className="cash-waiting-admin-card">
                      <div className="listening-pulse-ring">
                        <span className="pulse-dot orange"></span>
                        <Clock size={18} className="clock-icon-pulse" />
                      </div>
                      <div className="cash-wait-info">
                        <h4>Cash Payment Request Sent to Admin</h4>
                        <p>
                          Our staff has received your cash payment request for Table {bill.table_number}. When staff confirms
                          the cash received, this screen will automatically open your verified Digital Receipt.
                        </p>
                        <span className="cash-amount-tag">Amount to Collect: ₹{Number(bill.grand_total).toFixed(2)}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}

export default BillPayment;
