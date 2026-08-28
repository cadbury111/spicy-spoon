import { useEffect, useRef, useState, useCallback } from "react";
import { getWsUrl, getDeviceId } from "../api";

const CLOUD_SYNC_TOPIC = "spicy_spoon_cloud_sync_prod_v2";

// Global Shared Singleton State
const listeners = new Set();
let globalWs = null;
let globalSse = null;
let globalWsReconnectTimer = null;
let globalSseReconnectTimer = null;
let isInitialized = false;
let globalIsConnected = true;
let lastSyncTimestamp = 0;

function notifyListeners(payload) {
  if (!payload) return;
  listeners.forEach((listener) => {
    try {
      listener(payload);
    } catch (e) {
      console.warn("WebSocket listener error:", e);
    }
  });
}

function connectGlobalWs() {
  const wsUrl = getWsUrl();
  if (!wsUrl || typeof window === "undefined") return;

  if (globalWs && (globalWs.readyState === WebSocket.OPEN || globalWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    globalWs = new WebSocket(wsUrl);

    globalWs.onopen = () => {
      globalIsConnected = true;
      notifyListeners({ type: "WS_RECONNECTED", timestamp: Date.now() });
    };

    globalWs.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        notifyListeners(payload);
      } catch (e) {}
    };

    globalWs.onclose = () => {
      globalIsConnected = false;
      if (globalWsReconnectTimer) clearTimeout(globalWsReconnectTimer);
      globalWsReconnectTimer = setTimeout(connectGlobalWs, 2000);
    };

    globalWs.onerror = () => {
      try {
        globalWs.close();
      } catch (e) {}
    };
  } catch (err) {
    globalWsReconnectTimer = setTimeout(connectGlobalWs, 3000);
  }
}

function mergeIncomingPayloadIntoLocalStorage(payload) {
  if (!payload) return false;
  let updated = false;

  // 1. Single order object in payload.data (NEW_ORDER or ORDER_STATUS_UPDATED)
  if (
    (payload.type === "NEW_ORDER" || payload.type === "ORDER_STATUS_UPDATED") &&
    payload.data
  ) {
    const singleOrder = payload.data.order || payload.data;
    if (singleOrder && (singleOrder.id || singleOrder.order_number)) {
      const existingOrders = JSON.parse(localStorage.getItem("spicy_demo_orders") || "[]");
      const key = String(singleOrder.id || singleOrder.order_number);
      const filtered = existingOrders.filter((o) => String(o.id || o.order_number) !== key);
      const merged = [singleOrder, ...filtered];
      localStorage.setItem("spicy_demo_orders", JSON.stringify(merged));
      updated = true;
    }
  }

  // 2. Full orders array in payload.orders
  if (payload.orders && Array.isArray(payload.orders) && payload.orders.length > 0) {
    const existingOrders = JSON.parse(localStorage.getItem("spicy_demo_orders") || "[]");
    const map = new Map();
    existingOrders.forEach((o) => map.set(String(o.id || o.order_number), o));
    payload.orders.forEach((o) => map.set(String(o.id || o.order_number), o));
    const merged = Array.from(map.values()).sort((a, b) => (b.id || 0) - (a.id || 0));
    localStorage.setItem("spicy_demo_orders", JSON.stringify(merged));
    updated = true;
  }

  // 3. Single table object or full tables array
  if (payload.tables && Array.isArray(payload.tables) && payload.tables.length > 0) {
    localStorage.setItem("spicy_demo_tables", JSON.stringify(payload.tables));
    updated = true;
  } else if (payload.type === "TABLE_STATUS_UPDATED" && payload.data) {
    const tableObj = payload.data.table || payload.data;
    if (tableObj && (tableObj.id || tableObj.table_number)) {
      const existingTables = JSON.parse(localStorage.getItem("spicy_demo_tables") || "[]");
      const mergedTables = existingTables.map((t) => (t.id === tableObj.id || t.table_number === tableObj.table_number ? { ...t, ...tableObj } : t));
      localStorage.setItem("spicy_demo_tables", JSON.stringify(mergedTables));
      updated = true;
    }
  }

  // 4. Bookings
  if (payload.bookings && Array.isArray(payload.bookings) && payload.bookings.length > 0) {
    localStorage.setItem("spicy_demo_bookings", JSON.stringify(payload.bookings));
    updated = true;
  } else if ((payload.type === "NEW_BOOKING" || payload.type === "TABLE_BOOKED") && payload.data) {
    const bookingData = payload.data.booking || payload.data;
    const bId = bookingData.id || bookingData.bookingId;
    if (bId) {
      const existingBookings = JSON.parse(localStorage.getItem("spicy_demo_bookings") || "[]");
      const filtered = existingBookings.filter((b) => b.id !== bId);
      const normalizedBooking = {
        id: bId,
        booking_number: bookingData.booking_number || bookingData.bookingNumber || `BK-${bId}`,
        table_id: bookingData.table_id || bookingData.tableId,
        table_number: bookingData.table_number || bookingData.tableNumber,
        section: bookingData.section || "",
        booking_date: bookingData.booking_date || bookingData.bookingDate,
        start_time: bookingData.start_time || bookingData.bookingTime,
        end_time: bookingData.end_time || bookingData.endTime || "09:00 PM",
        guest_count: bookingData.guest_count || bookingData.guestCount || 2,
        customer_name: bookingData.customer_name || bookingData.customerName || "Guest Diner",
        status: bookingData.status || bookingData.bookingStatus || "CONFIRMED",
        special_notes: bookingData.special_notes || "",
        created_at: bookingData.created_at || new Date().toISOString(),
      };
      localStorage.setItem("spicy_demo_bookings", JSON.stringify([normalizedBooking, ...filtered]));
      updated = true;
    }
  }

  // 5. Bills
  if (payload.bills && Array.isArray(payload.bills) && payload.bills.length > 0) {
    localStorage.setItem("spicy_demo_bills", JSON.stringify(payload.bills));
    updated = true;
  }

  return updated;
}

function connectGlobalSse() {
  if (typeof window === "undefined" || typeof EventSource === "undefined") return;

  if (globalSse && globalSse.readyState !== EventSource.CLOSED) {
    return;
  }

  try {
    globalSse = new EventSource(`https://ntfy.sh/${CLOUD_SYNC_TOPIC}/sse`);

    globalSse.onopen = () => {
      globalIsConnected = true;
    };

    globalSse.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data);
        if (raw.event === "message" && raw.message) {
          const payload = JSON.parse(raw.message);
          const myDeviceId = getDeviceId();

          // Ignore own echo to avoid double processing
          if (payload.senderDeviceId && payload.senderDeviceId === myDeviceId) {
            return;
          }

          mergeIncomingPayloadIntoLocalStorage(payload);
          notifyListeners(payload);
        }
      } catch (err) {}
    };

    globalSse.onerror = () => {
      try {
        globalSse.close();
      } catch (e) {}
      if (globalSseReconnectTimer) clearTimeout(globalSseReconnectTimer);
      globalSseReconnectTimer = setTimeout(connectGlobalSse, 6000);
    };
  } catch (err) {
    globalSseReconnectTimer = setTimeout(connectGlobalSse, 6000);
  }
}

async function pollHistoricalCloudEvents() {
  if (typeof window === "undefined") return;
  try {
    const res = await fetch(`https://ntfy.sh/${CLOUD_SYNC_TOPIC}/json?poll=1`).catch(() => null);
    if (!res || !res.ok) return;
    const text = await res.text();
    const lines = text.split("\n").filter((l) => l.trim());

    let hasChanges = false;
    let lastEvent = null;

    for (const line of lines) {
      try {
        const raw = JSON.parse(line);
        if (raw.event === "message" && raw.message) {
          const payload = JSON.parse(raw.message);
          if (payload.type) lastEvent = payload;
          const updated = mergeIncomingPayloadIntoLocalStorage(payload);
          if (updated) hasChanges = true;
        }
      } catch (e) {}
    }

    if (hasChanges) {
      notifyListeners(lastEvent || { type: "NEW_ORDER", timestamp: Date.now() });
    }
  } catch (err) {}
}

function initGlobalSync() {
  if (isInitialized || typeof window === "undefined") return;
  isInitialized = true;

  connectGlobalWs();
  connectGlobalSse();
  pollHistoricalCloudEvents();

  const handleClientEvent = (e) => {
    if (e?.detail) {
      notifyListeners(e.detail);
    }
  };

  const handleStorageEvent = (e) => {
    if (e.key === "spicy_last_event" && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        if (parsed) {
          notifyListeners(parsed);
        }
      } catch (err) {}
    }
  };

  const handleVisibilityOrFocus = () => {
    const now = Date.now();
    pollHistoricalCloudEvents();
    if (document.visibilityState === "visible" && now - lastSyncTimestamp > 4000) {
      lastSyncTimestamp = now;
      notifyListeners({ type: "SYNC_STATUS", timestamp: now });
    }
  };

  const handleOnline = () => {
    connectGlobalWs();
    connectGlobalSse();
    pollHistoricalCloudEvents();
    const now = Date.now();
    if (now - lastSyncTimestamp > 4000) {
      lastSyncTimestamp = now;
      notifyListeners({ type: "SYNC_STATUS", timestamp: now });
    }
  };

  window.addEventListener("spicy_ws_event", handleClientEvent);
  window.addEventListener("storage", handleStorageEvent);
  window.addEventListener("visibilitychange", handleVisibilityOrFocus);
  window.addEventListener("focus", handleVisibilityOrFocus);
  window.addEventListener("online", handleOnline);
}

export function useWebSocket(onEvent) {
  const [isConnected] = useState(() => globalIsConnected);
  const [lastMessage, setLastMessage] = useState(null);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    pollHistoricalCloudEvents();
  }, []);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    initGlobalSync();

    const listener = (payload) => {
      setLastMessage(payload);
      if (onEventRef.current) {
        onEventRef.current(payload);
      }
    };

    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const sendMessage = useCallback((type, data = {}) => {
    if (globalWs && globalWs.readyState === WebSocket.OPEN) {
      globalWs.send(JSON.stringify({ type, ...data }));
    }
  }, []);

  return { isConnected, lastMessage, sendMessage };
}
