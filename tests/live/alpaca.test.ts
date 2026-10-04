import { config } from "dotenv";
import { describe, expect, it } from "vitest";
import { AlpacaClient, barSchema } from "../../src/lib/provider/alpaca";
import { extendedBars, marketDate, shiftDate } from "../../src/lib/domain/time";
config({ path: [".env.local", ".env"], quiet: true });
describe("REAL Alpaca integration — credentials and network required, never silently skipped", () => {
  it("authenticates, resolves assets, calendar, snapshots and coherent extended bars", async () => {
    const client = new AlpacaClient();
    const date = marketDate(client.asOf());
    const [assets, calendar, snapshots] = await Promise.all([
      client.assets(),
      client.calendar(shiftDate(date, -14), date),
      client.snapshots(["AAPL", "NVDA", "TSLA"]),
    ]);
    expect(assets.length).toBeGreaterThan(100);
    expect(assets.some((a) => a.symbol === "AAPL")).toBe(true);
    expect(calendar.length).toBeGreaterThan(2);
    expect(Object.keys(snapshots).length).toBeGreaterThan(0);
    const completed = calendar.filter((s) => s.close < client.asOf()),
      session = completed.at(-1)!,
      previous = completed.at(-2)!;
    const bars = await client.bars(
      ["AAPL", "NVDA", "TSLA"],
      previous.open,
      session.close,
    );
    for (const symbol of ["AAPL", "NVDA", "TSLA"]) {
      expect(bars[symbol]?.length, `${symbol} bars`).toBeGreaterThan(0);
      for (const b of bars[symbol])
        expect(barSchema.safeParse(b).success).toBe(true);
    }
    const ext = extendedBars(bars.AAPL, previous, session);
    expect(
      ext.length,
      "This feed must have actual extended observations for live acceptance",
    ).toBeGreaterThan(0);
  }, 120000);
  it("uses actual holiday, early-close and DST calendar records", async () => {
    const client = new AlpacaClient();
    const july = await client.calendar("2025-07-01", "2025-07-07");
    expect(july.find((s) => s.date === "2025-07-04")).toBeUndefined();
    expect(july.find((s) => s.date === "2025-07-03")?.close).toBe(
      "2025-07-03T17:00:00.000Z",
    );
    const march = await client.calendar("2025-03-07", "2025-03-10");
    expect(march.map((s) => s.open)).toEqual([
      "2025-03-07T14:30:00.000Z",
      "2025-03-10T13:30:00.000Z",
    ]);
  }, 60000);
});
