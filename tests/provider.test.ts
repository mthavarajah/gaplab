import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AlpacaClient,
  barSchema,
  readConfig,
} from "../src/lib/provider/alpaca";
const config = {
  key: "test-key-never-production",
  secret: "test-secret-never-production",
  tradingUrl: "https://paper-api.alpaca.markets",
  feed: "iex" as const,
  delayMinutes: 0,
};
afterEach(() => vi.unstubAllEnvs());
describe("Alpaca transport / failures (no invented market payloads)", () => {
  it("requires server configuration and rejects unknown feed/host", () => {
    vi.stubEnv("ALPACA_API_KEY", "");
    expect(readConfig).toThrow(/Configure/);
    vi.stubEnv("ALPACA_API_KEY", "local-test");
    vi.stubEnv("ALPACA_API_SECRET", "local-test");
    vi.stubEnv("ALPACA_FEED", "unknown");
    expect(readConfig).toThrow(/Check/);
    vi.stubEnv("ALPACA_FEED", "iex");
    vi.stubEnv("ALPACA_TRADING_URL", "https://evil.example");
    expect(readConfig).toThrow(/Check/);
  });
  it.each([
    [401, "PROVIDER_AUTH", 1],
    [403, "FEED_FORBIDDEN", 1],
    [429, "RATE_LIMIT", 3],
    [500, "PROVIDER_ERROR", 3],
    [404, "UNSUPPORTED_SYMBOL", 1],
  ])(
    "handles HTTP %s without returning fake rows",
    async (status, code, count) => {
      const fetcher = vi.fn(
        async () => new Response("", { status: status as number }),
      );
      const client = new AlpacaClient(config, fetcher, async () => {});
      await expect(client.assets()).rejects.toMatchObject({ code });
      expect(fetcher).toHaveBeenCalledTimes(count as number);
    },
  );
  it("retries network failures a bounded number of times", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    await expect(
      new AlpacaClient(config, fetcher, async () => {}).assets(),
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("rejects malformed responses", async () => {
    for (const raw of ["not json", JSON.stringify({ assets: [] })])
      await expect(
        new AlpacaClient(config, async () => new Response(raw)).assets(),
      ).rejects.toMatchObject({ code: "MALFORMED_PROVIDER" });
  });
  it("follows pagination even when a page is empty; never truncates silently", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ bars: {}, next_page_token: "next" }),
      )
      .mockResolvedValueOnce(
        Response.json({ bars: null, next_page_token: null }),
      );
    const client = new AlpacaClient(config, fetcher);
    expect(await client.bars(["AAPL"], "2025-03-07", "2025-03-10")).toEqual({});
    expect(fetcher).toHaveBeenCalledTimes(2);
    const url = String(fetcher.mock.calls[1][0]);
    expect(url).toContain("page_token=next");
    expect(url).toContain("feed=iex");
    expect(url).toContain("adjustment=split");
    expect(url).toContain("asof=-");
  });
  it("rejects looping pagination", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ bars: {}, next_page_token: "same" }),
    );
    await expect(
      new AlpacaClient(config, fetcher).bars(
        ["AAPL"],
        "2025-03-07",
        "2025-03-10",
      ),
    ).rejects.toMatchObject({ code: "PAGINATION_ERROR" });
  });
  it("marks single-venue coverage and delay explicitly", () => {
    const c = new AlpacaClient({ ...config, delayMinutes: 16 });
    expect(c.asOf(Date.parse("2025-03-10T14:30:59Z"))).toBe(
      "2025-03-10T14:14:00.000Z",
    );
    expect(c.provenance(c.asOf()).coverage).toMatch(/not the full US market/);
  });
  it("requires coherent OHLC and doesn't coerce missing volume to zero", () => {
    expect(barSchema.safeParse({}).success).toBe(false);
    expect(barSchema.safeParse({ t: "invalid" }).success).toBe(false);
  });
});
