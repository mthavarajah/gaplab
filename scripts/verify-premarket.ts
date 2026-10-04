import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { AlpacaClient } from "../src/lib/provider/alpaca";
import { getContext, scanBatch } from "../src/lib/server/services";
import { marketTime, marketDate } from "../src/lib/domain/time";
config({ path: [".env.local", ".env"], quiet: true });
const client = new AlpacaClient();
const current = await getContext(client);
const date = current.quoteSession.date;
const asOf = marketTime(date, "08:00");
const symbols = ["AAPL", "NVDA", "TSLA"];
const context = await getContext(client, asOf);
const batch = await scanBatch(symbols, asOf, client, "premarket");
const [source, daily] = await Promise.all([
  client.bars(symbols, marketTime(date, "04:00"), context.quoteSession.close),
  client.bars(
    symbols,
    marketTime(context.quotePrevious.date, "00:00"),
    marketTime(date, "00:00"),
    "1Day",
  ),
]);
const report = [];
for (const symbol of symbols) {
  const row = batch.rows.find((r) => r.symbol === symbol);
  assert.ok(row, `${symbol}: no premarket row`);
  const prior = daily[symbol].find(
    (b) => marketDate(b.t) === context.quotePrevious.date,
  )!;
  const eligible = source[symbol].filter(
    (b) => Date.parse(b.t) + 60000 <= Date.parse(asOf),
  );
  const last = eligible.at(-1)!;
  assert.equal(row.price, last.c);
  assert.equal(row.previousClose, prior.c);
  assert.ok(Math.abs(row.gap! - (last.c / prior.c - 1) * 100) < 1e-8);
  assert.equal(
    row.volume,
    eligible.reduce((sum, b) => sum + b.v, 0),
  );
  assert.equal(row.latestTime, last.t);
  assert.equal(row.quote?.openingGap, null);
  assert.equal(row.quote?.changeFromOpen, null);
  report.push({
    symbol,
    price: row.price,
    previousClose: prior.c,
    gap: row.gap,
    priceTime: row.latestTime,
    volume: row.volume,
  });
}
const open = await scanBatch(
  symbols,
  context.quoteSession.open,
  client,
  "premarket",
);
const noon = await scanBatch(
  symbols,
  marketTime(date, "12:00"),
  client,
  "premarket",
);
assert.deepEqual(
  open.rows.map((r) => [r.symbol, r.price, r.gap, r.volume, r.latestTime]),
  noon.rows.map((r) => [r.symbol, r.price, r.gap, r.volume, r.latestTime]),
);
await mkdir("artifacts/live/premarket", { recursive: true });
await writeFile(
  "artifacts/live/premarket/source.json",
  JSON.stringify({ context, batch, source, daily, open, noon }, null, 2),
);
await writeFile(
  "artifacts/live/premarket/report.json",
  JSON.stringify({ asOf, report, freezesAtOpen: true }, null, 2),
);
console.log(JSON.stringify({ asOf, report, freezesAtOpen: true }, null, 2));
const modeReport = [];
for (const mode of ["gap-and-go", "premarket", "extended", "all"] as const) {
  const currentBatch = await scanBatch(symbols, current.asOf, client, mode);
  for (const symbol of symbols) {
    const row = currentBatch.rows.find((value) => value.symbol === symbol);
    assert.ok(row, `${mode}: missing ${symbol}`);
    const prior = daily[symbol].find(
      (bar) => marketDate(bar.t) === current.quotePrevious.date,
    )!;
    const eligible = source[symbol].filter(
      (bar) =>
        bar.t >= marketTime(date, "04:00") &&
        bar.t < current.quoteSession.open &&
        Date.parse(bar.t) + 60000 <= Date.parse(current.asOf),
    );
    const last = eligible.at(-1)!;
    const expected = (last.c / prior.c - 1) * 100;
    assert.ok(Math.abs(row.premarketChange! - expected) < 1e-8);
    assert.equal(row.premarketTime, last.t);
    modeReport.push({
      mode,
      symbol,
      premarketPrice: last.c,
      previousClose: prior.c,
      premarketChange: row.premarketChange,
      premarketTime: row.premarketTime,
      latestPriceChange: row.quote?.priceChange,
    });
  }
}
await writeFile(
  "artifacts/live/premarket/change-modes.json",
  JSON.stringify(modeReport, null, 2),
);
console.log(JSON.stringify(modeReport));

// Independent raw-source sum for the UI's previous-close-through-open volume.
const volumeSource = await client.bars(
  symbols,
  context.quotePrevious.close,
  context.quoteSession.open,
);
const volumeReport = [];
for (const cutoff of [
  asOf,
  context.quoteSession.open,
  marketTime(date, "12:00"),
]) {
  const observed = await scanBatch(symbols, cutoff, client, "all");
  for (const symbol of symbols) {
    const bars = volumeSource[symbol].filter(
      (b) =>
        b.t >= context.quotePrevious.close &&
        b.t < context.quoteSession.open &&
        Date.parse(b.t) + 60000 <= Date.parse(cutoff),
    );
    const expected = bars.length ? bars.reduce((sum, b) => sum + b.v, 0) : null;
    const row = observed.rows.find((r) => r.symbol === symbol)!;
    assert.equal(row.premarketVolume, expected);
    volumeReport.push({
      symbol,
      cutoff,
      start: context.quotePrevious.close,
      end: context.quoteSession.open,
      bars: bars.length,
      volume: row.premarketVolume,
    });
  }
}
await writeFile(
  "artifacts/live/premarket/volume-audit.json",
  JSON.stringify({ source: volumeSource, report: volumeReport }, null, 2),
);
console.log(JSON.stringify(volumeReport));
