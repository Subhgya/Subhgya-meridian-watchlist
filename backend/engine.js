const UNIVERSE = {
  AAPL: { name: "Apple", base: 227.4, vol: 0.9 },
  MSFT: { name: "Microsoft", base: 421.8, vol: 0.8 },
  NVDA: { name: "NVIDIA", base: 118.3, vol: 2.1, delayed: true },
  TSLA: { name: "Tesla", base: 246.1, vol: 2.6 },
  AMZN: { name: "Amazon", base: 186.9, vol: 1.2 },
  GOOGL: { name: "Alphabet", base: 168.4, vol: 1.0 },
  META: { name: "Meta Platforms", base: 512.7, vol: 1.6 },
  AMD: { name: "Advanced Micro Devices", base: 142.6, vol: 2.0 },
  NFLX: { name: "Netflix", base: 688.2, vol: 1.4 },
  JPM: { name: "JPMorgan Chase", base: 214.5, vol: 0.7 },
  XOM: { name: "Exxon Mobil", base: 112.8, vol: 0.9, delayed: true },
  SPY: { name: "S&P 500 ETF", base: 561.2, vol: 0.5 },
};

const state = new Map();
let providerMode = 'simulated';

function setProviderMode(mode) { providerMode = mode; }
function getProviderMode() { return providerMode; }

function setLivePrice(sym, price, at = Date.now(), volume = null) {
  if (!UNIVERSE[sym] || !Number.isFinite(price)) return;
  const cur = ensure(sym);
  const prev = cur.price || price;
  const move = Math.abs((price - prev) / Math.max(prev, 0.0001)) * 100;
  state.set(sym, {
    ...cur, price, updatedAt: at, high: Math.max(cur.high, price), low: Math.min(cur.low, price),
    history: [...cur.history, price].slice(-40), volumeSpike: move >= Math.max(1.2, UNIVERSE[sym].vol * 0.8),
    sourceLag: 'primary', primary: { price, at }, secondary: cur.secondary, conflict: false,
    volume: volume == null ? cur.volume : volume
  });
}

function seed(sym) {
  const cfg = UNIVERSE[sym];
  const now = Date.now();
  return {
    symbol: sym,
    price: cfg.base,
    open: cfg.base,
    high: cfg.base,
    low: cfg.base,
    history: [cfg.base],
    volumeSpike: false,
    updatedAt: now,
    sourceLag: cfg.delayed ? "secondary" : "primary",
    primary: { price: cfg.base, at: now },
    secondary: { price: cfg.base, at: now },
    conflict: false,
  };
}

function ensure(sym) {
  if (!UNIVERSE[sym]) throw new Error(`unknown symbol: ${sym}`);
  if (!state.has(sym)) state.set(sym, seed(sym));
  return state.get(sym);
}

function resetState() {
  state.clear();
  Object.keys(UNIVERSE).forEach(ensure);
}

function tickAll() {
  const now = Date.now();
  for (const sym of Object.keys(UNIVERSE)) {
    const cfg = UNIVERSE[sym];
    const cur = ensure(sym);
    if (providerMode === 'live') continue;
    if (cfg.delayed && Math.random() < 0.66) {
      state.set(sym, { ...cur, volumeSpike: false });
      continue;
    }

    const jump = Math.random() < 0.06;
    let movePct = (Math.random() - 0.5) * 2 * cfg.vol * 0.35;
    if (jump) movePct += (Math.random() > 0.5 ? 1 : -1) * (1.5 + Math.random() * 3.5) * (cfg.vol / 1.4);
    const primaryPrice = Math.max(0.5, cur.primary.price * (1 + movePct / 100));

    let secondaryPrice = cur.secondary.price;
    let secondaryAt = cur.secondary.at;
    if (Math.random() < 0.5) {
      const jitter = (Math.random() - 0.5) * 2 * cfg.vol * 0.15;
      secondaryPrice = Math.max(0.5, primaryPrice * (1 + jitter / 100));
      secondaryAt = now;
    }

    const disagreementPct = Math.abs((secondaryPrice - primaryPrice) / primaryPrice) * 100;
    const conflict = now - secondaryAt < 15000 && disagreementPct > 0.35;
    const reconciledPrice = primaryPrice;

    state.set(sym, {
      ...cur,
      price: reconciledPrice,
      high: Math.max(cur.high, reconciledPrice),
      low: Math.min(cur.low, reconciledPrice),
      history: [...cur.history, reconciledPrice].slice(-24),
      volumeSpike: jump,
      updatedAt: now,
      primary: { price: primaryPrice, at: now },
      secondary: { price: secondaryPrice, at: secondaryAt },
      conflict,
    });
  }
}

function pctChange(a, b) {
  if (!a) return 0;
  return ((b - a) / a) * 100;
}

function roundLevel(price) {
  const step = price >= 400 ? 50 : price >= 100 ? 25 : price >= 20 ? 5 : 1;
  return Math.round(price / step) * step;
}

function thresholdFor(sym) {
  return 1.1 + UNIVERSE[sym].vol * 0.75;
}

function diff(sym, baseline) {
  const cur = ensure(sym);
  if (!baseline) return { symbol: sym, current: cur, reasons: [] };
  const reasons = [];
  const chg = pctChange(baseline.price, cur.price);
  if (Math.abs(chg) >= thresholdFor(sym)) {
    reasons.push({
      type: "move",
      kind: chg > 0 ? "up" : "down",
      pct: chg,
      label: `${chg > 0 ? "Up" : "Down"} ${Math.abs(chg).toFixed(1)}% since you checked`,
    });
  }
  const oldLevel = roundLevel(baseline.price);
  const newLevel = roundLevel(cur.price);
  if (oldLevel !== newLevel) {
    reasons.push({ type: "level", kind: cur.price > baseline.price ? "up" : "down", label: `Crossed $${newLevel} level` });
  }
  if (cur.volumeSpike) reasons.push({ type: "activity", kind: "flag", label: "Unusual activity flagged" });
  return { symbol: sym, current: cur, reasons };
}

function freshness(sym) {
  const cur = ensure(sym);
  if (cur.conflict) return "reconciling";
  const secs = (Date.now() - cur.updatedAt) / 1000;
  if (cur.sourceLag === "primary" || secs < 45) return "live";
  if (secs < 240) return "delayed";
  return "stale";
}

resetState();
module.exports = { UNIVERSE, ensure, tickAll, diff, freshness, thresholdFor, pctChange, resetState, state, setLivePrice, setProviderMode, getProviderMode };
