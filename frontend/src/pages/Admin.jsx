import { useEffect, useState, useCallback, useMemo } from "react";
import {
  LayoutDashboard,
  Grid,
  ShoppingBag,
  Receipt,
  Calendar,
  BookOpen,
  QrCode,
  Users,
  Settings,
  DollarSign,
  TrendingUp,
  Plus,
  Edit2,
  Trash2,
  RefreshCw,
  Printer,
  ArrowLeft,
  LogOut,
  ShieldCheck,
  ChefHat,
  Banknote,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  UserPlus,
  Lock,
} from "lucide-react";
import { api } from "../api";
import { useWebSocket } from "../hooks/useWebSocket";
import "./Admin.css";

const ADMIN_TABS = [
  { id: "overview", label: "Analytics Overview", icon: LayoutDashboard },
  { id: "floormap", label: "Live Floor Map", icon: Grid },
  { id: "orders", label: "Live Orders & KDS", icon: ShoppingBag },
  { id: "bills", label: "Invoices & Billing", icon: Receipt },
  { id: "bookings", label: "Table Bookings", icon: Calendar },
  { id: "menu", label: "Menu Management", icon: BookOpen },
  { id: "qr", label: "QR Stand Generator", icon: QrCode },
  { id: "staff", label: "Staff Management", icon: Users },
  { id: "settings", label: "Restaurant Settings", icon: Settings },
];

function Admin({ onLogout }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);

  // Authenticated Staff Profile
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("spicy_staff_user")) || { name: "Restaurant Manager", role: "ADMIN" };
    } catch {
      return { name: "Restaurant Manager", role: "ADMIN" };
    }
  });

  // Core Data
  const [analytics, setAnalytics] = useState(null);
  const [tables, setTables] = useState([]);
  const [orders, setOrders] = useState([]);
  const [bills, setBills] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [restaurantSettings, setRestaurantSettings] = useState(null);
  const [restaurantQrData, setRestaurantQrData] = useState(null);

  // Booking Filters
  const [bookingFilter, setBookingFilter] = useState("ALL");

  // Modals
  const [selectedTable, setSelectedTable] = useState(null);
  const [tableDetailsBill, setTableDetailsBill] = useState(null);

  const [menuModalOpen, setMenuModalOpen] = useState(false);
  const [editingMenuItem, setEditingMenuItem] = useState(null);
  const [menuForm, setMenuForm] = useState({
    name: "",
    category: "Starters",
    price: 199,
    description: "",
    image_url: "",
    is_veg: 1,
    is_spicy: 0,
  });

  // Staff Modal
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [staffForm, setStaffForm] = useState({
    name: "",
    username: "",
    password: "",
    role: "KITCHEN",
  });

  const [printableQrTable, setPrintableQrTable] = useState(null);
  const [tableQrCache, setTableQrCache] = useState({});

  // Fetch all Admin data
  const fetchAllData = useCallback(async () => {
    try {
      setLoading(true);
      const [aData, tData, oData, bData, bkData, mData, sData, stData, qrData] = await Promise.all([
        api.getAnalytics().catch(() => null),
        api.getTables().catch(() => []),
        api.getOrders().catch(() => []),
        api.getBills().catch(() => []),
        api.getBookings().catch(() => []),
        api.getMenu().catch(() => []),
        api.getSettings().catch(() => null),
        api.getStaffList().catch(() => []),
        api.getRestaurantQr("spicy-spoon").catch(() => null),
      ]);

      setAnalytics(aData);
      setTables(tData || []);
      setOrders(oData || []);
      setBills(bData || []);
      setBookings(bkData || []);
      setMenuItems(mData || []);
      setRestaurantSettings(sData);
      setStaffList(stData || []);
      setRestaurantQrData(qrData);
    } catch (err) {
      console.error("Admin fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllData();
    const timer = setInterval(() => {
      fetchAllData();
    }, 10000);
    return () => clearInterval(timer);
  }, [fetchAllData]);

  // WebSocket Live Sync
  const handleWsEvent = useCallback(
    (event) => {
      if (!event || !event.type) return;
      if (
        [
          "NEW_ORDER",
          "ORDER_STATUS_UPDATED",
          "TABLE_STATUS_UPDATED",
          "BILL_GENERATED",
          "PAYMENT_COMPLETED",
          "CASH_PAYMENT_REQUESTED",
          "NEW_BOOKING",
          "BOOKING_STATUS_UPDATED",
          "MENU_UPDATED",
        ].includes(event.type)
      ) {
        fetchAllData();
      }
    },
    [fetchAllData]
  );

  useWebSocket(handleWsEvent);

  const handleLogout = () => {
    localStorage.removeItem("spicy_staff_token");
    localStorage.removeItem("spicy_staff_user");
    if (onLogout) {
      onLogout();
    } else {
      window.location.hash = "#/staff/login";
    }
  };

  // Table Details Handler
  const handleOpenTableDetails = async (table) => {
    setSelectedTable(table);
    try {
      const liveBill = await api.getLiveBill({ tableId: table.id }).catch(() => null);
      setTableDetailsBill(liveBill?.bill || null);
    } catch (e) {
      setTableDetailsBill(null);
    }
  };

  // Cash Confirmation (ADMIN ONLY)
  const handleConfirmCashPayment = async (billId) => {
    if (!billId) return;
    try {
      await api.confirmCashPayment({ bill_id: billId });
      alert("Cash payment confirmed and table released successfully!");
      setSelectedTable(null);
      fetchAllData();
    } catch (err) {
      alert("Failed to confirm cash: " + err.message);
    }
  };

  // Release Table (ADMIN ONLY)
  const handleReleaseTable = async (tableId) => {
    if (!confirm("Are you sure you want to release this table to AVAILABLE?")) return;
    try {
      await api.updateTableStatus(tableId, { status: "AVAILABLE" });
      setSelectedTable(null);
      fetchAllData();
    } catch (err) {
      alert("Error releasing table: " + err.message);
    }
  };

  // Update Booking Status
  const handleUpdateBookingStatus = async (bookingId, status) => {
    try {
      await api.updateBookingStatus(bookingId, status);
      fetchAllData();
    } catch (err) {
      alert("Failed to update booking status: " + err.message);
    }
  };

  // Update Order Status
  const handleUpdateOrderStatus = async (orderId, status) => {
    try {
      await api.updateOrderStatus(orderId, status);
      fetchAllData();
    } catch (err) {
      alert("Failed to update order: " + err.message);
    }
  };

  // Menu Save
  const handleSaveMenuItem = async (e) => {
    e.preventDefault();
    try {
      if (editingMenuItem) {
        await api.updateMenuItem(editingMenuItem.id, menuForm);
      } else {
        await api.addMenuItem(menuForm);
      }
      setMenuModalOpen(false);
      setEditingMenuItem(null);
      fetchAllData();
    } catch (err) {
      alert("Failed to save menu item: " + err.message);
    }
  };

  // Staff Save (ADMIN ONLY)
  const handleCreateStaff = async (e) => {
    e.preventDefault();
    try {
      await api.createStaffUser(staffForm);
      alert(`Staff user "${staffForm.username}" created successfully.`);
      setStaffModalOpen(false);
      setStaffForm({ name: "", username: "", password: "", role: "KITCHEN" });
      fetchAllData();
    } catch (err) {
      alert("Failed to create staff account: " + err.message);
    }
  };

  // Toggle Staff Status
  const handleToggleStaffStatus = async (staffId, currentStatus) => {
    const nextStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      await api.toggleStaffStatus(staffId, nextStatus);
      fetchAllData();
    } catch (err) {
      alert(err.message || "Failed to update staff status");
    }
  };

  // Table QR loader
  const handleLoadTableQr = async (tableId) => {
    if (tableQrCache[tableId]) {
      setPrintableQrTable(tableQrCache[tableId]);
      return;
    }
    try {
      const data = await api.getTableQr(tableId);
      setTableQrCache((prev) => ({ ...prev, [tableId]: data }));
      setPrintableQrTable(data);
    } catch (err) {
      alert("Failed to fetch table QR: " + err.message);
    }
  };

  // Filter Bookings
  const filteredBookings = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    return bookings.filter((b) => {
      if (bookingFilter === "TODAY") return b.booking_date === today;
      if (bookingFilter === "UPCOMING") return b.booking_date >= today && b.status === "CONFIRMED";
      if (bookingFilter === "COMPLETED") return b.status === "COMPLETED";
      if (bookingFilter === "CANCELLED") return b.status === "CANCELLED" || b.status === "NO_SHOW";
      return true;
    });
  }, [bookings, bookingFilter]);

  return (
    <div className="admin-container">
      {/* Sidebar */}
      <aside className="admin-sidebar">
        <div className="sidebar-brand">
          <a href="#home">
            SPICY <span>SPOON</span>
          </a>
          <span className="admin-badge">ADMIN CONTROL</span>
        </div>

        <nav className="sidebar-nav">
          {ADMIN_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={`nav-tab-btn ${activeTab === tab.id ? "active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={18} />
                <span>{tab.label}</span>
              </button>
            );
          })}

          <div className="sidebar-nav-divider">
            <span>QUICK ACCESS</span>
          </div>

          <a href="#/kitchen" className="nav-tab-btn kds-link-btn" title="Open Dedicated Kitchen KDS">
            <ChefHat size={18} />
            <span>Open Kitchen KDS 👨‍🍳</span>
          </a>

          <a href="#/order?table=T1" className="nav-tab-btn external-link-btn" title="Open Customer Menu">
            <ShoppingBag size={18} />
            <span>Customer Menu 🍽️</span>
          </a>

          <a href="#/restaurant/spicy-spoon/tables" className="nav-tab-btn external-link-btn" title="Open Table Booking">
            <Calendar size={18} />
            <span>Table Booking 📅</span>
          </a>
        </nav>

        <div className="sidebar-footer">
          <button className="exit-admin-btn" onClick={handleLogout}>
            <LogOut size={16} /> Logout Staff
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="admin-main">
        {/* Top bar */}
        <header className="admin-topbar">
          <div className="topbar-title">
            <h2>{ADMIN_TABS.find((t) => t.id === activeTab)?.label}</h2>
            <p>Spicy Spoon Restaurant Management Suite · Live Sync</p>
          </div>

          <div className="topbar-actions">
            <a href="#/kitchen" className="btn-topbar-link kds-btn" title="Switch to Kitchen KDS">
              <ChefHat size={16} />
              <span>Kitchen KDS</span>
            </a>

            <a href="#/order?table=T1" className="btn-topbar-link menu-btn" title="View Customer Menu">
              <ShoppingBag size={16} />
              <span>Customer Menu</span>
            </a>

            <div className="staff-profile-chip">
              <ShieldCheck size={16} className="profile-icon" />
              <span>{currentUser.name}</span>
              <span className="role-tag">ADMIN</span>
            </div>

            <button className="btn-refresh-all" onClick={fetchAllData} title="Refresh Data">
              <RefreshCw size={16} className={loading ? "spin" : ""} />
              <span>Refresh</span>
            </button>
          </div>
        </header>

        {/* TAB 1: ANALYTICS OVERVIEW */}
        {activeTab === "overview" && (
          <div className="tab-content overview-tab">
            <div className="kpi-grid">
              <div className="kpi-card revenue-kpi">
                <div className="kpi-icon-box">
                  <DollarSign size={24} />
                </div>
                <div className="kpi-info">
                  <span>Total Settled Revenue</span>
                  <h3>₹{Number(analytics?.summary?.totalRevenue || 0).toLocaleString("en-IN")}</h3>
                  <small>Today: ₹{Number(analytics?.summary?.todayRevenue || 0).toLocaleString("en-IN")}</small>
                </div>
              </div>

              <div className="kpi-card orders-kpi">
                <div className="kpi-icon-box">
                  <ShoppingBag size={24} />
                </div>
                <div className="kpi-info">
                  <span>Total Orders Placed</span>
                  <h3>{analytics?.summary?.totalOrders || 0}</h3>
                  <small>{analytics?.summary?.activeOrders || 0} currently active</small>
                </div>
              </div>

              <div className="kpi-card bookings-kpi">
                <div className="kpi-icon-box">
                  <Calendar size={24} />
                </div>
                <div className="kpi-info">
                  <span>Table Reservations</span>
                  <h3>{analytics?.summary?.totalBookings || 0}</h3>
                  <small>{analytics?.summary?.todayBookings || 0} bookings today</small>
                </div>
              </div>

              <div className="kpi-card tables-kpi">
                <div className="kpi-icon-box">
                  <Grid size={24} />
                </div>
                <div className="kpi-info">
                  <span>Restaurant Tables</span>
                  <h3>{tables.length || 12}</h3>
                  <small>{tables.filter((t) => t.status === "AVAILABLE").length} available now</small>
                </div>
              </div>
            </div>

            <div className="overview-dual-grid">
              <div className="admin-card">
                <h3>Payment Methods Breakdown</h3>
                <div className="payment-methods-list">
                  {analytics?.revenueByMethod && analytics.revenueByMethod.length > 0 ? (
                    analytics.revenueByMethod.map((pm) => (
                      <div className="pm-row" key={pm.payment_method}>
                        <div className="pm-info">
                          <span className="pm-tag">{pm.payment_method}</span>
                          <span className="pm-count">{pm.transaction_count} Transactions</span>
                        </div>
                        <strong>₹{Number(pm.total_amount).toLocaleString("en-IN")}</strong>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state-p">No settled payments yet.</div>
                  )}
                </div>
              </div>

              <div className="admin-card">
                <h3>Top Selling Dishes</h3>
                <div className="top-items-list">
                  {analytics?.topItems && analytics.topItems.length > 0 ? (
                    analytics.topItems.map((item, idx) => (
                      <div className="top-dish-row" key={idx}>
                        <span className="rank-badge">#{idx + 1}</span>
                        <div className="dish-detail">
                          <strong>{item.name}</strong>
                          <small>{item.total_quantity} orders</small>
                        </div>
                        <span className="dish-sales">₹{Number(item.total_sales).toLocaleString("en-IN")}</span>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state-p">No dish sales recorded yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: LIVE FLOOR MAP */}
        {activeTab === "floormap" && (
          <div className="tab-content floormap-tab">
            <div className="floormap-header-controls">
              <div className="floor-summary-chips">
                <span className="chip available">🟢 Available ({tables.filter((t) => t.status === "AVAILABLE").length})</span>
                <span className="chip reserved">🟡 Reserved ({tables.filter((t) => t.status === "RESERVED").length})</span>
                <span className="chip occupied">🔴 Occupied ({tables.filter((t) => ["OCCUPIED", "ORDER_PLACED"].includes(t.status)).length})</span>
                <span className="chip payment">💳 Payment Pending ({tables.filter((t) => t.status === "PAYMENT_PENDING").length})</span>
              </div>
            </div>

            <div className="admin-floor-sections">
              {["Main Hall", "Window Side", "Outdoor Patio", "VIP Lounge"].map((secName) => {
                const secTables = tables.filter((t) => t.section === secName);

                return (
                  <div className="floor-section-group" key={secName}>
                    <div className="group-title">
                      <h3>{secName}</h3>
                      <span>{secTables.length} Tables</span>
                    </div>

                    <div className="group-tables-grid">
                      {secTables.map((tbl) => (
                        <div
                          key={tbl.id}
                          className={`admin-table-card ${tbl.status.toLowerCase()}`}
                          onClick={() => handleOpenTableDetails(tbl)}
                        >
                          <div className="tbl-card-top">
                            <span className="tbl-number">{tbl.table_number}</span>
                            <span className={`tbl-status-badge ${tbl.status.toLowerCase()}`}>{tbl.status}</span>
                          </div>
                          <div className="tbl-card-body">
                            <p className="tbl-cap">👥 {tbl.capacity} Seats</p>
                            {tbl.booking_customer && <p className="tbl-guest-name">📅 {tbl.booking_customer}</p>}
                            {tbl.order_number && <p className="tbl-order-tag">🍽️ Order #{tbl.order_number}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: LIVE ORDERS & KITCHEN */}
        {activeTab === "orders" && (
          <div className="tab-content orders-tab">
            <div className="orders-grid-display">
              {orders.length === 0 ? (
                <div className="empty-box">No orders recorded in the system.</div>
              ) : (
                orders.map((ord) => (
                  <div className={`admin-order-card ${ord.status.toLowerCase()}`} key={ord.id}>
                    <div className="order-card-header">
                      <div>
                        <span className="ord-number">#{ord.order_number}</span>
                        <h4>
                          Table {ord.tableNumber || ord.table_number} (Round {ord.round_number || 1})
                        </h4>
                      </div>
                      <span className={`ord-status-pill ${ord.status.toLowerCase()}`}>{ord.status}</span>
                    </div>

                    <div className="order-items-scroll">
                      {ord.items?.map((item, idx) => (
                        <div className="ord-item-line" key={idx}>
                          <span>
                            <strong>{item.quantity}×</strong> {item.name}
                          </span>
                          <span>₹{Number(item.total_price || item.unit_price * item.quantity).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>

                    <div className="order-card-total">
                      <span>Total: ₹{Number(ord.total).toFixed(2)}</span>
                    </div>

                    <div className="order-actions-bar">
                      {ord.status === "ORDER_PLACED" && (
                        <button className="btn-status accept" onClick={() => handleUpdateOrderStatus(ord.id, "ACCEPTED")}>
                          Accept
                        </button>
                      )}
                      {ord.status === "ACCEPTED" && (
                        <button className="btn-status prep" onClick={() => handleUpdateOrderStatus(ord.id, "PREPARING")}>
                          Cook
                        </button>
                      )}
                      {ord.status === "PREPARING" && (
                        <button className="btn-status ready" onClick={() => handleUpdateOrderStatus(ord.id, "READY")}>
                          Ready
                        </button>
                      )}
                      {ord.status === "READY" && (
                        <button className="btn-status serve" onClick={() => handleUpdateOrderStatus(ord.id, "SERVED")}>
                          Serve
                        </button>
                      )}
                      {ord.status === "SERVED" && (
                        <button className="btn-status complete" onClick={() => handleUpdateOrderStatus(ord.id, "COMPLETED")}>
                          Complete
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 4: BILLS & INVOICES */}
        {activeTab === "bills" && (
          <div className="tab-content bills-tab">
            <div className="admin-table-wrapper">
              <table className="admin-data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Table</th>
                    <th>Subtotal</th>
                    <th>GST</th>
                    <th>Service</th>
                    <th>Discount</th>
                    <th>Grand Total</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <strong>#{b.bill_number}</strong>
                      </td>
                      <td>{b.table_number}</td>
                      <td>₹{Number(b.subtotal).toFixed(2)}</td>
                      <td>₹{Number(b.tax).toFixed(2)}</td>
                      <td>₹{Number(b.service_charge).toFixed(2)}</td>
                      <td>-₹{Number(b.discount || 0).toFixed(2)}</td>
                      <td>
                        <strong>₹{Number(b.grand_total).toFixed(2)}</strong>
                      </td>
                      <td>
                        <span className={`status-pill ${b.status === "PAID" ? "green" : "yellow"}`}>{b.status}</span>
                      </td>
                      <td>{b.payment_method || "Pending"}</td>
                      <td>
                        {b.status !== "PAID" && (
                          <button className="btn-collect-cash" onClick={() => handleConfirmCashPayment(b.id)}>
                            Collect Cash
                          </button>
                        )}
                        {b.status === "PAID" && <span className="settled-tag">Settled ✓</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: TABLE BOOKINGS */}
        {activeTab === "bookings" && (
          <div className="tab-content bookings-tab">
            <div className="bookings-filter-bar">
              {["ALL", "TODAY", "UPCOMING", "COMPLETED", "CANCELLED"].map((f) => (
                <button
                  key={f}
                  className={`filter-tab ${bookingFilter === f ? "active" : ""}`}
                  onClick={() => setBookingFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>

            <div className="admin-table-wrapper">
              <table className="admin-data-table">
                <thead>
                  <tr>
                    <th>Ref #</th>
                    <th>Guest</th>
                    <th>Phone</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Party</th>
                    <th>Table</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBookings.map((bk) => (
                    <tr key={bk.id}>
                      <td>
                        <strong>#{bk.booking_number}</strong>
                      </td>
                      <td>{bk.customer_name}</td>
                      <td>{bk.customer_phone}</td>
                      <td>{bk.booking_date}</td>
                      <td>{bk.start_time}</td>
                      <td>👥 {bk.guest_count}</td>
                      <td>{bk.table_number}</td>
                      <td>
                        <span className={`status-pill ${bk.status.toLowerCase()}`}>{bk.status}</span>
                      </td>
                      <td>
                        <div className="action-buttons-row">
                          {bk.status === "CONFIRMED" && (
                            <button
                              className="btn-action checkin"
                              onClick={() => handleUpdateBookingStatus(bk.id, "CHECKED_IN")}
                            >
                              Check In
                            </button>
                          )}
                          {bk.status === "CHECKED_IN" && (
                            <button
                              className="btn-action complete"
                              onClick={() => handleUpdateBookingStatus(bk.id, "COMPLETED")}
                            >
                              Complete
                            </button>
                          )}
                          {["CONFIRMED", "CHECKED_IN"].includes(bk.status) && (
                            <button
                              className="btn-action cancel"
                              onClick={() => handleUpdateBookingStatus(bk.id, "CANCELLED")}
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 6: MENU MANAGEMENT */}
        {activeTab === "menu" && (
          <div className="tab-content menu-tab">
            <div className="menu-mgmt-header">
              <h3>Restaurant Dishes ({menuItems.length})</h3>
              <button
                className="btn-add-dish"
                onClick={() => {
                  setEditingMenuItem(null);
                  setMenuForm({
                    name: "",
                    category: "Starters",
                    price: 199,
                    description: "",
                    image_url: "",
                    is_veg: 1,
                    is_spicy: 0,
                  });
                  setMenuModalOpen(true);
                }}
              >
                <Plus size={16} /> Add New Dish
              </button>
            </div>

            <div className="admin-table-wrapper">
              <table className="admin-data-table">
                <thead>
                  <tr>
                    <th>Dish Name</th>
                    <th>Category</th>
                    <th>Price</th>
                    <th>Type</th>
                    <th>Availability</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {menuItems.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.name}</strong>
                      </td>
                      <td>{item.category}</td>
                      <td>₹{Number(item.price).toFixed(2)}</td>
                      <td>{item.is_veg ? "🟢 Veg" : "🔴 Non-Veg"}</td>
                      <td>
                        <span className={`status-pill ${item.is_available ? "green" : "red"}`}>
                          {item.is_available ? "In Stock" : "Sold Out"}
                        </span>
                      </td>
                      <td>
                        <button
                          className="btn-edit-item"
                          onClick={() => {
                            setEditingMenuItem(item);
                            setMenuForm(item);
                            setMenuModalOpen(true);
                          }}
                        >
                          <Edit2 size={14} /> Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 7: QR STAND GENERATOR */}
        {activeTab === "qr" && (
          <div className="tab-content qr-tab">
            <div className="qr-generator-grid">
              <div className="qr-stand-card">
                <div className="stand-head">
                  <Sparkles size={20} />
                  <h3>Restaurant Master QR Stand</h3>
                </div>
                <p>Permanent table-side QR code linking to restaurant digital portal.</p>

                {restaurantQrData?.qrCodeDataUrl ? (
                  <div className="stand-preview">
                    <img src={restaurantQrData.qrCodeDataUrl} alt="Restaurant QR" className="stand-qr-img" />
                    <span className="stand-url">{restaurantQrData.targetUrl}</span>
                  </div>
                ) : (
                  <div className="qr-placeholder">Generating Master QR...</div>
                )}

                <div className="stand-actions">
                  <a
                    href={restaurantQrData?.qrCodeDataUrl}
                    download="spicy-spoon-master-qr.png"
                    className="btn-stand-action"
                  >
                    Download PNG
                  </a>
                  <button className="btn-stand-action" onClick={() => window.print()}>
                    Print Stand
                  </button>
                </div>
              </div>

              <div className="table-qr-stands-wrapper">
                <h3>Table QR Stands (T1 – T12)</h3>
                <p>Click any table to generate and download its individual QR code.</p>

                <div className="table-stands-selector">
                  {tables.map((t) => (
                    <button
                      key={t.id}
                      className={`table-qr-chip ${printableQrTable?.table?.id === t.id ? "active" : ""}`}
                      onClick={() => handleLoadTableQr(t.id)}
                    >
                      <span>{t.table_number}</span>
                      <small>{t.section}</small>
                    </button>
                  ))}
                </div>

                {printableQrTable && (
                  <div className="active-table-qr-preview">
                    <h4>Table {printableQrTable.table?.table_number} QR Code</h4>
                    <img src={printableQrTable.qrCodeDataUrl} alt="Table QR" className="table-qr-preview-img" />
                    <p className="table-qr-link">{printableQrTable.targetUrl}</p>
                    <a
                      href={printableQrTable.qrCodeDataUrl}
                      download={`spicy-spoon-table-${printableQrTable.table?.table_number}.png`}
                      className="btn-download-table-qr"
                    >
                      Download Table {printableQrTable.table?.table_number} QR
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 8: STAFF MANAGEMENT (ADMIN ONLY) */}
        {activeTab === "staff" && (
          <div className="tab-content staff-tab">
            <div className="menu-mgmt-header">
              <div>
                <h3>Staff Users & Role-Based Access Control</h3>
                <p>Manage internal Admin and Kitchen operator credentials.</p>
              </div>
              <button className="btn-add-dish" onClick={() => setStaffModalOpen(true)}>
                <UserPlus size={16} /> Add Staff Account
              </button>
            </div>

            <div className="admin-table-wrapper">
              <table className="admin-data-table">
                <thead>
                  <tr>
                    <th>Full Name</th>
                    <th>Username</th>
                    <th>Assigned Role</th>
                    <th>Status</th>
                    <th>Account Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {staffList.map((st, idx) => (
                    <tr key={st.id ? `staff-${st.id}-${st.username}` : `staff-${idx}`}>
                      <td>
                        <strong>{st.name}</strong>
                      </td>
                      <td>{st.username}</td>
                      <td>
                        <span className={`role-badge ${st.role?.toLowerCase()}`}>{st.role}</span>
                      </td>
                      <td>
                        <span className={`status-pill ${st.status === "ACTIVE" ? "green" : "red"}`}>
                          {st.status}
                        </span>
                      </td>
                      <td>{st.created_at ? new Date(st.created_at).toLocaleDateString() : "Active"}</td>
                      <td>
                        {st.id !== currentUser.id && (
                          <button
                            className="btn-toggle-status"
                            onClick={() => handleToggleStaffStatus(st.id, st.status)}
                          >
                            {st.status === "ACTIVE" ? "Deactivate" : "Activate"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 9: SETTINGS */}
        {activeTab === "settings" && (
          <div className="tab-content settings-tab">
            <div className="settings-card">
              <div className="settings-head-row">
                <div>
                  <h3>Restaurant Profile & System Controls</h3>
                  <p>Configure tax rates, service charges, contact info and operational parameters.</p>
                </div>
                <button
                  type="button"
                  className="btn-save-settings"
                  onClick={async () => {
                    try {
                      await api.updateSettings({
                        name: restaurantSettings?.name || "Spicy Spoon",
                        tax_rate: parseFloat(restaurantSettings?.tax_rate || 5.0),
                        service_charge_rate: parseFloat(restaurantSettings?.service_charge_rate || 2.5),
                        phone: restaurantSettings?.phone || "+91 73958 77142",
                        address: restaurantSettings?.address || "Tiruppur-Palladam road, Tamil Nadu",
                      });
                      alert("Restaurant parameters saved successfully!");
                      fetchAllData();
                    } catch (err) {
                      alert("Failed to save settings: " + err.message);
                    }
                  }}
                >
                  Save System Parameters
                </button>
              </div>

              <div className="settings-fields-grid">
                <div className="field-group">
                  <label>Restaurant Brand Name</label>
                  <input
                    type="text"
                    value={restaurantSettings?.name || "Spicy Spoon"}
                    onChange={(e) => setRestaurantSettings({ ...restaurantSettings, name: e.target.value })}
                  />
                </div>
                <div className="field-group">
                  <label>Slug Identifier</label>
                  <input type="text" value="spicy-spoon" readOnly />
                </div>
                <div className="field-group">
                  <label>Official Phone Number</label>
                  <input
                    type="text"
                    value={restaurantSettings?.phone || "+91 73958 77142"}
                    onChange={(e) => setRestaurantSettings({ ...restaurantSettings, phone: e.target.value })}
                  />
                </div>
                <div className="field-group">
                  <label>Physical Address</label>
                  <input
                    type="text"
                    value={restaurantSettings?.address || "Tiruppur-Palladam road, Tamil Nadu"}
                    onChange={(e) => setRestaurantSettings({ ...restaurantSettings, address: e.target.value })}
                  />
                </div>
                <div className="field-group">
                  <label>GST Tax Rate (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={restaurantSettings?.tax_rate !== undefined ? restaurantSettings.tax_rate : 5.0}
                    onChange={(e) => setRestaurantSettings({ ...restaurantSettings, tax_rate: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="field-group">
                  <label>Service Charge Rate (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={restaurantSettings?.service_charge_rate !== undefined ? restaurantSettings.service_charge_rate : 2.5}
                    onChange={(e) => setRestaurantSettings({ ...restaurantSettings, service_charge_rate: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="field-group">
                  <label>Booking Duration (Minutes)</label>
                  <input type="text" value="90 Minutes" readOnly />
                </div>
                <div className="field-group">
                  <label>UPI Merchant VPA</label>
                  <input type="text" value="spicyspoon@upi" readOnly />
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* TABLE DETAILS POPUP MODAL */}
      {selectedTable && (
        <div className="modal-backdrop" onClick={() => setSelectedTable(null)}>
          <div className="table-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="tbl-modal-head">
              <div>
                <span className="tbl-modal-sec">{selectedTable.section} · 👥 {selectedTable.capacity} Seats</span>
                <h2>Table {selectedTable.table_number} Management</h2>
              </div>
              <button className="close-btn" onClick={() => setSelectedTable(null)}>
                ✕
              </button>
            </div>

            <div className="tbl-modal-body">
              <div className="tbl-status-row">
                <span>Current Status</span>
                <strong className={`status-pill ${selectedTable.status.toLowerCase()}`}>{selectedTable.status}</strong>
              </div>

              {/* Instant Status Override Bar */}
              <div className="status-override-bar">
                <label>Manual Status Override:</label>
                <div className="override-btns-grid">
                  <button
                    className={`btn-override ${selectedTable.status === "AVAILABLE" ? "active green" : ""}`}
                    onClick={async () => {
                      await api.updateTableStatus(selectedTable.id, { status: "AVAILABLE" });
                      setSelectedTable({ ...selectedTable, status: "AVAILABLE" });
                      fetchAllData();
                    }}
                  >
                    🟢 Available
                  </button>
                  <button
                    className={`btn-override ${selectedTable.status === "RESERVED" ? "active yellow" : ""}`}
                    onClick={async () => {
                      await api.updateTableStatus(selectedTable.id, { status: "RESERVED" });
                      setSelectedTable({ ...selectedTable, status: "RESERVED" });
                      fetchAllData();
                    }}
                  >
                    🟡 Reserved
                  </button>
                  <button
                    className={`btn-override ${selectedTable.status === "OCCUPIED" ? "active red" : ""}`}
                    onClick={async () => {
                      await api.updateTableStatus(selectedTable.id, { status: "OCCUPIED" });
                      setSelectedTable({ ...selectedTable, status: "OCCUPIED" });
                      fetchAllData();
                    }}
                  >
                    🔴 Occupied
                  </button>
                  <button
                    className={`btn-override ${selectedTable.status === "PAYMENT_PENDING" ? "active orange" : ""}`}
                    onClick={async () => {
                      await api.updateTableStatus(selectedTable.id, { status: "PAYMENT_PENDING" });
                      setSelectedTable({ ...selectedTable, status: "PAYMENT_PENDING" });
                      fetchAllData();
                    }}
                  >
                    💳 Payment Pending
                  </button>
                </div>
              </div>

              {selectedTable.booking_customer && (
                <div className="tbl-info-block">
                  <h4>Active Reservation</h4>
                  <p>Customer: <strong>{selectedTable.booking_customer}</strong></p>
                  <p>Booking ID: #{selectedTable.booking_number}</p>
                </div>
              )}

              {tableDetailsBill && (
                <div className="tbl-info-block bill-block">
                  <h4>Outstanding Live Bill</h4>
                  <p>Invoice: <strong>#{tableDetailsBill.bill_number}</strong></p>
                  <p>Grand Total: <strong>₹{Number(tableDetailsBill.grand_total).toFixed(2)}</strong></p>
                  <p>Status: <span className={`status-pill ${tableDetailsBill.status.toLowerCase()}`}>{tableDetailsBill.status}</span></p>
                </div>
              )}

              <div className="tbl-modal-actions">
                {tableDetailsBill && tableDetailsBill.status !== "PAID" && (
                  <button
                    className="btn-collect-cash-modal"
                    onClick={() => handleConfirmCashPayment(tableDetailsBill.id)}
                  >
                    <Banknote size={16} /> Collect Cash & Settle
                  </button>
                )}

                <button
                  className="btn-modal-view-qr"
                  onClick={() => {
                    handleLoadTableQr(selectedTable.id);
                    setActiveTab("qr");
                    setSelectedTable(null);
                  }}
                >
                  <QrCode size={16} /> View Table QR Stand
                </button>

                <button className="btn-release-table" onClick={() => handleReleaseTable(selectedTable.id)}>
                  Release to AVAILABLE
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ADD STAFF MODAL */}
      {staffModalOpen && (
        <div className="modal-backdrop" onClick={() => setStaffModalOpen(false)}>
          <div className="menu-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Add Internal Staff Member</h3>
              <button onClick={() => setStaffModalOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleCreateStaff} className="menu-form">
              <div className="field-group">
                <label>Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Chef"
                  value={staffForm.name}
                  onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                />
              </div>

              <div className="field-dual">
                <div className="field-group">
                  <label>Staff Username *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. ramesh_kitchen"
                    value={staffForm.username}
                    onChange={(e) => setStaffForm({ ...staffForm, username: e.target.value })}
                  />
                </div>

                <div className="field-group">
                  <label>Assigned Role *</label>
                  <select
                    value={staffForm.role}
                    onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })}
                  >
                    <option value="KITCHEN">KITCHEN (Kitchen KDS)</option>
                    <option value="ADMIN">ADMIN (Full Operations)</option>
                  </select>
                </div>
              </div>

              <div className="field-group">
                <label>Password *</label>
                <input
                  type="password"
                  required
                  placeholder="Enter secure password"
                  value={staffForm.password}
                  onChange={(e) => setStaffForm({ ...staffForm, password: e.target.value })}
                />
              </div>

              <div className="modal-actions-bar">
                <button type="button" onClick={() => setStaffModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-save">
                  Create Staff Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Admin;
