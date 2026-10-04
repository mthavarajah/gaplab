import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { AlpacaClient } from "../src/lib/provider/alpaca";
import { backtest, scanBatch, getContext } from "../src/lib/server/services";
import {
  chunksOfDates,
  marketDate,
  marketTime,
  shiftDate,
} from "../src/lib/domain/time";
import { combineBacktests } from "../src/lib/client/workflows";
import { filterScannerRows } from "../src/lib/domain/scanner";
import type { Bar, ScannerRow } from "../src/lib/domain/types";
config({ path: [".env.local", ".env"], quiet: true });
const client = new AlpacaClient(),
  asOf = client.asOf(),
  end = shiftDate(marketDate(asOf), -1),
  start = shiftDate(end, -59);
await mkdir("artifacts/live", { recursive: true });
const reports = [];
let auditedEvents = 0;
const close = (a: number | null, b: number | null, label: string) => {
  assert.equal(a === null, b === null, label);
  if (a !== null && b !== null)
    assert.ok(Math.abs(a - b) < 1e-8, `${label}: ${a} versus ${b}`);
};
for (const symbol of ["AAPL", "NVDA", "TSLA"]) {
  const parts = [];
  for (const chunk of chunksOfDates(start, end))
    parts.push(
      await backtest(
        { symbol, threshold: 1, direction: "both", ...chunk, asOf },
        client,
      ),
    );
  const result = combineBacktests(parts);
  assert.equal(
    new Set(result.events.map((e) => e.id)).size,
    result.events.length,
  );
  console.log(
    `${symbol}: ${result.examined} sessions, ${result.events.length} observed events, ${result.insufficient.length} insufficient`,
  );
  await writeFile(
    `artifacts/live/${symbol}.json`,
    JSON.stringify(result, null, 2),
  );
  reports.push({
    symbol,
    events: result.events.length,
    examined: result.examined,
    insufficient: result.insufficient.length,
  });
  // Independently recompute directly from raw bars; no production calculation helpers.
  const event =
    result.events.find((e) => e.completeRegular && !e.ambiguousDirection) ??
    result.events.find((e) => !e.ambiguousDirection);
  if (event) {
    const calendar = await client.calendar(
        shiftDate(event.date, -15),
        event.date,
      ),
      session = calendar.at(-1)!,
      previous = calendar.at(-2)!;
    const source = (await client.bars([symbol], previous.open, session.close))[
      symbol
    ];
    const ref = source.find(
      (b) => Date.parse(b.t) === Date.parse(previous.close) - 60000,
    )!;
    assert.ok(ref);
    const ext = source.filter(
      (b) =>
        (b.t >= previous.close && b.t < marketTime(previous.date, "20:00")) ||
        (b.t >= marketTime(session.date, "04:00") && b.t < session.open),
    );
    const regular = source.filter(
      (b) => b.t >= session.open && b.t < session.close,
    );
    const target = ref.c * (event.side === "up" ? 1.01 : 0.99),
      trigger = ext.find((b) =>
        event.side === "up" ? b.h >= target - 1e-10 : b.l <= target + 1e-10,
      )!;
    assert.ok(trigger);
    assert.equal(event.firstTrigger.time, trigger.t);
    close(event.previousClose, ref.c, "previous close");
    const observed =
      event.side === "up"
        ? trigger.o >= target
          ? trigger.o
          : trigger.h
        : trigger.o <= target
          ? trigger.o
          : trigger.l;
    close(event.firstTrigger.observedPrice, observed, "first bar price");
    const eh = Math.max(...ext.map((b) => b.h)),
      el = Math.min(...ext.map((b) => b.l));
    close(
      event.maxGap,
      ((event.side === "up" ? eh : el) / ref.c - 1) * 100,
      "max gap",
    );
    const open = regular.find((b) => b.t === session.open)?.o ?? null,
      last =
        regular.find(
          (b) => Date.parse(b.t) === Date.parse(session.close) - 60000,
        )?.c ?? null;
    close(event.open, open, "regular open");
    close(event.close, last, "regular close");
    const filledAt =
      regular.find((b) => (event.side === "up" ? b.l <= ref.c : b.h >= ref.c))
        ?.t ?? null;
    assert.equal(event.gapFillTime, filledAt);
    assert.equal(
      event.gapFilled,
      filledAt ? true : event.completeRegular ? false : null,
    );
    const exceededHigh = regular.some((b) => b.h > eh);
    assert.equal(
      event.exceededExtendedHigh,
      exceededHigh ? true : event.completeRegular ? false : null,
    );
    const continued = regular.some((b) =>
      event.side === "up" ? b.h > eh : b.l < el,
    );
    assert.equal(
      event.continued,
      continued ? true : event.completeRegular ? false : null,
    );
    const daily = await client.bars(
      [symbol],
      marketTime(event.date, "00:00"),
      marketTime(event.date, "23:59"),
      "1Day",
    );
    close(
      event.sessionVolume,
      daily[symbol]?.find((b) => marketDate(b.t) === event.date)?.v ?? null,
      "daily volume",
    );
    close(
      event.previousCloseToClose,
      last === null ? null : (last / ref.c - 1) * 100,
      "price change",
    );
    close(
      event.openReturn,
      open === null ? null : (open / ref.c - 1) * 100,
      "opening gap",
    );
    for (const [minutes, key] of [
      [5, "return5m"],
      [15, "return15m"],
      [30, "return30m"],
      [60, "return60m"],
    ] as const) {
      const targetBar = regular.find(
        (b) =>
          Date.parse(b.t) === Date.parse(session.open) + (minutes - 1) * 60000,
      );
      close(
        event[key],
        open !== null && targetBar ? (targetBar.c / open - 1) * 100 : null,
        key,
      );
    }
    close(
      event.openToClose,
      open !== null && last !== null ? (last / open - 1) * 100 : null,
      "open-to-close",
    );
    if (event.completeRegular && open !== null) {
      const high = Math.max(...regular.map((b) => b.h)),
        low = Math.min(...regular.map((b) => b.l));
      close(event.high, high, "regular high");
      close(event.low, low, "regular low");
      close(
        event.mfe,
        Math.max(
          0,
          event.side === "up"
            ? (high / open - 1) * 100
            : (1 - low / open) * 100,
        ),
        "MFE",
      );
      close(
        event.mae,
        Math.min(
          0,
          event.side === "up"
            ? (low / open - 1) * 100
            : (1 - high / open) * 100,
        ),
        "MAE",
      );
      assert.equal(
        event.gapHeld,
        event.side === "up" ? low > ref.c : high < ref.c,
      );
      assert.equal(
        event.followThrough2pct,
        event.side === "up" ? high >= open * 1.02 : low <= open * 0.98,
      );
    }
    await writeFile(
      `artifacts/live/${symbol}-audit.json`,
      JSON.stringify(
        {
          event,
          previous,
          session,
          rawBars: source,
          independent: {
            previousClose: ref.c,
            trigger,
            target,
            extendedHigh: eh,
            extendedLow: el,
            open,
            close: last,
            regularCount: regular.length,
          },
        },
        null,
        2,
      ),
    );
    console.log(
      `${symbol}: independently verified event ${event.date} (${event.regularBars}/${event.expectedRegularBars} regular minutes)`,
    );
    auditedEvents++;
    const tighter = await backtest(
      {
        symbol,
        threshold: 5,
        direction: "both",
        start: event.date,
        end: event.date,
        asOf,
      },
      client,
    );
    assert.ok(tighter.events.length <= 1);
  }
}
assert.ok(
  auditedEvents === 3,
  "Each of the three real backtests must have an independently audited event",
);
// Capture the exact source responses used for this scan, so quote movement
// between requests cannot cause a false mismatch in the audit.
class RecordingClient extends AlpacaClient {
  rawBars: Record<string, Bar[]> = {};
  rawDaily: Record<string, Bar[]> = {};
  rawSnapshots: Awaited<ReturnType<AlpacaClient["snapshots"]>> = {};
  override async bars(
    symbols: string[],
    start: string,
    end: string,
    timeframe: "1Min" | "1Day" = "1Min",
  ) {
    const result = await super.bars(symbols, start, end, timeframe);
    if (timeframe === "1Day") this.rawDaily = result;
    else this.rawBars = result;
    return result;
  }
  override async snapshots(symbols: string[]) {
    this.rawSnapshots = await super.snapshots(symbols);
    return this.rawSnapshots;
  }
}
const recordingClient = new RecordingClient();
const savedText = await readFile(
  "artifacts/qa/scanner-data.json",
  "utf8",
).catch(() => null);
const candidates = savedText
  ? (JSON.parse(savedText) as { rows: ScannerRow[] }).rows
      .slice(0, 8)
      .map((r) => r.symbol)
  : [
      "SPY",
      "QQQ",
      "AMZN",
      "META",
      "MSFT",
      "GOOGL",
      "AMD",
      "AAOI",
      "AMAT",
      "ACVA",
      "AIXI",
      "AMOD",
    ];
const context = await getContext(recordingClient, asOf),
  symbols = [...new Set([...candidates, "AAPL", "NVDA", "TSLA"])].filter((s) =>
    context.assets.some((a) => a.symbol === s),
  );
const scan = await scanBatch(symbols, asOf, recordingClient);
assert.ok(
  scan.rows.length >= 3,
  "At least three real scanner rows must be audited",
);
const low = filterScannerRows(scan.rows, { threshold: 1, direction: "both" }),
  high = filterScannerRows(scan.rows, { threshold: 5, direction: "both" });
assert.ok(high.every((r) => low.some((s) => s.symbol === r.symbol)));
for (const row of scan.rows) {
  assert.ok(
    row.price !== null && row.previousClose !== null && row.gap !== null,
  );
  close(row.gap, (row.price / row.previousClose - 1) * 100, "scanner gap");
  const source = recordingClient.rawBars[row.symbol];
  const ref = source.find(
    (b) => Date.parse(b.t) === Date.parse(context.previous.close) - 60000,
  )!;
  const ext = source.filter(
    (b) =>
      Date.parse(b.t) + 60000 <= Date.parse(asOf) &&
      ((b.t >= context.previous.close &&
        b.t < marketTime(context.previous.date, "20:00")) ||
        (b.t >= marketTime(context.session.date, "04:00") &&
          b.t < context.session.open)),
  );
  close(row.previousClose, ref.c, "scanner raw reference");
  close(row.price, ext.at(-1)!.c, "scanner raw latest extended price");
  close(row.high, Math.max(...ext.map((b) => b.h)), "scanner high");
  close(row.low, Math.min(...ext.map((b) => b.l)), "scanner low");
  close(
    row.volume,
    ext.reduce((total, b) => total + b.v, 0),
    "scanner volume",
  );
  assert.equal(row.latestTime, ext.at(-1)!.t);
  const raw = recordingClient.rawSnapshots[row.symbol];
  assert.ok(
    raw && row.quote,
    "Provider quotes must be available for the real scanner audit",
  );
  const day = [raw.dailyBar, raw.prevDailyBar].find(
    (b) => b && marketDate(b.t) === context.quoteSession.date,
  );
  const prior = recordingClient.rawDaily[row.symbol]?.find(
    (b) => marketDate(b.t) === context.quotePrevious.date,
  );
  close(row.quote.price, raw.latestTrade?.p ?? null, "last trade price");
  close(row.quote.volume, day?.v ?? null, "current session volume");
  close(
    row.quote.priceChange,
    raw.latestTrade && prior ? (raw.latestTrade.p / prior.c - 1) * 100 : null,
    "current price change",
  );
  close(
    row.quote.openingGap,
    day && prior ? (day.o / prior.c - 1) * 100 : null,
    "current opening gap",
  );
  close(
    row.quote.changeFromOpen,
    raw.latestTrade &&
      day &&
      Date.parse(raw.latestTrade.t) >= Date.parse(context.quoteSession.open)
      ? (raw.latestTrade.p / day.o - 1) * 100
      : null,
    "current change from open",
  );
}
await writeFile(
  "artifacts/live/scanner-source-audit.json",
  JSON.stringify(
    {
      context,
      rows: scan.rows,
      rawBars: recordingClient.rawBars,
      rawSnapshots: recordingClient.rawSnapshots,
      rawDaily: recordingClient.rawDaily,
    },
    null,
    2,
  ),
);
await writeFile("artifacts/live/scan.json", JSON.stringify(scan, null, 2));
await writeFile(
  "artifacts/live/report.json",
  JSON.stringify(
    {
      verifiedAt: new Date().toISOString(),
      feed: client.config.feed,
      start,
      end,
      reports,
      scannerRows: scan.rows.length,
      auditedEvents,
    },
    null,
    2,
  ),
);
console.log(
  "Live audit finished; artifacts/live contains provider-derived results and raw bars. Review these alongside the running UI.",
);
