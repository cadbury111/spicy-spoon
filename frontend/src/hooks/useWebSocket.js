import { useEffect, useRef, useState, useCallback } from "react";
import { getWsUrl, getDeviceId } from "../api";

const CLOUD_SYNC_TOPIC = "spicy_spoon_cloud_sync_prod_v2";

export function useWebSocket(onEvent) {
  const [isConnected, setIsConnected] = useState(true);
  const [lastMessage, setLastMessage] = useState(null);
  const wsRef = useRef(null);
  const sseRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  // 1. Connect Local WebSocket (for local dev backend)
  const connectLocalWs = useCallback(() => {
    const wsUrl = getWsUrl();
    if (!wsUrl || typeof window === "undefined") return;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          setLastMessage(payload);
          if (onEventRef.current) {
            onEventRef.current(payload);
          }
        } catch (e) {}
      };

      ws.onclose = () => {
        reconnectTimeoutRef.current = setTimeout(connectLocalWs, 4000);
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch (e) {}
      };
    } catch (err) {}
  }, []);

  // 2. Connect Cloud Realtime Stream (for instant Phone <-> PC Cross-Device Sync)
  const connectCloudStream = useCallback(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;

    try {
      const sse = new EventSource(`https://ntfy.sh/${CLOUD_SYNC_TOPIC}/sse`);
      sseRef.current = sse;

      sse.onopen = () => {
        setIsConnected(true);
      };

      sse.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data);
          if (raw.event === "message" && raw.message) {
            const payload = JSON.parse(raw.message);
            const myDeviceId = getDeviceId();

            // Ignore our own echo to avoid double processing
            if (payload.senderDeviceId && payload.senderDeviceId === myDeviceId) {
              return;
            }

            // Sync shared state data into local storage from the other device
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

            // Trigger in-app listeners (Admin, Kitchen, Customer Booking, Menu)
            setLastMessage(payload);
            if (onEventRef.current) {
              onEventRef.current(payload);
            }
          }
        } catch (err) {}
      };

      sse.onerror = () => {
        try {
          sse.close();
        } catch (e) {}
        setTimeout(connectCloudStream, 5000);
      };
    } catch (err) {}
  }, []);

  useEffect(() => {
    connectLocalWs();
    connectCloudStream();

    // Client event listener for standalone/hosted Vercel sync
    const handleClientEvent = (e) => {
      if (e?.detail && onEventRef.current) {
        setLastMessage(e.detail);
        onEventRef.current(e.detail);
      }
    };

    const handleStorageEvent = (e) => {
      if (e.key === "spicy_last_event" && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed && onEventRef.current) {
            setLastMessage(parsed);
            onEventRef.current(parsed);
          }
        } catch (err) {}
      }
    };

    window.addEventListener("spicy_ws_event", handleClientEvent);
    window.addEventListener("storage", handleStorageEvent);

    return () => {
      window.removeEventListener("spicy_ws_event", handleClientEvent);
      window.removeEventListener("storage", handleStorageEvent);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) wsRef.current.close();
      if (sseRef.current) sseRef.current.close();
    };
  }, [connectLocalWs, connectCloudStream]);

  const sendMessage = useCallback((type, data = {}) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, ...data }));
    }
  }, []);

  return { isConnected, lastMessage, sendMessage };
}
