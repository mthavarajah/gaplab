import { api } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET() {
  return api(async () => ({
    configured: Boolean(
      process.env.ALPACA_API_KEY &&
      (process.env.ALPACA_API_SECRET || process.env.ALPACA_SECRET_KEY),
    ),
    feed: process.env.ALPACA_FEED || process.env.ALPACA_DATA_FEED || "iex",
    delayMinutes: Number(process.env.ALPACA_DELAY_MINUTES ?? "0"),
    persistence: process.env.DATABASE_URL
      ? "configured (verified on use)"
      : "not configured",
    historyStart: process.env.ALPACA_HISTORY_START ?? "2016-01-04",
  }));
}
