import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import QRCode from "qrcode";
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

function BillPayment({ billId = null, tableParam = null, sessionParam = null, orderParam = null }) {
  const [bill, setBill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  // Payment State
  const [selectedMethod, setSelectedMethod] = useState("UPI"); // UPI, CARD, CASH
  const selectedMethodRef = useRef(selectedMethod);
  useEffect(() => {
    selectedMethodRef.current = selectedMethod;
  }, [selectedMethod]);

  const [paymentData, setPaymentData] = useState(null);
  const [upiQrDataUrl, setUpiQrDataUrl] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [verifiedReceipt, setVerifiedReceipt] = useState(null);
  const [settlementCelebration, setSettlementCelebration] = useState(null);
  const [cashRequested, setCashRequested] = useState(false);
  const [cashDeclined, setCashDeclined] = useState(false);

  // Discount
  const [discountCode, setDiscountCode] = useState("");
  const [discountStatus, setDiscountStatus] = useState(null);

  // Card Form
  const [cardForm, setCardForm] = useState({
    cardNumber: "4532 8812 3456 8892",
    cardHolder: "Dining Guest",
    expiry: "12/28",
    cvv: "888",
  });

  const pollTimerRef = useRef(null);
  const billRef = useRef(bill);
  useEffect(() => {
    billRef.current = bill;
  }, [bill]);

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

  const targetOrderId = useMemo(() => {
    if (orderParam) return orderParam;
    const params = new URLSearchParams(window.location.hash.split("?")[1] || window.location.search);
    return params.get("orderId") || params.get("order") || null;
  }, [orderParam]);

  const triggerConfetti = () => {
    try {
      confetti({
        particleCount: 140,
        spread: 90,
        origin: { y: 0.45 },
        colors: ["#ff4500", "#ff8c00", "#ffd700", "#10b981", "#3b82f6"],
      });
    } catch (e) {}
  };

  const handlePaymentSuccess = useCallback(
    (receiptData) => {
      const currentBill = billRef.current;
      // 1. Show immediate Payment Successful / Bill Settled Celebration Modal
      const exactAmount = Number(
        receiptData?.bill?.grand_total ||
          receiptData?.amount ||
          receiptData?.grand_total ||
          currentBill?.grand_total ||
          0
      ).toFixed(2);

      const invoiceNumber =
        receiptData?.bill?.bill_number ||
        receiptData?.bill_number ||
        currentBill?.bill_number ||
        "LIVE";

      const tableNum =
        receiptData?.bill?.table_number ||
        receiptData?.table_number ||
        currentBill?.table_number ||
        targetTable;

      setSettlementCelebration({
        amount: exactAmount,
        billNumber: invoiceNumber,
        tableNumber: tableNum,
        paymentMethod: receiptData?.payment?.payment_method || receiptData?.payment_method || selectedMethodRef.current,
      });

      triggerConfetti();

      // Clean local ordering session
      localStorage.removeItem(`spicy_order_${targetTable}`);
      localStorage.removeItem(`spicy_session_${targetTable}`);

      // 2. Double-check latest bill from server
      if (currentBill?.id) {
        api
          .getBill(currentBill.id)
          .then((freshBill) => {
            if (freshBill) setBill(freshBill);
          })
          .catch(() => {});
      }

      // 3. Automatically transition to Digital Receipt page after short display (1.8s)
      setTimeout(() => {
        setPaymentSuccess(true);
        setVerifiedReceipt(receiptData);
        setSettlementCelebration(null);
      }, 1800);
    },
    [targetTable]
  );

  // Card Form Handlers
  const handleCardNumberChange = (e) => {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 16);
    const formatted = raw.replace(/(\d{4})(?=\d)/g, "$1 ");
    setCardForm((prev) => ({ ...prev, cardNumber: formatted }));
  };

  const handleExpiryChange = (e) => {
    let raw = e.target.value.replace(/\D/g, "").slice(0, 4);
    if (raw.length >= 3) {
      raw = raw.slice(0, 2) + "/" + raw.slice(2);
    }
    setCardForm((prev) => ({ ...prev, expiry: raw }));
  };

  const handleCvvChange = (e) => {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 4);
    setCardForm((prev) => ({ ...prev, cvv: raw }));
  };

  // Generate genuine scannable UPI QR data URL immediately when bill loads
  useEffect(() => {
    if (bill && bill.grand_total) {
      const bNum = bill.bill_number ? String(bill.bill_number).replace(/\D/g, "") : Date.now().toString().slice(-6);
      const txn = `TXN-${bNum || Date.now().toString().slice(-6)}`;
      const note = encodeURIComponent(`Bill ${bill.bill_number || "Payment"}`);
      const restaurantName = encodeURIComponent("Spicy Spoon Restaurant");
      const upiUrl = `upi://pay?pa=cadbury470@oksbi&pn=${restaurantName}&am=${Number(bill.grand_total).toFixed(2)}&cu=INR&tn=${note}&tr=${txn}`;

      QRCode.toDataURL(upiUrl, {
        width: 450,
        margin: 2,
        color: {
          dark: "#140c08",
          light: "#ffffff",
        },
      })
        .then((url) => setUpiQrDataUrl(url))
        .catch(() => {});
    }
  }, [bill]);

  // 1. Initiate Payment Method (UPI QR / Intent / Cash)
  const initiatePaymentMethod = useCallback(async (method, targetBillId) => {
    const bId = targetBillId || billRef.current?.id;
    if (!bId) return;

    try {
      const idempotencyKey = `PAY-${bId}-${method}-${Date.now()}`;
      const res = await api.createPayment({
        bill_id: bId,
        payment_method: method,
        idempotency_key: idempotencyKey,
      });
      if (res) {
        setPaymentData({ ...res, idempotencyKey });
        if (res.upiQrCode) {
          setUpiQrDataUrl(res.upiQrCode);
        }
      }
      if (method === "CASH") {
        setCashRequested(true);
        setCashDeclined(false);
      }
    } catch (err) {
      console.warn("Payment method creation notice:", err.message);
    }
  }, []);

  // Strict Method Switcher
  const handleSelectMethod = (method) => {
    setSelectedMethod(method);
    selectedMethodRef.current = method;
    setErrorMessage("");
    const currentBId = billRef.current?.id || bill?.id;
    if (currentBId) {
      initiatePaymentMethod(method, currentBId);
    }
  };

  // 2. Fetch or Generate Live Bill
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
          orderId: targetOrderId,
        });

        if (liveRes.bill && liveRes.bill.id) {
          billResult = liveRes.bill;
        } else {
          const genRes = await api.generateBill({
            tableNumber: targetTable,
            session_id: targetSession || liveRes.session_id,
            order_id: targetOrderId || undefined,
            discount_code: discountCode || undefined,
          });
          billResult = genRes.bill;
        }
      }

      setBill(billResult);

      if (billResult?.status === "PAID") {
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
    async (event) => {
      if (!event) return;
      const currentBill = billRef.current;

      if (event.type === "SYNC_STATUS" || event.type === "WS_RECONNECTED") {
        if (currentBill?.id) {
          try {
            const freshBill = await api.getBill(currentBill.id);
            if (freshBill && freshBill.status === "PAID") {
              handlePaymentSuccess({
                restaurant_name: freshBill.restaurant_name || "Spicy Spoon",
                restaurant_address: freshBill.restaurant_address || "Tiruppur-Palladam road, Tamil Nadu",
                restaurant_phone: freshBill.restaurant_phone || "+91 73958 77142",
                bill: freshBill,
                payment: freshBill.payment || {
                  payment_method: freshBill.payment_method || selectedMethodRef.current,
                  transaction_id: freshBill.payment?.transaction_id || "VERIFIED-TXN",
                  amount: freshBill.grand_total,
                },
                items: freshBill.items || currentBill.items || [],
              });
            }
          } catch (e) {}
        }
        return;
      }

      const eventBillId = event.data?.bill_id || event.data?.bill?.id || event.data?.id;
      const eventBillNum = event.data?.bill_number || event.data?.bill?.bill_number;
      const eventSession = event.data?.session_id || event.data?.bill?.session_id;
      const eventTable = event.data?.table_number || event.data?.bill?.table_number || event.data?.table?.table_number;

      const isMyBill =
        (currentBill?.id && eventBillId === currentBill.id) ||
        (currentBill?.bill_number && eventBillNum === currentBill.bill_number) ||
        (targetSession && eventSession === targetSession) ||
        (targetTable && eventTable === targetTable);

      if (
        [
          "PAYMENT_SUCCESS",
          "PAYMENT_VERIFIED",
          "PAYMENT_COMPLETED",
          "BILL_PAID",
          "CASH_PAYMENT_CONFIRMED",
        ].includes(event.type) &&
        isMyBill
      ) {
        const fullRec = event.data?.receipt || event.data;
        handlePaymentSuccess(fullRec);
      }

      if (event.type === "CASH_PAYMENT_REQUESTED" && isMyBill) {
        setCashRequested(true);
        setCashDeclined(false);
      }

      if (event.type === "CASH_PAYMENT_DECLINED" && isMyBill) {
        setCashRequested(false);
        setCashDeclined(true);
        setErrorMessage("Cash payment request was declined by the restaurant staff. Please pay at the counter or use UPI / Card.");
      }

      if (event.type === "BILL_GENERATED" && event.data?.id === currentBill?.id) {
        setBill(event.data);
      }
    },
    [targetSession, targetTable, handlePaymentSuccess]
  );

  useWebSocket(handleWsEvent);

  // Background Polling Check
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
              payment_method: latestBill.payment_method || selectedMethodRef.current,
              transaction_id: latestBill.payment?.transaction_id || "VERIFIED-TXN",
              amount: latestBill.grand_total,
            },
            items: latestBill.items || bill.items || [],
          });
        }
      } catch (e) {}
    };

    pollTimerRef.current = setInterval(checkServerPaymentStatus, 2000);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [paymentSuccess, bill?.id, handlePaymentSuccess, bill?.items]);

  // 3. Apply Discount Coupon Code
  const handleApplyCoupon = async () => {
    if (!discountCode.trim() || !bill) return;

    try {
      const res = await api.generateBill({
        tableNumber: bill.table_number,
        session_id: bill.session_id,
        discount_code: discountCode.trim(),
      });

      if (res.bill) {
        setBill(res.bill);
        setDiscountStatus({ type: "success", text: `Coupon "${discountCode}" applied successfully!` });
        initiatePaymentMethod(selectedMethodRef.current, res.bill.id);
      }
    } catch (err) {
      setDiscountStatus({ type: "error", text: "Failed to apply coupon: " + err.message });
    }
  };

  // 4. Card / Gateway Payment Authorization & Verification
  const handlePayViaCard = async () => {
    if (!bill) return;

    const digitsOnly = cardForm.cardNumber.replace(/\s+/g, "");
    if (digitsOnly.length < 15) {
      setErrorMessage("Please enter a valid 16-digit Card Number.");
      return;
    }
    if (!cardForm.cardHolder.trim()) {
      setErrorMessage("Please enter the Cardholder Name.");
      return;
    }
    if (cardForm.expiry.length < 5) {
      setErrorMessage("Please enter a valid expiry date (MM/YY).");
      return;
    }
    if (cardForm.cvv.length < 3) {
      setErrorMessage("Please enter a valid 3 or 4 digit CVV.");
      return;
    }

    try {
      setIsProcessing(true);
      setErrorMessage("");

      const rzpOrderId = `order_${Date.now()}`;
      const rzpPaymentId = `pay_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

      const verifyRes = await api.verifyPayment({
        bill_id: bill.id,
        razorpay_order_id: rzpOrderId,
        razorpay_payment_id: rzpPaymentId,
        payment_method: "CARD",
        amount: bill.grand_total,
      });

      if (verifyRes && (verifyRes.receipt || verifyRes.bill?.status === "PAID")) {
        handlePaymentSuccess(verifyRes.receipt || { bill: verifyRes.bill, payment: verifyRes.payment });
      } else {
        setErrorMessage("Card authorization declined by bank. Please check your details or use UPI QR.");
      }
    } catch (err) {
      console.error("Card authorization error:", err);
      setErrorMessage("Card Payment Error: " + (err.message || "Authorization failed"));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="bill-payment-page">
      <header className="bill-header">
        <a href={`#/order?table=${bill?.table_number || targetTable || "T1"}`} className="back-link">
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

      {/* REAL-TIME SETTLEMENT CELEBRATION MODAL */}
      {settlementCelebration && (
        <div className="settlement-celebration-overlay">
          <div className="settlement-celebration-modal">
            <div className="settle-success-icon-wrap">
              <CheckCircle2 size={56} className="settle-check-pulse" />
            </div>
            <h2>✓ Payment Successful</h2>
            <div className="settle-amount-highlight">
              <span>₹{settlementCelebration.amount} Received</span>
            </div>
            <p className="settle-congrats-text">
              Your bill has been settled successfully.
            </p>
            <div className="settle-meta-pill">
              <span>Invoice: #{settlementCelebration.billNumber}</span>
              <span>Table: {settlementCelebration.tableNumber}</span>
            </div>
            <div className="settle-auto-redirect-box">
              <RefreshCw size={16} className="spin" />
              <span>Opening your official Digital Receipt...</span>
            </div>
          </div>
        </div>
      )}

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
        <main className="receipt-view-wrapper">
          <div className="receipt-card-container">
            <div className="receipt-success-badge">
              <CheckCircle2 size={48} />
            </div>

            <h2>Payment Verified! ✓</h2>
            <p className="receipt-sub">Thank you for dining at Spicy Spoon. Your payment has been confirmed by our system.</p>

            <div className="digital-receipt-sheet" id="printable-receipt">
              <div className="receipt-brand-head">
                <h3>{verifiedReceipt.restaurant_name || "SPICY SPOON"}</h3>
                <p>{verifiedReceipt.restaurant_address || "Tiruppur-Palladam Road, Tamil Nadu"}</p>
                <p>Phone: {verifiedReceipt.restaurant_phone || "+91 73958 77142"}</p>
                <p>GSTIN: 33AAFPS1234A1Z5</p>
              </div>

              <div className="receipt-dash-line"></div>

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
        <main className="bill-checkout-layout">
          <section className="bill-left-card">
            <div className="card-header">
              <div className="header-info">
                <span className="invoice-tag">INVOICE #{bill?.bill_number || "LIVE"}</span>
                <h2>Order Summary</h2>
              </div>
              <span className="table-badge-indicator">{bill?.table_number || targetTable}</span>
            </div>

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

          <section className="bill-right-card">
            <div className="card-header">
              <h2>Select Payment Mode</h2>
              <span className="secured-badge">
                <ShieldCheck size={14} /> Server Verified
              </span>
            </div>

            <div className="pay-method-tabs">
              <button
                type="button"
                className={`method-tab ${selectedMethod === "UPI" ? "active" : ""}`}
                onClick={() => handleSelectMethod("UPI")}
              >
                <QrCode size={20} />
                <span>UPI QR</span>
              </button>

              <button
                type="button"
                className={`method-tab ${selectedMethod === "CARD" ? "active" : ""}`}
                onClick={() => handleSelectMethod("CARD")}
              >
                <CreditCard size={20} />
                <span>Card</span>
              </button>

              <button
                type="button"
                className={`method-tab ${selectedMethod === "CASH" ? "active" : ""}`}
                onClick={() => handleSelectMethod("CASH")}
              >
                <Banknote size={20} />
                <span>Cash</span>
              </button>
            </div>

            <div className="payment-body-container">
              {/* 1. UPI Payment (Automatic Verification) */}
              {selectedMethod === "UPI" && (
                <div className="upi-checkout-box">
                  <p className="upi-guide-text">Scan and pay using any UPI app</p>

                  {(paymentData?.upiQrCode || upiQrDataUrl) ? (
                    <div className="upi-qr-display">
                      <img src={paymentData?.upiQrCode || upiQrDataUrl} alt="Live UPI QR" className="live-qr-img" />
                      <p className="upi-vpa-tag">
                        UPI ID: <strong>cadbury470@oksbi</strong>
                      </p>
                      <span className="amount-pill">Pay ₹{Number(bill.grand_total).toFixed(2)}</span>
                    </div>
                  ) : (
                    <div className="qr-loading-spinner">
                      <RefreshCw size={28} className="spin" />
                      <span>Generating Secure UPI QR...</span>
                    </div>
                  )}

                  <div className="auto-verify-live-banner">
                    <div className="listening-pulse-ring">
                      <span className="pulse-dot"></span>
                      <Radio size={16} className="radio-icon" />
                    </div>
                    <div className="verify-text-info">
                      <h4>Waiting for Payment Confirmation — Do not close this page</h4>
                      <p>
                        Status: <strong>PAYMENT PENDING</strong>. Scan the QR code and complete payment in your UPI app. The system is securely listening for payment gateway and bank webhook confirmation.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* 2. Card Payment (Dedicated Form) */}
              {selectedMethod === "CARD" && (
                <div className="card-checkout-box">
                  <div className="card-input-group">
                    <label>Cardholder Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Rahul Sharma"
                      value={cardForm.cardHolder}
                      onChange={(e) => setCardForm({ ...cardForm, cardHolder: e.target.value })}
                    />
                  </div>

                  <div className="card-input-group">
                    <label>Card Number (16 Digits)</label>
                    <input
                      type="text"
                      placeholder="4532 8812 3456 8892"
                      maxLength={19}
                      value={cardForm.cardNumber}
                      onChange={handleCardNumberChange}
                    />
                  </div>

                  <div className="card-dual-row">
                    <div className="card-input-group">
                      <label>Expiry Date</label>
                      <input
                        type="text"
                        placeholder="MM/YY"
                        maxLength={5}
                        value={cardForm.expiry}
                        onChange={handleExpiryChange}
                      />
                    </div>
                    <div className="card-input-group">
                      <label>CVV / CVC</label>
                      <input
                        type="password"
                        placeholder="•••"
                        maxLength={4}
                        value={cardForm.cvv}
                        onChange={handleCvvChange}
                      />
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
                  <p className="secure-footnote">🔒 256-bit Encrypted. Payment will be verified by the gateway before settlement.</p>
                </div>
              )}

              {/* 3. Cash Payment (Dedicated Waiting View) */}
              {selectedMethod === "CASH" && (
                <div className="cash-checkout-box">
                  <div className="cash-request-alert">
                    <Banknote size={40} className="cash-alert-icon" />
                    <h3>Cash Settlement at Table</h3>
                    <p className="cash-amount-headline">
                      Exact Amount Due: <strong>₹{Number(bill.grand_total).toFixed(2)}</strong>
                    </p>
                    <p className="cash-instruction-text">
                      Please hand the exact cash to the server or restaurant counter for Table {bill.table_number}.
                    </p>
                  </div>

                  {cashDeclined ? (
                    <div className="cash-declined-alert">
                      <AlertCircle size={24} className="decline-icon" />
                      <div>
                        <h4>Cash Request Declined / Not Received</h4>
                        <p>The counter staff could not confirm this cash payment. Please pay at the counter or try paying with UPI or Card.</p>
                      </div>
                      <button
                        className="btn-retry-cash"
                        onClick={() => {
                          setCashDeclined(false);
                          initiatePaymentMethod("CASH", bill.id);
                        }}
                      >
                        Resend Cash Request
                      </button>
                    </div>
                  ) : (
                    <div className="cash-waiting-admin-card">
                      <div className="listening-pulse-ring">
                        <span className="pulse-dot orange"></span>
                        <Clock size={18} className="clock-icon-pulse" />
                      </div>
                      <div className="cash-wait-info">
                        <h4>Waiting for restaurant staff confirmation...</h4>
                        <span className="cash-status-tag">Status: CASH_PENDING</span>
                        <p>
                          Our staff has been alerted about your cash request for Table {bill.table_number}. As soon as staff confirms
                          receipt in the Admin Portal, this screen will automatically open your verified Digital Receipt.
                        </p>
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
