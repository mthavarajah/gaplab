import { expect, it } from "vitest";
import {
  calculateSessionMetrics,
  rowsForSession,
} from "../src/lib/domain/session-metrics";
import { bar, previous, session } from "./fixtures";
import { marketTime } from "../src/lib/domain/time";

it("separates post-market, premarket and combined overnight across weekend/DST", () => {
  const bars = [
    bar(previous.date, "15:59", 100),
    bar(previous.date, "16:00", 101),
    bar(previous.date, "19:59", 102),
    bar(previous.date, "20:00", 999),
    bar(session.date, "03:59", 999),
    bar(session.date, "07:59", 104),
    bar(session.date, "08:00", 105),
    bar(session.date, "09:30", 120),
  ];
  const context = {
    previous,
    session,
    quotePrevious: previous,
    quoteSession: session,
    asOf: marketTime(session.date, "08:00"),
  };
  const metrics = calculateSessionMetrics(
    bars,
    [bar(previous.date, "00:00", 100)],
    context,
  );
  expect(metrics.postmarket.change).toBeCloseTo(2);
  expect(metrics.postmarket.volume).toBe(20);
  expect(metrics.postmarket.date).toBe(previous.date);
  expect(metrics.premarket.change).toBeCloseTo(4);
  expect(metrics.premarket.volume).toBe(10);
  expect(metrics.premarket.date).toBe(session.date);
  expect(metrics.overnight.change).toBeCloseTo(4);
  expect(metrics.overnight.volume).toBe(30);
  expect(metrics.overnight.time).toBe("2025-03-10T11:59:00.000Z");
});

it("uses Friday post-market on Saturday while retaining Friday premarket separately", () => {
  const thursday = {
    date: "2025-03-06",
    open: marketTime("2025-03-06", "09:30"),
    close: marketTime("2025-03-06", "16:00"),
  };
  const context = {
    previous,
    session,
    quotePrevious: thursday,
    quoteSession: previous,
    asOf: marketTime("2025-03-08", "12:00"),
  };
  const metrics = calculateSessionMetrics(
    [bar(previous.date, "07:59", 104.99), bar(previous.date, "19:59", 110.13)],
    [bar(thursday.date, "00:00", 100), bar(previous.date, "00:00", 110)],
    context,
  );
  expect(metrics.premarket.change).toBeCloseTo(4.99);
  expect(metrics.postmarket.change).toBeCloseTo(0.11818, 4);
  expect(metrics.overnight).toEqual(metrics.postmarket);
  expect(metrics.postmarket.volume).toBe(10);
});

it("leaves missing bars/reference unavailable and preserves observed zero volume", () => {
  const context = {
    previous,
    session,
    quotePrevious: previous,
    quoteSession: session,
    asOf: session.open,
  };
  const empty = calculateSessionMetrics([], [], context);
  expect(empty.premarket.change).toBeNull();
  expect(empty.premarket.volume).toBeNull();
  const missing = calculateSessionMetrics(
    [{ ...bar(session.date, "07:59", 104), v: 0 }],
    [],
    context,
  );
  expect(missing.premarket.price).toBe(104);
  expect(missing.premarket.volume).toBe(0);
  expect(missing.premarket.change).toBeNull();
});

it("uses the selected session for independent change and volume filters", async () => {
  const { createOpeningScannerRow, calculateSessionQuote, filterScannerRows } =
    await import("../src/lib/domain/scanner");
  const row = createOpeningScannerRow(
    {
      symbol: "TEST",
      name: "Test",
      exchange: "NASDAQ",
      status: "active",
      tradable: true,
      class: "us_equity",
    },
    calculateSessionQuote({}, session, previous, session.open),
  );
  row.sessionMetrics = calculateSessionMetrics(
    [bar(previous.date, "19:59", 102), bar(session.date, "07:59", 104)],
    [bar(previous.date, "00:00", 100)],
    {
      previous,
      session,
      quotePrevious: previous,
      quoteSession: session,
      asOf: session.open,
    },
  );
  const filters = {
    mode: "all" as const,
    threshold: 0,
    direction: "up" as const,
    minPremarketChange: 3,
    minPremarketVolume: 10,
  };
  expect(
    filterScannerRows(rowsForSession([row], "premarket"), filters),
  ).toHaveLength(1);
  expect(
    filterScannerRows(rowsForSession([row], "postmarket"), filters),
  ).toHaveLength(0);
  expect(
    filterScannerRows(rowsForSession([row], "overnight"), {
      ...filters,
      minPremarketVolume: 20,
      maxPremarketVolume: 20,
    }),
  ).toHaveLength(1);
  expect(row.premarketChange).toBeUndefined();
});
