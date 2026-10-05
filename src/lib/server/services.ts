import { calculateSessionMetrics } from "../domain/session-metrics";
import "server-only";
import { AlpacaClient } from "../provider/alpaca";
import { getMarketCaps } from "../provider/market-caps";
import { withMarketCaps } from "../domain/market-caps";
import { cached, cacheKey } from "../db/cache";
import {
  analyzeSession,
  deduplicateEvents,
  summarize,
  previousRegularClose,
} from "../domain/calculations";
import {
  calculateSessionQuote,
  createScannerRow,
  scannerUnavailableReason,
  createOpeningScannerRow,
  createPremarketScannerRow,
  calculateAMCChange,
  calculatePremarketVolume,
} from "../domain/scanner";
import {
  extendedBars,
  regularBars,
  MINUTE,
  marketDate,
  marketTime,
  scannerSessions,
  shiftDate,
} from "../domain/time";
import type {
  BacktestResult,
  Direction,
  ScanBatch,
  ScanContext,
  EventChartResult,
  ScanMode,
  EventRule,
  Bar,
} from "../domain/types";
import { AppError } from "./errors";
export async function eventChart(
  input: { symbol: string; date: string; asOf: string },
  client = new AlpacaClient(),
): Promise<EventChartResult> {
  if (
    Date.parse(input.asOf) > Date.parse(client.asOf()) ||
    input.date > marketDate(input.asOf)
  )
    throw new AppError(
      "FUTURE_RANGE",
      "The chart cannot request future or unavailable data.",
      400,
    );
  const result = await cached(
    cacheKey("event-chart", [input, client.config.feed]),
    "event-chart",
    86400000,
    async () => {
      const calendar = await client.calendar(
        shiftDate(input.date, -20),
        input.date,
      );
      const session = calendar.at(-1),
        previous = calendar.at(-2);
      if (!session || !previous || session.date !== input.date)
        throw new AppError(
          "INVALID_SESSION",
          "Select an event on a valid trading date.",
          400,
        );
      const cutoff = input.asOf < session.close ? input.asOf : session.close;
      const source =
        (
          await client.bars(
            [input.symbol],
            previous.open,
            new Date(Date.parse(cutoff) - 1).toISOString(),
          )
        )[input.symbol] ?? [];
      const bars = [
        ...extendedBars(source, previous, session, input.asOf),
        ...regularBars(source, session).filter(
          (b) => Date.parse(b.t) + MINUTE <= Date.parse(input.asOf),
        ),
      ];
      return {
        symbol: input.symbol,
        session,
        previous,
        previousClose: previousRegularClose(source, previous)?.c ?? null,
        bars,
        provenance: client.provenance(input.asOf),
      };
    },
  );
  return { ...result.value, warnings: result.warnings };
}
export async function premarketMetrics(
  tickers: string[],
  asOf: string,
  client = new AlpacaClient(),
  context?: ScanContext,
) {
  context ??= await getContext(client, asOf);
  const start =
    context.quotePrevious.close < context.previous.close
      ? context.quotePrevious.close
      : context.previous.close;
  const cutoff = asOf < context.session.open ? asOf : context.session.open;
  const premarket = await cached(
    cacheKey("scan-sessions-v6", [
      client.config.feed,
      asOf,
      context.session.date,
      [...tickers].sort(),
    ]),
    "scan-premarket",
    120000,
    async () => {
      if (cutoff <= start)
        return {} as Record<
          string,
          ReturnType<typeof calculateAMCChange> & {
            volume: number | null;
            sessions: ReturnType<typeof calculateSessionMetrics>;
          }
        >;
      const [bars, references] = await Promise.all([
        client.bars(
          tickers,
          start,
          new Date(Date.parse(cutoff) - 1).toISOString(),
        ),
        client.bars(
          tickers,
          marketTime(context.quotePrevious.date, "00:00"),
          new Date(
            Math.min(
              Date.parse(cutoff),
              Date.parse(marketTime(context.session.date, "00:00")),
            ) - 1,
          ).toISOString(),
          "1Day",
        ),
      ]);
      return Object.fromEntries(
        tickers.map((symbol) => [
          symbol,
          {
            sessions: calculateSessionMetrics(
              bars[symbol] ?? [],
              references[symbol] ?? [],
              context,
            ),
            ...calculateAMCChange(
              bars[symbol] ?? [],
              references[symbol]?.find(
                (bar) => marketDate(bar.t) === context.previous.date,
              ) ?? null,
              context.previous,
              context.session,
              asOf,
            ),
            volume: calculatePremarketVolume(
              bars[symbol] ?? [],
              context.previous,
              context.session,
              asOf,
            ),
          },
        ]),
      );
    },
  );
  return {
    metrics: premarket.value,
    sessionDate: context.session.date,
    warnings: premarket.warnings,
  };
}

export async function getContext(
  client = new AlpacaClient(),
  asOf = client.asOf(),
): Promise<ScanContext> {
  if (Date.parse(asOf) > Date.parse(client.asOf()))
    throw new AppError(
      "INVALID_ASOF",
      "Snapshot time cannot exceed the feed's available data.",
      400,
    );
  const date = marketDate(asOf);
  const [calendar, assets] = await Promise.all([
    cached(
      cacheKey("calendar", [date, client.config.tradingUrl]),
      "calendar",
      3600000,
      () => client.calendar(shiftDate(date, -20), shiftDate(date, 20)),
    ),
    cached(
      cacheKey("assets", [client.config.tradingUrl]),
      "assets",
      3600000,
      () => client.assets(),
    ),
  ]);
  if (!assets.value.length)
    throw new AppError(
      "EMPTY_UNIVERSE",
      "Alpaca returned no eligible active US equities.",
    );
  let sessions;
  try {
    sessions = scannerSessions(calendar.value, asOf);
  } catch {
    throw new AppError(
      "CALENDAR_UNAVAILABLE",
      "Alpaca's market calendar does not cover this snapshot. No weekday fallback is used.",
    );
  }
  const quoteIndex = calendar.value.findLastIndex((s) => s.date <= date);
  if (quoteIndex < 1)
    throw new AppError(
      "CALENDAR_UNAVAILABLE",
      "Calendar does not cover the current quote session.",
    );
  return {
    ...sessions,
    assets: assets.value,
    asOf,
    provenance: client.provenance(asOf),
    historyStart: process.env.ALPACA_HISTORY_START ?? "2016-01-04",
    quoteSession: calendar.value[quoteIndex],
    quotePrevious: calendar.value[quoteIndex - 1],
    warnings: [...new Set([...calendar.warnings, ...assets.warnings])],
  };
}
export async function scanBatch(
  symbols: string[],
  asOf: string,
  client = new AlpacaClient(),
  mode: ScanMode = "extended",
): Promise<ScanBatch> {
  const context = await getContext(client, asOf),
    selected = context.assets.filter((a) => symbols.includes(a.symbol));
  if (selected.length !== new Set(symbols).size)
    throw new AppError(
      "UNSUPPORTED_SYMBOL",
      "One or more requested tickers are not in the current eligible Alpaca universe.",
      400,
    );
  const result = await cached(
    cacheKey("scan", [
      client.config.feed,
      client.config.delayMinutes,
      mode,
      asOf,
      [...symbols].sort(),
    ]),
    "scan",
    120000,
    async () => {
      const dailyReferences = (tickers: string[]) =>
        client.bars(
          tickers,
          marketTime(context.quotePrevious.date, "00:00"),
          new Date(
            Date.parse(marketTime(context.quoteSession.date, "00:00")) - 1,
          ).toISOString(),
          "1Day",
        );
      if (mode === "premarket") {
        const session = context.quoteSession;
        const start = marketTime(session.date, "04:00");
        const cutoff = asOf < session.open ? asOf : session.open;
        const [bars, references, snapshots] = await Promise.all([
          cutoff > start
            ? client.bars(
                symbols,
                start,
                new Date(Date.parse(cutoff) - 1).toISOString(),
              )
            : Promise.resolve({} as Record<string, Bar[]>),
          dailyReferences(symbols),
          client.snapshots(symbols),
        ]);
        const fetchedAt = new Date().toISOString();
        const rows: ScanBatch["rows"] = [],
          unavailable: ScanBatch["unavailable"] = [];
        for (const asset of selected) {
          const reference =
            references[asset.symbol]?.find(
              (b) => marketDate(b.t) === context.quotePrevious.date,
            ) ?? null;
          const quote = calculateSessionQuote(
            snapshots[asset.symbol] ?? {},
            session,
            context.quotePrevious,
            fetchedAt,
            asOf,
            reference,
          );
          const row = createPremarketScannerRow(
            asset,
            bars[asset.symbol] ?? [],
            reference,
            context.quotePrevious,
            session,
            asOf,
            quote,
          );
          if (row) rows.push(row);
          else
            unavailable.push({
              symbol: asset.symbol,
              reason: !reference
                ? "Previous trading day’s closing price unavailable"
                : "No completed premarket bars for this trading session before the data cutoff",
            });
        }
        return {
          rows,
          unavailable,
          provenance: {
            ...context.provenance,
            reference:
              "Latest completed premarket bar (04:00–09:30 ET) versus split-adjusted previous daily regular-session close",
          },
          quoteWarnings: [],
        };
      }
      if (mode === "gap-and-go" || mode === "all") {
        const [snapshots, references] = await Promise.all([
          client.snapshots(symbols),
          dailyReferences(symbols),
        ]);
        const fetchedAt = new Date().toISOString();
        const delay =
          client.config.feed === "sip" && client.config.delayMinutes >= 15
            ? 15
            : 0;
        const availableAt = new Date(
          Date.parse(fetchedAt) - delay * 60000,
        ).toISOString();
        const rows: ScanBatch["rows"] = [],
          unavailable: ScanBatch["unavailable"] = [];
        for (const asset of selected) {
          const quote = calculateSessionQuote(
            snapshots[asset.symbol] ?? {},
            context.quoteSession,
            context.quotePrevious,
            fetchedAt,
            availableAt,
            references[asset.symbol]?.find(
              (b) => marketDate(b.t) === context.quotePrevious.date,
            ) ?? null,
          );
          const reason =
            quote.previousClose === null
              ? "Previous trading day’s closing price unavailable"
              : mode !== "all" && quote.open === null
                ? "Regular-session opening price not available yet"
                : quote.price === null ||
                    (mode !== "all" && quote.changeFromOpen === null)
                  ? "No available price after this session’s open"
                  : null;
          if (reason) unavailable.push({ symbol: asset.symbol, reason });
          else rows.push(createOpeningScannerRow(asset, quote));
        }
        return {
          rows,
          unavailable,
          provenance: {
            ...context.provenance,
            timeframe: "snapshot" as const,
            reference:
              mode === "all"
                ? "Split-adjusted previous daily regular-session close; independent current quote and premarket metrics"
                : "Split-adjusted previous daily regular-session close; opening gap uses the regular open",
          },
          quoteWarnings: [],
        };
      }
      const cutoff = asOf < context.session.open ? asOf : context.session.open;
      const bars = await client.bars(
        symbols,
        context.previous.open,
        new Date(Date.parse(cutoff) - 1).toISOString(),
      );
      const rows: ScanBatch["rows"] = [],
        unavailable: ScanBatch["unavailable"] = [];
      for (const asset of selected) {
        const row = createScannerRow(
          asset,
          bars[asset.symbol] ?? [],
          context.previous,
          context.session,
          asOf,
        );
        if (row) rows.push(row);
        else
          unavailable.push({
            symbol: asset.symbol,
            reason: scannerUnavailableReason(
              bars[asset.symbol] ?? [],
              context.previous,
              context.session,
              asOf,
            )!,
          });
      }
      // Only request current quotes for symbols with usable overnight data.
      // Sparse feeds otherwise spend most of the quota on rows we cannot show.
      const quotes = rows.length
        ? await Promise.all([
            client.snapshots(rows.map((row) => row.symbol)),
            dailyReferences(rows.map((row) => row.symbol)),
          ])
            .then(([snapshots, references]) => ({
              snapshots,
              references,
              warning: null as string | null,
            }))
            .catch(() => ({
              snapshots: {} as Awaited<ReturnType<AlpacaClient["snapshots"]>>,
              references: {} as Record<string, Bar[]>,
              warning:
                "Current quotes or adjusted daily references could not be retrieved. Overnight results remain available; refresh to retry quotes.",
            }))
        : {
            snapshots: {} as Awaited<ReturnType<AlpacaClient["snapshots"]>>,
            references: {} as Record<string, Bar[]>,
            warning: null,
          };
      const quoteFetchedAt = new Date().toISOString();
      // The snapshot endpoint has its own fixed 15-minute delayed SIP feed.
      // The historical request buffer must not discard its latest trade.
      const quoteDelay =
        client.config.feed === "sip" && client.config.delayMinutes >= 15
          ? 15
          : 0;
      const quoteAvailableAt = new Date(
        Date.parse(quoteFetchedAt) - quoteDelay * 60000,
      ).toISOString();
      for (const row of rows) {
        const snapshot = quotes.snapshots[row.symbol];
        if (snapshot)
          row.quote = calculateSessionQuote(
            snapshot,
            context.quoteSession,
            context.quotePrevious,
            quoteFetchedAt,
            quoteAvailableAt,
            quotes.references[row.symbol]?.find(
              (b) => marketDate(b.t) === context.quotePrevious.date,
            ) ?? null,
          );
      }
      return {
        rows,
        unavailable,
        provenance: context.provenance,
        quoteWarnings: quotes.warning ? [quotes.warning] : [],
      };
    },
  );
  let rows = result.value.rows;
  const capWarnings: string[] = [];
  if (mode !== "premarket" && rows.length) {
    try {
      const premarket = await premarketMetrics(
        rows.map((row) => row.symbol),
        asOf,
        client,
        context,
      );
      rows = rows.map((row) => ({
        ...row,
        premarketChange: premarket.metrics[row.symbol]?.change ?? null,
        premarketVolume: premarket.metrics[row.symbol]?.volume ?? null,
        premarketPrice: premarket.metrics[row.symbol]?.price ?? null,
        premarketTime: premarket.metrics[row.symbol]?.time ?? null,
        premarketSessionDate: context.session.date,
        amcVersion: 2,
        sessionMetrics: premarket.metrics[row.symbol]?.sessions,
      }));
      capWarnings.push(...premarket.warnings);
    } catch {
      rows = rows.map((row) => ({
        ...row,
        premarketChange: null,
        premarketVolume: null,
        premarketPrice: null,
        premarketTime: null,
        premarketSessionDate: context.session.date,
        amcVersion: 2,
      }));
      capWarnings.push(
        "Session change and volume could not be loaded. Other scanner results remain available; Scan to retry.",
      );
    }
  }
  if (rows.length) {
    try {
      rows = withMarketCaps(rows, await getMarketCaps());
    } catch {
      capWarnings.push(
        "Market caps could not be loaded. Stock prices remain available; try again shortly.",
      );
    }
  }
  return {
    ...result.value,
    rows,
    mode,
    warnings: [
      ...new Set([
        ...context.warnings,
        ...result.warnings,
        ...result.value.quoteWarnings,
        ...capWarnings,
      ]),
    ],
  };
}
export async function backtest(
  input: {
    symbol: string;
    threshold: number;
    direction: Direction;
    start: string;
    end: string;
    asOf?: string;
    rule?: EventRule;
  },
  client = new AlpacaClient(),
): Promise<BacktestResult> {
  if ((Date.parse(input.end) - Date.parse(input.start)) / 86400000 > 7)
    throw new AppError(
      "CHUNK_TOO_LARGE",
      "Backtest requests must be chunked into at most seven calendar days.",
      400,
    );
  const asOf = input.asOf ?? client.asOf();
  if (
    Date.parse(asOf) > Date.parse(client.asOf()) ||
    input.end > marketDate(asOf)
  )
    throw new AppError(
      "FUTURE_RANGE",
      "Backtests cannot request future/unavailable sessions.",
      400,
    );
  const asset = await cached(
    cacheKey("asset", [input.symbol, client.config.tradingUrl]),
    "asset",
    3600000,
    () => client.asset(input.symbol),
  );
  if (asset.value.class !== "us_equity" || asset.value.exchange === "OTC")
    throw new AppError(
      "UNSUPPORTED_SYMBOL",
      "This symbol is not a supported exchange-listed US equity.",
      400,
    );
  const calendar = await cached(
    cacheKey("calendar-range", [
      input.start,
      input.end,
      client.config.tradingUrl,
    ]),
    "calendar",
    86400000,
    () => client.calendar(shiftDate(input.start, -20), input.end),
  );
  const sessions = calendar.value.filter(
    (s) => s.date >= input.start && s.date <= input.end,
  );
  const result = await cached(
    cacheKey("backtest", [input, client.config.feed, asOf]),
    "backtest",
    86400000,
    async () => {
      const events: BacktestResult["events"] = [],
        insufficient: BacktestResult["insufficient"] = [];
      if (!sessions.length) return { events, insufficient, examined: 0 };
      const firstIndex = calendar.value.findIndex(
          (s) => s.date === sessions[0].date,
        ),
        previous = calendar.value[firstIndex - 1];
      if (!previous)
        throw new AppError(
          "CALENDAR_UNAVAILABLE",
          "Prior trading session is absent from the provider calendar.",
        );
      const last = sessions.at(-1)!,
        cutoff = last.close < asOf ? last.close : asOf;
      const [bars, dailyBars] = await Promise.all([
        client.bars(
          [input.symbol],
          previous.open,
          new Date(Date.parse(cutoff) - 1).toISOString(),
        ),
        client.bars(
          [input.symbol],
          marketTime(previous.date, "00:00"),
          new Date(Date.parse(cutoff) - 1).toISOString(),
          "1Day",
        ),
      ]);
      for (const session of sessions) {
        const index = calendar.value.findIndex((s) => s.date === session.date),
          prior = calendar.value[index - 1];
        if (session.open > asOf) {
          insufficient.push({
            date: session.date,
            reason: "Extended session is still in progress",
          });
          continue;
        }
        const r = analyzeSession(
          input.symbol,
          bars[input.symbol] ?? [],
          prior,
          session,
          input.threshold,
          input.direction,
          asOf,
          {
            rule: input.rule,
            previousDaily: dailyBars[input.symbol]?.find(
              (b) => marketDate(b.t) === prior.date,
            ),
            daily: dailyBars[input.symbol]?.find(
              (b) => marketDate(b.t) === session.date,
            ),
          },
        );
        if (r.event) {
          // Full-day volume is only available after that ET day has ended.
          // Unlike minute OHLC, Alpaca daily volume includes extended-hours prints.
          if (marketDate(asOf) > session.date)
            r.event.sessionVolume =
              dailyBars[input.symbol]?.find(
                (b) => marketDate(b.t) === session.date,
              )?.v ?? null;
          events.push(r.event);
        }
        if (r.insufficient)
          insufficient.push({ date: session.date, reason: r.insufficient });
      }
      return {
        events: deduplicateEvents(events),
        insufficient,
        examined: sessions.length,
      };
    },
  );
  return {
    ...result.value,
    symbol: input.symbol,
    rule: input.rule ?? "extended",
    start: input.start,
    end: input.end,
    summary: summarize(result.value.events),
    provenance: {
      ...client.provenance(asOf),
      ...(input.rule === "opening"
        ? {
            reference:
              "Previous daily regular-session close; completed daily OHLC for historical outcomes",
          }
        : {}),
    },
    warnings: [
      ...new Set([
        ...asset.warnings,
        ...calendar.warnings,
        ...result.warnings,
        "Minute-bar events describe observed feed data. No-event results do not establish that a threshold was never reached in missing data.",
        "Split-adjusted prices; symbol mapping disabled. Renamed/delisted history may be unavailable. No survivorship-free universe claim.",
      ]),
    ],
  };
}
