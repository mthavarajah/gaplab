import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "../src/lib/client/workflows";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("browser request cooldowns", () => {
  it("honors a 429 cooldown before retrying the same request", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "Retry-After": "60" } }),
      )
      .mockResolvedValueOnce(Response.json({ status: "ok" }));
    vi.stubGlobal("fetch", fetcher);
    const retry = vi.fn(),
      promise = request("/api/scan", {}, retry);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith(60);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(promise).resolves.toEqual({ status: "ok" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("stop cancels a pending provider cooldown", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetcher = vi.fn(async () => new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", fetcher);
    const promise = request("/api/scan", { signal: controller.signal });
    const check = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await check;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
