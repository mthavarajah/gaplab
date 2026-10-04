import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as scan } from "../src/app/api/scan/route";
import { POST as backtest } from "../src/app/api/backtest/route";
import { POST as eventChart } from "../src/app/api/backtest/chart/route";
import { GET as status } from "../src/app/api/status/route";
import { GET as context } from "../src/app/api/scan/context/route";
import { backtestSchema } from "../src/lib/domain/validation";
const request = (body: unknown) =>
  new Request("http://localhost/api/backtest", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
afterEach(() => vi.unstubAllEnvs());
describe("Route handlers", () => {
  it("validates event chart dates, symbol and snapshot before provider access", async () => {
    for (const value of [
      {},
      { symbol: "BAD!", date: "2025-01-02", asOf: "2025-01-03T00:00:00Z" },
      { symbol: "AAPL", date: "2025-02-30", asOf: "2025-03-01T00:00:00Z" },
    ])
      expect((await eventChart(request(value))).status).toBe(400);
  });
  it("rejects invalid ticker/threshold/dates before provider access", async () => {
    for (const body of [
      {},
      {
        symbol: "<script>",
        threshold: 4,
        direction: "up",
        start: "2025-01-01",
        end: "2025-01-07",
      },
      {
        symbol: "AAPL",
        threshold: 0,
        direction: "up",
        start: "2025-01-01",
        end: "2025-01-07",
      },
      {
        symbol: "AAPL",
        threshold: 4,
        direction: "up",
        start: "2025-02-30",
        end: "2025-03-01",
      },
    ])
      expect((await backtest(request(body))).status).toBe(400);
  });
  it("rejects invalid direction/down threshold and inverted dates", () => {
    const b = {
      symbol: "AAPL",
      threshold: 4,
      direction: "up",
      start: "2025-01-01",
      end: "2025-01-07",
    };
    expect(
      backtestSchema.safeParse({ ...b, threshold: 100, direction: "down" })
        .success,
    ).toBe(false);
    expect(
      backtestSchema.safeParse({ ...b, start: "2025-02-01" }).success,
    ).toBe(false);
    expect(
      backtestSchema.safeParse({ ...b, direction: "sideways" }).success,
    ).toBe(false);
  });
  it("normalizes ticker casing", () => {
    expect(
      backtestSchema.parse({
        symbol: " aapl ",
        threshold: 4,
        direction: "up",
        start: "2025-01-01",
        end: "2025-01-07",
      }).symbol,
    ).toBe("AAPL");
  });
  it("limits scanner batches and validates cutoff", async () => {
    expect((await scan(request({ symbols: [], asOf: "bad" }))).status).toBe(
      400,
    );
    expect(
      (
        await scan(
          request({
            symbols: Array(51).fill("AAPL"),
            asOf: "2025-01-01T12:00:00Z",
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("reports missing provider credentials with no fabricated data", async () => {
    vi.stubEnv("ALPACA_API_KEY", "");
    const response = await context();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_CONFIGURED");
    expect(body.rows).toBeUndefined();
  });
  it("status exposes configuration flags but never keys", async () => {
    vi.stubEnv("ALPACA_API_KEY", "secret-key-sentinel");
    vi.stubEnv("ALPACA_API_SECRET", "secret-value-sentinel");
    const body = await (await status()).text();
    expect(body).not.toContain("sentinel");
    expect(JSON.parse(body).configured).toBe(true);
  });
  it("rejects cross-origin mutation, oversized and malformed bodies", async () => {
    expect(
      (
        await scan(
          new Request("http://localhost/api/scan", {
            method: "POST",
            headers: { origin: "https://evil.example" },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await scan(
          new Request("http://localhost/api/scan", {
            method: "POST",
            body: "x".repeat(16001),
          }),
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await scan(
          new Request("http://localhost/api/scan", {
            method: "POST",
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("accepts same-origin browser requests when Next uses an internal hostname", async () => {
    const response = await scan(
      new Request("http://localhost:3000/api/scan", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_INPUT");
  });
});
