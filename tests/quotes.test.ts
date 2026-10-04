import { describe, expect, it } from "vitest";
import {
  calculateSessionQuote,
  filterScannerRows,
  createScannerRow,
} from "../src/lib/domain/scanner";
import { bar, previous, session, sampleBars } from "./fixtures";
import { marketTime } from "../src/lib/domain/time";
import type { StockSnapshot } from "../src/lib/domain/types";

// Controlled inputs only for deterministic financial calculations.
const snapshot: StockSnapshot = {
  latestTrade: { p: 110, t: marketTime(session.date, "12:00") },
  dailyBar: bar(session.date, "00:00", 104, {
    c: 110,
    h: 111,
    l: 103,
    v: 123456,
  }),
  prevDailyBar: bar(previous.date, "00:00", 100),
};
const now = marketTime(session.date, "12:01");
describe("current-session quote calculations", () => {
  it("separates price change, opening gap and movement from the open", () => {
    const result = calculateSessionQuote(snapshot, session, previous, now);
    expect(result.price).toBe(110);
    expect(result.priceChange).toBeCloseTo(10);
    expect(result.openingGap).toBeCloseTo(4);
    expect(result.changeFromOpen).toBeCloseTo(100 * (110 / 104 - 1));
    expect(result.volume).toBe(123456);
    expect(result.sessionDate).toBe(session.date);
  });
  it("does not call yesterday's open or volume today's before the market opens", () => {
    const result = calculateSessionQuote(
      {
        latestTrade: { p: 102, t: marketTime(session.date, "08:00") },
        dailyBar: snapshot.prevDailyBar,
      },
      session,
      previous,
      marketTime(session.date, "08:01"),
    );
    expect(result.priceChange).toBeCloseTo(2);
    expect(result.open).toBeNull();
    expect(result.openingGap).toBeNull();
    expect(result.changeFromOpen).toBeNull();
    expect(result.volume).toBeNull();
  });
  it("withholds an opening metric before the regular open even when daily data exists", () => {
    const result = calculateSessionQuote(
      snapshot,
      session,
      previous,
      marketTime(session.date, "08:00"),
    );
    expect(result.openingGap).toBeNull();
    expect(result.price).toBeNull();
  });
  it("does not compare stale previous-date data or stale trades to today's open", () => {
    const result = calculateSessionQuote(
      {
        ...snapshot,
        latestTrade: { p: 99, t: marketTime(previous.date, "15:00") },
        prevDailyBar: bar("2025-03-06", "00:00", 100),
      },
      session,
      previous,
      now,
    );
    expect(result.price).toBe(99);
    expect(result.priceChange).toBeNull();
    expect(result.openingGap).toBeNull();
    expect(result.changeFromOpen).toBeNull();
  });
  it("uses the supplied trading calendar date on weekends and respects delayed quotes", () => {
    const friday = {
      ...session,
      date: "2025-03-14",
      open: marketTime("2025-03-14", "09:30"),
      close: marketTime("2025-03-14", "16:00"),
    };
    const thursday = {
      ...previous,
      date: "2025-03-13",
      open: marketTime("2025-03-13", "09:30"),
      close: marketTime("2025-03-13", "16:00"),
    };
    const s = {
      latestTrade: { p: 110, t: marketTime(friday.date, "17:00") },
      dailyBar: bar(friday.date, "00:00", 104),
      prevDailyBar: bar(thursday.date, "00:00", 100),
    };
    const quote = calculateSessionQuote(
      s,
      friday,
      thursday,
      marketTime("2025-03-15", "12:00"),
    );
    expect(quote.openingGap).toBeCloseTo(4);
    expect(quote.priceChange).toBeCloseTo(10);
    expect(
      calculateSessionQuote(
        s,
        friday,
        thursday,
        marketTime(friday.date, "17:05"),
        marketTime(friday.date, "16:49"),
      ).price,
    ).toBeNull();
  });
  it("uses a dated split-adjusted daily reference and never silently falls back when it is missing", () => {
    const raw = { ...snapshot, prevDailyBar: bar(previous.date, "00:00", 5) };
    const q = calculateSessionQuote(
      raw,
      session,
      previous,
      now,
      now,
      bar(previous.date, "00:00", 100),
    );
    expect(q.openingGap).toBeCloseTo(4);
    expect(q.priceChange).toBeCloseTo(10);
    expect(
      calculateSessionQuote(raw, session, previous, now, now, null).openingGap,
    ).toBeNull();
  });
  it("leaves missing provider fields unavailable", () => {
    const q = calculateSessionQuote({}, session, previous, now);
    for (const key of [
      "price",
      "priceTime",
      "previousClose",
      "open",
      "priceChange",
      "openingGap",
      "changeFromOpen",
      "volume",
    ] as const)
      expect(q[key]).toBeNull();
  });
  it("filters current price and day volume separately from the overnight gap", () => {
    const row = createScannerRow(
      {
        symbol: "TEST",
        name: "Calculation fixture",
        exchange: "NASDAQ",
        status: "active",
        tradable: true,
        class: "us_equity",
      },
      sampleBars(),
      previous,
      session,
      now,
    )!;
    row.quote = calculateSessionQuote(snapshot, session, previous, now);
    expect(row.price).toBe(101.5);
    expect(
      filterScannerRows([row], {
        threshold: 1,
        direction: "up",
        minPrice: 105,
        minSessionVolume: 100000,
      }),
    ).toHaveLength(1);
    expect(
      filterScannerRows([row], {
        threshold: 1,
        direction: "up",
        maxPrice: 105,
      }),
    ).toHaveLength(0);
    expect(
      filterScannerRows([row], {
        threshold: 1,
        direction: "up",
        minSessionVolume: 200000,
      }),
    ).toHaveLength(0);
    expect(
      filterScannerRows([row], { threshold: 4, direction: "up" }),
    ).toHaveLength(0);
  });
});
