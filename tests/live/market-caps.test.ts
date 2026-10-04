import { expect, it } from "vitest";
import { getMarketCaps } from "../../src/lib/provider/market-caps";
it("retrieves real bulk stock market caps with exact class mapping", async () => {
  const result = await getMarketCaps();
  expect(Object.keys(result.values).length).toBeGreaterThan(1000);
  for (const symbol of ["AAPL", "NVDA", "TSLA", "BRK.B"]) {
    expect(Number.isFinite(result.values[symbol])).toBe(true);
    expect(result.values[symbol]).toBeGreaterThan(0);
  }
  expect(Number.isFinite(Date.parse(result.fetchedAt))).toBe(true);
  expect(result.source).toBe("Nasdaq");
}, 60000);
