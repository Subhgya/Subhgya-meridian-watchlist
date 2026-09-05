import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus, X, TrendingUp, TrendingDown, ChevronDown, ChevronUp, Check,
  RotateCcw, Wifi, WifiOff, Activity, BarChart3, Zap, ShieldCheck,
  Wallet, ShoppingCart, ArrowUpRight, ArrowDownRight, Clock3, Radio, RefreshCw
} from "lucide-react";
import { api } from "./services/api";
import { useMeridianSocket } from "./hooks/useMeridianSocket";

const ink = "#F4F7FB";
const inkSoft = "#94A3B8";
const up = "#36D399";
const down = "#FF6B7A";
const gold = "#F5C76A";
const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const USER_ID = "demo-user";

function pctChange(a, b) {
  if (!a) return 0;
  return ((b - a) / a) * 100;
}

function freshnessLabel(item) {
  if (item.freshness === "reconciling") return { text: "Reconciling", color: gold };
  if (item.freshness === "delayed") return { text: "Delayed", color: gold };
  if (item.freshness === "stale") return { text: "Stale", color: down };
  return { text: "Live", color: up };
}

function Sparkline({ history = [], color }) {
  if (history.length < 2) return <svg width="100" height="34" />;
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;
  const pts = history.map((v, i) => {
    const x = (i / (history.length - 1)) * 96 + 2;
    const y = 31 - ((v - min) / range) * 27;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width="100" height="34" viewBox="0 0 100 34" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function StatCard({ icon: Icon, label, value, accent = "" }) {
  return (
    <div className="stat-card">
      <div className="stat-icon"><Icon size={15} /></div>
      <div>
        <div className="stat-label">{label}</div>
        <div className={`stat-value ${accent}`}>{value}</div>
      </div>
    </div>
  );
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [universe, setUniverse] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [portfolio, setPortfolio] = useState(null);
  const [provider, setProvider] = useState("simulated");
  const [tradeSymbol, setTradeSymbol] = useState("AAPL");
  const [tradeSide, setTradeSide] = useState("buy");
  const [quantity, setQuantity] = useState(1);

  const applySnapshot = useCallback((data) => {
    if (Array.isArray(data?.items)) {
      setItems(data.items);
      if (data.portfolio) setPortfolio(data.portfolio);
      if (data.provider) setProvider(data.provider);
      setLoading(false);
      setError("");
    }
  }, []);

  const connection = useMeridianSocket(USER_ID, applySnapshot);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getSnapshot(USER_ID);
      applySnapshot(data);
    } catch (e) {
      setError(e.message || "Could not reach the backend.");
      setLoading(false);
    }
  }, [applySnapshot]);

  useEffect(() => {
    Promise.all([api.getUniverse(), api.getSnapshot(USER_ID)])
      .then(([u, s]) => {
        setUniverse(u.instruments || []);
        applySnapshot(s);
      })
      .catch((e) => {
        setError(e.message || "Could not load Meridian.");
        setLoading(false);
      });
  }, [applySnapshot]);

  useEffect(() => {
    if (connection === "connected") return;
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [connection, refresh]);

  const watchlist = useMemo(() => items.map((i) => i.symbol), [items]);
  const available = useMemo(() => universe.filter((u) => !watchlist.includes(u.symbol)), [universe, watchlist]);
  const digest = useMemo(() => items
    .filter((i) => i.reasons?.length)
    .map((i) => ({ ...i, severity: i.reasons.length + (i.reasons.some((r) => r.kind === "flag") ? 1 : 0) }))
    .sort((a, b) => b.severity - a.severity), [items]);

  const marketStats = useMemo(() => {
    const gainers = items.filter((i) => pctChange(i.open, i.price) >= 0).length;
    const avgMove = items.length ? items.reduce((sum, i) => sum + pctChange(i.open, i.price), 0) / items.length : 0;
    return { gainers, avgMove };
  }, [items]);

  async function runAction(action) {
    setBusy(true);
    setError("");
    try {
      const data = await action();
      if (data?.items) applySnapshot(data);
      else await refresh();
    } catch (e) {
      setError(e.message || "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  const addSymbol = (symbol) => runAction(async () => {
    await api.addSymbol(USER_ID, symbol);
    setAdding(false);
    return api.getSnapshot(USER_ID);
  });
  const removeSymbol = (symbol) => runAction(async () => {
    await api.removeSymbol(USER_ID, symbol);
    if (expanded === symbol) setExpanded(null);
    return api.getSnapshot(USER_ID);
  });
  const markReviewed = () => runAction(() => api.acknowledge(USER_ID));
  const resetDemo = () => runAction(() => api.reset(USER_ID));
  const executeTrade = () => runAction(() => api.trade(USER_ID, tradeSymbol, tradeSide, Number(quantity)));

  if (loading) {
    return (
      <div className="app-shell loading-screen">
        <div className="ambient ambient-a" /><div className="ambient ambient-b" />
        <div className="loader-card"><div className="brand-mark">M</div><div className="loader-line" /><span>Initializing Meridian…</span></div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="grid-overlay" />
      <div className="ambient ambient-a" /><div className="ambient ambient-b" /><div className="ambient ambient-c" />
      <div className="noise" />

      <main className="page-wrap">
        <header className="topbar">
          <div className="brand-block">
            <div className="brand-row"><span className="brand-symbol">M</span><h1>Meridian</h1><span className="version-pill">{provider === "live" ? "LIVE MARKET" : "PAPER MODE"}</span></div>
            <p>Intelligent watchlist intelligence for what actually moved since you last looked.</p>
          </div>
          <div className="header-actions">
            <div className={`connection ${connection === "connected" ? "connected" : ""}`}>
              {connection === "connected" ? <Wifi size={13} /> : <WifiOff size={13} />}
              <span>{connection === "connected" ? (provider === "live" ? "Live market + socket" : "Live socket") : connection}</span>
              <i />
            </div>
            <button disabled={busy} onClick={resetDemo} className="ghost-button"><RotateCcw size={13} /> Reset demo</button>
          </div>
        </header>

        <section className="hero-grid">
          <div className="hero-card glass-card">
            <div className="eyebrow"><span className="eyebrow-dot" /> MARKET INTELLIGENCE</div>
            <h2>See the signal.<br /><span>Ignore the noise.</span></h2>
            <p>Meridian tracks your selected instruments, detects meaningful movement, and surfaces changes worth your attention in real time.</p>
            <div className="hero-badges"><span><Zap size={12} /> Real-time events</span><span><ShieldCheck size={12} /> Source-aware</span><span><Activity size={12} /> {provider === "live" ? "Live prices" : "Paper market"}</span></div>
          </div>
          <div className="stats-grid">
            <StatCard icon={Activity} label="Watching" value={items.length.toString().padStart(2, "0")} />
            <StatCard icon={TrendingUp} label="Positive" value={`${marketStats.gainers}/${items.length || 0}`} accent="green" />
            <StatCard icon={BarChart3} label="Avg. move" value={`${marketStats.avgMove >= 0 ? "+" : ""}${marketStats.avgMove.toFixed(2)}%`} accent={marketStats.avgMove >= 0 ? "green" : "red"} />
          </div>
        </section>

        <div className="demo-note"><span>{provider === "live" ? "LIVE MARKET DATA" : "PAPER MODE"}</span> {provider === "live" ? "Streaming market prices from Twelve Data via a server-side WebSocket." : "Paper trading uses the built-in market simulator. Add a Twelve Data API key to enable live prices."}</div>

        {error && (
          <div className="error-banner"><span>{error}</span><button onClick={refresh}>Retry</button></div>
        )}

        <section className="attention-card glass-card">
          <div className="section-head">
            <div><div className="section-kicker">01 / ATTENTION</div><h3>Since you last checked</h3></div>
            {digest.length > 0 && <button disabled={busy} onClick={markReviewed} className="accent-button"><Check size={13} /> Mark reviewed</button>}
          </div>
          {digest.length === 0 ? (
            <div className="empty-attention"><div className="quiet-orb"><Activity size={19} /></div><div><strong>Quiet is a signal too.</strong><span>Nothing requires your attention right now.</span></div></div>
          ) : digest.map((item) => (
            <div key={item.symbol} className="digest-row">
              <span className="digest-symbol">{item.symbol}</span>
              <div className="reason-list">{item.reasons.map((r, i) => <span key={`${r.type}-${i}`} className={`reason ${r.kind}`}>{r.label}</span>)}</div>
            </div>
          ))}
        </section>

        <section className="watch-section">
          <div className="section-head watch-head">
            <div><div className="section-kicker">02 / WATCHLIST</div><h3>Your market radar <span>{watchlist.length}</span></h3></div>
            <button disabled={busy} onClick={() => setAdding((a) => !a)} className="add-button"><Plus size={15} /> Add instrument</button>
          </div>

          {adding && (
            <div className="add-panel glass-card">
              <span className="add-label">ADD TO RADAR</span>
              {available.length === 0 ? <span className="muted">Every instrument in the demo universe is already on your list.</span> : available.map((u) => (
                <button disabled={busy} key={u.symbol} onClick={() => addSymbol(u.symbol)} className="instrument-chip"><span>{u.symbol}</span>{u.name}</button>
              ))}
            </div>
          )}

          <div className="watch-card glass-card">
            <div className="table-head"><span>Instrument</span><span>Price</span><span>Session move</span><span>Trend</span><span>Status</span><span /></div>
            {items.length === 0 && <div className="empty-list">Your watchlist is empty. Add a few instruments to start tracking what matters.</div>}
            {items.map((item) => {
              const sessionChg = pctChange(item.open, item.price);
              const fresh = freshnessLabel(item);
              const color = sessionChg >= 0 ? up : down;
              const isOpen = expanded === item.symbol;
              const sinceBaseline = item.baseline ? pctChange(item.baseline.price, item.price) : null;
              return (
                <div key={item.symbol} className={`watch-item ${isOpen ? "expanded" : ""}`}>
                  <div onClick={() => setExpanded(isOpen ? null : item.symbol)} className="watch-row">
                    <div className="instrument"><span className="ticker-dot" style={{ background: color }} /><div><strong>{item.symbol}</strong><small>{item.name}</small></div></div>
                    <div className="price">${item.price.toFixed(2)}</div>
                    <div className={`move ${sessionChg >= 0 ? "positive" : "negative"}`}>{sessionChg >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}{Math.abs(sessionChg).toFixed(2)}%</div>
                    <div className="spark"><Sparkline history={item.history} color={color} /></div>
                    <span className="live-status" style={{ color: fresh.color }}><i style={{ background: fresh.color }} />{fresh.text}</span>
                    <button disabled={busy} aria-label={`Remove ${item.symbol}`} onClick={(e) => { e.stopPropagation(); removeSymbol(item.symbol); }} className="icon-button"><X size={14} /></button>
                    <span className="chevron">{isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
                  </div>
                  {isOpen && (
                    <div className="detail-panel">
                      <div><span>Session open</span><b>${item.open.toFixed(2)}</b></div><div><span>Session high</span><b>${item.high.toFixed(2)}</b></div><div><span>Session low</span><b>${item.low.toFixed(2)}</b></div>
                      <div><span>Volatility</span><b>{item.volatility >= 1.8 ? "High" : item.volatility >= 1 ? "Moderate" : "Low"}</b></div>
                      <div><span>Since last check</span><b>{sinceBaseline == null ? "No baseline" : `${sinceBaseline >= 0 ? "+" : ""}${sinceBaseline.toFixed(2)}%`}</b></div>
                      <div><span>Feed</span><b>{item.delayed ? "Secondary / delayed" : "Primary source"}</b></div>
                      {item.conflict && <div className="conflict"><span>Source conflict</span><b>Two sources disagree by {Math.abs(pctChange(item.price, item.secondaryPrice)).toFixed(2)}%</b></div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>


        <section className="trading-grid">
          <div className="trade-card glass-card">
            <div className="section-head compact-head">
              <div><div className="section-kicker">03 / PAPER TRADING</div><h3>Execute a paper order</h3></div>
              <span className="paper-badge"><Radio size={12} /> No real money</span>
            </div>
            <div className="trade-form">
              <label>Instrument<select value={tradeSymbol} onChange={(e) => setTradeSymbol(e.target.value)}>{items.map((i) => <option key={i.symbol}>{i.symbol}</option>)}</select></label>
              <label>Side<div className="side-toggle"><button className={tradeSide === "buy" ? "active buy" : ""} onClick={() => setTradeSide("buy")}><ArrowUpRight size={14} /> Buy</button><button className={tradeSide === "sell" ? "active sell" : ""} onClick={() => setTradeSide("sell")}><ArrowDownRight size={14} /> Sell</button></div></label>
              <label>Quantity<input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
              <button className={`execute-button ${tradeSide}`} disabled={busy || !items.length} onClick={executeTrade}><ShoppingCart size={15} /> {tradeSide === "buy" ? "Buy" : "Sell"} {tradeSymbol}</button>
            </div>
            <div className="trade-caption"><Clock3 size={12} /> Orders execute instantly at the latest Meridian market price.</div>
          </div>
          <div className="portfolio-card glass-card">
            <div className="portfolio-top"><div><div className="section-kicker">PORTFOLIO</div><h3>Paper account</h3></div><Wallet size={18} /></div>
            <div className="equity"><span>Account equity</span><strong>${(portfolio?.equity ?? 100000).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong><em className={(portfolio?.pnl ?? 0) >= 0 ? "gain" : "loss"}>{(portfolio?.pnl ?? 0) >= 0 ? "+" : ""}${(portfolio?.pnl ?? 0).toFixed(2)}</em></div>
            <div className="portfolio-metrics"><div><span>Cash</span><b>${(portfolio?.cash ?? 100000).toLocaleString(undefined, {maximumFractionDigits: 2})}</b></div><div><span>Invested</span><b>${(portfolio?.marketValue ?? 0).toLocaleString(undefined, {maximumFractionDigits: 2})}</b></div><div><span>Positions</span><b>{portfolio?.positions?.length ?? 0}</b></div></div>
          </div>
        </section>

        <section className="positions-card glass-card">
          <div className="section-head compact-head"><div><div className="section-kicker">04 / POSITIONS</div><h3>Open positions</h3></div><span className="position-count">{portfolio?.positions?.length ?? 0} open</span></div>
          {portfolio?.positions?.length ? <div className="positions-list">{portfolio.positions.map((p) => <div className="position-row" key={p.symbol}><strong>{p.symbol}</strong><span>{p.quantity} shares</span><span>Avg ${p.avg_price.toFixed(2)}</span><span>Now ${p.price.toFixed(2)}</span><b className={p.pnl >= 0 ? "gain" : "loss"}>{p.pnl >= 0 ? "+" : ""}${p.pnl.toFixed(2)}</b></div>)}</div> : <div className="empty-positions"><Wallet size={16} /> No open positions yet. Place a paper order above.</div>}
        </section>

        <footer><span>MERIDIAN</span><span>REAL-TIME MARKET OBSERVABILITY · PAPER EXECUTION</span><span>BUILD 4.0</span></footer>
      </main>
    </div>
  );
}
