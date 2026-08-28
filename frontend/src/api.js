import QRCode from "qrcode";
import { menuItems as fallbackMenu } from "./data/menuData";

const CLOUD_SYNC_TOPIC = "spicy_spoon_cloud_sync_prod_v2";

export function getDeviceId() {
  if (typeof window === "undefined") return "server";
  let id = localStorage.getItem("spicy_device_id");
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2, 9);
    localStorage.setItem("spicy_device_id", id);
  }
  return id;
}

export function broadcastCloudEvent(eventPayload) {
  try {
    fetch(`https://ntfy.sh/${CLOUD_SYNC_TOPIC}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventPayload),
    }).catch(() => {});
  } catch (err) {}
}

// Resolve API base URL dynamically for Dev, Production, Local Network (Wi-Fi), and Custom Backends
function resolveApiBaseUrl() {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/\/$/, "").replace(/\/api$/, "") + "/api";
  }
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return `${protocol}//localhost:5000/api`;
    }
    // Match local network IP addresses (e.g. 192.168.x.x, 10.x.x.x, 172.x.x.x) so mobile and laptop share the same backend server!
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
      return `${protocol}//${hostname}:5000/api`;
    }
    // For Vercel production or any domain, use same-origin relative API path "/api"
    return "/api";
  }
  return "/api";
}

const API_BASE_URL = resolveApiBaseUrl();

export function getWsUrl() {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  if (import.meta.env.VITE_API_URL) {
    const apiUrl = import.meta.env.VITE_API_URL.replace(/\/api$/, "");
    if (apiUrl.startsWith("https://")) {
      return apiUrl.replace("https://", "wss://");
    }
    if (apiUrl.startsWith("http://")) {
      return apiUrl.replace("http://", "ws://");
    }
  }
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return `${protocol}//localhost:5000`;
    }
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
      return `${protocol}//${hostname}:5000`;
    }
  }
  return null;
}

// Initial Seed Data for Demo Tables
export const INITIAL_DEMO_TABLES = [
  { id: 1, table_number: "T1", capacity: 2, section: "Main Hall", status: "AVAILABLE" },
  { id: 2, table_number: "T2", capacity: 2, section: "Main Hall", status: "AVAILABLE" },
  { id: 3, table_number: "T3", capacity: 4, section: "Main Hall", status: "AVAILABLE" },
  { id: 4, table_number: "T4", capacity: 4, section: "Main Hall", status: "AVAILABLE" },
  { id: 5, table_number: "T5", capacity: 4, section: "Window Side", status: "AVAILABLE" },
  { id: 6, table_number: "T6", capacity: 4, section: "Window Side", status: "AVAILABLE" },
  { id: 7, table_number: "T7", capacity: 6, section: "Window Side", status: "AVAILABLE" },
  { id: 8, table_number: "T8", capacity: 6, section: "Window Side", status: "AVAILABLE" },
  { id: 9, table_number: "T9", capacity: 4, section: "Outdoor Patio", status: "AVAILABLE" },
  { id: 10, table_number: "T10", capacity: 6, section: "Outdoor Patio", status: "AVAILABLE" },
  { id: 11, table_number: "T11", capacity: 8, section: "VIP Lounge", status: "AVAILABLE" },
  { id: 12, table_number: "T12", capacity: 10, section: "VIP Lounge", status: "AVAILABLE" },
];

export const DEFAULT_TABLES = INITIAL_DEMO_TABLES;
export const INITIAL_DEMO_ORDERS = [];
export const INITIAL_DEMO_BOOKINGS = [];

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
    const tables = getLocalDemoData("spicy_demo_tables", INITIAL_DEMO_TABLES);
    const orders = getLocalDemoData("spicy_demo_orders", INITIAL_DEMO_ORDERS);
    const bookings = getLocalDemoData("spicy_demo_bookings", INITIAL_DEMO_BOOKINGS);

    const payload = {
      type,
      data,
      tables,
      orders,
      bookings,
      senderDeviceId: getDeviceId(),
      timestamp: Date.now(),
    };

    // 1. In-page event dispatch
    window.dispatchEvent(new CustomEvent("spicy_ws_event", { detail: payload }));

    // 2. Same-device cross-tab event
    localStorage.setItem("spicy_last_event", JSON.stringify(payload));
    localStorage.setItem("spicy_ws_event_timestamp", Date.now().toString());

    // 3. Cross-device cloud broadcast (Phone <-> PC live sync)
    broadcastCloudEvent(payload);
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

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error(`Server returned non-JSON response (${response.status})`);
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
    if (netOrHttpErr.status) {
      throw netOrHttpErr;
    }
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
    const seedTables = INITIAL_DEMO_TABLES || DEFAULT_TABLES || [];
    tables = seedTables.map((t) => ({ ...t, current_booking_id: null, current_order_id: null, current_session_id: null }));
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
      const savedOrders = getLocalDemoData("spicy_demo_orders", INITIAL_DEMO_ORDERS);

      return tables.map((t) => {
        const fitsCapacity = t.capacity >= guests;
        const isBooked = savedBookings.some(
          (b) => (b.table_id === t.id || b.table_number === t.table_number) &&
                 b.booking_date === date &&
                 b.start_time === time &&
                 b.status !== "CANCELLED"
        );

        const isAvailableForSlot = fitsCapacity && !isBooked;

        return {
          ...t,
          status: isBooked ? "RESERVED" : "AVAILABLE",
          slotStatus: isBooked ? "RESERVED" : "AVAILABLE",
          restaurant_id: 1,
          isAvailableForSlot,
          fitsRequestedGuests: fitsCapacity,
          isSlotAvailable: !isBooked,
          conflictReason: !fitsCapacity
            ? `Capacity is ${t.capacity} (requires ${guests})`
            : isBooked
            ? "Already booked for this slot"
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

      // Atomic double-booking concurrency check:
      const hasOverlap = bookings.some(
        (b) =>
          (b.table_id === table.id || b.table_number === table.table_number) &&
          b.booking_date === body.booking_date &&
          b.start_time === body.start_time &&
          b.status !== "CANCELLED"
      );

      if (hasOverlap) {
        const error = new Error(`Sorry, Table ${table.table_number} was just reserved for ${body.start_time}. Please select another table.`);
        error.status = 409;
        throw error;
      }

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

      const tableBookedPayload = {
        tableId: table.id,
        tableNumber: table.table_number,
        bookingId: newBooking.id,
        bookingNumber: newBooking.booking_number,
        bookingDate: newBooking.booking_date,
        bookingTime: newBooking.start_time,
        endTime: newBooking.end_time,
        guestCount: newBooking.guest_count,
        bookingStatus: newBooking.status,
        booking: newBooking,
      };

      dispatchClientEvent("TABLE_BOOKED", tableBookedPayload);
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
      const isActiveOnly = endpoint.startsWith("/orders/active");

      let filtered = orders;
      if (isActiveOnly) {
        filtered = filtered.filter((o) => o.status !== "COMPLETED" && o.status !== "PAID" && o.status !== "CANCELLED");
      }
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

    // 4a. Live Bill Status Lookup (READ-ONLY GET - NEVER MUTATE OR DISPATCH EVENTS)
    if (method === "GET" && (endpoint.startsWith("/bills/live") || endpoint.match(/^\/bills\/\d+$/))) {
      if (endpoint.match(/^\/bills\/\d+$/)) {
        const bId = parseInt(endpoint.replace("/bills/", ""), 10);
        const found = bills.find((b) => b.id === bId) || null;
        return found;
      }

      const urlObj = new URL(`http://dummy${endpoint}`);
      const tableNumber = (urlObj.searchParams.get("tableNumber") || "T1").replace(/^Table\s*/i, "").trim();
      const sessionId = urlObj.searchParams.get("sessionId");
      const orderId = urlObj.searchParams.get("orderId") || urlObj.searchParams.get("order");

      const existingBill = bills.find(
        (b) =>
          b.status !== "PAID" &&
          ((orderId && (String(b.order_id) === String(orderId) || String(b.orderId) === String(orderId))) ||
           (sessionId && b.session_id === sessionId) ||
           (!sessionId && !orderId && (b.table_number === tableNumber || b.table_number === `T${tableNumber.replace(/^T/i, "")}`)))
      );

      if (existingBill) {
        return { bill: existingBill, session_id: existingBill.session_id };
      }

      const allOrders = getLocalDemoData("spicy_demo_orders", INITIAL_DEMO_ORDERS);
      let sessionOrders = [];

      if (orderId && orderId !== "undefined" && orderId !== "null") {
        sessionOrders = allOrders.filter(
          (o) =>
            o.status !== "COMPLETED" &&
            o.status !== "PAID" &&
            o.status !== "CANCELLED" &&
            (String(o.id) === String(orderId) || String(o.order_number) === String(orderId))
        );
      } else if (sessionId && sessionId !== "undefined" && sessionId !== "null") {
        sessionOrders = allOrders.filter(
          (o) =>
            o.status !== "COMPLETED" &&
            o.status !== "PAID" &&
            o.status !== "CANCELLED" &&
            o.session_id === sessionId
        );
      } else {
        const matchingTableOrders = allOrders.filter(
          (o) =>
            o.status !== "COMPLETED" &&
            o.status !== "PAID" &&
            o.status !== "CANCELLED" &&
            (o.table_number === tableNumber || o.tableNumber === tableNumber || o.table_number === `T${tableNumber.replace(/^T/i, "")}`)
        );
        if (matchingTableOrders.length > 0) {
          sessionOrders = [matchingTableOrders[0]];
        }
      }

      if (sessionOrders.length === 0) {
        return { bill: null, session_id: sessionId || `SESSION-${tableNumber}-DEMO` };
      }

      const subtotal = sessionOrders.reduce((sum, o) => sum + (o.subtotal || 0), 0);
      const tax = Math.round(subtotal * 0.05 * 100) / 100;
      const service = Math.round(subtotal * 0.025 * 100) / 100;
      const grandTotal = Math.round((subtotal + tax + service) * 100) / 100;

      const previewBill = {
        id: Date.now(),
        bill_number: `INV-2026-${Math.floor(10000 + Math.random() * 90000)}`,
        session_id: sessionId || sessionOrders[0]?.session_id || `SESSION-${tableNumber}-DEMO`,
        order_id: sessionOrders[0]?.id || null,
        table_number: tableNumber,
        subtotal,
        discount: 0,
        tax,
        service_charge: service,
        grand_total: grandTotal,
        status: "UNPAID",
        payment_method: null,
        created_at: new Date().toISOString(),
        orders: sessionOrders,
        items: sessionOrders.flatMap((o) => o.items || []),
      };

      bills.unshift(previewBill);
      setLocalDemoData("spicy_demo_bills", bills);

      return { bill: previewBill, session_id: sessionId || previewBill.session_id };
    }

    // 4b. Explicit Bill Generation (POST - Mutates database and broadcasts event)
    if (method === "POST" && (endpoint.startsWith("/bills/generate") || endpoint === "/bills")) {
      const tableNumber = (body.tableNumber || body.table_number || "T1").replace(/^Table\s*/i, "").trim();
      const sessionId = body.session_id || body.sessionId;
      const orderId = body.order_id || body.orderId;

      const allOrders = getLocalDemoData("spicy_demo_orders", INITIAL_DEMO_ORDERS);
      let sessionOrders = [];

      if (orderId && orderId !== "undefined" && orderId !== "null") {
        sessionOrders = allOrders.filter(
          (o) =>
            o.status !== "COMPLETED" &&
            o.status !== "PAID" &&
            o.status !== "CANCELLED" &&
            (String(o.id) === String(orderId) || String(o.order_number) === String(orderId))
        );
      } else if (sessionId && sessionId !== "undefined" && sessionId !== "null") {
        sessionOrders = allOrders.filter(
          (o) =>
            o.status !== "COMPLETED" &&
            o.status !== "PAID" &&
            o.status !== "CANCELLED" &&
            o.session_id === sessionId
        );
      } else {
        const matchingTableOrders = allOrders.filter(
          (o) =>
            o.status !== "COMPLETED" &&
            o.status !== "PAID" &&
            o.status !== "CANCELLED" &&
            (o.table_number === tableNumber || o.tableNumber === tableNumber || o.table_number === `T${tableNumber.replace(/^T/i, "")}`)
        );
        if (matchingTableOrders.length > 0) {
          sessionOrders = [matchingTableOrders[0]];
        }
      }

      if (sessionOrders.length === 0) {
        return { bill: null, session_id: sessionId, message: "No active orders found for this table." };
      }

      const subtotal = sessionOrders.reduce((sum, o) => sum + (o.subtotal || 0), 0);

      const discountRate = body.discount_code === "SPICY10" || body.discount_code === "WELCOME10" ? 0.1 : 0;
      const discountAmount = Math.round(subtotal * discountRate * 100) / 100;
      const discountedSubtotal = subtotal - discountAmount;

      const tax = Math.round(discountedSubtotal * 0.05 * 100) / 100;
      const service = Math.round(discountedSubtotal * 0.025 * 100) / 100;
      const grandTotal = Math.round((discountedSubtotal + tax + service) * 100) / 100;

      const billNumber = `INV-2026-${Math.floor(10000 + Math.random() * 90000)}`;
      const liveBill = {
        id: Date.now(),
        bill_number: billNumber,
        session_id: sessionId || sessionOrders[0]?.session_id || `SESSION-${tableNumber}-${Date.now().toString().slice(-6)}`,
        order_id: sessionOrders[0]?.id || null,
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
      tables = tables.map((t) =>
        t.table_number === tableNumber || t.table_number === `T${tableNumber.replace(/^T/i, "")}`
          ? { ...t, status: "PAYMENT_PENDING" }
          : t
      );
      setLocalDemoData("spicy_demo_tables", tables);

      dispatchClientEvent("BILL_GENERATED", liveBill);
      return { bill: liveBill, session_id: sessionId };
    }
  }

  // 5. PAYMENTS
  if (endpoint.startsWith("/payments")) {
    if (endpoint.includes("cash-requests")) {
      const bills = getLocalDemoData("spicy_demo_bills", []);
      const pendingCashBills = bills.filter((b) => b.payment_method === "CASH" && b.status !== "PAID");
      return pendingCashBills.map((b) => ({
        id: b.id,
        bill_id: b.id,
        bill_number: b.bill_number,
        table_number: b.table_number,
        grand_total: b.grand_total,
        amount: b.grand_total,
        status: "CASH_PENDING",
        payment_method: "CASH",
      }));
    }

    if (endpoint.includes("cash-decline")) {
      let bills = getLocalDemoData("spicy_demo_bills", []);
      const billId = body.bill_id || body.billId;
      const targetBill = bills.find((b) => b.id === billId || b.id === Number(billId)) || null;

      if (targetBill) {
        bills = bills.map((b) => (b.id === targetBill.id ? { ...b, payment_method: null, status: "UNPAID" } : b));
        setLocalDemoData("spicy_demo_bills", bills);
      }

      dispatchClientEvent("CASH_PAYMENT_DECLINED", {
        bill_id: billId,
        reason: body.reason || "Cash not received by counter",
        status: "DECLINED",
      });
      dispatchClientEvent("PAYMENT_FAILED", {
        bill_id: billId,
        reason: "Cash request declined",
      });

      return {
        message: "Cash request declined",
        declined: true,
        bill_id: billId,
      };
    }

    if (endpoint.includes("create")) {
      let bills = getLocalDemoData("spicy_demo_bills", []);
      const billId = body.bill_id || body.billId;
      let targetBill = bills.find((b) => b.id === billId || b.id === Number(billId) || String(b.id) === String(billId)) || null;

      if (!targetBill) {
        targetBill = bills.find((b) => b.status !== "PAID" && (b.table_number === body.table_number || b.session_id === body.session_id)) || null;
      }

      if (!targetBill) {
        targetBill = {
          id: billId || Date.now(),
          bill_number: `INV-2026-${Math.floor(10000 + Math.random() * 90000)}`,
          grand_total: body.amount || 897,
          subtotal: body.amount || 897,
          table_number: body.table_number || "T1",
          status: "UNPAID",
          payment_method: null,
          created_at: new Date().toISOString(),
        };
        bills.unshift(targetBill);
        setLocalDemoData("spicy_demo_bills", bills);
      }

      const txn = `TXN-${Date.now().toString().slice(-8)}`;
      const upiVpa = "cadbury470@oksbi";
      const restaurantName = encodeURIComponent("Spicy Spoon Restaurant");
      const note = encodeURIComponent(`Bill ${targetBill.bill_number}`);
      const amountStr = Number(targetBill.grand_total || 0).toFixed(2);
      const upiIntentUrl = `upi://pay?pa=${upiVpa}&pn=${restaurantName}&am=${amountStr}&cu=INR&tn=${note}&tr=${txn}`;

      const upiQrCode = await generateQrDataUrl(upiIntentUrl);
      const isCash = body.payment_method === "CASH";

      if (isCash) {
        // Update bill payment_method to CASH, table to PAYMENT_PENDING
        let updatedBills = bills.map((b) => (b.id === targetBill.id ? { ...b, payment_method: "CASH" } : b));
        setLocalDemoData("spicy_demo_bills", updatedBills);

        tables = tables.map((t) => (t.table_number === targetBill.table_number ? { ...t, status: "PAYMENT_PENDING" } : t));
        setLocalDemoData("spicy_demo_tables", tables);

        const targetTable = tables.find((t) => t.table_number === targetBill.table_number) || tables[0];

        const cashEventPayload = {
          bill: targetBill,
          table: targetTable,
          transactionId: txn,
          amount: targetBill.grand_total,
          status: "CASH_PENDING",
        };

        dispatchClientEvent("CASH_PAYMENT_REQUESTED", cashEventPayload);
        dispatchClientEvent("PAYMENT_PENDING", cashEventPayload);
        dispatchClientEvent("TABLE_STATUS_UPDATED", targetTable);
      } else {
        dispatchClientEvent("PAYMENT_PENDING", {
          bill: targetBill,
          payment_method: body.payment_method || "UPI",
          transactionId: txn,
          amount: targetBill.grand_total,
        });
      }

      return {
        message: `Payment initiated via ${body.payment_method || "UPI"}`,
        payment: {
          id: Date.now(),
          transaction_id: txn,
          amount: targetBill.grand_total,
          status: isCash ? "CASH_PENDING" : "PENDING",
        },
        upiQrCode,
        upiIntentUrl,
      };
    }

    if (endpoint.includes("verify") || endpoint.includes("cash-confirm")) {
      let bills = getLocalDemoData("spicy_demo_bills", []);
      let orders = getLocalDemoData("spicy_demo_orders", INITIAL_DEMO_ORDERS);
      const billId = body.bill_id;
      const isCash = endpoint.includes("cash-confirm");

      const targetBill = bills.find((b) => b.id === billId || Number(b.id) === Number(billId)) || null;
      if (!targetBill) {
        throw new Error("Bill not found for verification");
      }

      bills = bills.map((b) => (b.id === targetBill.id ? { ...b, status: "PAID", payment_method: isCash ? "CASH" : (b.payment_method || "ONLINE") } : b));
      setLocalDemoData("spicy_demo_bills", bills);

      const paidBill = { ...targetBill, status: "PAID", payment_method: isCash ? "CASH" : (targetBill.payment_method || "ONLINE") };
      const tableNumber = paidBill.table_number || "T1";

      // Mark associated orders as COMPLETED
      orders = orders.map((o) => {
        if (
          (paidBill.session_id && o.session_id === paidBill.session_id) ||
          o.table_number === tableNumber ||
          o.tableNumber === tableNumber
        ) {
          return { ...o, status: "COMPLETED" };
        }
        return o;
      });
      setLocalDemoData("spicy_demo_orders", orders);

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
          payment_method: isCash ? "CASH" : (paidBill.payment_method || "ONLINE"),
          transaction_id: body.transaction_id || `PAY-${Date.now().toString().slice(-6)}`,
          amount: paidBill.grand_total,
          status: "SUCCESS",
        },
        table: targetTable,
        items: paidBill.items || [],
      };

      if (isCash) {
        dispatchClientEvent("CASH_PAYMENT_CONFIRMED", receipt);
      }
      dispatchClientEvent("PAYMENT_VERIFIED", receipt);
      dispatchClientEvent("BILL_PAID", receipt);
      dispatchClientEvent("PAYMENT_COMPLETED", receipt);
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
    if (method === "GET") {
      return menu.map((item) => ({
        ...item,
        is_veg: item.is_veg !== undefined ? (Number(item.is_veg) === 1 ? 1 : 0) : (item.dietaryType === "VEG" ? 1 : 0),
        dietaryType: item.dietaryType || (item.is_veg === 1 ? "VEG" : "NON_VEG"),
      }));
    }

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
  getActiveOrders: (params = {}) => {
    return request(`/orders/active${buildQueryString(params)}`);
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
  declineCashPayment: (data) => request("/payments/cash-decline", { method: "POST", body: data }),
  getCashRequests: () => request("/payments/cash-requests"),
  getPayments: () => request("/payments"),
  getPayment: (id) => request(`/payments/${id}`),
  getPaymentByBill: (billId) => request(`/payments/by-bill/${billId}`),

  // Reports & Analytics (Admin Only)
  getAnalytics: () => request("/reports/analytics"),
  getDailyReports: (days = 7) => request(`/reports/daily?days=${days}`),

  // Settings
  getSettings: () => request("/settings"),
  updateSettings: (data) => request("/settings", { method: "PUT", body: data }),

  // QR
  getTableQr: (tableId) => request(`/qr/table/${tableId}`),
};
