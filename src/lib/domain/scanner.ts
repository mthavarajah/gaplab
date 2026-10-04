import type {
  Asset,
  Bar,
  Direction,
  ScannerRow,
  Session,
  SessionQuote,
  StockSnapshot,
  ScanMode,
} from "./types";
import { calculateGapPercent, previousRegularClose } from "./calculations";
import {
  extendedBars,
  marketDate,
  marketTime,
  MINUTE,
  normalizeBars,
  regularBars,
} from "./time";

export function calculatePremarketVolume(
  source: Bar[],
  previous: Session,
  session: Session,
  asOf: string,
): number | null {
  const bars = normalizeBars(source).filter(
    (b) =>
      b.t >= previous.close &&
      b.t < session.open &&
      Date.parse(b.t) + MINUTE <= Date.parse(asOf),
  );
  return bars.length ? bars.reduce((sum, bar) => sum + bar.v, 0) : null;
}

export function calculatePremarketChange(
  source: Bar[],
  previousDaily: Bar | null,
  previous: Session,
  session: Session,
  asOf: string,
) {
  const last = normalizeBars(source)
    .filter(
      (b) =>
        b.t >= marketTime(session.date, "04:00") &&
        b.t < session.open &&
        Date.parse(b.t) + MINUTE <= Date.parse(asOf),
    )
    .at(-1);
  return last
    ? {
        change:
          previousDaily && marketDate(previousDaily.t) === previous.date
            ? calculateGapPercent(last.c, previousDaily.c)
            : null,
        time: last.t,
        price: last.c,
      }
    : { change: null, time: null, price: null };
}

// Only completed bars in this trading session's premarket window qualify.
// Previous-evening prints are never substituted when premarket is missing.
export function createPremarketScannerRow(
  asset: Asset,
  source: Bar[],
  previousDaily: Bar | null,
  previous: Session,
  session: Session,
  asOf: string,
  quote: SessionQuote,
): ScannerRow | null {
  if (!previousDaily || marketDate(previousDaily.t) !== previous.date)
    return null;
  const start = marketTime(session.date, "04:00");
  const bars = normalizeBars(source).filter(
    (b) =>
      b.t >= start &&
      b.t < session.open &&
      Date.parse(b.t) + MINUTE <= Date.parse(asOf),
  );
  const last = bars.at(-1);
  if (!last) return null;
  const reference = previousDaily.c;
  const volume = bars.reduce((sum, b) => sum + b.v, 0);
  const magnitude = (b: Bar) =>
    Math.max(Math.abs(b.h / reference - 1), Math.abs(b.l / reference - 1));
  const max = bars.reduce((a, b) => (magnitude(b) > magnitude(a) ? b : a));
  return {
    ...createOpeningScannerRow(asset, quote),
    price: last.c,
    premarketChange: calculateGapPercent(last.c, reference),
    premarketPrice: last.c,
    premarketVolume: calculatePremarketVolume(source, previous, session, asOf),
    premarketTime: last.t,
    premarketSessionDate: session.date,
    previousClose: reference,
    gap: calculateGapPercent(last.c, reference),
    high: Math.max(...bars.map((b) => b.h)),
    low: Math.min(...bars.map((b) => b.l)),
    volume,
    dollarVolume: last.c * volume,
    latestTime: last.t,
    referenceTime: previous.close,
    maxGapTime: max.t,
    extendedBars: bars,
  };
}
export function scannerUnavailableReason(
  source: Bar[],
  previous: Session,
  session: Session,
  asOf: string,
): string | null {
  const bars = normalizeBars(source);
  if (!bars.length) return "No price bars returned for this period";
  const close = previousRegularClose(bars, previous);
  const extended = extendedBars(bars, previous, session, asOf);
  if (!close && !extended.length)
    return "No closing-minute price or extended-hours bars";
  if (!close) return "No price in the previous session’s closing minute";
  if (!extended.length)
    return "No extended-hours bars returned for this period";
  return null;
}
// Quote fields use the current/latest trading date, which differs from the
// overnight target session after the close and on weekends.
export function calculateSessionQuote(
  snapshot: StockSnapshot,
  session: Session,
  previous: Session,
  fetchedAt: string,
  availableAt = fetchedAt,
  adjustedPreviousDaily?: Bar | null,
): SessionQuote {
  const daily = [snapshot.dailyBar, snapshot.prevDailyBar];
  const today = daily.find((b) => b && marketDate(b.t) === session.date);
  const prior =
    adjustedPreviousDaily === undefined
      ? daily.find((b) => b && marketDate(b.t) === previous.date)
      : adjustedPreviousDaily &&
          marketDate(adjustedPreviousDaily.t) === previous.date
        ? adjustedPreviousDaily
        : null;
  const trade = snapshot.latestTrade;
  const validTrade = trade && Date.parse(trade.t) <= Date.parse(availableAt);
  const price = validTrade ? trade.p : null;
  const open =
    Date.parse(availableAt) >= Date.parse(session.open)
      ? (today?.o ?? null)
      : null;
  const previousClose = prior?.c ?? null;
  const tradeAfterOpen =
    validTrade && Date.parse(trade.t) >= Date.parse(session.open);
  return {
    sessionDate: session.date,
    price,
    priceTime: validTrade ? new Date(trade.t).toISOString() : null,
    previousClose,
    open,
    priceChange:
      price !== null && previousClose !== null
        ? calculateGapPercent(price, previousClose)
        : null,
    openingGap:
      open !== null && previousClose !== null
        ? calculateGapPercent(open, previousClose)
        : null,
    changeFromOpen:
      price !== null && open !== null && tradeAfterOpen
        ? calculateGapPercent(price, open)
        : null,
    volume: today?.v ?? null,
    fetchedAt,
  };
}
export function createScannerRow(
  asset: Asset,
  source: Bar[],
  previous: Session,
  session: Session,
  asOf: string,
): ScannerRow | null {
  const bars = normalizeBars(source),
    reference = previousRegularClose(bars, previous),
    ext = extendedBars(bars, previous, session, asOf);
  if (!reference || !ext.length) return null;
  const last = ext.at(-1)!,
    volume = ext.reduce((a, b) => a + b.v, 0);
  const magnitude = (b: Bar) =>
    Math.max(
      Math.abs(calculateGapPercent(b.h, reference.c)),
      Math.abs(calculateGapPercent(b.l, reference.c)),
    );
  const max = ext.reduce((a, b) => (magnitude(b) > magnitude(a) ? b : a));
  const prev = regularBars(bars, previous),
    complete =
      prev.length ===
      (Date.parse(previous.close) - Date.parse(previous.open)) / 60000;
  return {
    symbol: asset.symbol,
    name: asset.name,
    exchange: asset.exchange,
    assetType: "US equity · subtype unavailable",
    price: last.c,
    previousClose: reference.c,
    gap: calculateGapPercent(last.c, reference.c),
    high: Math.max(...ext.map((b) => b.h)),
    low: Math.min(...ext.map((b) => b.l)),
    volume,
    previousVolume: complete ? prev.reduce((a, b) => a + b.v, 0) : null,
    relativeVolume: null,
    marketCap: null,
    dollarVolume: last.c * volume,
    maxGapTime: max.t,
    latestTime: last.t,
    referenceTime: reference.t,
    quote: null,
    extendedBars: ext,
  };
}
export type Filters = {
  mode?: ScanMode;
  threshold: number;
  direction: Direction;
  minPrice?: number;
  maxPrice?: number;
  minVolume?: number;
  maxVolume?: number;
  minPremarketVolume?: number;
  maxPremarketVolume?: number;
  minSessionVolume?: number;
  maxSessionVolume?: number;
  minDollarVolume?: number;
  minRelativeVolume?: number;
  minMarketCap?: number;
  maxMarketCap?: number;
  minPriceChange?: number;
  minPremarketChange?: number;
  minOpeningGap?: number;
  minChangeFromOpen?: number;
};
export function filterScannerRows(
  rows: ScannerRow[],
  f: Filters,
): ScannerRow[] {
  return rows.filter(
    (r) =>
      (f.mode === "all"
        ? true
        : f.mode === "gap-and-go"
          ? matchesGapAndGo(r.quote, f.threshold, f.direction)
          : r.gap !== null &&
            (f.direction === "up"
              ? r.gap + 1e-10 >= f.threshold
              : f.direction === "down"
                ? r.gap - 1e-10 <= -f.threshold
                : Math.abs(r.gap) + 1e-10 >= f.threshold)) &&
      (f.minPrice === undefined ||
        ((f.mode === "premarket" ? r.price : r.quote?.price) != null &&
          (f.mode === "premarket" ? r.price! : r.quote!.price!) >=
            f.minPrice)) &&
      (f.maxPrice === undefined ||
        ((f.mode === "premarket" ? r.price : r.quote?.price) != null &&
          (f.mode === "premarket" ? r.price! : r.quote!.price!) <=
            f.maxPrice)) &&
      (f.minVolume === undefined ||
        (r.volume !== null && r.volume >= f.minVolume)) &&
      (f.maxVolume === undefined ||
        (r.volume !== null && r.volume <= f.maxVolume)) &&
      (f.minPremarketVolume === undefined ||
        (r.premarketVolume != null &&
          r.premarketVolume >= f.minPremarketVolume)) &&
      (f.maxPremarketVolume === undefined ||
        (r.premarketVolume != null &&
          r.premarketVolume <= f.maxPremarketVolume)) &&
      (f.minSessionVolume === undefined ||
        (r.quote?.volume != null && r.quote.volume >= f.minSessionVolume)) &&
      (f.maxSessionVolume === undefined ||
        (r.quote?.volume != null && r.quote.volume <= f.maxSessionVolume)) &&
      (f.minDollarVolume === undefined ||
        (r.dollarVolume !== null && r.dollarVolume >= f.minDollarVolume)) &&
      (f.minRelativeVolume === undefined ||
        (r.relativeVolume !== null &&
          r.relativeVolume >= f.minRelativeVolume)) &&
      (f.minMarketCap === undefined ||
        (r.marketCap !== null && r.marketCap >= f.minMarketCap)) &&
      (f.maxMarketCap === undefined ||
        (r.marketCap !== null && r.marketCap <= f.maxMarketCap)) &&
      atLeast(
        r.premarketChange ?? (f.mode === "premarket" ? r.gap : null),
        f.minPremarketChange,
      ) &&
      atLeast(r.quote?.priceChange, f.minPriceChange) &&
      atLeast(r.quote?.openingGap, f.minOpeningGap) &&
      atLeast(r.quote?.changeFromOpen, f.minChangeFromOpen),
  );
}
function atLeast(value: number | null | undefined, minimum?: number): boolean {
  return minimum === undefined || (value != null && value + 1e-10 >= minimum);
}
export function scannerTrigger(
  row: ScannerRow,
  threshold: number,
  direction: Direction,
) {
  if (
    row.previousClose === null ||
    row.gap === null ||
    !row.extendedBars.length
  )
    return { firstTime: null, maxTime: null };
  const side =
    direction === "both" ? (row.gap >= 0 ? "up" : "down") : direction;
  const target =
    row.previousClose * (1 + ((side === "up" ? 1 : -1) * threshold) / 100);
  const first = row.extendedBars.find((b) =>
    side === "up" ? b.h >= target - 1e-10 : b.l <= target + 1e-10,
  );
  const max = row.extendedBars.reduce((a, b) =>
    side === "up" ? (b.h > a.h ? b : a) : b.l < a.l ? b : a,
  );
  return { firstTime: first?.t ?? null, maxTime: max.t };
}
export function yahooFinanceLink(symbol: string): string {
  const ticker = symbol
    .toUpperCase()
    .replace(/\.PR([A-Z])$/, "-P$1")
    .replace(/\.WS$/, "-WT")
    .replace(/\.U$/, "-UN")
    .replaceAll(".", "-");
  return `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/`;
}

// Opening-gap selection includes flat and reversed movement after the open.
export function matchesGapAndGo(
  quote: SessionQuote | null,
  threshold: number,
  direction: Direction,
): boolean {
  if (quote?.openingGap == null) return false;
  return (
    (direction !== "down" && quote.openingGap + 1e-10 >= threshold) ||
    (direction !== "up" && quote.openingGap - 1e-10 <= -threshold)
  );
}
export function createOpeningScannerRow(
  asset: Asset,
  quote: SessionQuote,
): ScannerRow {
  return {
    symbol: asset.symbol,
    name: asset.name,
    exchange: asset.exchange,
    assetType: "US equity · subtype unavailable",
    quote,
    price: null,
    previousClose: null,
    gap: null,
    high: null,
    low: null,
    volume: null,
    previousVolume: null,
    relativeVolume: null,
    dollarVolume: null,
    marketCap: null,
    maxGapTime: null,
    latestTime: null,
    referenceTime: null,
    extendedBars: [],
  };
}
