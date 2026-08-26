import {
  ChefHat,
  Clock,
  CheckCircle2,
  AlertCircle,
  Flame,
  Utensils,
  RefreshCw,
  LogOut,
  Sparkles,
  ArrowLeft,
  Volume2,
  ShieldCheck,
} from "lucide-react";
import { api } from "../api";
import { useWebSocket } from "../hooks/useWebSocket";
import "./Kitchen.css";

function Kitchen({ onLogout }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState("ALL");

  const [currentStaff] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("spicy_staff_user")) || { name: "Head Chef", role: "KITCHEN" };
    } catch {
      return { name: "Head Chef", role: "KITCHEN" };
    }
  });

  const fetchKitchenOrders = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getOrders();
      // Keep active kitchen orders
      const kitchenOrders = data.filter((o) =>
        ["ORDER_PLACED", "ACCEPTED", "PREPARING", "READY", "SERVED"].includes(o.status)
      );
      setOrders(kitchenOrders);
    } catch (err) {
      console.warn("Failed to fetch kitchen orders:", err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKitchenOrders();
  }, [fetchKitchenOrders]);

  // WebSocket Live Updates
  const handleWsEvent = useCallback(
    (event) => {
      if (!event || !event.type) return;
      if (["NEW_ORDER", "ORDER_STATUS_UPDATED", "ORDER_DELETED"].includes(event.type)) {
        fetchKitchenOrders();
      }
    },
    [fetchKitchenOrders]
  );

  useWebSocket(handleWsEvent);

  const handleUpdateStatus = async (orderId, nextStatus) => {
    try {
      await api.updateOrderStatus(orderId, nextStatus);
      fetchKitchenOrders();
    } catch (err) {
      alert("Failed to update status: " + err.message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("spicy_staff_token");
    localStorage.removeItem("spicy_staff_user");
    if (onLogout) {
      onLogout();
    } else {
      window.location.hash = "#/staff/login";
    }
  };

  // Group orders by KDS lanes
  const newOrders = useMemo(() => orders.filter((o) => o.status === "ORDER_PLACED"), [orders]);
  const acceptedOrders = useMemo(() => orders.filter((o) => o.status === "ACCEPTED"), [orders]);
  const prepOrders = useMemo(() => orders.filter((o) => o.status === "PREPARING"), [orders]);
  const readyOrders = useMemo(() => orders.filter((o) => o.status === "READY"), [orders]);

  const getTimeElapsed = (createdAt) => {
    if (!createdAt) return "Just now";
    const diffMs = Date.now() - new Date(createdAt).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    return `${diffMins} min ago`;
  };

  return (
    <div className="kitchen-kds-page">
      {/* Top Header */}
      <header className="kds-topbar">
        <div className="kds-brand-left">
          <div className="kds-logo-icon">
            <ChefHat size={26} />
          </div>
          <div>
            <h2>
              SPICY <span>SPOON</span> KITCHEN KDS
            </h2>
            <p className="kds-sub">Live Clay Oven & Chef Expediting Station</p>
          </div>
        </div>

        <div className="kds-top-actions">
          <a href="#/admin" className="kds-nav-btn admin-btn" title="Switch to Admin Dashboard">
            <ShieldCheck size={16} />
            <span>Admin Portal</span>
          </a>

          <a href="#/order?table=T1" className="kds-nav-btn menu-btn" title="View Customer Digital Menu">
            <Utensils size={16} />
            <span>Customer Menu</span>
          </a>

          <div className="kds-profile-badge">
            <span>{currentStaff.name}</span>
            <span className="kds-role-pill">KITCHEN</span>
          </div>

          <button className="kds-btn-refresh" onClick={fetchKitchenOrders} title="Refresh KDS">
            <RefreshCw size={16} className={loading ? "spin" : ""} />
            <span>Refresh</span>
          </button>

          <button className="kds-btn-logout" onClick={handleLogout}>
            <LogOut size={16} />
            <span>Logout</span>
          </button>
        </div>
      </header>

      {/* KDS Main Columns Grid */}
      <main className="kds-board-lanes">
        {/* LANE 1: NEW ORDERS (ORDER_PLACED) */}
        <div className="kds-lane lane-new">
          <div className="lane-header">
            <h3>1. NEW ORDERS</h3>
            <span className="count-pill">{newOrders.length}</span>
          </div>

          <div className="lane-cards-scroll">
            {newOrders.length === 0 ? (
              <div className="lane-empty-state">No new tickets</div>
            ) : (
              newOrders.map((ord) => (
                <div className="kds-order-card new-card" key={ord.id}>
                  <div className="kds-card-head">
                    <div>
                      <span className="table-badge">Table {ord.tableNumber || ord.table_number}</span>
                      <span className="round-tag">Round {ord.round_number || 1}</span>
                    </div>
                    <span className="time-tag">
                      <Clock size={12} /> {getTimeElapsed(ord.created_at)}
                    </span>
                  </div>

                  <p className="kds-ticket-id">#{ord.order_number}</p>

                  <div className="kds-items-list">
                    {ord.items?.map((item, idx) => (
                      <div className="kds-dish-row" key={idx}>
                        <span className="dish-qty">{item.quantity}×</span>
                        <div className="dish-text">
                          <strong>{item.name}</strong>
                          {item.special_instruction && (
                            <span className="kds-note">📝 "{item.special_instruction}"</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="kds-card-actions">
                    <button className="btn-kds-action accept" onClick={() => handleUpdateStatus(ord.id, "ACCEPTED")}>
                      ✓ Accept Order
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* LANE 2: ACCEPTED / QUEUED */}
        <div className="kds-lane lane-accepted">
          <div className="lane-header">
            <h3>2. QUEUED / ACCEPTED</h3>
            <span className="count-pill">{acceptedOrders.length}</span>
          </div>

          <div className="lane-cards-scroll">
            {acceptedOrders.length === 0 ? (
              <div className="lane-empty-state">No orders in queue</div>
            ) : (
              acceptedOrders.map((ord) => (
                <div className="kds-order-card accepted-card" key={ord.id}>
                  <div className="kds-card-head">
                    <div>
                      <span className="table-badge">Table {ord.tableNumber || ord.table_number}</span>
                      <span className="round-tag">Round {ord.round_number || 1}</span>
                    </div>
                    <span className="time-tag">
                      <Clock size={12} /> {getTimeElapsed(ord.created_at)}
                    </span>
                  </div>

                  <p className="kds-ticket-id">#{ord.order_number}</p>

                  <div className="kds-items-list">
                    {ord.items?.map((item, idx) => (
                      <div className="kds-dish-row" key={idx}>
                        <span className="dish-qty">{item.quantity}×</span>
                        <div className="dish-text">
                          <strong>{item.name}</strong>
                          {item.special_instruction && (
                            <span className="kds-note">📝 "{item.special_instruction}"</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="kds-card-actions">
                    <button className="btn-kds-action prep" onClick={() => handleUpdateStatus(ord.id, "PREPARING")}>
                      <Flame size={16} /> Start Cooking
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* LANE 3: COOKING (PREPARING) */}
        <div className="kds-lane lane-prep">
          <div className="lane-header">
            <h3>3. COOKING IN KITCHEN 🔥</h3>
            <span className="count-pill">{prepOrders.length}</span>
          </div>

          <div className="lane-cards-scroll">
            {prepOrders.length === 0 ? (
              <div className="lane-empty-state">No dishes currently cooking</div>
            ) : (
              prepOrders.map((ord) => (
                <div className="kds-order-card prep-card" key={ord.id}>
                  <div className="kds-card-head">
                    <div>
                      <span className="table-badge">Table {ord.tableNumber || ord.table_number}</span>
                      <span className="round-tag">Round {ord.round_number || 1}</span>
                    </div>
                    <span className="time-tag">
                      <Clock size={12} /> {getTimeElapsed(ord.created_at)}
                    </span>
                  </div>

                  <p className="kds-ticket-id">#{ord.order_number}</p>

                  <div className="kds-items-list">
                    {ord.items?.map((item, idx) => (
                      <div className="kds-dish-row" key={idx}>
                        <span className="dish-qty">{item.quantity}×</span>
                        <div className="dish-text">
                          <strong>{item.name}</strong>
                          {item.special_instruction && (
                            <span className="kds-note highlight">🔥 "{item.special_instruction}"</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="kds-card-actions">
                    <button className="btn-kds-action ready" onClick={() => handleUpdateStatus(ord.id, "READY")}>
                      <CheckCircle2 size={16} /> Mark as Ready 🍽️
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* LANE 4: READY / EXPEDITE */}
        <div className="kds-lane lane-ready">
          <div className="lane-header">
            <h3>4. READY FOR SERVICE 🍽️</h3>
            <span className="count-pill">{readyOrders.length}</span>
          </div>

          <div className="lane-cards-scroll">
            {readyOrders.length === 0 ? (
              <div className="lane-empty-state">No ready orders waiting</div>
            ) : (
              readyOrders.map((ord) => (
                <div className="kds-order-card ready-card" key={ord.id}>
                  <div className="kds-card-head">
                    <div>
                      <span className="table-badge green">Table {ord.tableNumber || ord.table_number}</span>
                      <span className="round-tag">Round {ord.round_number || 1}</span>
                    </div>
                    <span className="time-tag">
                      <Clock size={12} /> {getTimeElapsed(ord.created_at)}
                    </span>
                  </div>

                  <p className="kds-ticket-id">#{ord.order_number}</p>

                  <div className="kds-items-list">
                    {ord.items?.map((item, idx) => (
                      <div className="kds-dish-row" key={idx}>
                        <span className="dish-qty">{item.quantity}×</span>
                        <div className="dish-text">
                          <strong>{item.name}</strong>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="kds-card-actions">
                    <button className="btn-kds-action serve" onClick={() => handleUpdateStatus(ord.id, "SERVED")}>
                      <Utensils size={16} /> Mark Served ✨
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default Kitchen;
