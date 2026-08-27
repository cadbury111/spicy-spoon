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

          // Sync shared state data into local storage from peer devices
          if (payload.tables && Array.isArray(payload.tables)) {
            localStorage.setItem("spicy_demo_tables", JSON.stringify(payload.tables));
          }
          if (payload.bookings && Array.isArray(payload.bookings)) {
            localStorage.setItem("spicy_demo_bookings", JSON.stringify(payload.bookings));
          }
          if (payload.orders && Array.isArray(payload.orders)) {
            localStorage.setItem("spicy_demo_orders", JSON.stringify(payload.orders));
          }
          if (payload.bills && Array.isArray(payload.bills)) {
            localStorage.setItem("spicy_demo_bills", JSON.stringify(payload.bills));
          }

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

function initGlobalSync() {
  if (isInitialized || typeof window === "undefined") return;
  isInitialized = true;

  connectGlobalWs();
  connectGlobalSse();

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
    if (document.visibilityState === "visible" && now - lastSyncTimestamp > 4000) {
      lastSyncTimestamp = now;
      notifyListeners({ type: "SYNC_STATUS", timestamp: now });
    }
  };

  const handleOnline = () => {
    connectGlobalWs();
    connectGlobalSse();
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
