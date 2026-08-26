import { useEffect, useRef, useState, useCallback } from "react";
import { getWsUrl } from "../api";

export function useWebSocket(onEvent) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const connect = useCallback(() => {
    try {
      const url = getWsUrl();
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        console.log("⚡ Connected to Spicy Spoon Live WebSocket");
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          setLastMessage(payload);
          if (onEventRef.current) {
            onEventRef.current(payload);
          }
        } catch (e) {
          // Non-JSON message
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        // Attempt reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      };

      ws.onerror = (err) => {
        console.warn("WebSocket connection warning:", err);
        ws.close();
      };
    } catch (err) {
      console.warn("WebSocket init error:", err);
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 5000);
    }
  }, []);

  useEffect(() => {
    connect();

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
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const sendMessage = useCallback((type, data = {}) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, ...data }));
    }
  }, []);

  return { isConnected, lastMessage, sendMessage };
}
