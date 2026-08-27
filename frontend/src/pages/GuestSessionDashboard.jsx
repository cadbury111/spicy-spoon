import { useEffect, useState, useCallback } from "react";
import {
  Utensils,
  Receipt,
  Clock,
  CheckCircle2,
  AlertCircle,
  Plus,
  ArrowLeft,
  ChevronRight,
  Flame,
  Printer,
  Sparkles,
  ShoppingBag,
  RefreshCw,
} from "lucide-react";
import { api } from "../api";
import { useWebSocket } from "../hooks/useWebSocket";
import "./GuestSessionDashboard.css";

function GuestSessionDashboard({ sessionId: propSessionId }) {
  const [sessionId, setSessionId] = useState(() => {
    if (propSessionId) return propSessionId;
    const hash = window.location.hash;
    const match = hash.match(/\/session\/([A-Za-z0-9-_]+)/i);
    if (match) return match[1];
    const params = new URLSearchParams(hash.split("?")[1] || window.location.search);
    return params.get("session") || localStorage.getItem("spicy_last_session") || "SESSION-DEFAULT";
  });

  const [sessionData, setSessionData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const fetchSession = useCallback(async () => {
    if (!sessionId || sessionId === "SESSION-DEFAULT") {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const data = await api.getGuestSession(sessionId);
      setSessionData(data);
      setErrorMsg("");
    } catch (err) {
      console.warn("Session fetch error:", err.message);
      setErrorMsg(err.message || "Unable to find active guest dining session.");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // WebSocket Live Updates
  const handleWsEvent = useCallback(
    (event) => {
      if (!event || !event.type) return;

      if (
        [
          "NEW_ORDER",
          "ORDER_STATUS_UPDATED",
          "BILL_GENERATED",
          "PAYMENT_COMPLETED",
          "PAYMENT_VERIFIED",
          "CASH_PAYMENT_CONFIRMED",
          "BILL_PAID",
          "TABLE_STATUS_UPDATED",
        ].includes(event.type)
      ) {
        fetchSession();
      }
    },
    [fetchSession]
  );

  useWebSocket(handleWsEvent);

  const formatTable = (tbl) => {
    if (!tbl) return "Table";
    return String(tbl).startsWith("T") ? tbl : `Table ${tbl}`;
  };

  const getStatusDisplay = (status) => {
    switch (status) {
      case "ORDER_PLACED":
        return { label: "1. Order Placed", color: "orange" };
      case "ACCEPTED":
        return { label: "2. Accepted by Chef", color: "blue" };
      case "PREPARING":
        return { label: "3. Cooking in Kitchen 🔥", color: "yellow" };
      case "READY":
        return { label: "4. Ready for Service 🍽️", color: "green" };
      case "SERVED":
        return { label: "5. Served ✨", color: "purple" };
      case "COMPLETED":
        return { label: "Settled ✓", color: "green" };
      default:
        return { label: status, color: "gray" };
    }
  };

  if (loading) {
    return (
      <div className="session-dashboard-page">
        <div className="session-loading-box">
          <RefreshCw className="spin-icon" size={36} />
          <h3>Loading your dining session...</h3>
        </div>
      </div>
    );
  }

  if (errorMsg || !sessionData) {
    return (
      <div className="session-dashboard-page">
        <header className="session-topbar">
          <a href="#home" className="session-home-link">
            <ArrowLeft size={18} /> Home
          </a>
          <div className="session-brand">
            SPICY <span>SPOON</span>
          </div>
        </header>

        <div className="session-empty-card">
          <AlertCircle size={48} className="empty-icon-amber" />
          <h3>No Active Dining Session Found</h3>
          <p>
            {errorMsg ||
              "Your dining session has either ended or has not been started yet. Please book a table or scan your table QR code."}
          </p>
          <div className="empty-actions">
            <a href="#/restaurant/spicy-spoon/tables" className="btn-session-primary">
              Book a Table →
            </a>
            <a href="#/order?table=T1" className="btn-session-secondary">
              Browse Menu →
            </a>
          </div>
        </div>
      </div>
    );
  }

  const { session, orders = [], bill, summary } = sessionData;
  const isPaid = bill?.status === "PAID" || session.status === "COMPLETED";

  return (
    <div className="session-dashboard-page">
      {/* Top Navbar */}
      <header className="session-topbar">
        <a href="#home" className="session-home-link">
          <ArrowLeft size={18} /> Home
        </a>
        <div className="session-brand">
          SPICY <span>SPOON</span>
          <span className="guest-badge">GUEST DINING SESSION</span>
        </div>
        <button className="btn-refresh-session" onClick={fetchSession} title="Refresh Session">
          <RefreshCw size={16} />
        </button>
      </header>

      <main className="session-dashboard-body">
        {/* WELCOME BANNER */}
        <section className="session-welcome-card">
          <div className="welcome-meta-row">
            <div>
              <span className="session-tag-code">SESSION: {session.session_id}</span>
              <h2>Welcome, {session.customer_name || "Valued Guest"}</h2>
              <p className="session-dining-info">
                Dining at <strong>{formatTable(session.table_number)}</strong> · {session.section || "Main Hall"}
              </p>
            </div>
            <div className="session-status-pill-box">
              <span className={`status-pill ${isPaid ? "paid" : "active"}`}>
                {isPaid ? "SESSION COMPLETED ✓" : "ACTIVE DINING SESSION"}
              </span>
            </div>
          </div>

          {/* Quick Action Buttons */}
          {!isPaid && (
            <div className="session-cta-banner">
              <a
                href={`#/order?table=${session.table_number}&session=${session.session_id}`}
                className="btn-session-action order-more"
              >
                <Plus size={18} />
                <span>Order More Dishes (Round {orders.length + 1})</span>
              </a>
              <a
                href={`#/bill?table=${session.table_number}&session=${session.session_id}`}
                className="btn-session-action view-bill"
              >
                <Receipt size={18} />
                <span>View Live Bill & Settle (₹{Number(bill?.grand_total || 0).toFixed(2)})</span>
              </a>
            </div>
          )}
        </section>

        {/* TWO-COLUMN CONTENT: ORDERS & LIVE BILL */}
        <div className="session-dual-grid">
          {/* LEFT: YOUR ORDERS */}
          <section className="session-card orders-card">
            <div className="card-head">
              <ShoppingBag size={20} className="card-icon" />
              <div>
                <h3>Your Dining Orders</h3>
                <p>
                  {orders.length} {orders.length === 1 ? "Round Placed" : "Rounds Placed"} ({summary?.totalItemsCount || 0} items)
                </p>
              </div>
            </div>

            {orders.length === 0 ? (
              <div className="no-orders-box">
                <Utensils size={36} />
                <p>No dishes ordered yet in this session.</p>
                <a
                  href={`#/order?table=${session.table_number}&session=${session.session_id}`}
                  className="btn-start-order"
                >
                  Start Round 1 Order →
                </a>
              </div>
            ) : (
              <div className="orders-rounds-list">
                {orders.map((ord, idx) => {
                  const statusInfo = getStatusDisplay(ord.status);

                  return (
                    <div className="order-round-block" key={ord.id || idx}>
                      <div className="round-head">
                        <div>
                          <span className="round-pill">ROUND {ord.round_number || idx + 1}</span>
                          <strong className="round-order-num">#{ord.order_number}</strong>
                        </div>
                        <span className={`round-status-badge ${statusInfo.color}`}>{statusInfo.label}</span>
                      </div>

                      <div className="round-items-table">
                        {ord.items?.map((item, iIdx) => (
                          <div className="round-item-row" key={iIdx}>
                            <div className="item-qty-name">
                              <span className="qty-tag">{item.quantity}×</span>
                              <span className="item-name">{item.name}</span>
                              {item.special_instruction && (
                                <small className="item-special-note">📝 "{item.special_instruction}"</small>
                              )}
                            </div>
                            <span className="item-price">
                              ₹{Number(item.total_price || item.unit_price * item.quantity).toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="round-footer">
                        <span>Round Subtotal</span>
                        <strong>₹{Number(ord.subtotal).toFixed(2)}</strong>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* RIGHT: LIVE BILL SUMMARY */}
          <section className="session-card bill-card">
            <div className="card-head">
              <Receipt size={20} className="card-icon" />
              <div>
                <h3>Live Bill Summary</h3>
                <p>Calculated live from active session orders</p>
              </div>
            </div>

            <div className="live-bill-breakdown">
              <div className="bill-line">
                <span>Total Orders Subtotal</span>
                <strong>₹{Number(bill?.subtotal || 0).toFixed(2)}</strong>
              </div>

              <div className="bill-line">
                <span>GST (5.0%)</span>
                <span>₹{Number(bill?.tax || 0).toFixed(2)}</span>
              </div>

              <div className="bill-line">
                <span>Service Charge (2.5%)</span>
                <span>₹{Number(bill?.service_charge || 0).toFixed(2)}</span>
              </div>

              {Number(bill?.discount || 0) > 0 && (
                <div className="bill-line discount">
                  <span>Coupon Discount</span>
                  <span>-₹{Number(bill?.discount).toFixed(2)}</span>
                </div>
              )}

              <div className="bill-line grand-total-line">
                <span>Grand Total</span>
                <strong>₹{Number(bill?.grand_total || 0).toFixed(2)}</strong>
              </div>

              <div className="bill-status-footer">
                <span>Payment Status:</span>
                <strong className={`status-tag ${isPaid ? "paid" : "unpaid"}`}>
                  {isPaid ? "PAID & SETTLED ✓" : "PAYMENT PENDING"}
                </strong>
              </div>

              {isPaid ? (
                <div className="paid-receipt-action">
                  <p className="paid-celebration">Thank you for dining at Spicy Spoon! Your payment is settled.</p>
                  <button className="btn-print-bill" onClick={() => window.print()}>
                    <Printer size={16} />
                    <span>Print Official Receipt</span>
                  </button>
                </div>
              ) : (
                <a
                  href={`#/bill?table=${session.table_number}&session=${session.session_id}`}
                  className="btn-pay-now-full"
                >
                  <span>Proceed to Payment (UPI / Card / Cash) →</span>
                </a>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export default GuestSessionDashboard;
