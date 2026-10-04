import { config } from "dotenv";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { AlpacaClient } from "../src/lib/provider/alpaca";
import { getContext, premarketMetrics } from "../src/lib/server/services";
import { marketDate, marketTime } from "../src/lib/domain/time";
config({ path: [".env.local", ".env"], quiet: true });
const client = new AlpacaClient();
const context = await getContext(client);
const symbols = ["ARM", "AAPL", "NVDA"];
const actual = await premarketMetrics(symbols, context.asOf, client, context);
const [bars, daily] = await Promise.all([
  client.bars(symbols, context.previous.close, context.asOf),
  client.bars(
    symbols,
    marketTime(context.previous.date, "00:00"),
    context.asOf,
    "1Day",
  ),
]);
const report = symbols.map((symbol) => {
  const eligible = bars[symbol].filter(
    (b) =>
      Date.parse(b.t) + 60000 <= Date.parse(context.asOf) &&
      ((b.t >= context.previous.close &&
        b.t < marketTime(context.previous.date, "20:00")) ||
        (b.t >= marketTime(context.session.date, "04:00") &&
          b.t < context.session.open)),
  );
  const last = eligible.at(-1)!;
  const reference = daily[symbol].find(
    (b) => marketDate(b.t) === context.previous.date,
  )!;
  assert.ok(last && reference, `${symbol}: missing raw data`);
  const change = (last.c / reference.c - 1) * 100;
  const volume = eligible.reduce((sum, b) => sum + b.v, 0);
  assert.ok(Math.abs(actual.metrics[symbol].change! - change) < 1e-8);
  assert.equal(actual.metrics[symbol].volume, volume);
  assert.equal(actual.metrics[symbol].time, last.t);
  return {
    symbol,
    reference: reference.c,
    latest: last.c,
    time: last.t,
    change,
    volume,
  };
});
await mkdir("artifacts/live/amc", { recursive: true });
await writeFile(
  "artifacts/live/amc/audit.json",
  JSON.stringify({ context, bars, daily, actual, report }, null, 2),
);
console.log(
  JSON.stringify(
    {
      asOf: context.asOf,
      referenceSession: context.previous.date,
      nextOpen: context.session.open,
      report,
    },
    null,
    2,
  ),
);
