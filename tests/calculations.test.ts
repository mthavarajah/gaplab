import { describe, expect, it } from "vitest";
import {
  analyzeSession,
  calculateGapPercent,
  calculateMAE,
  calculateMFE,
  calculateSessionReturns,
  deduplicateEvents,
  detectThresholdCrossing,
  previousRegularClose,
  summarize,
} from "../src/lib/domain/calculations";
import {
  chunksOfDates,
  extendedBars,
  marketTime,
  normalizeBars,
  scannerSessions,
} from "../src/lib/domain/time";
import {
  createScannerRow,
  filterScannerRows,
  scannerTrigger,
  yahooFinanceLink,
} from "../src/lib/domain/scanner";
import { bar, previous, sampleBars, session } from "./fixtures";
const end = "2025-03-11T00:00:00.000Z";
const analyze = (
  bars = sampleBars(),
  threshold = 4,
  direction: "up" | "down" | "both" = "up",
) => analyzeSession("AAPL", bars, previous, session, threshold, direction, end);
describe("gap engine", () => {
  it("computes signed percentages and rejects invalid references", () => {
    expect(calculateGapPercent(104, 100)).toBeCloseTo(4);
    expect(calculateGapPercent(96, 100)).toBeCloseTo(-4);
    for (const value of [0, -1, NaN, Infinity])
      expect(() => calculateGapPercent(1, value)).toThrow();
  });
  it("counts a brief crossing even if faded by open; records first evidence", () => {
    const e = analyze().event!;
    expect(e.firstTrigger.time).toBe(marketTime(session.date, "06:10"));
    expect(e.firstTrigger.observedPrice).toBe(104.3);
    expect(e.firstTrigger.exactTradePrice).toBeNull();
    expect(e.maxGap).toBeCloseTo(4.3);
    expect(e.openReturn).toBeCloseTo(2);
    expect(e.previousClose).toBe(100);
    expect(e.open).toBe(102);
  });
  it("uses bar high/low, not close, and exposes uncertainty", () => {
    const b = bar(session.date, "06:00", 101, { h: 105, c: 101 });
    const t = detectThresholdCrossing([b], 100, 4, "up")!;
    expect(t.observedPrice).toBe(105);
    expect(t.thresholdPrice).toBe(104);
    expect(t.precision).toBe("1Min");
    expect(detectThresholdCrossing([b], 100, 5, "up")).not.toBeNull();
    expect(detectThresholdCrossing([b], 100, 6, "up")).toBeNull();
  });
  it("sorts bars before first detection and deduplicates identical minutes", () => {
    const bars = sampleBars();
    expect(analyze([...bars].reverse()).event?.firstTrigger).toEqual(
      analyze().event?.firstTrigger,
    );
    expect(normalizeBars([...bars, bars[0]])).toHaveLength(bars.length);
    expect(() => normalizeBars([bars[0], { ...bars[0], c: 99 }])).toThrow(
      /Conflicting/,
    );
  });
  it("does not replace missing close or open with a nearby bar", () => {
    expect(analyze(sampleBars().slice(1)).insufficient).toMatch(
      /closing minute/,
    );
    const missing = sampleBars().filter((b) => b.t !== session.open);
    expect(analyze(missing).event?.open).toBeNull();
    expect(analyze(missing).event?.return5m).toBeNull();
    expect(
      previousRegularClose([bar(previous.date, "15:58", 100)], previous),
    ).toBeNull();
  });
  it("matches all elapsed return horizons to the final completed minute", () => {
    const bars = sampleBars();
    for (const minutes of [5, 15, 30, 60]) {
      const b = bars.find(
        (b) =>
          Date.parse(b.t) === Date.parse(session.open) + (minutes - 1) * 60000,
      )!;
      b.c = 102 + minutes / 10;
      b.h = b.c;
    }
    const e = analyze(bars).event!;
    expect(e.return5m).toBeCloseTo((0.5 / 102) * 100);
    expect(e.return15m).toBeCloseTo((1.5 / 102) * 100);
    expect(e.return30m).toBeCloseTo((3 / 102) * 100);
    expect(e.return60m).toBeCloseTo((6 / 102) * 100);
    expect(e.openToClose).toBeCloseTo((0.5 / 102) * 100);
    expect(e.previousCloseToClose).toBeCloseTo(2.5);
    expect(e.high).toBe(108);
    expect(e.low).toBe(101);
    expect(e.mfe).toBeCloseTo((6 / 102) * 100);
    expect(e.mae).toBeCloseTo((-1 / 102) * 100);
  });
  it("gap held requires every observed regular low strictly above reference", () => {
    const e = analyze().event!;
    expect(e.gapHeld).toBe(true);
    expect(e.gapFilled).toBe(false);
    expect(e.failedGap).toBe(false);
    expect(e.continued).toBe(false);
    expect(e.followThrough2pct).toBe(false);
  });
  it("fill, +2% follow through, continuation and failure are separate", () => {
    const bars = sampleBars();
    const b = bars.find((b) => b.t === marketTime(session.date, "10:00"))!;
    b.h = 105;
    b.l = 99;
    const last = bars.at(-1)!;
    last.c = 99;
    last.l = 99;
    const e = analyze(bars).event!;
    expect(e.gapHeld).toBe(false);
    expect(e.gapFilled).toBe(true);
    expect(e.gapFillTime).toBe(b.t);
    expect(e.continued).toBe(true);
    expect(e.followThrough2pct).toBe(true);
    expect(e.failedGap).toBe(true);
  });
  it("missing minutes leave full-session claims unknown, not zero", () => {
    const e = analyze(
      sampleBars().filter((b) => b.t !== marketTime(session.date, "09:34")),
    ).event!;
    expect(e.return5m).toBeNull();
    expect(e.gapHeld).toBeNull();
    expect(e.gapFilled).toBeNull();
    expect(e.mfe).toBeNull();
    expect(e.high).toBeNull();
    expect(e.continued).toBeNull();
    expect(e.completeRegular).toBe(false);
  });
  it("partial bars cannot look ahead beyond asOf", () => {
    const e = analyzeSession(
      "AAPL",
      sampleBars(),
      previous,
      session,
      4,
      "up",
      marketTime(session.date, "09:34"),
    ).event!;
    expect(e.regularBars).toBe(4);
    expect(e.return5m).toBeNull();
    expect(e.close).toBeNull();
  });
  it("reverse direction has signed directional excursions", () => {
    expect(calculateMFE(100, 103, 94, "down")).toBeCloseTo(6);
    expect(calculateMAE(100, 103, 94, "down")).toBeCloseTo(-3);
    const bars = sampleBars().map((b) => ({
      ...b,
      o: 200 - b.o,
      c: 200 - b.c,
      h: 200 - b.l,
      l: 200 - b.h,
    }));
    const e = analyze(bars, 4, "down").event!;
    expect(e.side).toBe("down");
    expect(e.maxGap).toBeCloseTo(-4.3);
    expect(e.gapHeld).toBe(true);
  });
  it("Both does not duplicate sessions; same-minute ordering remains unknown", () => {
    const bars = sampleBars();
    bars[2].l = 95;
    const e = analyze(bars, 4, "both").event!;
    expect(e.triggers).toHaveLength(2);
    expect(e.ambiguousDirection).toBe(true);
    expect(e.mfe).toBeNull();
    expect(deduplicateEvents([e, e])).toHaveLength(1);
  });
  it("higher thresholds cannot add sessions", () => {
    const thresholds = [1, 2, 4, 5, 10].map((t) =>
      Number(analyze(undefined, t).event !== null),
    );
    expect(thresholds).toEqual([1, 1, 1, 0, 0]);
  });
  it("reports exceeding the extended high independently of down-direction continuation", () => {
    const regular = sampleBars().filter((b) => b.t >= session.open);
    const outcome = calculateSessionReturns(
      regular,
      session,
      110,
      102.5,
      100,
      "down",
      end,
    );
    expect(outcome.continued).toBe(false);
    expect(outcome.exceededExtendedHigh).toBe(true);
    expect(
      calculateSessionReturns(
        regular.slice(1),
        session,
        110,
        104,
        100,
        "down",
        end,
      ).exceededExtendedHigh,
    ).toBeNull();
    expect(
      calculateSessionReturns(
        regular.slice(1),
        session,
        110,
        102.5,
        100,
        "down",
        end,
        true,
      ).exceededExtendedHigh,
    ).toBe(true);
  });
  it("summary excludes missing observations and exposes denominators", () => {
    const e = analyze().event!;
    const s = summarize([
      e,
      { ...e, id: "other", openToClose: null, gapHeld: null },
    ]);
    expect(s.events).toBe(2);
    expect(s.metrics.openToClose.n).toBe(1);
    expect(s.metrics.gapHeld).toEqual({ value: 100, n: 1 });
    expect(s.best?.value).toBe(e.openToClose);
    expect(summarize([]).metrics.openToClose.value).toBeNull();
  });
  it("reports absent extended bars as insufficient", () => {
    expect(
      analyze(
        sampleBars().filter(
          (b) =>
            b.t === previousRegularClose(sampleBars(), previous)?.t ||
            b.t >= session.open,
        ),
      ).insufficient,
    ).toMatch(/extended/);
  });
});
describe("market sessions", () => {
  it("DST shifts UTC boundaries without shifting 09:30 ET", () => {
    expect(previous.open).toBe("2025-03-07T14:30:00.000Z");
    expect(session.open).toBe("2025-03-10T13:30:00.000Z");
    expect(marketTime("2025-11-03", "09:30")).toBe("2025-11-03T14:30:00.000Z");
  });
  it("honors supplied holiday calendar and early close", () => {
    const p = {
      date: "2025-07-03",
      open: marketTime("2025-07-03", "09:30"),
      close: marketTime("2025-07-03", "13:00"),
    };
    const s = {
      date: "2025-07-07",
      open: marketTime("2025-07-07", "09:30"),
      close: marketTime("2025-07-07", "16:00"),
    };
    expect(scannerSessions([p, s], marketTime("2025-07-04", "12:00"))).toEqual({
      previous: p,
      session: s,
    });
    expect(
      extendedBars(
        [
          bar(p.date, "13:00", 101),
          bar("2025-07-04", "08:00", 102),
          bar(s.date, "04:00", 103),
        ],
        p,
        s,
      ),
    ).toHaveLength(2);
    const r = Array.from({ length: 210 }, (_, i) => ({
      ...bar(p.date, "09:30", 100),
      t: new Date(Date.parse(p.open) + i * 60000).toISOString(),
    }));
    expect(
      calculateSessionReturns(
        r,
        p,
        99,
        101,
        98,
        "up",
        end.replace("03-11", "07-08"),
      ).completeRegular,
    ).toBe(true);
  });
  it("midday scanner keeps prior overnight; after close moves to next session", () => {
    const next = {
      date: "2025-03-11",
      open: marketTime("2025-03-11", "09:30"),
      close: marketTime("2025-03-11", "16:00"),
    };
    expect(
      scannerSessions(
        [previous, session, next],
        marketTime(session.date, "12:00"),
      ).session,
    ).toEqual(session);
    expect(
      scannerSessions([previous, session, next], session.close).previous,
    ).toEqual(session);
    expect(
      extendedBars(sampleBars(), previous, session, end).every(
        (b) => b.t < session.open,
      ),
    ).toBe(true);
  });
  it("doesn't stretch after-hours through the weekend or accept 20:00 bars", () => {
    expect(
      extendedBars(
        [
          bar(previous.date, "20:00", 105),
          bar("2025-03-08", "10:00", 110),
          bar(session.date, "03:59", 105),
        ],
        previous,
        session,
      ),
    ).toEqual([]);
  });
  it("chunks arbitrary ranges without gaps or overlaps", () => {
    expect(chunksOfDates("2025-01-01", "2025-01-10")).toEqual([
      { start: "2025-01-01", end: "2025-01-07" },
      { start: "2025-01-08", end: "2025-01-10" },
    ]);
  });
});
describe("scanner", () => {
  const asset = {
    symbol: "AAPL",
    name: "Apple",
    exchange: "NASDAQ",
    status: "active",
    tradable: true,
    class: "us_equity",
  };
  it("uses latest extended close, not noon price, and genuine volume", () => {
    const row = createScannerRow(asset, sampleBars(), previous, session, end)!;
    expect(row.price).toBe(101.5);
    expect(row.gap).toBeCloseTo(1.5);
    expect(row.volume).toBe(40);
    expect(row.dollarVolume).toBe(4060);
    expect(row.relativeVolume).toBeNull();
    expect(row.marketCap).toBeNull();
    expect(scannerTrigger(row, 4, "up").firstTime).toBe(
      marketTime(session.date, "06:10"),
    );
  });
  it("threshold/filter invariants; unavailable filter values are excluded", () => {
    const row = createScannerRow(asset, sampleBars(), previous, session, end)!;
    const rows = [row, { ...row, symbol: "NVDA", gap: 5, price: 105 }];
    expect(
      filterScannerRows(rows, { threshold: 1, direction: "up" }),
    ).toHaveLength(2);
    expect(
      filterScannerRows(rows, { threshold: 5, direction: "up" }),
    ).toHaveLength(1);
    for (const f of [
      { minPrice: 106 },
      { maxPrice: 100 },
      { minVolume: 41 },
      { minDollarVolume: 4061 },
      { minRelativeVolume: 1 },
      { minMarketCap: 1 },
    ])
      expect(
        filterScannerRows(rows, { threshold: 1, direction: "up", ...f }),
      ).toHaveLength(0);
  });
  it("links to Yahoo Finance with its share-class and preferred-share notation", () => {
    expect(yahooFinanceLink("AAPL")).toBe(
      "https://finance.yahoo.com/quote/AAPL/",
    );
    expect(yahooFinanceLink("BRK.B")).toBe(
      "https://finance.yahoo.com/quote/BRK-B/",
    );
    expect(yahooFinanceLink("ABR.PRD")).toBe(
      "https://finance.yahoo.com/quote/ABR-PD/",
    );
    expect(yahooFinanceLink("TEST")).toBe(
      "https://finance.yahoo.com/quote/TEST/",
    );
  });
});
