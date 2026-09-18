# Meridian Watchlist 4.0

Meridian is a full-stack market observability and **paper-trading** application. It combines a React dashboard, Node/Express APIs, SQLite persistence, WebSockets, meaningful-change detection, optional live market prices, and a virtual trading account.

- Real-time event-driven UI using WebSockets
- REST API + persistent SQLite state
- Live market-data adapter with safe simulator fallback
- Paper BUY/SELL execution at the latest market price
- Portfolio equity, cash, positions, average cost and P&L
- Watchlist intelligence based on movement since the last review
- Responsive dashboard with animated visual design
- Docker-ready architecture

## Stack

- **Frontend:** React 18, Vite, Tailwind CSS, Lucide
- **Backend:** Node.js, Express, WebSocket (`ws`)
- **Database:** SQLite via `better-sqlite3`
- **Market data:** Twelve Data WebSocket (optional) with built-in simulator fallback
- **Trading:** Paper trading only; no real money is used

## Project structure

```text
meridian-watchlist/
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── index.css
│   │   ├── hooks/useMeridianSocket.js
│   │   └── services/api.js
│   ├── Dockerfile
│   ├── package.json
│   └── vite.config.js
├── backend/
│   ├── server.js
│   ├── engine.js
│   ├── marketProvider.js
│   ├── db.js
│   ├── engine.test.js
│   ├── Dockerfile
│   └── package.json
├── .env.example
├── docker-compose.yml
├── package.json
└── README.md
```

## Local development

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Then open **http://localhost:5173** (or the alternate Vite port shown in the terminal if 5173 is already occupied). The backend listens on **http://localhost:4000**.

## Enable live market prices

1. Create a Twelve Data account and obtain an API key.
2. Copy `.env.example` to `.env`.
3. Set:

```env
TWELVE_DATA_API_KEY=your_key_here
```

4. Restart `npm run dev`.

When the provider connects successfully, the Meridian header changes to **LIVE MARKET** and the server streams price ticks into the application. Without a key, the application remains fully functional in simulator/paper mode. Twelve Data's WebSocket uses a server-side API key and subscription message for real-time quote events.

## Paper trading

The account starts with **$100,000 virtual cash**. Orders never reach a broker.

- **Buy:** cash decreases and a position is created/updated.
- **Sell:** the position is reduced and cash increases.
- **Average cost:** recalculated for buys.
- **P&L:** marked to the latest Meridian price.
- **Trade history:** persisted in SQLite.

This makes the project safe to demonstrate in an interview while still showing realistic trading-system concepts.

## API endpoints

- `GET /health`
- `GET /api/universe`
- `GET /api/watchlist/:userId`
- `POST /api/watchlist/:userId` with `{ "symbol": "AAPL" }`
- `DELETE /api/watchlist/:userId/:symbol`
- `GET /api/snapshot/:userId`
- `GET /api/portfolio/:userId`
- `POST /api/trade/:userId` with `{ "symbol": "AAPL", "side": "buy", "quantity": 2 }`
- `POST /api/acknowledge/:userId`
- `POST /api/reset/:userId`

WebSocket:

```text
ws://localhost:4000/ws?userId=demo-user
```

The server pushes full watchlist + portfolio snapshots approximately every three seconds.

## Docker

```bash
docker compose up --build
```

Open **http://localhost:8080**.

## Useful commands

```bash
npm run dev
npm run dev:frontend
npm run dev:backend
npm run build
npm test
npm start
```

## Important limitation

Meridian's trading screen is intentionally **paper trading**. Connecting a real broker would require broker-specific authentication/OAuth, account permissions, order-risk controls, and a dedicated broker adapter. Broker secrets must remain server-side and should never be placed in the React client.
