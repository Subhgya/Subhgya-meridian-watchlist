const WebSocket = require('ws');

class TwelveDataProvider {
  constructor({ apiKey, symbols, onPrice, onStatus }) {
    this.apiKey = apiKey;
    this.symbols = symbols;
    this.onPrice = onPrice;
    this.onStatus = onStatus;
    this.ws = null;
    this.reconnectTimer = null;
    this.stopped = false;
  }

  start() {
    if (!this.apiKey) {
      this.onStatus?.('simulated');
      return;
    }
    this.stopped = false;
    this.connect();
  }

  connect() {
    if (this.stopped) return;
    this.onStatus?.('connecting');
    this.ws = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${encodeURIComponent(this.apiKey)}`);
    this.ws.on('open', () => {
      this.onStatus?.('live');
      this.ws.send(JSON.stringify({ action: 'subscribe', params: { symbols: this.symbols.join(',') } }));
    });
    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.event === 'price' && msg.symbol && Number.isFinite(Number(msg.price))) {
          this.onPrice(msg.symbol, Number(msg.price), Number(msg.timestamp || Date.now() / 1000) * 1000, msg.day_volume);
        }
        if (msg.event === 'subscribe-status' && msg.status === 'error') this.onStatus?.('error');
      } catch (err) {
        console.error('Market provider message error:', err.message);
      }
    });
    this.ws.on('error', (err) => {
      console.error('Twelve Data WebSocket error:', err.message);
      this.onStatus?.('error');
    });
    this.ws.on('close', () => {
      if (this.stopped) return;
      this.onStatus?.('reconnecting');
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connect(), 5000);
    });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    if (this.ws && this.ws.readyState < 2) this.ws.close();
  }
}

module.exports = { TwelveDataProvider };
