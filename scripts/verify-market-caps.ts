import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { getMarketCaps, MARKET_CAP_URL } from "../src/lib/provider/market-caps";
import { scanBatch, getContext } from "../src/lib/server/services";
import { AlpacaClient } from "../src/lib/provider/alpaca";
config({ path: [".env.local", ".env"], quiet: true });
const caps = await getMarketCaps();
const response = await fetch(MARKET_CAP_URL, {
  headers: { "User-Agent": "Gaplab/1.0", Accept: "application/json" },
  signal: AbortSignal.timeout(15000),
});
assert.equal(response.status, 200);
const source = await response.json();
const client = new AlpacaClient();
const context = await getContext(client);
const symbols = ["AAPL", "NVDA", "TSLA", "AAOI", "BRK.B", "SPY"];
const batch = await scanBatch(symbols, context.asOf, client, "gap-and-go");
const report = [];
for (const symbol of symbols.filter((s) => s !== "SPY")) {
  const raw = source.data.rows.find(
    (row: { symbol: string }) =>
      row.symbol === (symbol === "BRK.B" ? "BRK/B" : symbol),
  );
  assert.ok(raw?.marketCap);
  assert.equal(caps.values[symbol], Number(raw.marketCap));
  const row = batch.rows.find((row) => row.symbol === symbol);
  assert.ok(row);
  assert.equal(row.marketCap, Number(raw.marketCap));
  assert.equal(row.marketCapInfo?.source, "Nasdaq");
  report.push({ symbol, marketCap: row.marketCap });
}
assert.equal(batch.rows.find((r) => r.symbol === "SPY")?.marketCap, null);
const matched = context.assets.filter(
  (a) => caps.values[a.symbol] !== undefined,
).length;
await mkdir("artifacts/live/market-caps", { recursive: true });
await writeFile(
  "artifacts/live/market-caps/source.json",
  JSON.stringify(source),
);
await writeFile(
  "artifacts/live/market-caps/scan.json",
  JSON.stringify(batch, null, 2),
);
const result = {
  report,
  sourceRecords: source.data.rows.length,
  availableCaps: Object.keys(caps.values).length,
  matchedAssets: matched,
  fetchedAt: caps.fetchedAt,
  sourceAsOf: caps.sourceAsOf,
};
await writeFile(
  "artifacts/live/market-caps/report.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
