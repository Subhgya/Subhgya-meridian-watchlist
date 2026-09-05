const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("./engine");

test("thresholds are adaptive", () => {
  assert.ok(engine.thresholdFor("TSLA") > engine.thresholdFor("JPM"));
});

test("diff has no reasons without a baseline", () => {
  assert.deepEqual(engine.diff("AAPL", null).reasons, []);
});

test("every configured symbol can be ensured", () => {
  for (const symbol of Object.keys(engine.UNIVERSE)) assert.equal(engine.ensure(symbol).symbol, symbol);
});
