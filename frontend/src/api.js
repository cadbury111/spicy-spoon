import QRCode from "qrcode";
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

// 12 Standard Tables Dataset
const DEFAULT_TABLES = [
  { id: 1, table_number: "T1", capacity: 2, section: "Main Hall", status: "OCCUPIED" },
  { id: 2, table_number: "T2", capacity: 2, section: "Main Hall", status: "AVAILABLE" },
  { id: 3, table_number: "T3", capacity: 4, section: "Main Hall", status: "ORDER_PLACED" },
  { id: 4, table_number: "T4", capacity: 4, section: "Main Hall", status: "AVAILABLE" },
  { id: 5, table_number: "T5", capacity: 2, section: "Window Side", status: "ORDER_PLACED" },
  { id: 6, table_number: "T6", capacity: 4, section: "Window Side", status: "AVAILABLE" },
  { id: 7, table_number: "T7", capacity: 6, section: "Window Side", status: "PAYMENT_PENDING" },
  { id: 8, table_number: "T8", capacity: 4, section: "Outdoor Patio", status: "AVAILABLE" },
  { id: 9, table_number: "T9", capacity: 6, section: "Outdoor Patio", status: "RESERVED" },
  { id: 10, table_number: "T10", capacity: 8, section: "Outdoor Patio", status: "AVAILABLE" },
  { id: 11, table_number: "T11", capacity: 6, section: "VIP Lounge", status: "RESERVED" },
  { id: 12, table_number: "T12", capacity: 10, section: "VIP Lounge", status: "AVAILABLE" },
];

const INITIAL_DEMO_ORDERS = [
  {
    id: 101,
    order_number: "ORD-8421",
    session_id: "SESSION-T3-8421",
    table_number: "T3",
    tableNumber: "T3",
    round_number: 1,
    customer_name: "Anita & Family",
    status: "ORDER_PLACED",
    subtotal: 1047,
    tax: 52.35,
    service_charge: 26.18,
    discount: 0,
    total: 1125.53,
    items: [
      { id: 1, menu_item_id: 1, name: "Tandoori Chicken (Full)", unit_price: 649, quantity: 1, total_price: 649, special_instruction: "Extra spicy with mint chutney" },
      { id: 2, menu_item_id: 2, name: "Butter Chicken", unit_price: 398, quantity: 1, total_price: 398, special_instruction: "Less sweet, rich gravy" }
    ],
    created_at: new Date(Date.now() - 3 * 60000).toISOString()
  },
  {
    id: 102,
    order_number: "ORD-9134",
    session_id: "SESSION-T5-9134",
    table_number: "T5",
    tableNumber: "T5",
    round_number: 1,
    customer_name: "Rahul Sharma",
    status: "ACCEPTED",
    subtotal: 678,
    tax: 33.9,
    service_charge: 16.95,
    discount: 0,
    total: 728.85,
    items: [
      { id: 3, menu_item_id: 3, name: "Chicken Biryani", unit_price: 349, quantity: 1, total_price: 349, special_instruction: "Double salan on the side" },
      { id: 5, menu_item_id: 5, name: "Paneer Tikka", unit_price: 329, quantity: 1, total_price: 329, special_instruction: "Well roasted" }
    ],
    created_at: new Date(Date.now() - 8 * 60000).toISOString()
  },
  {
    id: 103,
    order_number: "ORD-7622",
    session_id: "SESSION-T1-7622",
    table_number: "T1",
    tableNumber: "T1",
    round_number: 1,
    customer_name: "Vikram Mehta",
    status: "PREPARING",
    subtotal: 828,
    tax: 41.4,
    service_charge: 20.7,
    discount: 0,
    total: 890.1,
    items: [
      { id: 7, menu_item_id: 7, name: "Grilled Fish", unit_price: 499, quantity: 1, total_price: 499, special_instruction: "Crispy skin, lemon butter sauce" },
      { id: 8, menu_item_id: 8, name: "Chicken Hakka Noodles", unit_price: 329, quantity: 1, total_price: 329, special_instruction: "Add fried garlic" }
    ],
    created_at: new Date(Date.now() - 14 * 60000).toISOString()
  },
  {
    id: 104,
    order_number: "ORD-6190",
    session_id: "SESSION-T7-6190",
    table_number: "T7",
    tableNumber: "T7",
    round_number: 2,
    customer_name: "Pooja Hegde",
    status: "READY",
    subtotal: 718,
    tax: 35.9,
    service_charge: 17.95,
    discount: 0,
    total: 771.85,
    items: [
      { id: 4, menu_item_id: 4, name: "Prawn Fry", unit_price: 519, quantity: 1, total_price: 519, special_instruction: "Garnish with curry leaves" },
      { id: 6, menu_item_id: 6, name: "Gulab Jamun (2 Pcs)", unit_price: 199, quantity: 1, total_price: 199, special_instruction: "Serve piping hot" }
    ],
    created_at: new Date(Date.now() - 20 * 60000).toISOString()
  }
];

const INITIAL_DEMO_BOOKINGS = [
  {
    id: 201,
    booking_number: "BK-829104",
    table_id: 11,
    table_number: "T11",
    section: "VIP Lounge",
    booking_date: new Date().toISOString().split("T")[0],
    start_time: "08:00 PM",
    end_time: "09:30 PM",
    guest_count: 6,
    customer_name: "Siddharth Roy",
    customer_phone: "+91 98450 11223",
    customer_email: "siddharth@example.com",
    status: "CONFIRMED",
    special_notes: "Corporate celebration, quiet booth",
    created_at: new Date().toISOString()
  },
  {
    id: 202,
    booking_number: "BK-471092",
    table_id: 9,
    table_number: "T9",
    section: "Outdoor Patio",
    booking_date: new Date().toISOString().split("T")[0],
    start_time: "07:30 PM",
    end_time: "09:00 PM",
    guest_count: 4,
    customer_name: "Meera Nair",
    customer_phone: "+91 97412 88990",
    customer_email: "meera.nair@example.com",
    status: "CHECKED_IN",
    special_notes: "Birthday anniversary decoration requested",
    created_at: new Date().toISOString()
  }
];

// Helper to generate genuine scannable QR Code Data URLs
async function generateQrDataUrl(text) {
  try {
    return await QRCode.toDataURL(text, {
      width: 450,
      margin: 2,
      color: {
        dark: "#140c08",
        light: "#ffffff",
      },
    });
  } catch (err) {
    return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><rect width='300' height='300' fill='white'/></svg>`;
  }
}

// Unified Local Storage Helpers for Standalone / Vercel Hosted Mode
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

function dispatchClientEvent(type, data = {}) {
  try {
    const payload = { type, data, timestamp: Date.now() };
    window.dispatchEvent(new CustomEvent("spicy_ws_event", { detail: payload }));
    localStorage.setItem("spicy_last_event", JSON.stringify(payload));
    localStorage.setItem("spicy_ws_event_timestamp", Date.now().toString());
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

  try {
    const response = await fetch(url, config);

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
  } catch (netOrHttpErr) {
    // If it's a real HTTP status error returned by reachable server, rethrow it
    if (netOrHttpErr.status) {
      throw netOrHttpErr;
    }
    // If backend is unreachable (e.g. hosted on Vercel without backend server), run client fallback engine
    return handleClientFallback(endpoint, options, netOrHttpErr);
  }
}

// Complete Client-side Engine for Seamless Hosted & Offline Execution
async function handleClientFallback(endpoint, options = {}, originalError) {
  const method = (options.method || "GET").toUpperCase();
  const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body || {};

  // Initialize base tables in local store if not present
  let tables = getLocalDemoData("spicy_demo_tables", null);
  if (!tables || !Array.isArray(tables) || tables.length === 0) {
    tables = DEFAULT_TABLES.map((t) => ({ ...t, current_booking_id: null, current_order_id: null, current_session_id: null }));
    setLocalDemoData("spicy_demo_tables", tables);
  }

  // 1. TABLES
  if (endpoint.includes("/tables") || endpoint.startsWith("/tables")) {
    if (method === "GET") {
      const urlObj = new URL(`http://dummy${endpoint}`);
      const guests = parseInt(urlObj.searchParams.get("guests") || "2", 10);
      const date = urlObj.searchParams.get("date") || new Date().toISOString().split("T")[0];
      const time = urlObj.searchParams.get("time") || "07:30 PM";

      const savedBookings = getLocalDemoData("spicy_demo_bookings", INITIAL_DEMO_BOOKINGS);

      return tables.map((t) => {
        const fitsCapacity = t.capacity >= guests;
        const isBooked = savedBookings.some(
          (b) => (b.table_id === t.id || b.table_number === t.table_number) &&
                 b.booking_date === date &&
                 b.start_time === time &&
                 b.status !== "CANCELLED"
        );

        return {
          ...t,
          restaurant_id: 1,
          isAvailableForSlot: fitsCapacity && !isBooked && t.status === "AVAILABLE",
          fitsRequestedGuests: fitsCapacity,
          isSlotAvailable: !isBooked,
          conflictReason: !fitsCapacity
            ? `Fits max ${t.capacity} guests`
            : isBooked
            ? "Already booked for this slot"
            : t.status !== "AVAILABLE"
            ? `Currently ${t.status}`
            : null,
        };
      });
    }

    if (method === "PUT" && (endpoint.includes("/status") || endpoint.match(/\/tables\/\d+/))) {
      const match = endpoint.match(/\/tables\/(\d+)/);
      const tableId = match ? parseInt(match[1], 10) : 1;
      const nextStatus = body.status || "AVAILABLE";

      tables = tables.map((t) => (t.id === tableId ? { ...t, status: nextStatus } : t));
      setLocalDemoData("spicy_demo_tables", tables);

      const updated = tables.find((t) => t.id === tableId);
      dispatchClientEvent("TABLE_STATUS_UPDATED", updated);
      return { message: "Table status updated", table: updated };
    }
  }

  // 2. BOOKINGS
  if (endpoint.startsWith("/bookings")) {
    let bookings = getLocalDemoData("spicy_demo_bookings", INITIAL_DEMO_BOOKINGS);

    if (method === "GET") {
      return bookings;
    }

    if (method === "POST") {
      const tableId = body.table_id || 1;
      const table = tables.find((t) => t.id === tableId || t.table_number === body.table_number) || tables[0];
      const ref = `BK-${Date.now().toString().slice(-6)}`;

      const newBooking = {
        id: Date.now(),
        booking_number: ref,
        table_id: table.id,
        table_number: table.table_number,
        section: table.section,
        booking_date: body.booking_date,
        start_time: body.start_time,
        end_time: body.end_time || "09:00 PM",
        guest_count: body.guest_count || 2,
        customer_name: body.customer_name || "Guest Diner",
        customer_phone: body.customer_phone || "+91 98765 43210",
        customer_email: body.customer_email || "",
        status: "CONFIRMED",
        special_notes: body.special_notes || "",
        created_at: new Date().toISOString(),
      };

      bookings.unshift(newBooking);
      setLocalDemoData("spicy_demo_bookings", bookings);

      // Update table status if today
      const today = new Date().toISOString().split("T")[0];
      if (body.booking_date === today) {
        tables = tables.map((t) => (t.id === table.id ? { ...t, status: "RESERVED", current_booking_id: newBooking.id } : t));
        setLocalDemoData("spicy_demo_tables", tables);
      }

      dispatchClientEvent("NEW_BOOKING", newBooking);
      dispatchClientEvent("TABLE_STATUS_UPDATED", table);

      return {
        message: `Table ${table.table_number} reserved successfully!`,
        booking: newBooking,
        session_id: `SESSION-${table.table_number}-${Date.now().toString().slice(-6)}`,
      };
    }

    if (method === "PUT" && endpoint.includes("/status")) {
      const match = endpoint.match(/\/bookings\/(\d+)\/status/);
      const bookingId = match ? parseInt(match[1], 10) : 0;
      const status = body.status || "CONFIRMED";

      bookings = bookings.map((b) => (b.id === bookingId ? { ...b, status } : b));
      setLocalDemoData("spicy_demo_bookings", bookings);

      const updatedBooking = bookings.find((b) => b.id === bookingId);
      dispatchClientEvent("BOOKING_STATUS_UPDATED", updatedBooking);
      return { message: "Booking status updated", booking: updatedBooking };
    }
  }

  // 3. ORDERS (Unified between Customer, Kitchen KDS, and Admin)
  if (endpoint.startsWith("/orders")) {
    let orders = getLocalDemoData("spicy_demo_orders", INITIAL_DEMO_ORDERS);

    if (method === "GET") {
      const urlObj = new URL(`http://dummy${endpoint}`);
      const sessionId = urlObj.searchParams.get("session_id");
      const tableNumber = urlObj.searchParams.get("table_number");

      let filtered = orders;
      if (sessionId && sessionId !== "undefined" && sessionId !== "null") {
        filtered = filtered.filter((o) => o.session_id === sessionId);
      }
      if (tableNumber && tableNumber !== "undefined" && tableNumber !== "null") {
        const clean = tableNumber.replace(/^Table\s*/i, "").trim();
        filtered = filtered.filter((o) => (o.table_number === clean || o.tableNumber === clean || o.table_number === `T${clean.replace(/^T/i, "")}`));
      }
      return filtered;
    }

    if (method === "POST") {
      const tableNumber = (body.tableNumber || body.table_number || "T1").replace(/^Table\s*/i, "").trim();
      const sessionId = body.session_id || `SESSION-${tableNumber}-${Date.now().toString().slice(-6)}`;
      const items = (body.items || []).map((item) => {
        const found = fallbackMenu.find((m) => m.id === item.menu_item_id || m.id === item.id || m.name.toLowerCase() === (item.name || "").toLowerCase()) || {};
        const unitPrice = item.unit_price || found.price || 299;
        const qty = item.quantity || 1;
        return {
          id: item.id || item.menu_item_id || Date.now(),
          menu_item_id: item.menu_item_id || item.id || 1,
          name: item.name || found.name || "Special Dish",
          unit_price: unitPrice,
          quantity: qty,
          total_price: unitPrice * qty,
          special_instruction: item.special_instruction || item.note || "",
        };
      });

      const subtotal = items.reduce((sum, it) => sum + it.total_price, 0);
      const tax = Math.round(subtotal * 0.05 * 100) / 100;
      const serviceCharge = Math.round(subtotal * 0.025 * 100) / 100;
      const grandTotal = Math.round((subtotal + tax + serviceCharge) * 100) / 100;

      const roundNumber = body.round_number || 1;
      const orderNumber = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;

      const newOrder = {
        id: Date.now(),
        order_number: orderNumber,
        session_id: sessionId,
        table_number: tableNumber,
        tableNumber,
        round_number: roundNumber,
        customer_name: body.customer_name || "Table Guest",
        status: "ORDER_PLACED",
        subtotal,
        tax,
        service_charge: serviceCharge,
        discount: 0,
        total: grandTotal,
        items,
        created_at: new Date().toISOString(),
      };

      orders.unshift(newOrder);
      setLocalDemoData("spicy_demo_orders", orders);

      // Update table occupancy in local store
      tables = tables.map((t) =>
        t.table_number === tableNumber || t.table_number === `T${tableNumber.replace(/^T/i, "")}`
          ? { ...t, status: "ORDER_PLACED", current_order_id: newOrder.id, current_session_id: sessionId, order_number: orderNumber }
          : t
      );
      setLocalDemoData("spicy_demo_tables", tables);

      const targetTable = tables.find((t) => t.table_number === tableNumber) || tables[0];

      dispatchClientEvent("NEW_ORDER", newOrder);
      dispatchClientEvent("TABLE_STATUS_UPDATED", targetTable);

      return {
        message: `Order #${orderNumber} (Round ${roundNumber}) placed successfully!`,
        order: newOrder,
        table: targetTable,
        session_id: sessionId,
      };
    }

    if (method === "PUT" && endpoint.includes("/status")) {
      const match = endpoint.match(/\/orders\/(\d+)\/status/);
      const orderId = match ? parseInt(match[1], 10) : 0;
      const status = body.status || "ACCEPTED";

      orders = orders.map((o) => (o.id === orderId ? { ...o, status, updated_at: new Date().toISOString() } : o));
      setLocalDemoData("spicy_demo_orders", orders);

      const updated = orders.find((o) => o.id === orderId);
      dispatchClientEvent("ORDER_STATUS_UPDATED", updated);
      return { message: "Order status updated", order: updated };
    }

    if (method === "DELETE") {
      const match = endpoint.match(/\/orders\/(\d+)/);
      const orderId = match ? parseInt(match[1], 10) : 0;
      orders = orders.filter((o) => o.id !== orderId);
      setLocalDemoData("spicy_demo_orders", orders);
      dispatchClientEvent("ORDER_DELETED", { id: orderId });
      return { message: "Order deleted" };
    }
  }

  // 4. BILLS & INVOICES
  if (endpoint.startsWith("/bills")) {
    let bills = getLocalDemoData("spicy_demo_bills", []);

    if (method === "GET" && endpoint === "/bills") {
      return bills;
    }

    if (endpoint.startsWith("/bills/live") || endpoint.startsWith("/bills/generate") || method === "POST") {
      const urlObj = new URL(`http://dummy${endpoint}`);
      const tableNumber = (urlObj.searchParams.get("tableNumber") || body.tableNumber || "T1").replace(/^Table\s*/i, "").trim();
      const sessionId = urlObj.searchParams.get("sessionId") || body.session_id || `SESSION-${tableNumber}-DEMO`;

      const allOrders = getLocalDemoData("spicy_demo_orders", INITIAL_DEMO_ORDERS);
      const sessionOrders = allOrders.filter((o) => o.session_id === sessionId || o.table_number === tableNumber || o.tableNumber === tableNumber);

      const subtotal = sessionOrders.length > 0
        ? sessionOrders.reduce((sum, o) => sum + (o.subtotal || 0), 0)
        : 897;

      const discountRate = (body.discount_code === "SPICY10" || body.discount_code === "WELCOME10") ? 0.1 : 0;
      const discountAmount = Math.round(subtotal * discountRate * 100) / 100;
      const discountedSubtotal = subtotal - discountAmount;

      const tax = Math.round(discountedSubtotal * 0.05 * 100) / 100;
      const service = Math.round(discountedSubtotal * 0.025 * 100) / 100;
      const grandTotal = Math.round((discountedSubtotal + tax + service) * 100) / 100;

      const billNumber = `INV-2026-${Math.floor(10000 + Math.random() * 90000)}`;
      const liveBill = {
        id: Date.now(),
        bill_number: billNumber,
        session_id: sessionId,
        table_number: tableNumber,
        subtotal,
        discount: discountAmount,
        discount_code: body.discount_code || "",
        tax,
        service_charge: service,
        grand_total: grandTotal,
        status: "UNPAID",
        payment_method: null,
        created_at: new Date().toISOString(),
        orders: sessionOrders,
        items: sessionOrders.flatMap((o) => o.items || []),
      };

      bills.unshift(liveBill);
      setLocalDemoData("spicy_demo_bills", bills);

      // Update table to PAYMENT_PENDING
      tables = tables.map((t) => (t.table_number === tableNumber ? { ...t, status: "PAYMENT_PENDING" } : t));
      setLocalDemoData("spicy_demo_tables", tables);

      dispatchClientEvent("BILL_GENERATED", liveBill);
      return { bill: liveBill, session_id: sessionId };
    }
  }

  // 5. PAYMENTS
  if (endpoint.startsWith("/payments")) {
    if (endpoint.includes("create")) {
      const txn = `TXN-${Date.now().toString().slice(-8)}`;
      return {
        message: "Payment initialized",
        payment: { id: Date.now(), transaction_id: txn, status: "PENDING" },
      };
    }

    if (endpoint.includes("verify") || endpoint.includes("cash-confirm")) {
      let bills = getLocalDemoData("spicy_demo_bills", []);
      const billId = body.bill_id;
      const isCash = endpoint.includes("cash-confirm");

      bills = bills.map((b) => (b.id === billId || !billId ? { ...b, status: "PAID", payment_method: isCash ? "CASH" : "ONLINE" } : b));
      setLocalDemoData("spicy_demo_bills", bills);

      const paidBill = bills.find((b) => b.id === billId) || bills[0] || { grand_total: 964.28, bill_number: "INV-2026-PAID" };
      const tableNumber = paidBill.table_number || "T1";

      // Release table back to AVAILABLE
      tables = tables.map((t) => (t.table_number === tableNumber ? { ...t, status: "AVAILABLE", current_order_id: null, current_session_id: null, current_booking_id: null } : t));
      setLocalDemoData("spicy_demo_tables", tables);

      const targetTable = tables.find((t) => t.table_number === tableNumber) || tables[0];

      const receipt = {
        restaurant_name: "Spicy Spoon",
        restaurant_address: "Tiruppur-Palladam road, Tamil Nadu",
        restaurant_phone: "+91 73958 77142",
        bill: paidBill,
        payment: {
          id: Date.now(),
          payment_method: isCash ? "CASH" : "ONLINE",
          transaction_id: body.transaction_id || `PAY-${Date.now().toString().slice(-6)}`,
          amount: paidBill.grand_total,
          status: isCash ? "CASH_PAID" : "SUCCESS",
        },
        table: targetTable,
        items: paidBill.items || [],
      };

      dispatchClientEvent("PAYMENT_COMPLETED", { bill: paidBill, receipt, table: targetTable });
      dispatchClientEvent("TABLE_STATUS_UPDATED", targetTable);

      return {
        message: isCash ? "Cash payment confirmed and table released." : "Payment verified successfully!",
        receipt,
        bill: paidBill,
        table: targetTable,
        payment: receipt.payment,
      };
    }
  }

  // 6. GUEST SESSIONS
  if (endpoint.startsWith("/sessions/")) {
    const sessionId = endpoint.split("/sessions/")[1];
    const allOrders = getLocalDemoData("spicy_demo_orders", INITIAL_DEMO_ORDERS);
    const sessionOrders = allOrders.filter((o) => o.session_id === sessionId);
    const subtotal = sessionOrders.reduce((sum, o) => sum + (o.subtotal || 0), 0);
    const tax = Math.round(subtotal * 0.05 * 100) / 100;
    const service = Math.round(subtotal * 0.025 * 100) / 100;

    return {
      session: { session_id: sessionId, table_number: sessionOrders[0]?.table_number || "T1", status: "ACTIVE" },
      orders: sessionOrders,
      bill: {
        id: Date.now(),
        bill_number: `INV-2026-${sessionId.slice(-5)}`,
        session_id: sessionId,
        table_number: sessionOrders[0]?.table_number || "T1",
        subtotal,
        tax_amount: tax,
        service_charge: service,
        grand_total: Math.round((subtotal + tax + service) * 100) / 100,
        status: "UNPAID",
      },
      summary: { totalRounds: sessionOrders.length, totalAmount: subtotal },
    };
  }

  // 7. MENU
  if (endpoint.startsWith("/menu")) {
    let menu = getLocalDemoData("spicy_demo_menu", fallbackMenu);
    if (method === "GET") return menu;

    if (method === "POST") {
      const newDish = { id: Date.now(), ...body, is_available: 1 };
      menu.push(newDish);
      setLocalDemoData("spicy_demo_menu", menu);
      dispatchClientEvent("MENU_UPDATED", newDish);
      return { message: "Menu item added", item: newDish };
    }

    if (method === "PUT") {
      const match = endpoint.match(/\/menu\/(\d+)/);
      const itemId = match ? parseInt(match[1], 10) : 0;
      menu = menu.map((m) => (m.id === itemId ? { ...m, ...body } : m));
      setLocalDemoData("spicy_demo_menu", menu);
      dispatchClientEvent("MENU_UPDATED", { id: itemId });
      return { message: "Menu item updated" };
    }
  }

  // 8. REPORTS & ANALYTICS
  if (endpoint.startsWith("/reports/analytics")) {
    const orders = getLocalDemoData("spicy_demo_orders", INITIAL_DEMO_ORDERS);
    const bookings = getLocalDemoData("spicy_demo_bookings", INITIAL_DEMO_BOOKINGS);
    const totalRev = orders.reduce((sum, o) => sum + (o.total || o.subtotal || 0), 0);
    const today = new Date().toISOString().split("T")[0];
    const todayBookings = bookings.filter((b) => b.booking_date === today).length;
    const activeOrdersCount = orders.filter((o) => ["ORDER_PLACED", "ACCEPTED", "PREPARING", "READY"].includes(o.status)).length;

    return {
      summary: {
        totalRevenue: Math.round(totalRev * 100) / 100,
        todayRevenue: Math.round(totalRev * 0.45 * 100) / 100,
        totalOrders: orders.length,
        activeOrders: activeOrdersCount,
        totalBookings: bookings.length,
        todayBookings: todayBookings || 2,
      },
      revenueByMethod: [
        { payment_method: "UPI", transaction_count: Math.max(1, Math.floor(orders.length * 0.6)), total_amount: Math.round(totalRev * 0.6) },
        { payment_method: "CARD", transaction_count: Math.max(1, Math.floor(orders.length * 0.3)), total_amount: Math.round(totalRev * 0.3) },
        { payment_method: "CASH", transaction_count: Math.max(1, Math.floor(orders.length * 0.1)), total_amount: Math.round(totalRev * 0.1) },
      ],
      topItems: [
        { name: "Butter Chicken", total_quantity: 28, total_sales: 11144 },
        { name: "Tandoori Chicken", total_quantity: 24, total_sales: 8376 },
        { name: "Chicken Biryani", total_quantity: 21, total_sales: 7329 },
        { name: "Paneer Tikka", total_quantity: 18, total_sales: 5922 },
      ],
    };
  }

  // 9. STAFF AUTH & LIST
  if (endpoint.startsWith("/auth/login") && method === "POST") {
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
    return {
      token: `staff_token_${Date.now()}`,
      user: { id: Date.now(), name: body.username, username: body.username, role: "KITCHEN", status: "ACTIVE" },
    };
  }

  if (endpoint.startsWith("/auth/staff-list")) {
    return [
      { id: 1, name: "General Manager", username: "admin", role: "ADMIN", status: "ACTIVE" },
      { id: 2, name: "Executive Chef", username: "kitchen", role: "KITCHEN", status: "ACTIVE" },
    ];
  }

  if (endpoint.startsWith("/auth/staff") && method === "POST") {
    return { message: "Staff created successfully" };
  }

  // 10. QR CODES & STAND GENERATOR
  if (endpoint.includes("/qr/table/") || (endpoint.startsWith("/tables/") && endpoint.includes("/qr"))) {
    const match = endpoint.match(/\/table\/([A-Za-z0-9]+)/i) || endpoint.match(/\/tables\/([A-Za-z0-9]+)\/qr/i);
    const tableIdentifier = match ? match[1] : "1";
    const cleanNum = String(tableIdentifier).replace(/^Table\s*/i, "").trim();

    const targetTable = tables.find((t) =>
      t.id === Number(cleanNum) ||
      t.table_number.toLowerCase() === cleanNum.toLowerCase() ||
      t.table_number.toLowerCase() === `t${cleanNum.replace(/^T/i, "").toLowerCase()}`
    ) || tables[0];

    const targetUrl = `${window.location.origin}/#/restaurant/spicy-spoon/table/${targetTable.table_number}`;
    const qrCodeDataUrl = await generateQrDataUrl(targetUrl);

    return {
      table: targetTable,
      targetUrl,
      qrCodeDataUrl,
    };
  }

  if (endpoint.includes("/restaurants/") && endpoint.includes("/qr")) {
    const targetUrl = `${window.location.origin}/#/restaurant/spicy-spoon`;
    const qrCodeDataUrl = await generateQrDataUrl(targetUrl);
    return {
      name: "Spicy Spoon",
      slug: "spicy-spoon",
      targetUrl,
      qrCodeDataUrl,
    };
  }

  // 11. RESTAURANT PROFILE & SETTINGS
  if (endpoint.includes("/restaurants/")) {
    const targetUrl = `${window.location.origin}/#/restaurant/spicy-spoon`;
    const qrCodeDataUrl = await generateQrDataUrl(targetUrl);
    return {
      name: "Spicy Spoon",
      slug: "spicy-spoon",
      tagline: "Authentic Flavours. Smoked Tandoori. Warm Hospitality.",
      address: "Tiruppur-Palladam road, Tamil Nadu",
      phone: "+91 73958 77142",
      tax_rate: 5.0,
      service_charge_rate: 2.5,
      targetUrl,
      qrCodeDataUrl,
    };
  }

  if (endpoint.startsWith("/settings")) {
    let settings = getLocalDemoData("spicy_demo_settings", {
      name: "Spicy Spoon",
      slug: "spicy-spoon",
      cuisine: "Contemporary Indian & Tandoori",
      tax_rate: 5.0,
      service_charge_rate: 2.5,
      address: "Tiruppur-Palladam road, Tamil Nadu",
      phone: "+91 73958 77142",
    });

    if (method === "PUT") {
      settings = { ...settings, ...body };
      setLocalDemoData("spicy_demo_settings", settings);
      dispatchClientEvent("SETTINGS_UPDATED", settings);
      return { message: "Restaurant settings updated successfully", settings };
    }

    return settings;
  }

  return { message: "Success" };
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
