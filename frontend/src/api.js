import { menuItems as fallbackMenu } from "./data/menuData";

// Resolve API base URL dynamically
function resolveApiBaseUrl() {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/\/$/, "") + "/api";
  }
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "http://localhost:5000/api";
    }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      return `http://${hostname}:5000/api`;
    }
  }
  return "http://localhost:5000/api";
}

const API_BASE_URL = resolveApiBaseUrl();

export function getWsUrl() {
  if (typeof window === "undefined") return "ws://localhost:5000";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const hostname = window.location.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//localhost:5000`;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return `${protocol}//${hostname}:5000`;
  }
  return `${protocol}//${hostname}:5000`;
}

// 12 Standard Tables Dataset for Fallback
const DEFAULT_TABLES = [
  { id: 1, table_number: "T1", capacity: 2, section: "Main Hall", status: "AVAILABLE" },
  { id: 2, table_number: "T2", capacity: 2, section: "Main Hall", status: "AVAILABLE" },
  { id: 3, table_number: "T3", capacity: 4, section: "Main Hall", status: "AVAILABLE" },
  { id: 4, table_number: "T4", capacity: 4, section: "Main Hall", status: "AVAILABLE" },
  { id: 5, table_number: "T5", capacity: 2, section: "Window Side", status: "AVAILABLE" },
  { id: 6, table_number: "T6", capacity: 4, section: "Window Side", status: "AVAILABLE" },
  { id: 7, table_number: "T7", capacity: 6, section: "Window Side", status: "AVAILABLE" },
  { id: 8, table_number: "T8", capacity: 4, section: "Outdoor Patio", status: "AVAILABLE" },
  { id: 9, table_number: "T9", capacity: 6, section: "Outdoor Patio", status: "AVAILABLE" },
  { id: 10, table_number: "T10", capacity: 8, section: "Outdoor Patio", status: "AVAILABLE" },
  { id: 11, table_number: "T11", capacity: 6, section: "VIP Lounge", status: "AVAILABLE" },
  { id: 12, table_number: "T12", capacity: 10, section: "VIP Lounge", status: "AVAILABLE" },
];

function getLocalDemoData(key, fallback = []) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function setLocalDemoData(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {}
}

function buildQueryString(params = {}) {
  const cleanParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "" && value !== "undefined" && value !== "null") {
      cleanParams[key] = value;
    }
  }
  const query = new URLSearchParams(cleanParams).toString();
  return query ? `?${query}` : "";
}

async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const token = localStorage.getItem("spicy_staff_token");

  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (token && !headers["Authorization"]) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const config = {
    ...options,
    headers,
  };

  if (config.body && typeof config.body === "object") {
    config.body = JSON.stringify(config.body);
  }

  let response;
  try {
    response = await fetch(url, config);
  } catch (netErr) {
    console.warn(`Network fetch unreachable for ${endpoint}:`, netErr.message);
    const method = config.method || "GET";
    // Only allow fallback for GET requests when server is genuinely unreachable (offline)
    if (method === "GET") {
      return handleClientFallback(endpoint, options, netErr);
    }
    // For mutations (POST, PUT, DELETE), NEVER pretend fake success if server is unreachable
    throw new Error(
      "Unable to connect to Spicy Spoon server. Please ensure the backend is running at " + API_BASE_URL
    );
  }

  if (response.status === 401 && endpoint.startsWith("/auth/me")) {
    localStorage.removeItem("spicy_staff_token");
    localStorage.removeItem("spicy_staff_user");
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

// Client-side fallback handler for seamless demo experience on mobile & cloud
function handleClientFallback(endpoint, options, originalError) {
  const method = options.method || "GET";

  // Tables availability fallback
  if (endpoint.includes("/tables")) {
    const urlObj = new URL(`http://dummy${endpoint}`);
    const guests = parseInt(urlObj.searchParams.get("guests") || "2", 10);
    const date = urlObj.searchParams.get("date") || new Date().toISOString().split("T")[0];
    const time = urlObj.searchParams.get("time") || "07:30 PM";

    const savedBookings = getLocalDemoData("spicy_demo_bookings", []);

    return DEFAULT_TABLES.map((t) => {
      const fitsCapacity = t.capacity >= guests;
      const isBooked = savedBookings.some(
        (b) => b.table_id === t.id && b.booking_date === date && b.start_time === time && b.status !== "CANCELLED"
      );

      return {
        ...t,
        restaurant_id: 1,
        isAvailableForSlot: fitsCapacity && !isBooked,
        fitsRequestedGuests: fitsCapacity,
        isSlotAvailable: !isBooked,
        conflictReason: !fitsCapacity
          ? `Fits max ${t.capacity} guests`
          : isBooked
          ? "Already booked for this slot"
          : null,
      };
    });
  }

  // Bookings fallback
  if (endpoint.startsWith("/bookings") && method === "POST") {
    const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body || {};
    const tableId = body.table_id || 1;
    const table = DEFAULT_TABLES.find((t) => t.id === tableId) || DEFAULT_TABLES[0];

    const ref = `BK-${Date.now().toString().slice(-6)}`;
    const newBooking = {
      id: Date.now(),
      booking_reference: ref,
      table_id: table.id,
      table_number: table.table_number,
      section: table.section,
      booking_date: body.booking_date,
      start_time: body.start_time,
      guest_count: body.guest_count || 2,
      customer_name: body.customer_name || "Guest Diner",
      customer_phone: body.customer_phone || "+91 98765 43210",
      status: "CONFIRMED",
      created_at: new Date().toISOString(),
    };

    const bookings = getLocalDemoData("spicy_demo_bookings", []);
    bookings.push(newBooking);
    setLocalDemoData("spicy_demo_bookings", bookings);

    return {
      message: "Table reservation confirmed successfully!",
      booking: newBooking,
    };
  }

  // Menu fallback
  if (endpoint.startsWith("/menu")) {
    return fallbackMenu;
  }

  // Orders fallback
  if (endpoint.startsWith("/orders") && method === "POST") {
    const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body || {};
    const tableNumber = body.table_number || "T1";
    const sessionId = body.session_id || `SESSION-${tableNumber}-${Date.now().toString().slice(-6)}`;

    const items = (body.items || []).map((item) => {
      const found = fallbackMenu.find((m) => m.id === item.menu_item_id || m.id === item.id) || {};
      const unitPrice = item.unit_price || found.price || 299;
      return {
        id: item.id || item.menu_item_id || Date.now(),
        menu_item_id: item.menu_item_id || item.id,
        name: item.name || found.name || "Special Dish",
        unit_price: unitPrice,
        quantity: item.quantity || 1,
        total_price: unitPrice * (item.quantity || 1),
        special_instruction: item.special_instruction || "",
      };
    });

    const subtotal = items.reduce((sum, it) => sum + it.total_price, 0);
    const roundNumber = body.round_number || 1;
    const orderNumber = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;

    const newOrder = {
      id: Date.now(),
      order_number: orderNumber,
      session_id: sessionId,
      table_number: tableNumber,
      round_number: roundNumber,
      status: "ORDER_PLACED",
      subtotal,
      created_at: new Date().toISOString(),
      items,
    };

    const localOrders = getLocalDemoData(`spicy_orders_${sessionId}`, []);
    localOrders.push(newOrder);
    setLocalDemoData(`spicy_orders_${sessionId}`, localOrders);

    // Save session metadata
    setLocalDemoData(`spicy_session_${sessionId}`, {
      session_id: sessionId,
      table_number: tableNumber,
      guest_name: body.guest_name || "Table Guest",
      status: "ACTIVE",
      created_at: new Date().toISOString(),
    });

    return {
      message: `Round ${roundNumber} order placed successfully!`,
      order: newOrder,
      sessionId,
    };
  }

  // Session fallback
  if (endpoint.startsWith("/sessions/")) {
    const sessionId = endpoint.split("/sessions/")[1];
    const session = getLocalDemoData(`spicy_session_${sessionId}`, {
      session_id: sessionId,
      table_number: "T1",
      guest_name: "Table Guest",
      status: "ACTIVE",
      created_at: new Date().toISOString(),
    });
    const orders = getLocalDemoData(`spicy_orders_${sessionId}`, []);
    const subtotal = orders.reduce((sum, o) => sum + (o.subtotal || 0), 0);
    const tax = Math.round(subtotal * 0.05 * 100) / 100;
    const service = Math.round(subtotal * 0.025 * 100) / 100;

    return {
      session,
      orders,
      bill: {
        id: Date.now(),
        bill_number: `INV-2026-${sessionId.slice(-5)}`,
        session_id: sessionId,
        table_number: session.table_number,
        subtotal,
        tax_amount: tax,
        service_charge: service,
        discount_amount: 0,
        grand_total: Math.round((subtotal + tax + service) * 100) / 100,
        status: "UNPAID",
      },
    };
  }

  // Live Bill fallback
  if (endpoint.startsWith("/bills/live") || endpoint.startsWith("/bills/generate")) {
    const urlObj = new URL(`http://dummy${endpoint}`);
    const tableNumber = urlObj.searchParams.get("table") || "T1";
    const sessionId = `SESSION-${tableNumber}-DEMO`;
    const orders = getLocalDemoData(`spicy_orders_${sessionId}`, []);
    const subtotal = orders.length > 0 ? orders.reduce((s, o) => s + (o.subtotal || 0), 0) : 748;
    const tax = Math.round(subtotal * 0.05 * 100) / 100;
    const service = Math.round(subtotal * 0.025 * 100) / 100;

    return {
      bill: {
        id: Date.now(),
        bill_number: `INV-2026-${Math.floor(10000 + Math.random() * 90000)}`,
        session_id: sessionId,
        table_number: tableNumber,
        subtotal,
        tax_amount: tax,
        service_charge: service,
        discount_amount: 0,
        grand_total: Math.round((subtotal + tax + service) * 100) / 100,
        status: "UNPAID",
        orders: orders.length > 0 ? orders : [
          {
            order_number: "ORD-DEMO",
            round_number: 1,
            subtotal,
            items: [
              { name: "Tandoori Chicken (Half)", quantity: 1, unit_price: 349, total_price: 349 },
              { name: "Butter Chicken", quantity: 1, unit_price: 399, total_price: 399 },
            ]
          }
        ]
      },
    };
  }

  // Payments verify fallback
  if (endpoint.startsWith("/payments/verify") || endpoint.startsWith("/payments/create")) {
    return {
      message: "Payment verified successfully!",
      payment: {
        id: Date.now(),
        payment_reference: `PAY-DEMO-${Date.now().toString().slice(-6)}`,
        status: "SUCCESS",
      },
      bill: { status: "PAID" },
    };
  }

  // Cash confirm fallback
  if (endpoint.startsWith("/payments/cash-confirm")) {
    return {
      message: "Cash payment confirmed by manager.",
      status: "CASH_PAID",
    };
  }

  // Staff login fallback for dev demo
  if (endpoint.startsWith("/auth/login") && method === "POST") {
    const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body || {};
    if (body.username === "admin" && body.password === "admin123") {
      return {
        token: "demo_admin_jwt_token",
        user: { id: 1, name: "General Manager", username: "admin", role: "ADMIN", status: "ACTIVE" },
      };
    }
    if (body.username === "kitchen" && body.password === "kitchen123") {
      return {
        token: "demo_kitchen_jwt_token",
        user: { id: 2, name: "Executive Chef", username: "kitchen", role: "KITCHEN", status: "ACTIVE" },
      };
    }
  }

  throw originalError;
}

export const api = {
  // Staff Auth & RBAC
  staffLogin: (credentials) => request("/auth/login", { method: "POST", body: credentials }),
  getStaffMe: () => request("/auth/me"),
  getStaffList: () => request("/auth/staff-list"),
  createStaffUser: (userData) => request("/auth/staff", { method: "POST", body: userData }),
  toggleStaffStatus: (id, status) => request(`/auth/staff/${id}/status`, { method: "PUT", body: { status } }),

  // Guest Dining Sessions (No Login Required)
  getGuestSession: (sessionId) => request(`/sessions/${sessionId}`),

  // Restaurants & QR
  getRestaurant: (slug = "spicy-spoon") => request(`/restaurants/${slug}`),
  getRestaurantQr: (slug = "spicy-spoon") => request(`/restaurants/${slug}/qr`),
  getRestaurantTables: (slug = "spicy-spoon", params = {}) => {
    return request(`/restaurants/${slug}/tables${buildQueryString(params)}`);
  },
  getRestaurantTablesWithAvailability: (slug = "spicy-spoon", params = {}) => {
    return request(`/restaurants/${slug}/tables${buildQueryString(params)}`);
  },

  // Tables
  getTables: (params = {}) => {
    return request(`/tables${buildQueryString(params)}`);
  },
  getTable: (id) => request(`/tables/${id}`),
  updateTableStatus: (id, data) => request(`/tables/${id}/status`, { method: "PUT", body: data }),
  createTable: (data) => request("/tables", { method: "POST", body: data }),

  // Bookings (Guest Table Reservation)
  getBookings: (params = {}) => {
    return request(`/bookings${buildQueryString(params)}`);
  },
  createBooking: (data) => request("/bookings", { method: "POST", body: data }),
  updateBookingStatus: (id, status) => request(`/bookings/${id}/status`, { method: "PUT", body: { status } }),

  // Menu
  getMenu: (params = {}) => {
    return request(`/menu${buildQueryString(params)}`);
  },
  getMenuItem: (id) => request(`/menu/${id}`),
  addMenuItem: (data) => request("/menu", { method: "POST", body: data }),
  updateMenuItem: (id, data) => request(`/menu/${id}`, { method: "PUT", body: data }),

  // Orders (Multi-Round Dining)
  getOrders: (params = {}) => {
    return request(`/orders${buildQueryString(params)}`);
  },
  createOrder: (data) => request("/orders", { method: "POST", body: data }),
  updateOrderStatus: (id, status) => request(`/orders/${id}/status`, { method: "PUT", body: { status } }),
  deleteOrder: (id) => request(`/orders/${id}`, { method: "DELETE" }),

  // Bills & Live Billing
  getLiveBill: (params = {}) => {
    return request(`/bills/live${buildQueryString(params)}`);
  },
  generateBill: (data) => request("/bills/generate", { method: "POST", body: data }),
  getBills: (params = {}) => {
    return request(`/bills${buildQueryString(params)}`);
  },
  getBill: (id) => request(`/bills/${id}`),

  // Payments & Idempotent Verification
  createGatewayOrder: (data) => request("/payments/create-gateway-order", { method: "POST", body: data }),
  createPayment: (data) => request("/payments/create", { method: "POST", body: data }),
  verifyPayment: (data) => request("/payments/verify", { method: "POST", body: data }),
  confirmCashPayment: (data) => request("/payments/cash-confirm", { method: "POST", body: data }),
  getPayments: () => request("/payments"),
  getPayment: (id) => request(`/payments/${id}`),

  // Reports & Analytics (Admin Only)
  getAnalytics: () => request("/reports/analytics"),
  getDailyReports: (days = 7) => request(`/reports/daily?days=${days}`),

  // Settings
  getSettings: () => request("/settings"),
  updateSettings: (data) => request("/settings", { method: "PUT", body: data }),

  // QR
  getTableQr: (tableId) => request(`/qr/table/${tableId}`),
};
