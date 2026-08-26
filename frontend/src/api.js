const API_BASE_URL = "http://localhost:5000/api";

export function getWsUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:5000`;
}

async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const token = localStorage.getItem("spicy_staff_token");

  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  // Automatically attach staff token if logged in
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

  try {
    const response = await fetch(url, config);

    // Handle 401 Unauthorized for staff
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
  } catch (err) {
    throw err;
  }
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
    const query = new URLSearchParams(params).toString();
    return request(`/restaurants/${slug}/tables${query ? `?${query}` : ""}`);
  },
  getRestaurantTablesWithAvailability: (slug = "spicy-spoon", params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/restaurants/${slug}/tables${query ? `?${query}` : ""}`);
  },

  // Tables
  getTables: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/tables${query ? `?${query}` : ""}`);
  },
  getTable: (id) => request(`/tables/${id}`),
  updateTableStatus: (id, data) => request(`/tables/${id}/status`, { method: "PUT", body: data }),
  createTable: (data) => request("/tables", { method: "POST", body: data }),

  // Bookings (Guest Table Reservation)
  getBookings: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/bookings${query ? `?${query}` : ""}`);
  },
  createBooking: (data) => request("/bookings", { method: "POST", body: data }),
  updateBookingStatus: (id, status) => request(`/bookings/${id}/status`, { method: "PUT", body: { status } }),

  // Menu
  getMenu: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/menu${query ? `?${query}` : ""}`);
  },
  getMenuItem: (id) => request(`/menu/${id}`),
  addMenuItem: (data) => request("/menu", { method: "POST", body: data }),
  updateMenuItem: (id, data) => request(`/menu/${id}`, { method: "PUT", body: data }),

  // Orders (Multi-Round Dining)
  getOrders: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/orders${query ? `?${query}` : ""}`);
  },
  createOrder: (data) => request("/orders", { method: "POST", body: data }),
  updateOrderStatus: (id, status) => request(`/orders/${id}/status`, { method: "PUT", body: { status } }),
  deleteOrder: (id) => request(`/orders/${id}`, { method: "DELETE" }),

  // Bills & Live Billing
  getLiveBill: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/bills/live${query ? `?${query}` : ""}`);
  },
  generateBill: (data) => request("/bills/generate", { method: "POST", body: data }),
  getBills: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/bills${query ? `?${query}` : ""}`);
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
