"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DateTime } from "luxon";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { request } from "@/lib/client/workflows";
import { backtestSchema } from "@/lib/domain/validation";
import type { Direction, GapEvent } from "@/lib/domain/types";
import { compact, number, percent, timestamp, yesNo } from "@/lib/format";
import {
  Notice,
  Percent,
  Progress,
  ProvenanceNote,
  visibleDataWarning,
} from "./common";
import { DataTable } from "./table";
import { useBacktest } from "./backtest-state";
import { MarketChart } from "./chart";
import {
  loadEventCharts,
  visibleTriggerEvents,
} from "@/lib/client/event-charts";
const metricNames: Record<string, string> = {
  openedAbovePrevious: "Opened above prior close",
  closedAbovePrevious: "Closed above prior close",
  continued: "Directional continuation",
  exceededExtendedHigh: "Exceeded extended-hours high",
  gapHeld: "Gap held · whole session",
  gapFilled: "Gap filled",
  openReturn: "Avg. open return",
  openReturnMedian: "Median open return",
  openToClose: "Avg. open → close",
  openToCloseMedian: "Median open → close",
  mfe: "Avg. MFE",
  mae: "Avg. MAE",
};
export function Backtester() {
  const router = useRouter();
  const params = useSearchParams(),
    now = DateTime.now().setZone("America/New_York");
  const {
    settings,
    setSetting,
    result,
    busy,
    finished,
    error,
    setError,
    storageError,
    ready,
    progress,
    execute: run,
    stop,
  } = useBacktest();
  const {
    rule,
    symbol,
    threshold,
    direction,
    start,
    end,
    researchColumns,
    chartMode,
  } = settings;
  const [selected, setSelected] = useState<GapEvent | null>(null);
  const requestedSymbol = params.get("symbol"),
    requestedThreshold = params.get("threshold"),
    requestedDirection = params.get("direction"),
    requestedRule = params.get("rule");
  useEffect(() => {
    if (!ready) return;
    if (requestedRule === "opening" || requestedRule === "extended")
      setSetting("rule", requestedRule);
    if (requestedSymbol) setSetting("symbol", requestedSymbol);
    if (requestedThreshold) setSetting("threshold", requestedThreshold);
    if (
      requestedDirection &&
      ["up", "down", "both"].includes(requestedDirection)
    )
      setSetting("direction", requestedDirection as Direction);
    // Consume handoff parameters so reloading cannot overwrite later edits.
    if (
      requestedSymbol ||
      requestedThreshold ||
      requestedDirection ||
      requestedRule
    )
      router.replace("/backtest", { scroll: false });
    // Apply explicit scanner handoff once after local results have been restored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready,
    requestedSymbol,
    requestedThreshold,
    requestedDirection,
    requestedRule,
  ]);
  const status = useQuery({
    queryKey: ["status"],
    queryFn: () =>
      request<{ historyStart: string; feed: string }>("/api/status"),
  });
  const feedChanged = Boolean(
    result && status.data && result.provenance.feed !== status.data.feed,
  );
  const priceChart = useQuery({
    queryKey: [
      "event-chart",
      result?.symbol,
      result?.events.map((event) => event.date),
      result?.provenance.asOf,
    ],
    enabled: Boolean(
      result &&
      result.events.length &&
      status.data &&
      !feedChanged &&
      !busy &&
      chartMode !== "returns",
    ),
    staleTime: Infinity,
    queryFn: ({ signal }) =>
      loadEventCharts(
        result!.symbol,
        result!.events.map((e) => e.date),
        result!.provenance.asOf,
        signal,
      ),
  });
  const chartTriggers = visibleTriggerEvents(
    result?.events ?? [],
    priceChart.data?.bars.map((b) => b.t) ?? [],
  );

  const validation = backtestSchema.safeParse({
    rule,
    symbol,
    threshold: Number(threshold),
    direction,
    start,
    end,
  });
  const columns = useMemo<ColumnDef<GapEvent>[]>(
    () => [
      {
        accessorKey: "date",
        header: "Session",
        cell: ({ row }) => (
          <button
            className="text-button"
            onClick={() => setSelected(row.original)}
          >
            {row.original.date} ↗
          </button>
        ),
      },
      {
        accessorKey: "side",
        header: "Side",
        cell: ({ row }) =>
          row.original.ambiguousDirection
            ? "Ambiguous"
            : row.original.side.toUpperCase(),
      },
      {
        accessorKey: "previousClose",
        header: "Prev. close",
        cell: ({ row }) => number(row.original.previousClose, 2),
      },
      {
        accessorKey: "threshold",
        header: "Threshold",
        cell: ({ row }) => `${row.original.threshold}%`,
      },
      {
        id: "trigger",
        accessorFn: (r) => r.firstTrigger.time,
        header:
          result?.rule === "opening" ? "Qualified at open" : "First crossing*",
        cell: ({ row }) => timestamp(row.original.firstTrigger.time),
      },
      {
        id: "triggerPrice",
        accessorFn: (r) => r.firstTrigger.observedPrice,
        header: "Trigger bar price*",
        cell: ({ row }) => number(row.original.firstTrigger.observedPrice, 2),
      },
      {
        accessorKey: "maxGap",
        header: "Max ext. gap",
        cell: ({ row }) => <Percent value={row.original.maxGap} />,
      },
      ...(
        ["extendedHigh", "extendedLow", "open", "high", "low", "close"] as const
      ).map((key) => ({
        id: key,
        accessorFn: (r: GapEvent) => r[key] ?? undefined,
        header: {
          extendedHigh: "Ext. high",
          extendedLow: "Ext. low",
          open: "Open",
          high: "High",
          low: "Low",
          close: "Price",
        }[key],
        cell: ({ row }: { row: { original: GapEvent } }) =>
          number(row.original[key], 2),
      })),
      ...(
        [
          "openReturn",
          "openToClose",
          "previousCloseToClose",
          "mfe",
          "mae",
        ] as const
      ).map((key) => ({
        id: key,
        accessorFn: (r: GapEvent) => r[key] ?? undefined,
        header: {
          openReturn: "Opening Gap",
          openToClose: "% Chg From Open",
          previousCloseToClose: "Price Chg",
          mfe: "MFE",
          mae: "MAE",
        }[key],
        cell: ({ row }: { row: { original: GapEvent } }) => (
          <Percent value={row.original[key]} />
        ),
      })),
      {
        id: "sessionVolume",
        accessorFn: (r) => r.sessionVolume ?? undefined,
        header: "Volume",
        cell: ({ row }) => compact(row.original.sessionVolume),
      },
      ...(
        ["gapHeld", "gapFilled", "continued", "exceededExtendedHigh"] as const
      ).map((key) => ({
        id: key,
        accessorFn: (r: GapEvent) =>
          r[key] === null ? undefined : Number(r[key]),
        header: {
          gapHeld: "Gap held",
          gapFilled: "Filled",
          continued: "Continued",
          exceededExtendedHigh: "Exceeded ext. high",
        }[key],
        cell: ({ row }: { row: { original: GapEvent } }) =>
          yesNo(row.original[key]),
      })),
      {
        accessorKey: "regularBars",
        header: "RTH coverage",
        cell: ({ row }) =>
          `${row.original.regularBars}/${row.original.expectedRegularBars}`,
      },
    ],
    [setSelected, result?.rule],
  );
  const visibleColumns = useMemo(() => {
    if (researchColumns) return columns;
    return [
      "date",
      "close",
      "previousCloseToClose",
      "openReturn",
      "openToClose",
      "sessionVolume",
      ...(result?.rule === "opening" ? [] : ["maxGap"]),
    ].map((id) =>
      columns.find(
        (column) =>
          (column.id ?? ("accessorKey" in column ? column.accessorKey : "")) ===
          id,
      )!,
    );
  }, [columns, researchColumns, result?.rule]);
  const points = useMemo(
    () =>
      result?.events
        .filter((e) => e.openToClose !== null)
        .map((e) => ({
          time: `${e.date}T12:00:00.000Z`,
          value: e.openToClose!,
        })) ?? [],
    [result],
  );
  async function execute(e: React.FormEvent) {
    e.preventDefault();
    if (!validation.success) {
      setError(validation.error.issues.map((i) => i.message).join(" "));
      return;
    }
    setSelected(null);
    await run(validation.data);
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Gap Backtester</h1>
          <p>Study opening gaps and measure how prices moved afterward.</p>
        </div>
      </div>
      <form className="panel" noValidate onSubmit={execute}>
        <div className="panel-title">
          <span>Backtest settings</span>
          <span>
            {rule === "opening"
              ? "Opening gap qualifies · continuation is measured afterward"
              : "Any-point trigger · prior after-hours + next pre-market"}
          </span>
        </div>
        <div className="filter-toolbar backtest-toolbar">
          <label>
            EVENT RULE
            <select
              aria-label="Event rule"
              value={rule}
              onChange={(e) =>
                setSetting("rule", e.target.value as "opening" | "extended")
              }
            >
              <option value="opening">Opening gap</option>
              <option value="extended">Extended-hours crossing</option>
            </select>
          </label>
          <label>
            TICKER
            <input
              aria-label="Ticker"
              value={symbol}
              placeholder="e.g. AAPL"
              onChange={(e) =>
                setSetting("symbol", e.target.value.toUpperCase())
              }
              maxLength={15}
            />
          </label>
          <label>
            MIN GAP %
            <input
              aria-label="Gap threshold"
              type="number"
              min="0.001"
              step="any"
              value={threshold}
              onChange={(e) => setSetting("threshold", e.target.value)}
            />
          </label>
          <label>
            DIRECTION
            <select
              aria-label="Direction"
              value={direction}
              onChange={(e) =>
                setSetting("direction", e.target.value as Direction)
              }
            >
              <option value="up">Gap up</option>
              <option value="down">Gap down</option>
              <option value="both">Both</option>
            </select>
          </label>
          <label>
            FROM
            <input
              type="date"
              aria-label="Start date"
              value={start}
              onChange={(e) => setSetting("start", e.target.value)}
            />
          </label>
          <label>
            TO
            <input
              type="date"
              aria-label="End date"
              value={end}
              max={now.toISODate()!}
              onChange={(e) => setSetting("end", e.target.value)}
            />
          </label>
          <button
            className="primary run-button"
            type="submit"
            disabled={busy || !ready}
          >
            {!ready ? "Restoring…" : busy ? "Running…" : "Run backtest →"}
          </button>
          {busy && (
            <button type="button" onClick={stop}>
              Stop
            </button>
          )}
        </div>
        <div className="preset-row">
          <span>LOOKBACK</span>
          {[1, 3, 6, 12, 24].map((m) => (
            <button
              type="button"
              key={m}
              onClick={() => {
                setSetting("start", now.minus({ months: m }).toISODate()!);
                setSetting("end", now.minus({ days: 1 }).toISODate()!);
              }}
            >
              {m < 12 ? `${m}M` : `${m / 12}Y`}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setSetting("start", status.data?.historyStart ?? "2016-01-04");
              setSetting("end", now.minus({ days: 1 }).toISODate()!);
            }}
          >
            Max available
          </button>
          <span className="toolbar-note">Uses available price history.</span>
        </div>
      </form>
      {storageError && (
        <Notice title="Local save unavailable">{storageError}</Notice>
      )}
      {error && (
        <Notice title="Backtest could not finish" error>
          {error}
        </Notice>
      )}
      {busy && (
        <Progress
          done={progress.done}
          total={progress.total}
          label="Analyzing trading days"
        />
      )}
      {result && (
        <>
          {!busy && rule !== (result.rule ?? "extended") && (
            <Notice title="Event rule changed">
              Saved results use{" "}
              {result.rule === "opening" ? "Opening gap" : "Extended hours"}.
              Run the backtest to use the selected rule.
            </Notice>
          )}
          {feedChanged && (
            <Notice title="Data source changed">
              Run the backtest again to refresh these saved results.
            </Notice>
          )}
          <ProvenanceNote
            value={result.provenance}
            warnings={result.warnings}
          />
          <div className="result-header">
            <span>
              <strong>{result.symbol}</strong> / {result.start} — {result.end}
            </span>
            <span>
              {finished ? "FINISHED" : "PARTIAL RESULTS"} · {result.examined}{" "}
              sessions examined · {result.insufficient.length} insufficient ·{" "}
              {result.rule === "opening" ? "Opening gap" : "Extended hours"}
            </span>
          </div>
          <div className="summary-grid">
            <div className="stat featured">
              <span>Qualifying events</span>
              <strong>{result.summary.events}</strong>
              <small>One event per trading session</small>
            </div>
            {(
              [
                ["close", "Avg. Price at Close", "price"],
                ["previousCloseToClose", "Avg. Price Chg", "percent"],
                ["openReturn", "Avg. Opening Gap", "percent"],
                ["openToClose", "Avg. % Chg From Open", "percent"],
                ["sessionVolume", "Avg. Volume", "volume"],
              ] as const
            ).map(([key, label, format]) => (
              <div className="stat" key={key}>
                <span>{label}</span>
                <strong>
                  {format === "price" ? (
                    number(result.summary.metrics[key]?.value, 2)
                  ) : format === "volume" ? (
                    compact(result.summary.metrics[key]?.value)
                  ) : (
                    <Percent value={result.summary.metrics[key]?.value} />
                  )}
                </strong>
                <small>
                  {result.summary.metrics[key]?.n ?? 0} valid observations
                </small>
              </div>
            ))}
            <div className="stat">
              <span>Gap and Go at close</span>
              <strong>
                <Percent
                  value={result.summary.metrics.continuedFromOpen?.value}
                />
              </strong>
              <small>
                {result.summary.metrics.continuedFromOpen?.n ?? 0} valid
                observations
              </small>
            </div>
          </div>
          {result.insufficient.length > 0 && (
            <Notice title="Coverage limitations">
              {result.insufficient.length} sessions could not be evaluated.
              Historical frequencies use only available observations, not the
              entire requested period.
            </Notice>
          )}
          <section className="panel">
            <div className="panel-title">
              <span>
                {chartMode === "returns"
                  ? "Returns by event"
                  : `${result.symbol} · All qualifying events`}
              </span>
              <span>1-minute prices · ET</span>
            </div>
            <div className="chart-controls">
              <div
                className="chart-toggle"
                role="group"
                aria-label="Chart mode"
              >
                {(["candles", "line", "returns"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={chartMode === mode}
                    onClick={() => setSetting("chartMode", mode)}
                  >
                    {mode === "candles"
                      ? "Candles"
                      : mode === "line"
                        ? "Line"
                        : "Event returns"}
                  </button>
                ))}
              </div>
            </div>
            {chartMode === "returns" ? (
              <MarketChart
                points={points}
                histogram
                label="Historical open-to-close returns by event date"
              />
            ) : feedChanged ? (
              <p className="chart-message">
                Run the backtest again to load a chart from the updated prices.
              </p>
            ) : busy || priceChart.isFetching ? (
              <p className="chart-message" role="status">
                Loading event prices…
              </p>
            ) : priceChart.isError ? (
              <Notice title="Chart unavailable" error>
                {priceChart.error.message}
              </Notice>
            ) : (
              <MarketChart
                points={[]}
                bars={priceChart.data?.bars ?? []}
                mode={chartMode}
                events={result.events}
                label={`${chartMode === "candles" ? "Candlestick" : "Line"} price chart for ${result.symbol} across all ${result.events.length} qualifying events`}
              />
            )}
            {chartMode !== "returns" && priceChart.data && (
              <>
                <p className="chart-caption" data-testid="gap-trigger">
                  {chartTriggers.length} of {result.events.length} qualifying
                  events marked. Gold arrows: first minute the Min gap threshold
                  was reached. Zoom or scroll to inspect each event.
                </p>
                {chartTriggers.length < result.events.length && (
                  <Notice title="Some trigger minutes are unavailable">
                    {result.events.length - chartTriggers.length} events have no
                    matching trigger bar in these chart prices. Their results
                    remain in the event table.
                  </Notice>
                )}
                {priceChart.data.failures.length > 0 && (
                  <Notice title="Some event prices could not be loaded" error>
                    {priceChart.data.failures
                      .map((f) => `${f.date}: ${f.reason}`)
                      .join(" · ")}{" "}
                    <button
                      type="button"
                      onClick={() => void priceChart.refetch()}
                    >
                      Retry chart
                    </button>
                  </Notice>
                )}
                {priceChart.data.warnings
                  .filter(visibleDataWarning)
                  .map((warning) => (
                    <Notice key={warning} title="Chart data">
                      {warning}
                    </Notice>
                  ))}
              </>
            )}
            <p className="chart-caption">
              {chartMode === "returns"
                ? "Each bar shows an event’s change from regular open to close."
                : "All qualifying sessions: prior after-hours, pre-market and regular-session prices. Each arrow labels that event’s threshold percentage. A minute’s high or low can reach the gap even if its closing price does not. Missing observations are not filled."}
            </p>
          </section>
          <details className="panel statistics">
            <summary>Additional research statistics</summary>
            <div className="stats-list">
              {Object.entries(metricNames).map(([key, name]) => (
                <div key={key}>
                  <span>{name}</span>
                  <strong>{percent(result.summary.metrics[key]?.value)}</strong>
                  <small>n = {result.summary.metrics[key]?.n ?? 0}</small>
                </div>
              ))}
              <div>
                <span>Best open-to-close</span>
                <strong>{percent(result.summary.best?.value)}</strong>
                <small>{result.summary.best?.date ?? "Unavailable"}</small>
              </div>
              <div>
                <span>Worst open-to-close</span>
                <strong>{percent(result.summary.worst?.value)}</strong>
                <small>{result.summary.worst?.date ?? "Unavailable"}</small>
              </div>
            </div>
          </details>
        </>
      )}
      <section className="panel results-panel">
        <div className="panel-title">
          <span>
            Historical events{" "}
            <b className="count">{result?.events.length ?? 0}</b>
          </span>
          <button
            className="text-button"
            aria-pressed={researchColumns}
            onClick={() => setSetting("researchColumns", !researchColumns)}
          >
            {researchColumns
              ? "Hide research columns"
              : "Show research columns"}
          </button>
        </div>
        <DataTable
          data={result?.events ?? []}
          columns={visibleColumns}
          initialSort={[{ id: "date", desc: true }]}
          onRow={setSelected}
          empty={
            busy
              ? "Searching historical extended-hours observations…"
              : !result
                ? "Enter a ticker, threshold and date range to begin."
                : result.insufficient.length === result.examined &&
                    result.examined > 0
                  ? "Insufficient data to evaluate this period."
                  : "No qualifying events in the available bars for this period."
          }
        />
      </section>
      <ul className="definition-notes" aria-label="Backtest definitions">
        <li>
          <strong>Qualifying events:</strong> Trading sessions that met your
          selected gap rule and minimum percentage. Each session counts once,
          even if the threshold was crossed several times.
        </li>
        <li>
          <strong>Avg. Price at Close:</strong> Average regular-session closing
          price across qualifying events. Add the available closing prices and
          divide by the number of valid observations.
        </li>
        <li>
          <strong>Avg. Price Chg:</strong> Average change from the previous
          trading day’s close to the event day’s regular close. For each event:
          (closing price ÷ previous close − 1) × 100, then average those
          percentages.
        </li>
        <li>
          <strong>Avg. Opening Gap:</strong> Average change from the previous
          trading day’s close to the event day’s regular open. For each event:
          (opening price ÷ previous close − 1) × 100, then average those
          percentages.
        </li>
        <li>
          <strong>Avg. % Chg From Open:</strong> Average change from regular
          open to regular close on qualifying days. For each event: (closing
          price ÷ opening price − 1) × 100, then average those percentages.
        </li>
        <li>
          <strong>Avg. Volume:</strong> Average total shares traded on
          qualifying dates, including premarket, regular trading and
          after-hours. Add the available daily volumes and divide by the number
          of valid observations.
        </li>
        <li>
          <strong>Gap and Go at close:</strong> Percentage of qualifying events
          that closed farther in the gap’s direction than they opened: above the
          open for gap-up events, below the open for gap-down events. Matching
          events ÷ valid observations × 100. Closing exactly at the open does
          not count.
        </li>
        <li>
          <strong>Valid observations:</strong> Events with the data needed for
          that metric. Missing values are left out, so metrics can have
          different counts. These are historical results, not predictions.
        </li>
      </ul>
      {result && result.insufficient.length > 0 && (
        <details className="provenance">
          <summary>Insufficient-data sessions</summary>
          {result.insufficient.map((s) => (
            <p key={s.date}>
              {s.date}: {s.reason}
            </p>
          ))}
        </details>
      )}
      {selected && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <section
            className="detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Event audit"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSelected(null);
            }}
          >
            <div className="drawer-heading">
              <div>
                <span className="eyebrow">EVENT AUDIT</span>
                <h2>
                  {selected.symbol} / {selected.date}
                </h2>
              </div>
              <button
                autoFocus
                onClick={() => setSelected(null)}
                aria-label="Close event"
              >
                ×
              </button>
            </div>
            <dl className="detail-grid">
              <dt>Prior regular close</dt>
              <dd>
                {number(selected.previousClose, 2)} ·{" "}
                {timestamp(selected.previousCloseTime)}
              </dd>
              <dt>Threshold price</dt>
              <dd>{number(selected.firstTrigger.thresholdPrice, 2)}</dd>
              <dt>
                {result?.rule === "opening"
                  ? "Qualified at regular open"
                  : "First observed crossing"}
              </dt>
              <dd>{timestamp(selected.firstTrigger.time)}</dd>
              <dt>Trigger bar price*</dt>
              <dd>{number(selected.firstTrigger.observedPrice, 2)}</dd>
              <dt>Maximum observed gap</dt>
              <dd>
                {percent(selected.maxGap)} · {timestamp(selected.maxGapTime)}
              </dd>
              <dt>Open / High / Low / Close</dt>
              <dd>
                {[selected.open, selected.high, selected.low, selected.close]
                  .map((v) => number(v, 2))
                  .join(" / ")}
              </dd>
              <dt>Open to high / low</dt>
              <dd>
                {percent(selected.openToHigh)} / {percent(selected.openToLow)}
              </dd>
              <dt>MFE / MAE</dt>
              <dd>
                {percent(selected.mfe)} / {percent(selected.mae)}
              </dd>
              <dt>First gap fill</dt>
              <dd>{timestamp(selected.gapFillTime)}</dd>
              <dt>Regular minutes observed</dt>
              <dd>
                {selected.regularBars} / {selected.expectedRegularBars}
              </dd>
              <dt>Extended minutes observed</dt>
              <dd>{selected.extendedBars}</dd>
            </dl>
            {selected.warnings.map((w) => (
              <p className="footnote" key={w}>
                {w}
              </p>
            ))}
            <p className="footnote">
              All values are feed-specific. Higher thresholds cannot increase
              the number of qualifying sessions on the same bars.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
