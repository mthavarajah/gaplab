import type {
  BacktestResult,
  ScanBatch,
  ScanContext,
  ScannerRow,
  ScanMode,
} from "../domain/types";
import { chunksOfDates } from "../domain/time";
import { SCAN_BATCH_SIZE } from "../domain/limits";
import { deduplicateEvents, summarize } from "../domain/calculations";
import type { z } from "zod";
import type { backtestSchema } from "../domain/validation";
export async function request<T>(
  url: string,
  options: RequestInit = {},
  onRetry?: (seconds: number) => void,
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    if (response.status === 429 && attempt < 3) {
      const seconds = Math.max(
        1,
        Math.min(120, Number(response.headers.get("Retry-After")) || 60),
      );
      onRetry?.(seconds);
      await new Promise<void>((resolve, reject) => {
        const signal = options.signal;
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        const onAbort = () => {
          clearTimeout(timer);
          reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, seconds * 1000);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
      continue;
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        `Server returned an unreadable response (${response.status}).`,
      );
    }
    if (!response.ok)
      throw new Error(
        data.error?.message ?? `Request failed (${response.status}).`,
      );
    return data as T;
  }
  throw new Error(
    "Provider rate limit persisted after three cooldowns. Retry later.",
  );
}
export type ScanRun = {
  mode?: ScanMode;
  rows: ScannerRow[];
  context: ScanContext;
  unavailable: ScanBatch["unavailable"];
  warnings: string[];
  processed: number;
  total: number;
  complete: boolean;
};
export async function runScan(
  signal: AbortSignal,
  onProgress: (run: ScanRun) => void,
  mode: ScanMode = "extended",
): Promise<ScanRun> {
  const context = await request<ScanContext>("/api/scan/context", { signal });
  const state: ScanRun = {
    mode,
    context,
    rows: [],
    unavailable: [],
    warnings: context.warnings,
    processed: 0,
    total: context.assets.length,
    complete: false,
  };
  onProgress({ ...state });
  let next = 0;
  const worker = async () => {
    while (next < context.assets.length) {
      signal.throwIfAborted();
      const assets = context.assets.slice(next, (next += SCAN_BATCH_SIZE));
      const batch = await request<ScanBatch>(
        "/api/scan",
        {
          method: "POST",
          signal,
          body: JSON.stringify({
            mode,
            symbols: assets.map((a) => a.symbol),
            asOf: context.asOf,
          }),
        },
        (seconds) => {
          state.warnings = [
            ...new Set([
              ...state.warnings,
              `Provider rate limit encountered; automatic ${seconds}-second cooldown before retrying the same snapshot.`,
            ]),
          ];
          onProgress({ ...state, rows: [...state.rows] });
        },
      );
      if (batch.mode && batch.mode !== mode)
        throw new Error(
          "The server returned a different scan rule. Retry this scan.",
        );
      state.context = { ...state.context, provenance: batch.provenance };
      state.rows.push(...batch.rows);
      state.unavailable.push(...batch.unavailable);
      state.warnings = [...new Set([...state.warnings, ...batch.warnings])];
      state.processed += assets.length;
      onProgress({
        ...state,
        rows: [...state.rows],
        unavailable: [...state.unavailable],
      });
    }
  };
  await Promise.all([worker(), worker()]);
  state.complete = true;
  onProgress({ ...state });
  return state;
}
export function combineBacktests(parts: BacktestResult[]): BacktestResult {
  const events = deduplicateEvents(parts.flatMap((p) => p.events)),
    first = parts[0];
  return {
    ...first,
    start: parts.map((p) => p.start).sort()[0],
    end: parts
      .map((p) => p.end)
      .sort()
      .at(-1)!,
    events,
    summary: summarize(events),
    examined: parts.reduce((sum, p) => sum + p.examined, 0),
    insufficient: parts.flatMap((p) => p.insufficient),
    warnings: [...new Set(parts.flatMap((p) => p.warnings))],
  };
}
export async function runBacktest(
  input: z.infer<typeof backtestSchema>,
  signal: AbortSignal,
  onProgress: (
    done: number,
    total: number,
    result: BacktestResult | null,
  ) => void,
): Promise<BacktestResult> {
  const chunks = chunksOfDates(input.start, input.end),
    parts: BacktestResult[] = [];
  let next = 0;
  let asOf = input.asOf;
  onProgress(0, chunks.length, null);
  // First result fixes provider-adjusted asOf for every following chunk.
  const first = await request<BacktestResult>("/api/backtest", {
    method: "POST",
    signal,
    body: JSON.stringify({ ...input, ...chunks[next++] }),
  });
  parts.push(first);
  asOf = first.provenance.asOf;
  onProgress(1, chunks.length, combineBacktests(parts));
  const worker = async () => {
    while (next < chunks.length) {
      signal.throwIfAborted();
      const chunk = chunks[next++];
      const result = await request<BacktestResult>("/api/backtest", {
        method: "POST",
        signal,
        body: JSON.stringify({ ...input, ...chunk, asOf }),
      });
      parts.push(result);
      onProgress(parts.length, chunks.length, combineBacktests(parts));
    }
  };
  await Promise.all([worker(), worker()]);
  return combineBacktests(parts);
}
