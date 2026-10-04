import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { repository } from "../src/lib/db/repository";
import { cached, cacheKey } from "../src/lib/db/cache";
const pg = new PGlite();
const store = repository(drizzle(pg));
beforeAll(async () => {
  await pg.exec(await readFile("drizzle/0000_cache.sql", "utf8"));
});
afterAll(() => pg.close());
describe("Postgres persistence (real PGlite PostgreSQL engine, Drizzle repository)", () => {
  it("persists and reads nulls, timestamps, and provenance without transformation", async () => {
    const payload = {
      outcome: null,
      provider: "Alpaca",
      feed: "iex",
      asOf: "2025-03-10T13:30:00.000Z",
    };
    await store.put("one", "backtest", payload, new Date(Date.now() + 60000));
    expect(await store.get("one")).toEqual(payload);
  });
  it("upserts unique keys, expires stale rows, isolates feed/threshold cache keys", async () => {
    await store.put(
      "one",
      "backtest",
      { version: 2 },
      new Date(Date.now() + 60000),
    );
    expect(await store.get("one")).toEqual({ version: 2 });
    await store.put("expired", "scan", {}, new Date(Date.now() - 1000));
    expect(await store.get("expired")).toBeUndefined();
    expect(cacheKey("scan", ["iex", 1])).not.toBe(cacheKey("scan", ["sip", 1]));
    expect(cacheKey("test", [1])).not.toBe(cacheKey("test", [5]));
  });
  it("loads once and reuses persisted results across cache calls", async () => {
    const loader = vi.fn(async () => ({ events: [], missing: null }));
    expect((await cached("cached", "test", 60000, loader, store)).cached).toBe(
      false,
    );
    expect((await cached("cached", "test", 60000, loader, store)).cached).toBe(
      true,
    );
    expect(loader).toHaveBeenCalledTimes(1);
  });
  it("reports read/write failures without suppressing the market result", async () => {
    const failed = {
      get: async () => {
        throw new Error("offline");
      },
      put: async () => {
        throw new Error("offline");
      },
    };
    const value = await cached(
      "failed",
      "test",
      1000,
      async () => ({ events: [] }),
      failed,
    );
    expect(value.value.events).toEqual([]);
    expect(value.warnings).toHaveLength(2);
    expect(value.warnings.join()).toContain("NOT been persisted");
  });
  it("labels missing database and does not hide provider failures", async () => {
    expect(
      (await cached("absent", "test", 1000, async () => null, null))
        .warnings[0],
    ).toContain("not configured");
    await expect(
      cached(
        "provider-failed",
        "test",
        1000,
        async () => {
          throw new Error("provider failed");
        },
        store,
      ),
    ).rejects.toThrow("provider failed");
  });
});
