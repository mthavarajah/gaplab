import { expect, it, vi } from "vitest";
import {
  loadSavedPremarket,
  withPremarketMetrics,
} from "../src/lib/client/premarket";
import {
  createOpeningScannerRow,
  calculateSessionQuote,
} from "../src/lib/domain/scanner";
import { session, previous } from "./fixtures";
it("adds historical premarket fields while preserving the saved price quote and existing cap", () => {
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
  const next = withPremarketMetrics([row], {
    sessionDate: session.date,
    warnings: [],
    metrics: {
      TEST: { price: 104, change: 4, volume: 300, time: session.open },
    },
  });
  expect(next[0].quote).toBe(row.quote);
  expect(next[0].marketCap).toBe(row.marketCap);
  expect(next[0].premarketPrice).toBe(104);
  expect(next[0].premarketVolume).toBe(300);
  expect(row.premarketPrice).toBeUndefined();
  expect(
    withPremarketMetrics([row], {
      sessionDate: session.date,
      warnings: [],
      metrics: {},
    })[0],
  ).toBe(row);
});

it("keeps successful batches visible when another provider batch fails", async () => {
  const workflows = await import("../src/lib/client/workflows");
  const spy = vi.spyOn(workflows, "request");
  spy.mockImplementation(async (_url, options) => {
    const body = JSON.parse(String(options?.body)) as { symbols: string[] };
    if (body.symbols.length === 50) throw new Error("Temporary outage");
    return {
      sessionDate: session.date,
      warnings: [],
      metrics: {
        X50: { price: 104, change: 4, volume: 300, time: session.open },
      },
    };
  });
  const batches = vi.fn();
  try {
    const result = await loadSavedPremarket(
      Array.from({ length: 51 }, (_, i) => `X${i}`),
      session.open,
      new AbortController().signal,
      batches,
    );
    expect(result.failures).toHaveLength(1);
    expect(result.metrics.X50.volume).toBe(300);
    expect(batches).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});
