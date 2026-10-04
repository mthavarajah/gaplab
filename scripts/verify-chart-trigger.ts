import { config } from "dotenv";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { AlpacaClient } from "../src/lib/provider/alpaca";
import { eventChart } from "../src/lib/server/services";
import type { BacktestResult } from "../src/lib/domain/types";
config({ path: [".env.local", ".env"], quiet: true });
const client = new AlpacaClient();
const report = [];
for (const symbol of ["AAPL", "NVDA", "TSLA"]) {
  const result = JSON.parse(
    await readFile(`artifacts/live/${symbol}.json`, "utf8"),
  ) as BacktestResult;
  const event = result.events[0];
  assert.ok(event);
  const chart = await eventChart(
    { symbol, date: event.date, asOf: result.provenance.asOf },
    client,
  );
  const target =
    event.previousClose *
    (1 + ((event.side === "up" ? 1 : -1) * event.threshold) / 100);
  assert.ok(Math.abs(target - event.firstTrigger.thresholdPrice) < 1e-8);
  const eligible = chart.bars.filter(
    (bar) => Date.parse(bar.t) < Date.parse(chart.session.open),
  );
  const crossing = eligible.find((bar) =>
    event.side === "up" ? bar.h >= target - 1e-10 : bar.l <= target + 1e-10,
  );
  assert.ok(crossing, `${symbol}: source chart bars never reach threshold`);
  assert.equal(crossing.t, event.firstTrigger.time);
  report.push({
    symbol,
    date: event.date,
    side: event.side,
    threshold: event.threshold,
    target,
    trigger: crossing,
    earlierBars: eligible.filter((b) => b.t < crossing.t).length,
  });
}
await writeFile(
  "artifacts/live/chart-trigger-audit.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
