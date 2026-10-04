import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { AlpacaClient } from "../src/lib/provider/alpaca";
import { backtest, getContext, scanBatch } from "../src/lib/server/services";
import {
  chunksOfDates,
  marketDate,
  marketTime,
  shiftDate,
} from "../src/lib/domain/time";
import { combineBacktests } from "../src/lib/client/workflows";
import type { Bar } from "../src/lib/domain/types";
config({ path: [".env.local", ".env"], quiet: true });
const client = new AlpacaClient();
const asOf = client.asOf(),
  end = shiftDate(marketDate(asOf), -1),
  start = shiftDate(end, -59);
const directory = "artifacts/live/opening";
await mkdir(directory, { recursive: true });
const eq = (actual: number | null, expected: number) => {
  assert.ok(actual !== null);
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} !== ${expected}`);
};
const reports = [];
for (const symbol of ["AAPL", "NVDA", "TSLA"]) {
  const parts = [];
  for (const chunk of chunksOfDates(start, end))
    parts.push(
      await backtest(
        {
          symbol,
          threshold: 1,
          direction: "both",
          rule: "opening",
          ...chunk,
          asOf,
        },
        client,
      ),
    );
  const result = combineBacktests(parts);
  const calendar = await client.calendar(shiftDate(start, -15), end);
  const first = calendar.findIndex((s) => s.date >= start);
  const daily = (
    await client.bars(
      [symbol],
      marketTime(calendar[first - 1].date, "00:00"),
      asOf,
      "1Day",
    )
  )[symbol];
  const dates = new Map(daily.map((b) => [marketDate(b.t), b]));
  const expected: string[] = [];
  let continued = 0;
  for (const [index, session] of calendar.entries()) {
    if (session.date < start) continue;
    const current = dates.get(session.date),
      previous = dates.get(calendar[index - 1].date);
    assert.ok(
      current && previous,
      `${symbol}: daily source missing for ${session.date}`,
    );
    const gap = (current.o / previous.c - 1) * 100;
    if (Math.abs(gap) < 1 - 1e-10) continue;
    expected.push(session.date);
    const event = result.events.find((e) => e.date === session.date);
    assert.ok(
      event,
      `${symbol}: qualifying opening gap omitted ${session.date}`,
    );
    eq(event.previousClose, previous.c);
    eq(event.open, current.o);
    eq(event.close, current.c);
    eq(event.high, current.h);
    eq(event.low, current.l);
    eq(event.openReturn, gap);
    eq(event.previousCloseToClose, (current.c / previous.c - 1) * 100);
    eq(event.openToClose, (current.c / current.o - 1) * 100);
    eq(event.sessionVolume, current.v);
    assert.equal(event.firstTrigger.time, session.open);
    const keptGoing = gap > 0 ? current.c > current.o : current.c < current.o;
    assert.equal(event.continuedFromOpen, keptGoing);
    if (keptGoing) continued++;
    assert.equal(
      event.gapFilled,
      gap > 0 ? current.l <= previous.c : current.h >= previous.c,
    );
  }
  assert.deepEqual(result.events.map((e) => e.date).sort(), expected.sort());
  eq(
    result.summary.metrics.continuedFromOpen.value,
    (continued / expected.length) * 100,
  );
  assert.equal(result.insufficient.length, 0);
  assert.ok(
    result.events.some((e) => e.continuedFromOpen === false),
    "Losing follow-through must remain in the cohort",
  );
  const event = result.events[0];
  const index = calendar.findIndex((s) => s.date === event.date);
  const bars = (
    await client.bars([symbol], calendar[index - 1].open, calendar[index].close)
  )[symbol];
  await writeFile(
    `${directory}/${symbol}.json`,
    JSON.stringify(result, null, 2),
  );
  await writeFile(
    `${directory}/${symbol}-source.json`,
    JSON.stringify(
      { calendar, daily, auditedEvent: event, minuteBars: bars },
      null,
      2,
    ),
  );
  reports.push({
    symbol,
    sessions: result.examined,
    events: expected.length,
    continued,
    reversedOrFlat: expected.length - continued,
    insufficient: result.insufficient.length,
  });
  console.log(JSON.stringify(reports.at(-1)));
}
const context = await getContext(client);
class RecordingClient extends AlpacaClient {
  raw: Awaited<ReturnType<AlpacaClient["snapshots"]>> = {};
  references: Record<string, Bar[]> = {};
  async snapshots(symbols: string[]) {
    this.raw = await super.snapshots(symbols);
    return this.raw;
  }
  async bars(
    symbols: string[],
    start: string,
    end: string,
    timeframe: "1Min" | "1Day" = "1Min",
  ) {
    assert.equal(
      timeframe,
      "1Day",
      "Opening scans must not require minute bars",
    );
    this.references = await super.bars(symbols, start, end, timeframe);
    return this.references;
  }
}
const recording = new RecordingClient(client.config);
const scan = await scanBatch(
  ["AAPL", "AAOI", "NVDA", "TSLA", "RETO"],
  context.asOf,
  recording,
  "gap-and-go",
);
assert.equal(scan.rows.length, 5);
for (const row of scan.rows) {
  const raw = recording.raw[row.symbol],
    quote = row.quote!;
  const day = [raw.dailyBar, raw.prevDailyBar].find(
    (b) => b && marketDate(b.t) === context.quoteSession.date,
  )!;
  const previous = recording.references[row.symbol].find(
    (b) => marketDate(b.t) === context.quotePrevious.date,
  )!;
  eq(quote.price, raw.latestTrade!.p);
  eq(quote.open, day.o);
  eq(quote.previousClose, previous.c);
  eq(quote.openingGap, (day.o / previous.c - 1) * 100);
  eq(quote.changeFromOpen, (raw.latestTrade!.p / day.o - 1) * 100);
  eq(quote.priceChange, (raw.latestTrade!.p / previous.c - 1) * 100);
  eq(quote.volume, day.v);
  assert.equal(row.gap, null);
}
await writeFile(
  `${directory}/scanner-source.json`,
  JSON.stringify(
    { scan, raw: recording.raw, adjustedReferences: recording.references },
    null,
    2,
  ),
);
await writeFile(
  `${directory}/report.json`,
  JSON.stringify(
    {
      verifiedAt: new Date().toISOString(),
      feed: client.config.feed,
      start,
      end,
      reports,
      scannerRows: scan.rows.length,
    },
    null,
    2,
  ),
);
console.log("Opening-gap cohort and snapshot source audits passed.");
