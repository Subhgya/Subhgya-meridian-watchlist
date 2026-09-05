const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(__dirname, "data", "meridian.db");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new Database(databasePath);
database.pragma("journal_mode = WAL");
database.pragma("foreign_keys = ON");

database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    initialized_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS watchlist (
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, symbol)
  );
  CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);
  CREATE TABLE IF NOT EXISTS portfolio (
    user_id TEXT PRIMARY KEY,
    cash REAL NOT NULL DEFAULT 100000,
    starting_cash REAL NOT NULL DEFAULT 100000,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS positions (
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0,
    avg_price REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, symbol)
  );
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    total REAL NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS baselines (
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    price REAL NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (user_id, symbol)
  );
`);

const q = {
  hasUser: database.prepare("SELECT 1 FROM users WHERE user_id = ?"),
  insertUser: database.prepare("INSERT OR IGNORE INTO users (user_id, initialized_at) VALUES (?, ?)"),
  clearWatchlist: database.prepare("DELETE FROM watchlist WHERE user_id = ?"),
  clearBaselines: database.prepare("DELETE FROM baselines WHERE user_id = ?"),
  getWatchlist: database.prepare("SELECT symbol FROM watchlist WHERE user_id = ? ORDER BY added_at, symbol"),
  addSymbol: database.prepare("INSERT OR IGNORE INTO watchlist (user_id, symbol, added_at) VALUES (?, ?, ?)"),
  removeSymbol: database.prepare("DELETE FROM watchlist WHERE user_id = ? AND symbol = ?"),
  removeBaseline: database.prepare("DELETE FROM baselines WHERE user_id = ? AND symbol = ?"),
  getPortfolio: database.prepare("SELECT cash, starting_cash FROM portfolio WHERE user_id = ?"),
  upsertPortfolio: database.prepare(`INSERT INTO portfolio (user_id, cash, starting_cash, updated_at) VALUES (?, ?, 100000, ?) ON CONFLICT(user_id) DO UPDATE SET cash=excluded.cash, updated_at=excluded.updated_at`),
  getPositions: database.prepare("SELECT symbol, quantity, avg_price FROM positions WHERE user_id = ? AND quantity > 0 ORDER BY symbol"),
  getPosition: database.prepare("SELECT symbol, quantity, avg_price FROM positions WHERE user_id = ? AND symbol = ?"),
  upsertPosition: database.prepare(`INSERT INTO positions (user_id, symbol, quantity, avg_price) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, symbol) DO UPDATE SET quantity=excluded.quantity, avg_price=excluded.avg_price`),
  deletePosition: database.prepare("DELETE FROM positions WHERE user_id = ? AND symbol = ?"),
  insertTrade: database.prepare("INSERT INTO trades (user_id, symbol, side, quantity, price, total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"),
  getTrades: database.prepare("SELECT id, symbol, side, quantity, price, total, created_at FROM trades WHERE user_id = ? ORDER BY id DESC LIMIT 20"),
  clearPortfolio: database.prepare("DELETE FROM portfolio WHERE user_id = ?"),
  clearPositions: database.prepare("DELETE FROM positions WHERE user_id = ?"),
  clearTrades: database.prepare("DELETE FROM trades WHERE user_id = ?"),
  getBaselines: database.prepare("SELECT symbol, price, at FROM baselines WHERE user_id = ?"),
  upsertBaseline: database.prepare(`
    INSERT INTO baselines (user_id, symbol, price, at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, symbol) DO UPDATE SET price = excluded.price, at = excluded.at
  `),
};

const DEFAULT_WATCHLIST = ["AAPL", "NVDA", "TSLA", "SPY"];

function ensureUser(userId) {
  if (q.hasUser.get(userId)) return;
  const tx = database.transaction(() => {
    q.insertUser.run(userId, Date.now());
    q.upsertPortfolio.run(userId, 100000, Date.now());
    DEFAULT_WATCHLIST.forEach((symbol, index) => q.addSymbol.run(userId, symbol, Date.now() + index));
  });
  tx();
}

function getWatchlist(userId) {
  ensureUser(userId);
  return q.getWatchlist.all(userId).map((r) => r.symbol);
}
function addSymbol(userId, symbol) {
  ensureUser(userId);
  q.addSymbol.run(userId, symbol, Date.now());
  return getWatchlist(userId);
}
function removeSymbol(userId, symbol) {
  ensureUser(userId);
  database.transaction(() => { q.removeSymbol.run(userId, symbol); q.removeBaseline.run(userId, symbol); })();
  return getWatchlist(userId);
}
function getBaselines(userId) {
  ensureUser(userId);
  const out = {};
  q.getBaselines.all(userId).forEach((r) => { out[r.symbol] = { price: r.price, at: r.at }; });
  return out;
}
function acknowledgeAll(userId, currentPrices) {
  ensureUser(userId);
  const now = Date.now();
  database.transaction(() => {
    getWatchlist(userId).forEach((symbol) => {
      if (currentPrices[symbol] != null) q.upsertBaseline.run(userId, symbol, currentPrices[symbol], now);
    });
  })();
}
function getPortfolio(userId) {
  ensureUser(userId);
  const portfolio = q.getPortfolio.get(userId) || { cash: 100000, starting_cash: 100000 };
  return { cash: portfolio.cash, startingCash: portfolio.starting_cash };
}
function getPositions(userId) { ensureUser(userId); return q.getPositions.all(userId); }
function getTrades(userId) { ensureUser(userId); return q.getTrades.all(userId); }
function executePaperTrade(userId, symbol, side, quantity, price) {
  ensureUser(userId);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantity must be greater than zero');
  if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid market price');
  if (!['buy','sell'].includes(side)) throw new Error('Side must be buy or sell');
  const total = quantity * price;
  let result;
  database.transaction(() => {
    const portfolio = getPortfolio(userId);
    const pos = q.getPosition.get(userId, symbol);
    if (side === 'buy') {
      if (total > portfolio.cash + 1e-8) throw new Error('Insufficient paper cash');
      const oldQty = pos?.quantity || 0;
      const oldAvg = pos?.avg_price || 0;
      const newQty = oldQty + quantity;
      const newAvg = ((oldQty * oldAvg) + total) / newQty;
      q.upsertPosition.run(userId, symbol, newQty, newAvg);
      q.upsertPortfolio.run(userId, portfolio.cash - total, Date.now());
    } else {
      if (!pos || pos.quantity < quantity - 1e-8) throw new Error('Insufficient position to sell');
      const newQty = pos.quantity - quantity;
      if (newQty <= 1e-8) q.deletePosition.run(userId, symbol);
      else q.upsertPosition.run(userId, symbol, newQty, pos.avg_price);
      q.upsertPortfolio.run(userId, portfolio.cash + total, Date.now());
    }
    q.insertTrade.run(userId, symbol, side, quantity, price, total, Date.now());
    result = getPortfolio(userId);
  })();
  return result;
}

function resetUser(userId) {
  database.transaction(() => {
    q.insertUser.run(userId, Date.now());
    q.clearWatchlist.run(userId);
    q.clearBaselines.run(userId);
    q.clearPortfolio.run(userId); q.clearPositions.run(userId); q.clearTrades.run(userId);
    q.upsertPortfolio.run(userId, 100000, Date.now());
    DEFAULT_WATCHLIST.forEach((symbol, index) => q.addSymbol.run(userId, symbol, Date.now() + index));
  })();
  return getWatchlist(userId);
}
function close() { database.close(); }

module.exports = { databasePath, DEFAULT_WATCHLIST, getWatchlist, addSymbol, removeSymbol, getBaselines, acknowledgeAll, resetUser, getPortfolio, getPositions, getTrades, executePaperTrade, close };
