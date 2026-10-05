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
  client.bars(symbols, context.quotePrevious.close, context.asOf),
  client.bars(
    symbols,
    marketTime(context.quotePrevious.date, "00:00"),
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
  const sessions = actual.metrics[symbol].sessions;
  for (const rule of ["premarket", "postmarket", "overnight"] as const) {
    const selected = bars[symbol].filter(
      (b) =>
        Date.parse(b.t) + 60000 <= Date.parse(context.asOf) &&
        (rule === "premarket"
          ? b.t >= marketTime(context.quoteSession.date, "04:00") &&
            b.t < context.quoteSession.open
          : rule === "postmarket"
            ? b.t >= context.previous.close &&
              b.t < marketTime(context.previous.date, "20:00")
            : eligible.includes(b)),
    );
    const refDate =
      rule === "premarket" ? context.quotePrevious.date : context.previous.date;
    const ref = daily[symbol].find((b) => marketDate(b.t) === refDate)!;
    const price = selected.at(-1);
    assert.equal(
      sessions[rule].volume,
      selected.length ? selected.reduce((sum, b) => sum + b.v, 0) : null,
    );
    assert.equal(sessions[rule].time, price?.t ?? null);
    if (price && ref)
      assert.ok(
        Math.abs(sessions[rule].change! - (price.c / ref.c - 1) * 100) < 1e-8,
      );
  }
  return {
    symbol,
    sessions,
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
