import "server-only";
import { cached, cacheKey } from "../db/cache";
import { parseMarketCaps, type MarketCapSnapshot } from "../domain/market-caps";
import { AppError } from "../server/errors";

export const MARKET_CAP_URL =
  "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=0&download=true";
const TTL = 30 * 60_000;
// One bulk request for the whole universe, shared across concurrent scan batches.
// Keep a dedicated entry so hundreds of price-cache keys cannot evict it.
export class MarketCapClient {
  private snapshot?: MarketCapSnapshot;
  private pending?: Promise<MarketCapSnapshot>;
  private retryAfter = 0;
  constructor(
    private fetcher: typeof fetch = fetch,
    private now = Date.now,
  ) {}
  async load(): Promise<MarketCapSnapshot> {
    if (this.snapshot && this.now() - Date.parse(this.snapshot.fetchedAt) < TTL)
      return this.snapshot;
    if (this.pending) return this.pending;
    if (this.now() < this.retryAfter) throw this.unavailable();
    this.pending = this.retrieve()
      .then((snapshot) => {
        this.snapshot = snapshot;
        return snapshot;
      })
      .catch(() => {
        this.retryAfter = Math.max(this.retryAfter, this.now() + 60_000);
        throw this.unavailable();
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  private unavailable() {
    return new AppError(
      "MARKET_CAP_UNAVAILABLE",
      "Market caps could not be loaded. Stock prices remain available; try again shortly.",
      503,
    );
  }
  private async retrieve(): Promise<MarketCapSnapshot> {
    const result = await cached(
      cacheKey("market-caps", MARKET_CAP_URL),
      "market-caps",
      TTL,
      async () => {
        const response = await this.fetcher(MARKET_CAP_URL, {
          headers: { "User-Agent": "Gaplab/1.0", Accept: "application/json" },
          signal: AbortSignal.timeout(15000),
          cache: "no-store",
        });
        if (!response.ok) {
          if (response.status === 429) {
            const retry = response.headers.get("retry-after");
            const seconds = Number(retry);
            const deadline =
              retry && Number.isFinite(seconds)
                ? this.now() + seconds * 1000
                : Date.parse(retry ?? "");
            if (Number.isFinite(deadline)) this.retryAfter = deadline;
          }
          throw this.unavailable();
        }
        return parseMarketCaps(
          await response.json(),
          new Date(this.now()).toISOString(),
        );
      },
    );
    return result.value;
  }
}
const client = new MarketCapClient();
export const getMarketCaps = () => client.load();
