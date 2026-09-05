const configured = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
export const API_BASE = configured;

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  let body = null;
  try { body = await response.json(); } catch { /* empty/non-json response */ }
  if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
  return body;
}

export const api = {
  getUniverse: () => request("/api/universe"),
  getSnapshot: (userId) => request(`/api/snapshot/${encodeURIComponent(userId)}`),
  addSymbol: (userId, symbol) => request(`/api/watchlist/${encodeURIComponent(userId)}`, {
    method: "POST", body: JSON.stringify({ symbol }),
  }),
  removeSymbol: (userId, symbol) => request(`/api/watchlist/${encodeURIComponent(userId)}/${encodeURIComponent(symbol)}`, {
    method: "DELETE",
  }),
  acknowledge: (userId) => request(`/api/acknowledge/${encodeURIComponent(userId)}`, { method: "POST" }),
  reset: (userId) => request(`/api/reset/${encodeURIComponent(userId)}`, { method: "POST" }),
  trade: (userId, symbol, side, quantity) => request(`/api/trade/${encodeURIComponent(userId)}`, { method: "POST", body: JSON.stringify({ symbol, side, quantity }) }),
  getPortfolio: (userId) => request(`/api/portfolio/${encodeURIComponent(userId)}`),
};

export function websocketUrl(userId) {
  if (configured) {
    const u = new URL(configured, window.location.origin);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = "/ws";
    u.search = `?userId=${encodeURIComponent(userId)}`;
    return u.toString();
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws?userId=${encodeURIComponent(userId)}`;
}
