import type { ScannerRow } from "./types";

export type MarketCapSnapshot = {
  source: "Nasdaq";
  fetchedAt: string;
  sourceAsOf: string | null;
  values: Record<string, number>;
};

// Match the security, never its parent ticker. Preferreds/warrants must not
// inherit a common stock's capitalization; fund assets are not market cap.
export function nasdaqSymbol(symbol: string): string {
  return symbol
    .trim()
    .toUpperCase()
    .replace(/\^([A-Z]+)$/, ".PR$1")
    .replaceAll("/", ".");
}
export function parseMarketCaps(
  payload: unknown,
  fetchedAt: string,
): MarketCapSnapshot {
  const data = (payload as { data?: { rows?: unknown; asOf?: unknown } } | null)
    ?.data;
  if (!data || !Array.isArray(data.rows) || !data.rows.length)
    throw new Error("Market-cap source returned no stock records.");
  const values: Record<string, number> = Object.create(null);
  const conflicts = new Set<string>();
  for (const item of data.rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as { symbol?: unknown; marketCap?: unknown };
    if (typeof row.symbol !== "string") continue;
    const symbol = nasdaqSymbol(row.symbol);
    if (!/^[A-Z][A-Z0-9.\-]{0,14}$/.test(symbol)) continue;
    const raw =
      typeof row.marketCap === "number" ? String(row.marketCap) : row.marketCap;
    if (typeof raw !== "string" || !/^\d+(?:\.\d+)?$/.test(raw.trim()))
      continue;
    const cap = Number(raw);
    if (!Number.isFinite(cap) || cap <= 0) continue;
    if (values[symbol] !== undefined && values[symbol] !== cap)
      conflicts.add(symbol);
    values[symbol] = cap;
  }
  for (const symbol of conflicts) delete values[symbol];
  if (!Object.keys(values).length)
    throw new Error("Market-cap source returned no usable values.");
  return {
    source: "Nasdaq",
    fetchedAt,
    sourceAsOf:
      typeof data.asOf === "string" && data.asOf.trim()
        ? data.asOf.trim()
        : null,
    values,
  };
}
export function withMarketCaps(
  rows: ScannerRow[],
  snapshot: MarketCapSnapshot,
): ScannerRow[] {
  return rows.map((row) => ({
    ...row,
    marketCap: snapshot.values[row.symbol] ?? null,
    marketCapInfo: {
      source: snapshot.source,
      fetchedAt: snapshot.fetchedAt,
      sourceAsOf: snapshot.sourceAsOf,
    },
  }));
}
