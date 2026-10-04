import { describe, expect, it } from "vitest";
import { analyzeSession, summarize } from "../src/lib/domain/calculations";
import {
  calculateSessionQuote,
  createOpeningScannerRow,
  filterScannerRows,
  matchesGapAndGo,
} from "../src/lib/domain/scanner";
import { bar, previous, session, sampleBars } from "./fixtures";
import { marketTime } from "../src/lib/domain/time";
import type { Bar, Direction } from "../src/lib/domain/types";

// Controlled fixtures for deterministic calculations only; never market payloads.
const prior = bar(previous.date, "00:00", 100);
const completed = marketTime("2025-03-11", "08:00");
const daily = (open: number, close: number) =>
  bar(session.date, "00:00", open, {
    c: close,
    h: Math.max(open, close) + 1,
    l: Math.min(open, close) - 1,
    v: 10000,
  });
const analyze = (day: Bar, source: Bar[] = [], direction: Direction = "up") =>
  analyzeSession("TEST", source, previous, session, 4, direction, completed, {
    rule: "opening",
    previousDaily: prior,
    daily: day,
  });
const quote = (open: number, price: number) =>
  calculateSessionQuote(
    {
      dailyBar: daily(open, price),
      prevDailyBar: prior,
      latestTrade: { p: price, t: marketTime(session.date, "15:59") },
    },
    session,
    previous,
    completed,
  );

describe("opening gap and go selection", () => {
  it("selects opening gaps even when the latest price is flat or below the open", () => {
    expect(matchesGapAndGo(quote(104, 106), 4, "up")).toBe(true);
    expect(matchesGapAndGo(quote(104, 103), 4, "up")).toBe(true);
    expect(matchesGapAndGo(quote(104, 104), 4, "up")).toBe(true);
    expect(matchesGapAndGo(quote(102, 110), 4, "up")).toBe(false);
    expect(matchesGapAndGo(quote(104, 106), 5, "up")).toBe(false);
  });
  it("supports either gap direction regardless of later reversals", () => {
    expect(matchesGapAndGo(quote(96, 93), 4, "down")).toBe(true);
    expect(matchesGapAndGo(quote(96, 97), 4, "both")).toBe(true);
    expect(matchesGapAndGo(quote(104, 106), 4, "both")).toBe(true);
    expect(matchesGapAndGo(quote(96, 93), 4, "both")).toBe(true);
    expect(matchesGapAndGo(null, 4, "up")).toBe(false);
    expect(
      matchesGapAndGo({ ...quote(104, 106), changeFromOpen: null }, 4, "up"),
    ).toBe(true);
  });
  it("uses distinct denominators, not addition of percentage changes", () => {
    const q = quote(104, 110);
    expect(q.openingGap).toBeCloseTo(4);
    expect(q.changeFromOpen).toBeCloseTo(5.769230769);
    expect(q.priceChange).toBeCloseTo(10);
  });
  it("does not require extended-hours trades for a regular opening gap", () => {
    const row = createOpeningScannerRow(
      {
        symbol: "TEST",
        name: "Fixture",
        exchange: "NASDAQ",
        status: "active",
        tradable: true,
        class: "us_equity",
      },
      quote(104, 106),
    );
    expect(row.gap).toBeNull();
    expect(row.extendedBars).toEqual([]);
    expect(
      filterScannerRows([row], {
        mode: "gap-and-go",
        threshold: 4,
        direction: "up",
      }),
    ).toHaveLength(1);
    expect(
      filterScannerRows([row], {
        mode: "extended",
        threshold: 4,
        direction: "up",
      }),
    ).toHaveLength(0);
  });
});

describe("historical opening-gap cohort", () => {
  it("rejects a premarket threshold crossing that fades before the open", () => {
    expect(analyze(daily(102, 103), sampleBars()).event).toBeNull();
    expect(
      analyzeSession(
        "TEST",
        sampleBars(),
        previous,
        session,
        4,
        "up",
        completed,
      ).event,
    ).not.toBeNull();
  });
  it("includes gaps that later fail, so continuation is an outcome", () => {
    const winner = analyze(daily(104, 106)).event!;
    const loser = analyze(daily(104, 102)).event!;
    expect(winner.firstTrigger.time).toBe(session.open);
    expect(winner.openReturn).toBeCloseTo(4);
    expect(winner.extendedHigh).toBeNull();
    expect(loser.openToClose).toBeLessThan(0);
    expect(
      summarize([winner, { ...loser, id: "TEST:another", date: "2025-03-11" }])
        .metrics.continuedFromOpen,
    ).toEqual({ value: 50, n: 2 });
  });
  it("uses daily OHLC for full-session outcomes while leaving unobserved fill time unavailable", () => {
    const e = analyze(daily(104, 99)).event!;
    expect(e.gapFilled).toBe(true);
    expect(e.gapFillTime).toBeNull();
    expect(e.high).toBe(105);
    expect(e.low).toBe(98);
    expect(e.previousClose).toBe(100);
    expect(e.mfe).toBeCloseTo((105 / 104 - 1) * 100);
    expect(e.openToClose).toBeCloseTo((99 / 104 - 1) * 100);
  });
  it("evaluates downward continuation without inverting displayed stock returns", () => {
    const e = analyze(daily(96, 93), [], "both").event!;
    expect(e.side).toBe("down");
    expect(e.continuedFromOpen).toBe(true);
    expect(e.openReturn).toBeCloseTo(-4);
    expect(e.openToClose).toBeLessThan(0);
  });
  it("rejects missing or stale daily references instead of substituting a different session", () => {
    const options = { rule: "opening" as const, daily: daily(104, 106) };
    expect(
      analyzeSession(
        "TEST",
        sampleBars(),
        previous,
        session,
        4,
        "up",
        completed,
        options,
      ).insufficient,
    ).toMatch(/daily close/);
    expect(
      analyzeSession("TEST", [], previous, session, 4, "up", completed, {
        ...options,
        previousDaily: bar("2025-03-06", "00:00", 100),
      }).event,
    ).toBeNull();
  });
  it("does not use the eventual daily open or close before that session is available", () => {
    const r = analyzeSession(
      "TEST",
      [],
      previous,
      session,
      4,
      "up",
      marketTime(session.date, "08:00"),
      { rule: "opening", previousDaily: prior, daily: daily(104, 106) },
    );
    expect(r.event).toBeNull();
    expect(r.insufficient).toMatch(/opening price/);
  });
});
