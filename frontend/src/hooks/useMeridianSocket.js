import { useEffect, useRef, useState } from "react";
import { websocketUrl } from "../services/api";

export function useMeridianSocket(userId, onSnapshot) {
  const [status, setStatus] = useState("connecting");
  const callbackRef = useRef(onSnapshot);
  const retryRef = useRef(null);
  callbackRef.current = onSnapshot;

  useEffect(() => {
    let socket;
    let cancelled = false;
    let attempt = 0;

    const connect = () => {
      if (cancelled) return;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      socket = new WebSocket(websocketUrl(userId));

      socket.onopen = () => { attempt = 0; setStatus("connected"); };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "snapshot") callbackRef.current(message);
        } catch { /* ignore malformed server frames */ }
      };
      socket.onerror = () => { if (!cancelled) setStatus("disconnected"); };
      socket.onclose = () => {
        if (cancelled) return;
        setStatus("disconnected");
        attempt += 1;
        const delay = Math.min(1000 * 2 ** Math.min(attempt, 4), 10000);
        retryRef.current = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      cancelled = true;
      clearTimeout(retryRef.current);
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    };
  }, [userId]);

  return status;
}
