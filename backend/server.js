const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const express = require("express");
const cors = require("cors");
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const { URL } = require("url");
const engine = require("./engine");
const db = require("./db");
const { TwelveDataProvider } = require("./marketProvider");

const app = express();
const allowedOrigin = process.env.FRONTEND_URL || "http://localhost:5173";
app.use(cors({ origin: allowedOrigin === "*" ? true : allowedOrigin }));
app.use(express.json({ limit: "20kb" }));

function validUserId(value) { return typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value); }
function requireUser(req, res, next) {
  if (!validUserId(req.params.userId)) return res.status(400).json({ error: "invalid userId" });
  next();
}
function buildItems(userId) {
  const baselines = db.getBaselines(userId);
  return db.getWatchlist(userId).map((symbol) => {
    const { current, reasons } = engine.diff(symbol, baselines[symbol]);
    const config = engine.UNIVERSE[symbol];
    return {
      symbol,
      name: config.name,
      volatility: config.vol,
      delayed: !!config.delayed,
      price: current.price,
      open: current.open,
      high: current.high,
      low: current.low,
      history: current.history,
      updatedAt: current.updatedAt,
      secondaryPrice: current.secondary.price,
      conflict: current.conflict,
      freshness: engine.freshness(symbol),
      baseline: baselines[symbol] || null,
      reasons,
    };
  });
}
function snapshot(userId) {
  const items = buildItems(userId);
  return { type: "snapshot", items, digestCount: items.filter((item) => item.reasons.length).length, at: Date.now() };
}
function portfolioSnapshot(userId) {
  const portfolio = db.getPortfolio(userId);
  const positions = db.getPositions(userId).map((p) => {
    const market = engine.ensure(p.symbol).price;
    return { ...p, price: market, marketValue: p.quantity * market, pnl: (market - p.avg_price) * p.quantity };
  });
  const marketValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
  const equity = portfolio.cash + marketValue;
  return { ...portfolio, positions, trades: db.getTrades(userId), marketValue, equity, pnl: equity - portfolio.startingCash };
}
function fullSnapshot(userId) { return { ...snapshot(userId), portfolio: portfolioSnapshot(userId), provider: engine.getProviderMode() }; }

app.get("/health", (_req, res) => res.json({ ok: true, service: "meridian-backend" }));
app.get("/api/universe", (_req, res) => res.json({
  instruments: Object.entries(engine.UNIVERSE).map(([symbol, cfg]) => ({ symbol, name: cfg.name, volatility: cfg.vol, delayed: !!cfg.delayed })),
}));
app.get("/api/watchlist/:userId", requireUser, (req, res) => res.json({ symbols: db.getWatchlist(req.params.userId) }));
app.post("/api/watchlist/:userId", requireUser, (req, res) => {
  const symbol = String(req.body?.symbol || "").trim().toUpperCase();
  if (!engine.UNIVERSE[symbol]) return res.status(400).json({ error: "unknown symbol" });
  res.status(201).json({ symbols: db.addSymbol(req.params.userId, symbol) });
});
app.delete("/api/watchlist/:userId/:symbol", requireUser, (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase();
  if (!engine.UNIVERSE[symbol]) return res.status(400).json({ error: "unknown symbol" });
  res.json({ symbols: db.removeSymbol(req.params.userId, symbol) });
});
app.get("/api/snapshot/:userId", requireUser, (req, res) => res.json(fullSnapshot(req.params.userId)));
app.get("/api/portfolio/:userId", requireUser, (req, res) => res.json(portfolioSnapshot(req.params.userId)));
app.post("/api/trade/:userId", requireUser, (req, res) => {
  const symbol = String(req.body?.symbol || "").toUpperCase();
  const side = String(req.body?.side || "").toLowerCase();
  const quantity = Number(req.body?.quantity);
  if (!engine.UNIVERSE[symbol]) return res.status(400).json({ error: "unknown symbol" });
  try {
    const price = engine.ensure(symbol).price;
    db.executePaperTrade(req.params.userId, symbol, side, quantity, price);
    res.json(fullSnapshot(req.params.userId));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post("/api/acknowledge/:userId", requireUser, (req, res) => {
  const prices = {};
  db.getWatchlist(req.params.userId).forEach((symbol) => { prices[symbol] = engine.ensure(symbol).price; });
  db.acknowledgeAll(req.params.userId, prices);
  res.json(fullSnapshot(req.params.userId));
});
app.post("/api/reset/:userId", requireUser, (req, res) => {
  db.resetUser(req.params.userId);
  engine.resetState();
  res.json(fullSnapshot(req.params.userId));
});
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "internal server error" });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const connections = new Map();
function sendSnapshot(ws, userId) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(fullSnapshot(userId)));
}
wss.on("connection", (ws, req) => {
  const userId = new URL(req.url, "http://internal").searchParams.get("userId") || "demo-user";
  if (!validUserId(userId)) return ws.close(1008, "invalid userId");
  connections.set(ws, userId);
  sendSnapshot(ws, userId);
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "add" && engine.UNIVERSE[msg.symbol]) db.addSymbol(userId, msg.symbol);
      if (msg.type === "remove" && engine.UNIVERSE[msg.symbol]) db.removeSymbol(userId, msg.symbol);
      if (msg.type === "acknowledge") {
        const prices = {};
        db.getWatchlist(userId).forEach((symbol) => { prices[symbol] = engine.ensure(symbol).price; });
        db.acknowledgeAll(userId, prices);
      }
      sendSnapshot(ws, userId);
    } catch { ws.send(JSON.stringify({ type: "error", error: "invalid message" })); }
  });
  ws.on("close", () => connections.delete(ws));
});

const provider = new TwelveDataProvider({
  apiKey: process.env.TWELVE_DATA_API_KEY,
  symbols: Object.keys(engine.UNIVERSE),
  onStatus: (status) => engine.setProviderMode(status === 'live' ? 'live' : (process.env.TWELVE_DATA_API_KEY ? 'provider-error' : 'simulated')),
  onPrice: (symbol, price, at, volume) => engine.setLivePrice(symbol, price, at, volume),
});
provider.start();
const marketTimer = setInterval(engine.tickAll, 3000);
const pushTimer = setInterval(() => {
  for (const [ws, userId] of connections) sendSnapshot(ws, userId);
}, 3000);

const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, () => console.log(`Meridian API + WebSocket listening on http://localhost:${PORT}`));

function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  clearInterval(marketTimer); clearInterval(pushTimer); provider.stop();
  wss.clients.forEach((client) => client.close(1001, "server shutdown"));
  server.close(() => { try { db.close(); } finally { process.exit(0); } });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

module.exports = { app, server, snapshot };
