import { describe, expect, it, vi } from "vitest";
import {
  nasdaqSymbol,
  parseMarketCaps,
  withMarketCaps,
} from "../src/lib/domain/market-caps";
import { MarketCapClient } from "../src/lib/provider/market-caps";
import { createOpeningScannerRow } from "../src/lib/domain/scanner";
vi.mock("../src/lib/db/cache", () => ({
  cacheKey: () => "test",
  cached: async (
    _key: string,
    _kind: string,
    _ttl: number,
    load: () => Promise<unknown>,
  ) => ({ value: await load() }),
}));
const stamp = "2026-10-03T12:00:00.000Z";
const payload = {
  data: {
    asOf: null,
    rows: [
      { symbol: "TEST", marketCap: "1234567890.25" },
      { symbol: "BRK/B", marketCap: "900000000000" },
      { symbol: "ABC^D", marketCap: "" },
    ],
  },
};
describe("market-cap parsing and security matching", () => {
  it("keeps exact USD values and source retrieval time", () => {
    const result = parseMarketCaps(payload, stamp);
    expect(result.values.TEST).toBe(1234567890.25);
    expect(result.fetchedAt).toBe(stamp);
    expect(result.sourceAsOf).toBeNull();
    expect(result.source).toBe("Nasdaq");
  });
  it("maps classes and preferreds without merging them with common shares", () => {
    expect(nasdaqSymbol(" brk/b ")).toBe("BRK.B");
    expect(nasdaqSymbol("ABC^D")).toBe("ABC.PRD");
    const result = parseMarketCaps(payload, stamp);
    expect(result.values["BRK.B"]).toBe(900000000000);
    expect(result.values.BRK).toBeUndefined();
    expect(result.values["ABC.PRD"]).toBeUndefined();
  });
  it("rejects missing, zero, negative, nonnumeric and conflicting values", () => {
    const result = parseMarketCaps(
      {
        data: {
          rows: [
            ...payload.data.rows,
            ...["", "N/A", "0", "-1", "NaN", "Infinity", "12B"].map(
              (marketCap, i) => ({ symbol: `BAD${i}`, marketCap }),
            ),
            { symbol: "CONFLICT", marketCap: "100" },
            { symbol: "CONFLICT", marketCap: "200" },
          ],
        },
      },
      stamp,
    );
    expect(Object.keys(result.values).sort()).toEqual(["BRK.B", "TEST"]);
    expect(() => parseMarketCaps({ data: { rows: [] } }, stamp)).toThrow();
    expect(() => parseMarketCaps({ error: "unavailable" }, stamp)).toThrow();
  });
  it("enriches saved rows without changing scan prices or inventing fund caps", () => {
    const make = (symbol: string) =>
      createOpeningScannerRow(
        {
          symbol,
          name: symbol,
          exchange: "NASDAQ",
          status: "active",
          tradable: true,
          class: "us_equity",
        },
        {
          sessionDate: "2026-10-02",
          price: 100,
          priceTime: stamp,
          previousClose: 90,
          open: 95,
          priceChange: 11.11,
          openingGap: 5.55,
          changeFromOpen: 5.26,
          volume: 10,
          fetchedAt: stamp,
        },
      );
    const rows = [make("TEST"), make("SPY")];
    const result = withMarketCaps(rows, parseMarketCaps(payload, stamp));
    expect(result[0].marketCap).toBe(1234567890.25);
    expect(result[0].quote).toBe(rows[0].quote);
    expect(result[1].marketCap).toBeNull();
    expect(result[1].marketCapInfo?.fetchedAt).toBe(stamp);
    expect(rows[0].marketCap).toBeNull();
  });
});
describe("bulk market-cap retrieval", () => {
  it("shares one request across concurrent batches and reuses it for 30 minutes", async () => {
    let now = Date.parse(stamp);
    const fetcher = vi.fn(async () => Response.json(payload));
    const client = new MarketCapClient(fetcher, () => now);
    const result = await Promise.all(
      Array.from({ length: 20 }, () => client.load()),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.every((r) => r === result[0])).toBe(true);
    now += 29 * 60000;
    await client.load();
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 2 * 60000;
    await client.load();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("backs off after failure and later recovers without caching a bogus empty list", async () => {
    let now = Date.parse(stamp);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json(payload));
    const client = new MarketCapClient(fetcher, () => now);
    await expect(client.load()).rejects.toThrow(
      "Market caps could not be loaded",
    );
    await expect(client.load()).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 61000;
    expect((await client.load()).values.TEST).toBeGreaterThan(0);
  });
  it("honors the provider retry-after on rate limits", async () => {
    let now = Date.parse(stamp);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "180" },
        }),
      )
      .mockResolvedValueOnce(Response.json(payload));
    const client = new MarketCapClient(fetcher, () => now);
    await expect(client.load()).rejects.toThrow();
    now += 61000;
    await expect(client.load()).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 120000;
    await client.load();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
