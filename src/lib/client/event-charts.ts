import type { Bar, EventChartResult, GapEvent } from "../domain/types";
import { request } from "./workflows";

// Reuse the session endpoint/cache with bounded requests, never one unbounded burst.
export async function loadEventCharts(
  symbol: string,
  dates: string[],
  asOf: string,
  signal: AbortSignal,
) {
  const charts: EventChartResult[] = [];
  const failures: { date: string; reason: string }[] = [];
  const unique = [...new Set(dates)].sort();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, unique.length) }, async () => {
      while (next < unique.length) {
        signal.throwIfAborted();
        const date = unique[next++];
        try {
          charts.push(
            await request<EventChartResult>("/api/backtest/chart", {
              method: "POST",
              signal,
              body: JSON.stringify({ symbol, date, asOf }),
            }),
          );
        } catch (error) {
          signal.throwIfAborted();
          failures.push({
            date,
            reason:
              error instanceof Error ? error.message : "Prices unavailable",
          });
        }
      }
    }),
  );
  return {
    bars: mergeEventBars(charts),
    failures,
    warnings: [...new Set(charts.flatMap((c) => c.warnings))],
  };
}

export function mergeEventBars(
  charts: Pick<EventChartResult, "bars">[],
): Bar[] {
  const unique = new Map<string, Bar>();
  for (const chart of charts)
    for (const bar of chart.bars) {
      const key = new Date(bar.t).toISOString();
      const existing = unique.get(key);
      if (
        existing &&
        ["o", "h", "l", "c", "v"].some(
          (k) => existing[k as keyof Bar] !== bar[k as keyof Bar],
        )
      )
        throw new Error(
          `Conflicting event prices at ${key}. Reload the chart.`,
        );
      unique.set(key, { ...bar, t: key });
    }
  return [...unique.values()].sort((a, b) => a.t.localeCompare(b.t));
}

export function visibleTriggerEvents(
  events: Pick<GapEvent, "firstTrigger" | "threshold">[],
  times: string[],
) {
  const available = new Set(times.map(Date.parse));
  return events
    .filter((e) => available.has(Date.parse(e.firstTrigger.time)))
    .sort(
      (a, b) =>
        Date.parse(a.firstTrigger.time) - Date.parse(b.firstTrigger.time),
    );
}
