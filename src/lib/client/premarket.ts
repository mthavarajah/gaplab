import type { ScannerRow } from "../domain/types";
import { SCAN_BATCH_SIZE } from "../domain/limits";
import { request } from "./workflows";
export type PremarketMetrics = {
  sessionDate: string;
  metrics: Record<
    string,
    {
      price: number | null;
      change: number | null;
      volume: number | null;
      time: string | null;
    }
  >;
  warnings: string[];
};
export async function loadSavedPremarket(
  symbols: string[],
  asOf: string,
  signal: AbortSignal,
  onBatch?: (data: PremarketMetrics) => void,
) {
  const result: PremarketMetrics = {
    sessionDate: "",
    metrics: {},
    warnings: [],
  };
  const failures: string[] = [];
  let next = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(2, Math.ceil(symbols.length / SCAN_BATCH_SIZE)) },
      async () => {
        while (next < symbols.length) {
          signal.throwIfAborted();
          const batch = symbols.slice(next, (next += SCAN_BATCH_SIZE));
          try {
            const data = await request<PremarketMetrics>(
              "/api/scan/premarket",
              {
                method: "POST",
                signal,
                body: JSON.stringify({ symbols: batch, asOf }),
              },
            );
            Object.assign(result.metrics, data.metrics);
            result.sessionDate = data.sessionDate;
            result.warnings.push(...data.warnings);
            onBatch?.(data);
          } catch (error) {
            signal.throwIfAborted();
            failures.push(
              `${batch.length} symbols: ${error instanceof Error ? error.message : "Data unavailable"}`,
            );
          }
        }
      },
    ),
  );
  result.warnings = [...new Set(result.warnings)];
  return { ...result, failures };
}
export function withPremarketMetrics(
  rows: ScannerRow[],
  data: PremarketMetrics,
): ScannerRow[] {
  return rows.map((row) => {
    const metric = data.metrics[row.symbol];
    return metric
      ? {
          ...row,
          premarketPrice: metric.price,
          premarketChange: metric.change,
          premarketVolume: metric.volume,
          premarketTime: metric.time,
          premarketSessionDate: data.sessionDate,
          amcVersion: 1,
        }
      : row;
  });
}
