import { useEffect, useState, useCallback } from "react";
import { Clock, CheckCircle2, ArrowLeft, RefreshCw, Receipt } from "lucide-react";
import { api } from "../api";
import { useWebSocket } from "../hooks/useWebSocket";
import "./OrderHistory.css";

function OrderHistory() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchCompletedOrders = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getOrders();
      const completed = data.filter((o) => ["COMPLETED", "completed"].includes(o.status));
      setOrders(completed);
    } catch (error) {
      console.error("Error fetching order history:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompletedOrders();
  }, [fetchCompletedOrders]);

  useWebSocket(
    useCallback(
      (event) => {
        if (event && ["PAYMENT_COMPLETED", "ORDER_STATUS_UPDATED"].includes(event.type)) {
          fetchCompletedOrders();
        }
      },
      [fetchCompletedOrders]
    )
  );

  return (
    <div className="order-history-page">
      {/* HEADER */}
      <header className="history-header">
        <div className="history-header-left">
          <a href="#home" className="back-link-btn" title="Back to Home">
            <ArrowLeft size={20} />
          </a>
          <div>
            <p className="history-tag">SPICY SPOON</p>
            <h1>Order & Dining History</h1>
            <p className="history-subtitle">Completed feasts and settled receipts</p>
          </div>
        </div>

        <button className="history-refresh-btn" onClick={fetchCompletedOrders}>
          <RefreshCw size={16} /> REFRESH
        </button>
      </header>

      {/* HISTORY CONTENT */}
      <section className="history-section">
        {loading ? (
          <div className="no-history">
            <RefreshCw className="spin-icon" size={32} />
            <p>Loading history...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="no-history">
            <Receipt size={48} />
            <h2>No Completed Orders Yet</h2>
            <p>Completed dining orders and bills will appear here.</p>
            <a href="#/order?table=T1" className="explore-btn">Start an Order →</a>
          </div>
        ) : (
          <div className="history-grid">
            {orders.map((order) => (
              <div className="history-card" key={order.id}>
                <div className="history-card-header">
                  <div>
                    <span className="history-order-number">
                      ORDER #{order.order_number || order.id}
                    </span>
                    <h2>Table {order.table_number || order.tableNumber}</h2>
                  </div>
                  <span className="completed-badge">
                    <CheckCircle2 size={14} /> COMPLETED
                  </span>
                </div>

                <div className="history-items">
                  {order.items &&
                    order.items.map((item, idx) => (
                      <div className="history-item" key={idx}>
                        <span>{item.name}</span>
                        <strong>× {item.quantity}</strong>
                      </div>
                    ))}
                </div>

                <div className="history-footer">
                  <div>
                    <span>ORDER TOTAL</span>
                    <strong>₹{order.total?.toFixed(2)}</strong>
                  </div>
                  <span className="history-time">
                    <Clock size={12} />
                    {new Date(order.created_at || order.createdAt || Date.now()).toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default OrderHistory;