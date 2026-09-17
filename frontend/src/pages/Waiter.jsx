import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Utensils,
  CheckCircle2,
  AlertCircle,
  Banknote,
  Receipt,
  Plus,
  Minus,
  Trash2,
  RefreshCw,
  ArrowLeft,
  Search,
  Check,
  UserCheck,
  Coffee,
  X,
  CreditCard,
} from "lucide-react";
import { api } from "../api";
import { useWebSocket } from "../hooks/useWebSocket";
import "./Waiter.css";

function Waiter() {
  const [tables, setTables] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [cashRequests, setCashRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  // New Order / Table Action Modal
  const [selectedTable, setSelectedTable] = useState(null);
  const [activeModal, setActiveModal] = useState(null); // "ORDER", "BILL", "SETTLE"
  const [orderCart, setOrderCart] = useState([]);
  const [guestName, setGuestName] = useState("Walk-in Guest");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeBill, setActiveBill] = useState(null);

  const fetchFloorData = useCallback(async () => {
    try {
      setLoading(true);
      const [tData, mData, oData] = await Promise.all([
        api.getTables(),
        api.getMenu({ available_only: "true" }),
        api.getOrders(),
      ]);
      setTables(tData);
      setMenuItems(mData);
      setOrders(oData);
    } catch (err) {
      console.error("Floor fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFloorData();
  }, [fetchFloorData]);

  // WebSocket Live Sync
  const handleWsEvent = useCallback(
    (event) => {
      if (!event || !event.type) return;

      if (event.type === "TABLE_STATUS_UPDATED" || event.type === "TABLE_CREATED") {
        api.getTables().then(setTables);
      }

      if (event.type === "ORDER_PLACED" || event.type === "ORDER_STATUS_UPDATED") {
        api.getOrders().then(setOrders);
      }

      if (event.type === "CASH_PAYMENT_REQUESTED") {
        setCashRequests((prev) => [
          ...prev.filter((r) => r.bill?.id !== event.data?.bill?.id),
          event.data,
        ]);
      }

      if (["PAYMENT_COMPLETED", "PAYMENT_VERIFIED", "CASH_PAYMENT_CONFIRMED", "BILL_PAID"].includes(event.type)) {
        setCashRequests((prev) =>
          prev.filter((r) => r.bill?.id !== event.data?.bill?.id && r.id !== event.data?.bill?.id)
        );
        fetchFloorData();
      }
    },
    [fetchFloorData]
  );

  useWebSocket(handleWsEvent);

  // Quick Table Status Changer
  const handleSetTableStatus = async (tableId, status) => {
    try {
      await api.updateTableStatus(tableId, { status });
      setTables((prev) =>
        prev.map((t) => (t.id === tableId ? { ...t, status } : t))
      );
    } catch (err) {
      alert("Failed to update table: " + err.message);
    }
  };

  // Open Order Modal for a table
  const handleOpenOrderModal = (table) => {
    setSelectedTable(table);
    setOrderCart([]);
    setActiveModal("ORDER");
  };

  // Cart operations
  const addToCart = (item) => {
    setOrderCart((prev) => {
      const existing = prev.find((i) => i.id === item.id);
      if (existing) {
        return prev.map((i) => (i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const updateCartQty = (id, delta) => {
    setOrderCart((prev) =>
      prev
        .map((i) => (i.id === id ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0)
    );
  };

  const handlePlaceWaiterOrder = async () => {
    if (!selectedTable || orderCart.length === 0) return;
    try {
      setIsSubmitting(true);
      await api.createOrder({
        tableNumber: selectedTable.table_number.replace(/^T/i, ""),
        table_id: selectedTable.id,
        items: orderCart.map((i) => ({
          id: i.id,
          name: i.name,
          quantity: i.quantity,
          price: i.price,
          unit_price: i.price,
          total_price: i.price * i.quantity,
        })),
        customer_name: guestName,
      });

      setActiveModal(null);
      setOrderCart([]);
      fetchFloorData();
    } catch (err) {
      alert("Order placement failed: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Bill / Settle Modal
  const handleOpenBillModal = async (table) => {
    setSelectedTable(table);
    try {
      if (table.current_order_id) {
        const res = await api.generateBill({ order_id: table.current_order_id });
        setActiveBill(res.bill);
        setActiveModal("BILL");
      } else {
        alert("No active order found on this table.");
      }
    } catch (err) {
      alert("Failed to generate bill: " + err.message);
    }
  };

  // Confirm Cash Settlement
  const handleConfirmCash = async (billId) => {
    try {
      setIsSubmitting(true);
      await api.confirmCashPayment({ bill_id: billId });
      setActiveModal(null);
      setActiveBill(null);
      setCashRequests((prev) => prev.filter((r) => r.bill?.id !== billId));
      fetchFloorData();
    } catch (err) {
      alert("Error confirming cash: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredMenuItems = useMemo(() => {
    return menuItems.filter((i) => {
      if (selectedCategory !== "All" && i.category !== selectedCategory) return false;
      if (searchQuery.trim()) {
        return i.name.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return true;
    });
  }, [menuItems, selectedCategory, searchQuery]);

  const categories = ["All", ...new Set(menuItems.map((i) => i.category || "General"))];
  const orderTotal = orderCart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <div className="waiter-terminal-page">
      {/* ================= HEADER ================= */}
      <header className="waiter-header">
        <div className="waiter-brand">
          <a href="#home" className="back-btn">
            <ArrowLeft size={20} />
          </a>
          <div>
            <h1>FLOOR & WAITER TERMINAL</h1>
            <p>Spicy Spoon Service Station</p>
          </div>
        </div>

        <div className="waiter-actions-top">
          <button className="refresh-btn" onClick={fetchFloorData}>
            <RefreshCw size={18} />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      {/* ================= CASH SETTLEMENT ALERTS ================= */}
      {cashRequests.length > 0 && (
        <section className="cash-requests-banner">
          <div className="cash-alert-header">
            <Banknote size={20} />
            <h4>Cash Payment Requests ({cashRequests.length})</h4>
          </div>
          <div className="cash-cards-row">
            {cashRequests.map((req, idx) => (
              <div className="cash-req-card" key={idx}>
                <div>
                  <strong>{req.bill?.table_number || req.table?.table_number}</strong>
                  <span>Bill #{req.bill?.bill_number} · ₹{req.bill?.grand_total}</span>
                </div>
                <button
                  className="confirm-cash-btn"
                  onClick={() => handleConfirmCash(req.bill?.id)}
                  disabled={isSubmitting}
                >
                  ✓ Confirm Cash & Clear Table
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ================= TABLES FLOOR GRID ================= */}
      <main className="waiter-tables-container">
        <div className="section-title-row">
          <h2>Live Table Occupancy ({tables.length} Tables)</h2>
          <div className="legend-pills">
            <span className="legend available">● Available</span>
            <span className="legend occupied">● Occupied</span>
            <span className="legend payment">● Payment Pending</span>
          </div>
        </div>

        {loading ? (
          <div className="waiter-loading">
            <RefreshCw className="spin-icon" size={32} />
            <p>Loading floor status...</p>
          </div>
        ) : (
          <div className="tables-pos-grid">
            {tables.map((table) => {
              const isOccupied = ["OCCUPIED", "ORDER_PLACED", "PAYMENT_PENDING"].includes(table.status);

              return (
                <div key={table.id} className={`waiter-table-card ${table.status.toLowerCase()}`}>
                  <div className="table-card-top">
                    <div className="table-badge-group">
                      <span className="table-id-tag">{table.table_number}</span>
                      <span className="capacity-badge">👥 {table.capacity}p</span>
                    </div>
                    <span className={`status-pill ${table.status.toLowerCase()}`}>{table.status}</span>
                  </div>

                  <p className="table-section-txt">{table.section}</p>

                  <div className="table-details-box">
                    {table.order_customer || table.booking_customer ? (
                      <p className="customer-info">
                        <strong>Guest:</strong> {table.order_customer || table.booking_customer}
                      </p>
                    ) : (
                      <p className="empty-info">Table is ready for guests</p>
                    )}

                    {table.order_total ? (
                      <p className="order-total-info">
                        <strong>Running Total:</strong> ₹{table.order_total}
                      </p>
                    ) : null}
                  </div>

                  {/* ACTION BUTTONS */}
                  <div className="table-action-buttons">
                    <button className="take-order-btn" onClick={() => handleOpenOrderModal(table)}>
                      <Plus size={16} />
                      <span>{isOccupied ? "Add Items" : "Take Order"}</span>
                    </button>

                    {table.current_order_id ? (
                      <button className="bill-btn" onClick={() => handleOpenBillModal(table)}>
                        <Receipt size={16} />
                        <span>Bill</span>
                      </button>
                    ) : null}

                    {table.status !== "AVAILABLE" && (
                      <button
                        className="clear-tbl-btn"
                        onClick={() => handleSetTableStatus(table.id, "AVAILABLE")}
                        title="Reset to Available"
                      >
                        <Check size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ================= ORDER TAKING MODAL ================= */}
      {activeModal === "ORDER" && selectedTable && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="waiter-order-modal" onClick={(e) => e.stopPropagation()}>
            <div className="order-modal-header">
              <div>
                <h3>Take Order · {selectedTable.table_number}</h3>
                <p>{selectedTable.section} · Seats {selectedTable.capacity}</p>
              </div>
              <button className="close-btn" onClick={() => setActiveModal(null)}>✕</button>
            </div>

            <div className="order-modal-layout">
              {/* Menu Column */}
              <div className="menu-selector-col">
                <div className="search-and-cats">
                  <input
                    type="text"
                    placeholder="Search menu..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <div className="cat-filter-chips">
                    {categories.map((c) => (
                      <button
                        key={c}
                        className={`chip ${selectedCategory === c ? "active" : ""}`}
                        onClick={() => setSelectedCategory(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="waiter-menu-list">
                  {filteredMenuItems.map((item) => (
                    <div className="waiter-dish-row" key={item.id}>
                      <div className="dish-info">
                        <h4>{item.name}</h4>
                        <span>₹{item.price} · {item.category}</span>
                      </div>
                      <button className="add-dish-btn" onClick={() => addToCart(item)}>
                        + Add
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cart / Ticket Column */}
              <div className="cart-ticket-col">
                <h4>Order Summary</h4>
                <div className="guest-input-box">
                  <label>Customer Name:</label>
                  <input
                    type="text"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                  />
                </div>

                <div className="ticket-items-scroll">
                  {orderCart.length === 0 ? (
                    <p className="no-items-hint">Select items from the left to build the order.</p>
                  ) : (
                    orderCart.map((item) => (
                      <div className="ticket-cart-item" key={item.id}>
                        <div>
                          <strong>{item.name}</strong>
                          <span className="price-calc">₹{item.price * item.quantity}</span>
                        </div>
                        <div className="qty-controls">
                          <button onClick={() => updateCartQty(item.id, -1)}>-</button>
                          <span>{item.quantity}</span>
                          <button onClick={() => updateCartQty(item.id, 1)}>+</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="ticket-total-bar">
                  <span>Subtotal</span>
                  <strong>₹{orderTotal}</strong>
                </div>

                <button
                  className="send-kitchen-btn"
                  onClick={handlePlaceWaiterOrder}
                  disabled={orderCart.length === 0 || isSubmitting}
                >
                  {isSubmitting ? "Sending..." : `Send to Kitchen (₹${orderTotal})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= BILL & CASH SETTLE MODAL ================= */}
      {activeModal === "BILL" && activeBill && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="waiter-bill-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bill-modal-header">
              <div>
                <h3>Invoice #{activeBill.bill_number}</h3>
                <p>{activeBill.table_number} · Guest: {activeBill.customer_name}</p>
              </div>
              <button className="close-btn" onClick={() => setActiveModal(null)}>✕</button>
            </div>

            <div className="bill-modal-content">
              <div className="bill-math-list">
                <div className="b-row"><span>Subtotal</span><span>₹{activeBill.subtotal}</span></div>
                <div className="b-row"><span>GST (5%)</span><span>₹{activeBill.tax}</span></div>
                <div className="b-row"><span>Service Charge (5%)</span><span>₹{activeBill.service_charge}</span></div>
                {activeBill.discount > 0 && <div className="b-row disc"><span>Discount</span><span>-₹{activeBill.discount}</span></div>}
                <div className="b-row grand"><strong>Grand Total</strong><strong>₹{activeBill.grand_total}</strong></div>
              </div>

              <div className="bill-settle-actions">
                <button
                  className="cash-settle-btn"
                  onClick={() => handleConfirmCash(activeBill.id)}
                  disabled={isSubmitting}
                >
                  <Banknote size={18} />
                  <span>Receive Cash (₹{activeBill.grand_total}) & Free Table</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Waiter;
