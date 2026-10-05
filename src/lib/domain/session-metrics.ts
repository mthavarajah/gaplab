import type {
  Bar,
  ScanContext,
  SessionMetric,
  SessionRule,
  ScannerRow,
} from "./types";
import { calculateGapPercent } from "./calculations";
import {
  extendedBars,
  marketDate,
  marketTime,
  normalizeBars,
  MINUTE,
} from "./time";

export function calculateSessionMetrics(
  source: Bar[],
  references: Bar[],
  context: Pick<
    ScanContext,
    "previous" | "session" | "quotePrevious" | "quoteSession" | "asOf"
  >,
): Record<SessionRule, SessionMetric> {
  const { previous, session, quotePrevious, quoteSession, asOf } = context;
  const completed = normalizeBars(source).filter(
    (b) => Date.parse(b.t) + MINUTE <= Date.parse(asOf),
  );
  const make = (
    bars: Bar[],
    date: string,
    referenceDate: string,
  ): SessionMetric => {
    const last = bars.at(-1);
    const reference = references.find((b) => marketDate(b.t) === referenceDate);
    return {
      price: last?.c ?? null,
      time: last?.t ?? null,
      date,
      referenceDate,
      change:
        last && reference ? calculateGapPercent(last.c, reference.c) : null,
      volume: bars.length ? bars.reduce((sum, b) => sum + b.v, 0) : null,
    };
  };
  return {
    premarket: make(
      completed.filter(
        (b) =>
          b.t >= marketTime(quoteSession.date, "04:00") &&
          b.t < quoteSession.open,
      ),
      quoteSession.date,
      quotePrevious.date,
    ),
    postmarket: make(
      completed.filter(
        (b) =>
          b.t >= previous.close && b.t < marketTime(previous.date, "20:00"),
      ),
      previous.date,
      previous.date,
    ),
    overnight: make(
      extendedBars(completed, previous, session, asOf),
      previous.date,
      previous.date,
    ),
  };
}

// Adapt selected authoritative metrics to the existing independent filter pipeline.
export function rowsForSession(
  rows: ScannerRow[],
  rule: SessionRule,
): ScannerRow[] {
  return rows.map((row) => {
    const metric = row.sessionMetrics?.[rule];
    return {
      ...row,
      premarketChange: metric?.change ?? null,
      premarketVolume: metric?.volume ?? null,
      premarketPrice: metric?.price ?? null,
      premarketTime: metric?.time ?? null,
      premarketSessionDate: metric?.date,
    };
  });
}
