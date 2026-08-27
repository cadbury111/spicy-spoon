import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import confetti from "canvas-confetti";
import {
  Utensils,
  ShoppingBag,
  Clock,
  CheckCircle2,
  AlertCircle,
  Receipt,
  CreditCard,
  QrCode,
  Banknote,
  Sparkles,
  ChevronRight,
  Flame,
  Leaf,
  Plus,
  Minus,
  Trash2,
  ArrowLeft,
  Share2,
  Printer,
  RefreshCw,
  Edit3,
  Check,
  Tag,
  Info,
  MapPin,
} from "lucide-react";
import { api } from "../api";
import { useWebSocket } from "../hooks/useWebSocket";
import { menuItems as fallbackMenu } from "../data/menuData";
import "./CustomerMenu.css";

const CATEGORIES = ["All", "Starters", "Main Course", "Biryani & Rice", "Seafood Specials", "Desserts"];

function CustomerMenu() {
  const [menuList, setMenuList] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [dietaryFilter, setDietaryFilter] = useState("ALL"); // ALL, VEG, NON_VEG, SPICY
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingMenu, setLoadingMenu] = useState(true);

  // Confetti helper
  const triggerConfetti = useCallback(() => {
    try {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#ff4500", "#ff8c00", "#ffd700", "#22c55e"],
      });
    } catch (e) {}
  }, []);

  // Table state
  const [tableNumber, setTableNumber] = useState(() => {
    const hash = window.location.hash;
    const match = hash.match(/\/table\/([A-Za-z0-9]+)/i);
    if (match) return match[1];
    const params = new URLSearchParams(hash.split("?")[1] || window.location.search);
    return params.get("table") || "T1";
  });

  const [isChangingTable, setIsChangingTable] = useState(false);
  const [availableTables, setAvailableTables] = useState([]);

  // Active Session & Multi-round orders
  const [activeSessionId, setActiveSessionId] = useState(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] || window.location.search);
    return (
      params.get("session") ||
      localStorage.getItem(`spicy_session_${tableNumber}`) ||
      localStorage.getItem("spicy_last_session") ||
      null
    );
  });
  const activeSessionIdRef = useRef(activeSessionId);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] || window.location.search);
    const sessionFromUrl = params.get("session");
    if (sessionFromUrl) {
      setActiveSessionId(sessionFromUrl);
      localStorage.setItem(`spicy_session_${tableNumber}`, sessionFromUrl);
    } else {
      const stored = localStorage.getItem(`spicy_session_${tableNumber}`);
      if (stored) {
        setActiveSessionId(stored);
      }
    }
  }, [tableNumber]);

  const [activeOrders, setActiveOrders] = useState([]);

  // Cart state
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [editingItemNote, setEditingItemNote] = useState(null);
  const [itemNoteText, setItemNoteText] = useState("");

  // Customer info
  const [customerName, setCustomerName] = useState("Table Guest");
  const [customerPhone, setCustomerPhone] = useState("");
  const [settlementNotification, setSettlementNotification] = useState(null);

  // 1. Fetch Menu & Tables
  const fetchMenu = useCallback(async () => {
    try {
      setLoadingMenu(true);
      const data = await api.getMenu();
      if (Array.isArray(data) && data.length > 0) {
        const mapped = data.map((item) => {
          const fallback = fallbackMenu.find((f) => f.name.toLowerCase() === item.name.toLowerCase());
          return {
            ...fallback,
            ...item,
            is_veg: item.is_veg !== undefined ? (Number(item.is_veg) === 1 ? 1 : 0) : (fallback?.is_veg ? 1 : 0),
            is_spicy: item.is_spicy !== undefined ? (Number(item.is_spicy) === 1 ? 1 : 0) : (fallback?.is_spicy ? 1 : 0),
            category: item.category || fallback?.category || "Main Course",
            image: fallback?.image || item.image_url || "/src/assets/tandoori-chicken.jpg",
          };
        });
        setMenuList(mapped);
      } else {
        setMenuList(fallbackMenu);
      }
    } catch (err) {
      console.warn("Failed to fetch menu from backend:", err.message);
      setMenuList(fallbackMenu);
    } finally {
      setLoadingMenu(false);
    }
  }, []);

  const fetchTables = useCallback(async () => {
    try {
      const data = await api.getTables();
      setAvailableTables(data || []);
    } catch (err) {
      console.warn("Tables error:", err);
    }
  }, []);

  // 2. Fetch Active Multi-round Orders
  const fetchActiveOrders = useCallback(async () => {
    try {
      const currentSessionId = activeSessionIdRef.current || localStorage.getItem(`spicy_session_${tableNumber}`);
      const liveBill = await api.getLiveBill({ tableNumber, sessionId: currentSessionId }).catch(() => null);
      if (liveBill && liveBill.bill) {
        if (liveBill.bill.status === "PAID") {
          setActiveOrders([]);
          setActiveSessionId(null);
          localStorage.removeItem(`spicy_session_${tableNumber}`);
          localStorage.removeItem(`spicy_order_${tableNumber}`);
          return;
        }
        if (liveBill.bill.orders && liveBill.bill.orders.length > 0) {
          setActiveOrders(liveBill.bill.orders);
          return;
        }
      }

      const orders = await api.getOrders({
        table_number: tableNumber,
        session_id: currentSessionId || undefined,
      });

      const ongoing = (orders || []).filter((o) =>
        ["ORDER_PLACED", "ACCEPTED", "PREPARING", "READY", "SERVED", "PAYMENT_PENDING"].includes(o.status)
      );

      setActiveOrders(ongoing);
    } catch (err) {
      console.warn("Error fetching active orders:", err);
    }
  }, [tableNumber]);

  useEffect(() => {
    fetchMenu();
    fetchTables();
    fetchActiveOrders();
  }, [fetchMenu, fetchTables, fetchActiveOrders]);

  // WebSocket live updates
  const handleWsEvent = useCallback(
    (event) => {
      if (!event || !event.type) return;

      if (
        [
          "NEW_ORDER",
          "ORDER_STATUS_UPDATED",
          "BILL_GENERATED",
          "PAYMENT_SUCCESS",
          "PAYMENT_COMPLETED",
          "PAYMENT_VERIFIED",
          "CASH_PAYMENT_CONFIRMED",
          "BILL_PAID",
          "TABLE_STATUS_UPDATED",
          "SYNC_STATUS",
          "WS_RECONNECTED",
        ].includes(event.type)
      ) {
        fetchActiveOrders();
        fetchTables();

        if (
          ["PAYMENT_SUCCESS", "PAYMENT_COMPLETED", "PAYMENT_VERIFIED", "CASH_PAYMENT_CONFIRMED", "BILL_PAID"].includes(
            event.type
          ) &&
          (event.data?.bill?.table_number === tableNumber ||
            event.data?.table?.table_number === tableNumber ||
            event.data?.table_number === tableNumber ||
            (activeSessionId && event.data?.session_id === activeSessionId) ||
            (activeSessionId && event.data?.bill?.session_id === activeSessionId))
        ) {
          const rec = event.data?.receipt || event.data;
          setSettlementNotification({
            billNumber: rec?.bill?.bill_number || rec?.bill_number || "LIVE",
            amount: Number(rec?.bill?.grand_total || rec?.amount || rec?.grand_total || 0).toFixed(2),
            tableNumber: tableNumber,
          });
          setActiveOrders([]);
          setActiveSessionId(null);
          localStorage.removeItem(`spicy_session_${tableNumber}`);
          localStorage.removeItem(`spicy_order_${tableNumber}`);
          triggerConfetti();
        }
      }
    },
    [fetchActiveOrders, fetchTables, tableNumber, activeSessionId]
  );

  useWebSocket(handleWsEvent);

  // Filtered Menu
  const filteredMenu = useMemo(() => {
    return menuList.filter((item) => {
      if (selectedCategory !== "All") {
        const itemCat = (item.category || "").toLowerCase();
        if (itemCat !== selectedCategory.toLowerCase()) {
          return false;
        }
      }
      const isItemVeg = item.dietaryType === "VEG" || item.is_veg === 1 || item.is_veg === true;
      if (dietaryFilter === "VEG" && !isItemVeg) return false;
      if (dietaryFilter === "NON_VEG" && isItemVeg) return false;
      if (dietaryFilter === "SPICY" && !item.is_spicy) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          item.name.toLowerCase().includes(q) ||
          (item.description && item.description.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [menuList, selectedCategory, dietaryFilter, searchQuery]);

  // Cart operations
  const addToCart = (item) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === item.id);
      if (existing) {
        return prev.map((i) => (i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prev, { ...item, quantity: 1, note: "" }];
    });
  };

  const increaseQuantity = (id) => {
    setCart((prev) => prev.map((i) => (i.id === id ? { ...i, quantity: i.quantity + 1 } : i)));
  };

  const decreaseQuantity = (id) => {
    setCart((prev) =>
      prev
        .map((i) => (i.id === id ? { ...i, quantity: i.quantity - 1 } : i))
        .filter((i) => i.quantity > 0)
    );
  };

  const removeItem = (id) => {
    setCart((prev) => prev.filter((i) => i.id !== id));
  };

  const saveItemNote = (id) => {
    setCart((prev) => prev.map((i) => (i.id === id ? { ...i, note: itemNoteText } : i)));
    setEditingItemNote(null);
    setItemNoteText("");
  };

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartSubtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const cartEstimatedTax = Math.round(cartSubtotal * 0.05 * 100) / 100;
  const cartEstimatedService = Math.round(cartSubtotal * 0.025 * 100) / 100;
  const cartEstimatedTotal = Math.round((cartSubtotal + cartEstimatedTax + cartEstimatedService) * 100) / 100;

  // Place Order (Supports Multiple Order Rounds in same session)
  const handlePlaceOrder = async () => {
    if (cart.length === 0 || isPlacingOrder) return;

    try {
      setIsPlacingOrder(true);

      const payload = {
        tableNumber: tableNumber.replace(/^Table\s*/i, "").trim(),
        session_id: activeSessionId || undefined,
        round_number: activeOrders.length + 1,
        items: cart.map((i) => ({
          id: i.id,
          name: i.name,
          quantity: i.quantity,
          special_instruction: i.note || "",
        })),
        customer_name: customerName,
        customer_phone: customerPhone,
      };

      const res = await api.createOrder(payload);
      const newOrder = res.order || res;
      const returnedSessionId = res.session_id || newOrder.session_id;

      setActiveSessionId(returnedSessionId);
      localStorage.setItem(`spicy_session_${tableNumber}`, returnedSessionId);

      setCart([]);
      setCartOpen(false);
      triggerConfetti();
      fetchActiveOrders();
    } catch (err) {
      console.error("Order error:", err);
      alert(err.message || "Failed to place order. Please try again.");
    } finally {
      setIsPlacingOrder(false);
    }
  };

  const formatTableDisplay = (num) => {
    return String(num).startsWith("T") ? num : `Table ${num}`;
  };

  const latestOrder = activeOrders.length > 0 ? activeOrders[0] : null;

  return (
    <div className="customer-menu-container">
      {/* Top Navbar */}
      <header className="customer-header">
        <div className="header-left">
          <a href="#home" className="back-home-btn" title="Back to Home">
            <ArrowLeft size={20} />
          </a>
          <div className="brand-title">
            <h2>
              SPICY <span>SPOON</span>
            </h2>
            <p className="brand-subtitle">Smart Table Ordering</p>
          </div>
        </div>

        <div className="header-right">
          {/* Table Selector Chip */}
          <div className="table-badge" onClick={() => setIsChangingTable(true)}>
            <Utensils size={16} />
            <span>{formatTableDisplay(tableNumber)}</span>
            <span className="change-hint">Switch</span>
          </div>

          {/* Cart Trigger */}
          <button className="cart-trigger-btn" onClick={() => setCartOpen(true)}>
            <ShoppingBag size={20} />
            {cartCount > 0 && <span className="cart-counter-badge">{cartCount}</span>}
          </button>
        </div>
      </header>

      {/* REAL-TIME SETTLEMENT CELEBRATION NOTIFICATION */}
      {settlementNotification && (
        <div className="menu-settlement-modal-overlay">
          <div className="menu-settlement-modal">
            <div className="settle-success-icon-wrap">
              <CheckCircle2 size={52} className="settle-check-pulse" />
            </div>
            <h2>✓ Payment Successful</h2>
            <div className="settle-amount-highlight">
              <span>₹{settlementNotification.amount} Received</span>
            </div>
            <p className="settle-congrats-text">
              Your bill has been settled successfully for {formatTableDisplay(tableNumber)}.
            </p>
            <div className="settle-meta-pill">
              <span>Invoice #{settlementNotification.billNumber}</span>
            </div>
            <div className="menu-settle-actions">
              <a
                href={`#/bill?table=${tableNumber}`}
                className="btn-view-receipt-modal"
              >
                <Receipt size={16} /> View Digital Receipt →
              </a>
              <button
                className="btn-dismiss-modal"
                onClick={() => setSettlementNotification(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TABLE DETECTED WELCOME BANNER */}
      <section className="table-welcome-strip">
        <div className="strip-content">
          <CheckCircle2 size={18} className="strip-check" />
          <span>
            Dining at <strong>{formatTableDisplay(tableNumber)}</strong>. Multiple order rounds will accumulate to your
            live table bill.
          </span>
        </div>
        {(activeOrders.length > 0 || activeSessionId) && (
          <button
            className="btn-strip-bill"
            onClick={() => {
              window.location.hash = `#/bill?table=${tableNumber}&session=${activeSessionId || latestOrder?.session_id || ""}`;
            }}
          >
            <Receipt size={15} />
            <span>Live Bill ({activeOrders.length || 1} {activeOrders.length <= 1 ? "Round" : "Rounds"})</span>
          </button>
        )}
      </section>

      {/* ACTIVE ORDERS TRACKER TIMELINE (Only visible after order is actually placed) */}
      {activeOrders.length > 0 && latestOrder && (
        <section className="active-order-banner">
          <div className="order-banner-content">
            <div className="order-banner-left">
              <div className="pulse-indicator">
                <span className="pulse-dot"></span>
              </div>
              <div>
                <p className="order-number-text">
                  ACTIVE SESSION: {activeSessionId || latestOrder.session_id || latestOrder.order_number} · ROUND {activeOrders.length}
                </p>
                <h4 className="order-stage-title">
                  {latestOrder.status === "ORDER_PLACED" && "⏳ Order Placed & Sent to Kitchen"}
                  {latestOrder.status === "ACCEPTED" && "👍 Kitchen Accepted Your Order"}
                  {latestOrder.status === "PREPARING" && "🔥 Chef is Cooking Your Feast"}
                  {latestOrder.status === "READY" && "🍽️ Dishes are Ready for Service"}
                  {latestOrder.status === "SERVED" && "✨ Food Served! Enjoy Your Meal."}
                  {latestOrder.status === "PAYMENT_PENDING" && "💳 Bill Requested for Settlement"}
                </h4>
              </div>
            </div>

            <div className="order-banner-actions">
              <button
                className="view-bill-btn"
                onClick={() => {
                  window.location.hash = `#/bill?table=${tableNumber}&session=${activeSessionId || latestOrder?.session_id || ""}`;
                }}
              >
                <Receipt size={16} />
                <span>View Live Bill & Pay</span>
              </button>
            </div>
          </div>

          {/* Progress Timeline Track */}
          <div className="status-progress-track">
            <div
              className={`progress-step ${
                ["ORDER_PLACED", "ACCEPTED", "PREPARING", "READY", "SERVED", "PAYMENT_PENDING"].includes(
                  latestOrder.status
                )
                  ? "active"
                  : ""
              }`}
            >
              <span>1. Placed</span>
            </div>
            <div
              className={`progress-step ${
                ["ACCEPTED", "PREPARING", "READY", "SERVED", "PAYMENT_PENDING"].includes(latestOrder.status)
                  ? "active"
                  : ""
              }`}
            >
              <span>2. Accepted</span>
            </div>
            <div
              className={`progress-step ${
                ["PREPARING", "READY", "SERVED", "PAYMENT_PENDING"].includes(latestOrder.status) ? "active" : ""
              }`}
            >
              <span>3. Cooking</span>
            </div>
            <div
              className={`progress-step ${
                ["READY", "SERVED", "PAYMENT_PENDING"].includes(latestOrder.status) ? "active" : ""
              }`}
            >
              <span>4. Ready / Served</span>
            </div>
            <div className={`progress-step ${["SERVED", "PAYMENT_PENDING"].includes(latestOrder.status) ? "active" : ""}`}>
              <span>5. Settle Bill</span>
            </div>
          </div>
        </section>
      )}

      {/* Hero Search & Category Pills */}
      <section className="menu-hero-section">
        <div className="menu-hero-text">
          <span className="hero-eyebrow">Table {formatTableDisplay(tableNumber)} Menu</span>
          <h1>Flavours Crafted with Tradition</h1>
          <p>Hand-pounded spices, clay oven tandoori, aromatic biryanis & rich coastal curries.</p>
        </div>

        {/* Search Bar */}
        <div className="menu-search-wrapper">
          <input
            type="text"
            placeholder="Search dishes (e.g. Butter Chicken, Biryani, Paneer Tikka)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="menu-search-input"
          />
        </div>

        {/* Dietary Filters */}
        <div className="dietary-filter-row">
          <button
            className={`diet-chip ${dietaryFilter === "ALL" ? "active" : ""}`}
            onClick={() => setDietaryFilter("ALL")}
          >
            All Items
          </button>
          <button
            className={`diet-chip veg ${dietaryFilter === "VEG" ? "active" : ""}`}
            onClick={() => setDietaryFilter("VEG")}
          >
            <Leaf size={14} /> Vegetarian Only
          </button>
          <button
            className={`diet-chip nonveg ${dietaryFilter === "NON_VEG" ? "active" : ""}`}
            onClick={() => setDietaryFilter("NON_VEG")}
          >
            <Flame size={14} /> Non-Veg
          </button>
          <button
            className={`diet-chip spicy ${dietaryFilter === "SPICY" ? "active" : ""}`}
            onClick={() => setDietaryFilter("SPICY")}
          >
            🌶️ Spicy Specials
          </button>
        </div>

        {/* Categories Bar */}
        <div className="category-scroll-bar">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              className={`cat-pill ${selectedCategory === cat ? "active" : ""}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </section>

      {/* Menu Grid */}
      <main className="menu-grid-section">
        {loadingMenu ? (
          <div className="loading-state">
            <RefreshCw className="spin-icon" size={32} />
            <p>Loading chef's authentic menu...</p>
          </div>
        ) : filteredMenu.length === 0 ? (
          <div className="empty-menu-state">
            <AlertCircle size={40} />
            <h3>No matching dishes found</h3>
            <p>Try resetting filters or searching for something else.</p>
            <button
              className="reset-filter-btn"
              onClick={() => {
                setSelectedCategory("All");
                setDietaryFilter("ALL");
                setSearchQuery("");
              }}
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="dish-cards-grid">
            {filteredMenu.map((item) => {
              const inCart = cart.find((c) => c.id === item.id);

              return (
                <div className="dish-card" key={item.id}>
                  <div className="dish-image-wrapper">
                    <img src={item.image} alt={item.name} loading="lazy" />
                    <div className="dish-badges">
                      {item.dietaryType === "VEG" || item.is_veg === 1 || item.is_veg === true ? (
                        <span className="badge veg-badge" title="Vegetarian">
                          🟢 Veg
                        </span>
                      ) : (
                        <span className="badge nonveg-badge" title="Non-Vegetarian">
                          🔴 Non-Veg
                        </span>
                      )}
                      {item.is_spicy ? <span className="badge spicy-badge" title="Spicy">🌶️ Spicy</span> : null}
                    </div>
                  </div>

                  <div className="dish-content">
                    <div className="dish-title-row">
                      <h3>{item.name}</h3>
                      <span className="dish-price">₹{item.price}</span>
                    </div>

                    <p className="dish-desc">{item.description}</p>

                    <div className="dish-action-row">
                      {inCart ? (
                        <div className="quantity-toggle">
                          <button onClick={() => decreaseQuantity(item.id)}>
                            <Minus size={16} />
                          </button>
                          <span className="qty-val">{inCart.quantity}</span>
                          <button onClick={() => increaseQuantity(item.id)}>
                            <Plus size={16} />
                          </button>
                        </div>
                      ) : (
                        <button className="add-to-cart-btn" onClick={() => addToCart(item)}>
                          <Plus size={16} />
                          <span>ADD</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Floating Cart Footer */}
      {cartCount > 0 && !cartOpen && (
        <div className="floating-cart-bar" onClick={() => setCartOpen(true)}>
          <div className="floating-cart-info">
            <span className="items-count-badge">
              {cartCount} {cartCount === 1 ? "Dish" : "Dishes"} (Round {activeOrders.length + 1})
            </span>
            <span className="cart-total-tag">
              ₹{cartSubtotal} <small>+ Tax & Srv</small>
            </span>
          </div>
          <button className="view-cart-action">
            <span>Review & Send Order</span>
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      {/* Cart Drawer */}
      {cartOpen && (
        <div className="modal-backdrop" onClick={() => setCartOpen(false)}>
          <div className="cart-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h3>Order Round {activeOrders.length + 1}</h3>
                <p className="drawer-sub">Table {formatTableDisplay(tableNumber)} · Spicy Spoon</p>
              </div>
              <button className="close-drawer-btn" onClick={() => setCartOpen(false)}>
                ✕
              </button>
            </div>

            <div className="drawer-body">
              {cart.length === 0 ? (
                <div className="empty-cart-view">
                  <ShoppingBag size={48} />
                  <h4>Your Cart is Empty</h4>
                  <p>Add dishes from the menu to build this order round.</p>
                </div>
              ) : (
                <>
                  <div className="cart-items-list">
                    {cart.map((item) => (
                      <div className="cart-item-row" key={item.id}>
                        <div className="item-main-details">
                          <h4>{item.name}</h4>
                          <span className="item-price-tag">₹{item.price * item.quantity}</span>
                          {item.note ? (
                            <p className="item-instruction-note">
                              📝 Note: <em>"{item.note}"</em>
                            </p>
                          ) : null}
                          <button
                            className="add-note-link"
                            onClick={() => {
                              setEditingItemNote(item.id);
                              setItemNoteText(item.note || "");
                            }}
                          >
                            <Edit3 size={12} /> {item.note ? "Edit Note" : "+ Add Special Cooking Note"}
                          </button>
                        </div>

                        <div className="item-qty-control">
                          <button onClick={() => decreaseQuantity(item.id)}>
                            <Minus size={14} />
                          </button>
                          <span>{item.quantity}</span>
                          <button onClick={() => increaseQuantity(item.id)}>
                            <Plus size={14} />
                          </button>
                          <button className="trash-btn" onClick={() => removeItem(item.id)}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Customer Info Form */}
                  <div className="guest-info-section">
                    <label>Guest Name (Optional):</label>
                    <input
                      type="text"
                      placeholder="e.g. Rahul Sharma"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                    />
                  </div>

                  {/* Price breakdown */}
                  <div className="cart-bill-summary">
                    <div className="summary-line">
                      <span>Subtotal</span>
                      <span>₹{cartSubtotal.toFixed(2)}</span>
                    </div>
                    <div className="summary-line">
                      <span>GST (5.0%)</span>
                      <span>₹{cartEstimatedTax.toFixed(2)}</span>
                    </div>
                    <div className="summary-line">
                      <span>Service Charge (2.5%)</span>
                      <span>₹{cartEstimatedService.toFixed(2)}</span>
                    </div>
                    <div className="summary-line total-line">
                      <strong>Round Total</strong>
                      <strong>₹{cartEstimatedTotal.toFixed(2)}</strong>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="drawer-footer">
              <button
                className="place-order-confirm-btn"
                onClick={handlePlaceOrder}
                disabled={cart.length === 0 || isPlacingOrder}
              >
                {isPlacingOrder ? (
                  <RefreshCw className="spin-icon" size={18} />
                ) : (
                  <>
                    <span>Send Round {activeOrders.length + 1} to Kitchen (₹{cartEstimatedTotal.toFixed(2)})</span>
                    <Sparkles size={18} />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cooking Note Modal */}
      {editingItemNote && (
        <div className="modal-backdrop sub-modal" onClick={() => setEditingItemNote(null)}>
          <div className="instruction-modal" onClick={(e) => e.stopPropagation()}>
            <h4>Special Cooking Request</h4>
            <p>Tell the kitchen how you like your dish (e.g., Less spicy, Extra gravy, No coriander):</p>
            <textarea
              rows={3}
              placeholder="e.g. Mild spice level, extra crispy"
              value={itemNoteText}
              onChange={(e) => setItemNoteText(e.target.value)}
            />
            <div className="instruction-modal-actions">
              <button className="cancel-btn" onClick={() => setEditingItemNote(null)}>
                Cancel
              </button>
              <button className="save-btn" onClick={() => saveItemNote(editingItemNote)}>
                Save Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table Selector Modal */}
      {isChangingTable && (
        <div className="modal-backdrop" onClick={() => setIsChangingTable(false)}>
          <div className="table-picker-modal" onClick={(e) => e.stopPropagation()}>
            <div className="picker-header">
              <h3>Switch Dining Table</h3>
              <button onClick={() => setIsChangingTable(false)}>✕</button>
            </div>

            <div className="table-grid-options">
              {availableTables.length > 0
                ? availableTables.map((t) => (
                    <button
                      key={t.id}
                      className={`table-select-card ${tableNumber === t.table_number ? "current" : ""}`}
                      onClick={() => {
                        setTableNumber(t.table_number);
                        setIsChangingTable(false);
                        window.location.hash = `#/order?table=${t.table_number}`;
                      }}
                    >
                      <span className="tbl-title">{t.table_number}</span>
                      <span className="tbl-section">{t.section}</span>
                      <span className="tbl-cap">👥 {t.capacity} Seats</span>
                    </button>
                  ))
                : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((num) => (
                    <button
                      key={num}
                      className={`table-select-card ${tableNumber === `T${num}` ? "current" : ""}`}
                      onClick={() => {
                        setTableNumber(`T${num}`);
                        setIsChangingTable(false);
                        window.location.hash = `#/order?table=T${num}`;
                      }}
                    >
                      <span className="tbl-title">Table {num}</span>
                    </button>
                  ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CustomerMenu;