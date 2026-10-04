import type {
  Bar,
  Direction,
  GapEvent,
  Outcomes,
  Session,
  Side,
  Summary,
  Trigger,
  EventRule,
} from "./types";
import {
  extendedBars,
  marketDate,
  MINUTE,
  normalizeBars,
  regularBars,
} from "./time";
export function calculateGapPercent(price: number, reference: number): number {
  if (
    !Number.isFinite(price) ||
    !Number.isFinite(reference) ||
    price <= 0 ||
    reference <= 0
  )
    throw new Error("Prices must be positive finite numbers");
  return (price / reference - 1) * 100;
}
const reached = (price: number, target: number, side: Side) =>
  side === "up" ? price >= target - 1e-10 : price <= target + 1e-10;
export function detectThresholdCrossing(
  bars: Bar[],
  previousClose: number,
  threshold: number,
  side: Side,
): Trigger | null {
  if (
    !Number.isFinite(threshold) ||
    threshold <= 0 ||
    (side === "down" && threshold >= 100)
  )
    throw new Error("Invalid threshold");
  const target =
    previousClose * (1 + ((side === "up" ? 1 : -1) * threshold) / 100);
  for (const b of normalizeBars(bars)) {
    const extreme = side === "up" ? b.h : b.l;
    if (reached(extreme, target, side))
      return {
        time: b.t,
        observedPrice: reached(b.o, target, side) ? b.o : extreme,
        thresholdPrice: target,
        side,
        precision: "1Min",
        exactTradePrice: null,
      };
  }
  return null;
}
export function previousRegularClose(
  bars: Bar[],
  session: Session,
): Bar | null {
  const lastTime = new Date(Date.parse(session.close) - MINUTE).toISOString();
  return bars.find((b) => b.t === lastTime) ?? null;
}
export function calculateMFE(
  open: number,
  high: number,
  low: number,
  side: Side,
): number {
  return Math.max(
    0,
    side === "up"
      ? calculateGapPercent(high, open)
      : -calculateGapPercent(low, open),
  );
}
export function calculateMAE(
  open: number,
  high: number,
  low: number,
  side: Side,
): number {
  return Math.min(
    0,
    side === "up"
      ? calculateGapPercent(low, open)
      : -calculateGapPercent(high, open),
  );
}
export function calculateGapFill(
  bars: Bar[],
  previousClose: number,
  side: Side,
): Bar | null {
  return (
    bars.find((b) =>
      side === "up" ? b.l <= previousClose : b.h >= previousClose,
    ) ?? null
  );
}
export function calculateSessionReturns(
  bars: Bar[],
  session: Session,
  previousClose: number,
  extendedHigh: number | null,
  extendedLow: number | null,
  side: Side,
  asOf: string,
  ambiguous = false,
  daily?: Bar,
): Outcomes {
  const regular = regularBars(normalizeBars(bars), session).filter(
    (b) => Date.parse(b.t) + MINUTE <= Date.parse(asOf),
  );
  const expected =
    (Date.parse(session.close) - Date.parse(session.open)) / MINUTE;
  const completedDaily =
    daily &&
    marketDate(daily.t) === session.date &&
    marketDate(asOf) > session.date
      ? daily
      : undefined;
  const complete = regular.length === expected || Boolean(completedDaily);
  const open =
    completedDaily?.o ?? regular.find((b) => b.t === session.open)?.o ?? null;
  const close =
    completedDaily?.c ?? previousRegularClose(regular, session)?.c ?? null;
  const observedHigh =
    completedDaily?.h ??
    (regular.length ? Math.max(...regular.map((b) => b.h)) : null);
  const observedLow =
    completedDaily?.l ??
    (regular.length ? Math.min(...regular.map((b) => b.l)) : null);
  const high = completedDaily?.h ?? (complete ? observedHigh : null),
    low = completedDaily?.l ?? (complete ? observedLow : null);
  const outcome = (minutes: number) => {
    const bar = regular.find(
      (b) =>
        Date.parse(b.t) === Date.parse(session.open) + (minutes - 1) * MINUTE,
    );
    return open !== null && bar ? calculateGapPercent(bar.c, open) : null;
  };
  const fill = calculateGapFill(regular, previousClose, side);
  const continued =
    extendedHigh === null ||
    extendedLow === null ||
    observedHigh === null ||
    observedLow === null
      ? null
      : side === "up"
        ? observedHigh > extendedHigh
        : observedLow < extendedLow;
  const follow =
    open === null || observedHigh === null || observedLow === null
      ? null
      : side === "up"
        ? observedHigh >= open * 1.02
        : observedLow <= open * 0.98;
  const filled = fill
    ? true
    : high !== null && low !== null
      ? side === "up"
        ? low <= previousClose
        : high >= previousClose
      : null;
  const evidenceBool = (value: boolean | null): boolean | null =>
    value === true ? true : complete ? value : null;
  return {
    open,
    high,
    low,
    close,
    continuedFromOpen:
      ambiguous || open === null || close === null
        ? null
        : side === "up"
          ? close > open
          : close < open,
    openReturn: open === null ? null : calculateGapPercent(open, previousClose),
    return5m: outcome(5),
    return15m: outcome(15),
    return30m: outcome(30),
    return60m: outcome(60),
    openToHigh:
      open !== null && high !== null ? calculateGapPercent(high, open) : null,
    openToLow:
      open !== null && low !== null ? calculateGapPercent(low, open) : null,
    openToClose:
      open !== null && close !== null ? calculateGapPercent(close, open) : null,
    previousCloseToClose:
      close === null ? null : calculateGapPercent(close, previousClose),
    mfe:
      !ambiguous && open !== null && high !== null && low !== null
        ? calculateMFE(open, high, low, side)
        : null,
    mae:
      !ambiguous && open !== null && high !== null && low !== null
        ? calculateMAE(open, high, low, side)
        : null,
    gapFilled: ambiguous ? null : filled,
    gapFillTime: ambiguous ? null : (fill?.t ?? null),
    gapHeld: ambiguous || filled === null ? null : !filled,
    failedGap:
      ambiguous || close === null
        ? null
        : side === "up"
          ? close <= previousClose
          : close >= previousClose,
    continued: ambiguous ? null : evidenceBool(continued),
    exceededExtendedHigh: evidenceBool(
      observedHigh === null || extendedHigh === null
        ? null
        : observedHigh > extendedHigh,
    ),
    followThrough2pct: ambiguous ? null : evidenceBool(follow),
    closedAbovePrevious: close === null ? null : close > previousClose,
    regularBars: regular.length,
    expectedRegularBars: expected,
    completeRegular: complete,
  };
}
export function analyzeSession(
  symbol: string,
  source: Bar[],
  previous: Session,
  session: Session,
  threshold: number,
  direction: Direction,
  asOf: string,
  options: { rule?: EventRule; previousDaily?: Bar; daily?: Bar } = {},
): { event: GapEvent | null; insufficient: string | null } {
  if (
    !Number.isFinite(threshold) ||
    threshold <= 0 ||
    (direction !== "up" && threshold >= 100)
  )
    throw new Error("Invalid threshold");
  const openingRule = options.rule === "opening";
  const bars = normalizeBars(source),
    reference = openingRule
      ? options.previousDaily &&
        marketDate(options.previousDaily.t) === previous.date
        ? options.previousDaily
        : null
      : previousRegularClose(bars, previous);
  if (!reference)
    return {
      event: null,
      insufficient: openingRule
        ? "Previous trading day’s daily close unavailable"
        : "Previous regular-session closing minute missing",
    };
  const ext = extendedBars(bars, previous, session, asOf);
  if (!ext.length && !openingRule)
    return { event: null, insufficient: "No eligible extended-hours bars" };
  const sides: Side[] = direction === "both" ? ["up", "down"] : [direction];
  const daily =
    options.daily &&
    marketDate(options.daily.t) === session.date &&
    marketDate(asOf) > session.date
      ? options.daily
      : undefined;
  const openingPrice =
    daily?.o ??
    regularBars(bars, session).find(
      (b) =>
        b.t === session.open && Date.parse(b.t) + MINUTE <= Date.parse(asOf),
    )?.o;
  if (openingRule && openingPrice === undefined)
    return {
      event: null,
      insufficient: "Regular-session opening price unavailable",
    };
  const triggers = sides
    .map((s): Trigger | null =>
      openingRule
        ? reached(
            openingPrice!,
            reference.c * (1 + ((s === "up" ? 1 : -1) * threshold) / 100),
            s,
          )
          ? {
              time: session.open,
              observedPrice: openingPrice!,
              thresholdPrice:
                reference.c * (1 + ((s === "up" ? 1 : -1) * threshold) / 100),
              side: s,
              precision: "1Min",
              exactTradePrice: null,
            }
          : null
        : detectThresholdCrossing(ext, reference.c, threshold, s),
    )
    .filter((t): t is Trigger => t !== null)
    .sort((a, b) => a.time.localeCompare(b.time));
  if (!triggers.length) return { event: null, insufficient: null };
  const first = triggers[0],
    side = first.side,
    ambiguous = triggers.length > 1 && triggers[0].time === triggers[1].time;
  const extreme = ext.length
    ? ext.reduce((a, b) =>
        side === "up" ? (b.h > a.h ? b : a) : b.l < a.l ? b : a,
      )
    : null;
  const high = ext.length ? Math.max(...ext.map((b) => b.h)) : null,
    low = ext.length ? Math.min(...ext.map((b) => b.l)) : null;
  const outcomes = calculateSessionReturns(
    bars,
    session,
    reference.c,
    high,
    low,
    side,
    asOf,
    ambiguous,
    openingRule ? daily : undefined,
  );
  return {
    insufficient: null,
    event: {
      id: `${symbol}:${session.date}`,
      symbol,
      date: session.date,
      previousClose: reference.c,
      previousCloseTime: reference.t,
      threshold,
      side,
      ambiguousDirection: ambiguous,
      triggers,
      firstTrigger: first,
      maxGap: extreme
        ? calculateGapPercent(
            side === "up" ? extreme.h : extreme.l,
            reference.c,
          )
        : null,
      maxGapTime: extreme?.t ?? null,
      extendedHigh: high,
      extendedLow: low,
      extendedVolume: ext.length ? ext.reduce((sum, b) => sum + b.v, 0) : null,
      sessionVolume: null,
      extendedBars: ext.length,
      warnings: [
        openingRule
          ? "Qualified at the regular open relative to the previous daily close. Later continuation is an outcome, not an entry requirement."
          : "First observed crossing minute; exact first trade time/price unavailable. Earlier missing bars may hide earlier crossings.",
        ...(!outcomes.completeRegular
          ? [
              "Incomplete regular session; full-session extrema and negative claims are unavailable.",
            ]
          : []),
        ...(ambiguous
          ? [
              "Both directions crossed in the same minute; intrabar ordering unknown, directional outcomes unavailable.",
            ]
          : []),
      ],
      ...outcomes,
    },
  };
}
export function summarize(events: GapEvent[]): Summary {
  const metrics: Summary["metrics"] = {};
  const numeric = [
    "close",
    "previousCloseToClose",
    "sessionVolume",
    "openReturn",
    "openToClose",
    "mfe",
    "mae",
    "return5m",
    "return15m",
    "return30m",
    "return60m",
  ] as const;
  for (const key of numeric) {
    const values = events
      .map((e) => e[key])
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    metrics[key] = {
      value: values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : null,
      n: values.length,
    };
    metrics[`${key}Median`] = {
      value: values.length
        ? (values[Math.floor((values.length - 1) / 2)] +
            values[Math.floor(values.length / 2)]) /
          2
        : null,
      n: values.length,
    };
  }
  for (const key of [
    "continuedFromOpen",
    "gapHeld",
    "gapFilled",
    "failedGap",
    "continued",
    "exceededExtendedHigh",
    "followThrough2pct",
    "closedAbovePrevious",
  ] as const) {
    const values = events
      .map((e) => e[key])
      .filter((v): v is boolean => v !== null);
    metrics[key] = {
      value: values.length
        ? (values.filter(Boolean).length / values.length) * 100
        : null,
      n: values.length,
    };
  }
  const opens = events.filter((e) => e.openReturn !== null);
  metrics.openedAbovePrevious = {
    value: opens.length
      ? (opens.filter((e) => e.openReturn! > 0).length / opens.length) * 100
      : null,
    n: opens.length,
  };
  const ranked = events
    .filter((e) => e.openToClose !== null)
    .sort((a, b) => a.openToClose! - b.openToClose!);
  const point = (e: GapEvent | undefined) =>
    e ? { date: e.date, value: e.openToClose! } : null;
  return {
    events: events.length,
    metrics,
    best: point(ranked.at(-1)),
    worst: point(ranked[0]),
  };
}
export function deduplicateEvents(events: GapEvent[]): GapEvent[] {
  return [...new Map(events.map((e) => [e.id, e])).values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}
