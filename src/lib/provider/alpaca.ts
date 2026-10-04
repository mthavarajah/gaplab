import "server-only";
import { z } from "zod";
import type { Asset, Bar, Provenance, Session } from "../domain/types";
import { marketTime, normalizeBars } from "../domain/time";
import { AppError } from "../server/errors";
export const barSchema = z
  .object({
    t: z.iso
      .datetime({ offset: true })
      .transform((t) => new Date(t).toISOString()),
    o: z.number().positive(),
    h: z.number().positive(),
    l: z.number().positive(),
    c: z.number().positive(),
    v: z.number().nonnegative(),
  })
  .refine(
    (b) => b.h >= Math.max(b.o, b.c, b.l) && b.l <= Math.min(b.o, b.c, b.h),
    "Incoherent OHLC",
  );
const assetSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  exchange: z.string(),
  status: z.string(),
  tradable: z.boolean(),
  class: z.string(),
});
const calendarSchema = z.array(
  z.object({
    date: z.iso.date(),
    open: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
    close: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
  }),
);
const pageSchema = z.object({
  bars: z.record(z.string(), z.array(barSchema)).nullable(),
  next_page_token: z.string().nullish(),
});
const snapshotSchema = z.record(
  z.string(),
  z
    .object({
      minuteBar: barSchema.nullish(),
      dailyBar: barSchema.nullish(),
      prevDailyBar: barSchema.nullish(),
      latestTrade: z
        .object({
          t: z.iso.datetime({ offset: true }),
          p: z.number().positive(),
        })
        .passthrough()
        .nullish(),
    })
    .passthrough(),
);
export type AlpacaConfig = {
  key: string;
  secret: string;
  tradingUrl: string;
  feed: "iex" | "sip";
  delayMinutes: number;
};
export function readConfig(): AlpacaConfig {
  const key = process.env.ALPACA_API_KEY,
    secret = process.env.ALPACA_API_SECRET || process.env.ALPACA_SECRET_KEY;
  if (!key || !secret)
    throw new AppError(
      "NOT_CONFIGURED",
      "Configure ALPACA_API_KEY and ALPACA_API_SECRET in .env.local (server-side). No market data has been substituted.",
      503,
    );
  const feed = z
    .enum(["iex", "sip"])
    .safeParse(
      process.env.ALPACA_FEED || process.env.ALPACA_DATA_FEED || "iex",
    );
  const delay = Number(process.env.ALPACA_DELAY_MINUTES ?? "0");
  const tradingUrl =
    process.env.ALPACA_TRADING_URL ?? "https://paper-api.alpaca.markets";
  if (
    !feed.success ||
    !Number.isInteger(delay) ||
    delay < 0 ||
    delay > 60 ||
    ![
      "https://paper-api.alpaca.markets",
      "https://api.alpaca.markets",
    ].includes(tradingUrl)
  )
    throw new AppError(
      "INVALID_CONFIG",
      "Check ALPACA_FEED, ALPACA_DELAY_MINUTES and ALPACA_TRADING_URL.",
      503,
    );
  return { key, secret, tradingUrl, feed: feed.data, delayMinutes: delay };
}
// Process-local pacing leaves headroom below Alpaca's common 200 request/min tier.
// Serverless instances also handle 429 explicitly; this is not a distributed quota.
let nextRequestAt = 0;
export class AlpacaClient {
  constructor(
    readonly config: AlpacaConfig = readConfig(),
    private fetcher: typeof fetch = fetch,
    private pause = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) {}
  asOf(now = Date.now()): string {
    return new Date(
      Math.floor((now - this.config.delayMinutes * 60000) / 60000) * 60000,
    ).toISOString();
  }
  provenance(asOf: string): Provenance {
    return {
      provider: "Alpaca",
      feed: this.config.feed,
      adjustment: "split",
      timeframe: "1Min",
      fetchedAt: new Date().toISOString(),
      asOf,
      delayMinutes: this.config.delayMinutes,
      calendar: "Alpaca",
      version: "gaplab-3",
      reference:
        "Last regular-session minute close; feed-specific, not official auction close",
      coverage:
        this.config.feed === "iex"
          ? "IEX only: partial venue/time coverage, not the full US market. Sparse bars cannot establish all-market first crossings or extrema."
          : "SIP consolidated bars; no BOATS overnight (20:00–04:00 ET). Missing minutes are not interpolated.",
    };
  }
  async request<T>(
    base: string,
    path: string,
    params: Record<string, string>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    for (let attempt = 0; attempt < 3; attempt++) {
      const reservedAt = Math.max(Date.now(), nextRequestAt);
      nextRequestAt = reservedAt + 400;
      await this.pause(Math.max(0, reservedAt - Date.now()));
      let response: Response;
      try {
        response = await this.fetcher(url, {
          headers: {
            "APCA-API-KEY-ID": this.config.key,
            "APCA-API-SECRET-KEY": this.config.secret,
          },
          signal: AbortSignal.timeout(12_000),
          cache: "no-store",
        });
      } catch {
        if (attempt < 2) {
          await this.pause(400 * (attempt + 1));
          continue;
        }
        throw new AppError(
          "PROVIDER_TIMEOUT",
          "Alpaca could not be reached or timed out. Try again.",
          504,
        );
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        const retry = Number(response.headers.get("retry-after"));
        await this.pause(
          Math.min(
            2000,
            Math.max(
              400 * (attempt + 1),
              Number.isFinite(retry) ? retry * 1000 : 0,
            ),
          ),
        );
        continue;
      }
      if (!response.ok) {
        if (response.status === 401)
          throw new AppError(
            "PROVIDER_AUTH",
            "Alpaca rejected the credentials. Check the keys and paper/live trading URL.",
            502,
          );
        if (response.status === 403)
          throw new AppError(
            "FEED_FORBIDDEN",
            `Alpaca denied access to the selected ${this.config.feed.toUpperCase()} feed or resource. Verify your subscription; delayed SIP may require ALPACA_DELAY_MINUTES=16.`,
            502,
          );
        if (response.status === 429)
          throw new AppError(
            "RATE_LIMIT",
            "Alpaca rate limit reached. Pause and retry the scan.",
            429,
          );
        if (response.status === 404)
          throw new AppError(
            "UNSUPPORTED_SYMBOL",
            "Alpaca could not find that symbol or resource.",
            404,
          );
        throw new AppError(
          "PROVIDER_ERROR",
          `Alpaca returned HTTP ${response.status}. No replacement data was used.`,
          502,
        );
      }
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        throw new AppError(
          "MALFORMED_PROVIDER",
          "Alpaca returned invalid JSON.",
        );
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success)
        throw new AppError(
          "MALFORMED_PROVIDER",
          "Alpaca returned data that failed schema or OHLC validation.",
        );
      return parsed.data;
    }
    throw new AppError("PROVIDER_ERROR", "Alpaca request failed.");
  }
  async calendar(start: string, end: string): Promise<Session[]> {
    const rows = await this.request(
      this.config.tradingUrl,
      "/v2/calendar",
      { start, end },
      calendarSchema,
    );
    const sessions = rows
      .map((r) => ({
        date: r.date,
        open: marketTime(r.date, r.open),
        close: marketTime(r.date, r.close),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (
      new Set(sessions.map((s) => s.date)).size !== sessions.length ||
      sessions.some((s) => s.open >= s.close)
    )
      throw new AppError(
        "MALFORMED_CALENDAR",
        "Alpaca returned invalid calendar boundaries.",
      );
    return sessions;
  }
  async assets(): Promise<Asset[]> {
    const assets = await this.request(
      this.config.tradingUrl,
      "/v2/assets",
      { status: "active", asset_class: "us_equity" },
      z.array(assetSchema),
    );
    return assets
      .filter(
        (a) =>
          a.status === "active" &&
          a.tradable &&
          a.class === "us_equity" &&
          a.exchange !== "OTC" &&
          /^[A-Z][A-Z0-9.\-]{0,14}$/.test(a.symbol),
      )
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }
  async asset(symbol: string): Promise<Asset> {
    return this.request(
      this.config.tradingUrl,
      `/v2/assets/${encodeURIComponent(symbol)}`,
      {},
      assetSchema,
    );
  }
  async snapshots(symbols: string[]) {
    return this.request(
      "https://data.alpaca.markets",
      "/v2/stocks/snapshots",
      {
        symbols: symbols.join(","),
        feed:
          this.config.feed === "sip" && this.config.delayMinutes >= 15
            ? "delayed_sip"
            : this.config.feed,
      },
      snapshotSchema,
    );
  }
  async bars(
    symbols: string[],
    start: string,
    end: string,
    timeframe: "1Min" | "1Day" = "1Min",
  ): Promise<Record<string, Bar[]>> {
    const result: Record<string, Bar[]> = {};
    const seen = new Set<string>();
    let token: string | undefined;
    for (let page = 0; page < 100; page++) {
      const data = await this.request(
        "https://data.alpaca.markets",
        "/v2/stocks/bars",
        {
          symbols: symbols.join(","),
          start,
          end,
          timeframe,
          feed: this.config.feed,
          adjustment: "split",
          asof: "-",
          sort: "asc",
          limit: "10000",
          ...(token ? { page_token: token } : {}),
        },
        pageSchema,
      );
      for (const [symbol, bars] of Object.entries(data.bars ?? {}))
        result[symbol] = [...(result[symbol] ?? []), ...bars];
      if (!data.next_page_token) {
        for (const symbol of Object.keys(result))
          result[symbol] = normalizeBars(result[symbol]);
        return result;
      }
      if (seen.has(data.next_page_token))
        throw new AppError(
          "PAGINATION_ERROR",
          "Alpaca repeated a page token; refusing truncated results.",
        );
      token = data.next_page_token;
      seen.add(token);
    }
    throw new AppError(
      "REQUEST_TOO_LARGE",
      "The Alpaca result exceeds the bounded page limit. Use a shorter interval.",
    );
  }
}
