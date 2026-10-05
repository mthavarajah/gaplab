"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { rowsForSession } from "@/lib/domain/session-metrics";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { request } from "@/lib/client/workflows";
import {
  filterScannerRows,
  scannerTrigger,
  yahooFinanceLink,
} from "@/lib/domain/scanner";
import type {
  ScanMode,
  ScannerRow,
  EventChartResult,
} from "@/lib/domain/types";
import { compact, number, timestamp } from "@/lib/format";
import { DataTable } from "./table";
import { useScanner } from "./scanner-state";
import { MarketChart } from "./chart";
import { ScanCoverage } from "./scan-coverage";
import { Notice, Percent, Progress, ProvenanceNote } from "./common";
export function Scanner() {
  const status = useQuery({
    queryKey: ["status"],
    queryFn: () =>
      request<{ configured: boolean; feed: string }>("/api/status"),
  });
  const {
    run,
    settings,
    setSetting,
    ready,
    busy,
    error,
    storageError,
    marketCapError,
    premarketError,
    premarketLoading,
    retryPremarket,
    lastSuccessfulRefresh,
    scan,
    stop,
  } = useScanner();
  const {
    sessionRule,
    threshold,
    minOpeningGap,
    direction,
    minPrice,
    maxPrice,
    volume,
    sessionVolume,
    maxVolume,
    minPremarketVolume,
    maxPremarketVolume,
    minMarketCap,
    maxMarketCap,
    minPriceChange,
    minPremarketChange,
    minChangeFromOpen,
    researchColumns,
  } = settings;
  const activeMode: ScanMode = "all";
  const openingMode = true;
  const premarketMode = false;
  const capError =
    marketCapError ??
    run?.warnings.find((warning) =>
      warning.startsWith("Market caps could not be loaded."),
    );
  const [selected, setSelected] = useState<ScannerRow | null>(null);
  const valid =
    [
      minPrice,
      maxPrice,
      volume,
      sessionVolume,
      maxVolume,
      minPremarketVolume,
      maxPremarketVolume,
      minMarketCap,
      maxMarketCap,
    ].every(
      (v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0),
    ) &&
    [
      minPriceChange,
      minPremarketChange,
      minOpeningGap,
      minChangeFromOpen,
    ].every((v) => v === "" || Number.isFinite(Number(v))) &&
    (!minPrice || !maxPrice || Number(minPrice) <= Number(maxPrice)) &&
    (!minMarketCap ||
      !maxMarketCap ||
      Number(minMarketCap) <= Number(maxMarketCap)) &&
    (!maxVolume ||
      !(premarketMode ? volume : sessionVolume) ||
      Number(premarketMode ? volume : sessionVolume) <= Number(maxVolume)) &&
    (!minPremarketVolume ||
      !maxPremarketVolume ||
      Number(minPremarketVolume) <= Number(maxPremarketVolume));
  const rows = useMemo(
    () =>
      valid
        ? filterScannerRows(rowsForSession(run?.rows ?? [], sessionRule), {
            mode: activeMode,
            threshold: 0,
            minOpeningGap: minOpeningGap ? Number(minOpeningGap) : undefined,
            direction,
            minPriceChange: minPriceChange ? Number(minPriceChange) : undefined,
            minPremarketChange: minPremarketChange
              ? Number(minPremarketChange)
              : undefined,
            minChangeFromOpen: minChangeFromOpen
              ? Number(minChangeFromOpen)
              : undefined,
            minPremarketVolume: minPremarketVolume
              ? Number(minPremarketVolume)
              : undefined,
            maxPremarketVolume: maxPremarketVolume
              ? Number(maxPremarketVolume)
              : undefined,
            minMarketCap: minMarketCap ? Number(minMarketCap) : undefined,
            maxMarketCap: maxMarketCap ? Number(maxMarketCap) : undefined,
            maxVolume:
              premarketMode && maxVolume ? Number(maxVolume) : undefined,
            maxSessionVolume:
              !premarketMode && maxVolume ? Number(maxVolume) : undefined,
            minPrice: minPrice ? Number(minPrice) : undefined,
            maxPrice: maxPrice ? Number(maxPrice) : undefined,
            minVolume: premarketMode && volume ? Number(volume) : undefined,
            minSessionVolume:
              !premarketMode && sessionVolume
                ? Number(sessionVolume)
                : undefined,
          })
        : [],
    [
      valid,
      sessionRule,
      activeMode,
      premarketMode,
      run,
      minOpeningGap,
      direction,
      minPrice,
      maxPrice,
      volume,
      sessionVolume,
      maxVolume,
      minPremarketVolume,
      maxPremarketVolume,
      minMarketCap,
      maxMarketCap,
      minPriceChange,
      minPremarketChange,
      minChangeFromOpen,
    ],
  );
  const columns = useMemo<ColumnDef<ScannerRow>[]>(
    () => [
      {
        accessorKey: "symbol",
        header: "Symbol",
        cell: ({ row }) => (
          <div className="symbol-cell">
            <a
              href={yahooFinanceLink(row.original.symbol)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              {row.original.symbol} ↗
            </a>
            <span title={row.original.name}>{row.original.name}</span>
          </div>
        ),
      },
      {
        id: "marketCap",
        accessorFn: (r) => r.marketCap ?? undefined,
        header: "Market Cap",
        cell: ({ row }) => (
          <span
            title={
              row.original.marketCap == null
                ? row.original.marketCapInfo
                  ? "No company market cap reported for this instrument"
                  : "Market cap not loaded"
                : `Market cap in USD · ${row.original.marketCapInfo?.source ?? "Source"} · Retrieved ${timestamp(row.original.marketCapInfo?.fetchedAt)}`
            }
          >
            {compact(row.original.marketCap)}
          </span>
        ),
      },
      {
        id: "currentPrice",
        accessorFn: (r) =>
          (premarketMode ? r.price : r.quote?.price) ?? undefined,
        header: "Price",
        cell: ({ row }) => (
          <span
            title={`Last trade: ${timestamp(premarketMode ? row.original.latestTime : row.original.quote?.priceTime)} · quote session ${row.original.quote?.sessionDate ?? "unavailable"}`}
          >
            {number(
              premarketMode ? row.original.price : row.original.quote?.price,
              2,
            )}
          </span>
        ),
      },
      {
        id: "premarketChange",
        accessorFn: (r) =>
          r.premarketChange ?? (premarketMode ? r.gap : undefined),
        header: "Session Chg %",
        cell: ({ row }) => (
          <span
            title={`Session ${row.original.premarketSessionDate ?? row.original.quote?.sessionDate ?? "unavailable"} · Latest session price ${timestamp(row.original.premarketTime ?? (premarketMode ? row.original.latestTime : null))}`}
          >
            <Percent
              value={
                row.original.premarketChange ??
                (premarketMode ? row.original.gap : null)
              }
            />
          </span>
        ),
      },
      ...(["priceChange", "openingGap", "changeFromOpen"] as const).map(
        (key) => ({
          id: key,
          accessorFn: (r: ScannerRow) => r.quote?.[key] ?? undefined,
          header: {
            priceChange: "Price Chg",
            openingGap: "Opening Gap",
            changeFromOpen: "% Chg From Open",
          }[key],
          cell: ({ row }: { row: { original: ScannerRow } }) => (
            <Percent value={row.original.quote?.[key]} />
          ),
        }),
      ),
      {
        accessorKey: "premarketVolume",
        header: "Session Volume",
        cell: ({ row }) => (
          <span title="Shares traded in the selected session through the saved cutoff">
            {compact(row.original.premarketVolume)}
          </span>
        ),
      },
      {
        accessorKey: "premarketSessionDate",
        header: "Session Date",
        cell: ({ row }) => row.original.premarketSessionDate ?? "—",
      },
      {
        accessorKey: "premarketTime",
        header: "Session Price Time",
        cell: ({ row }) => timestamp(row.original.premarketTime),
      },
      {
        id: "sessionVolume",
        accessorFn: (r) => r.quote?.volume ?? undefined,
        header: "Volume",
        cell: ({ row }) => (
          <span title="Provider day volume, including extended-hours trades">
            {compact(row.original.quote?.volume)}
          </span>
        ),
      },
      {
        accessorKey: "price",
        header: premarketMode ? "Premarket price" : "Ext. price",
        cell: ({ row }) => number(row.original.price, 2),
      },
      {
        accessorKey: "gap",
        header: premarketMode ? "Premarket Gap %" : "Ext. Gap %",
        cell: ({ row }) => <Percent value={row.original.gap} />,
      },
      {
        accessorKey: "previousClose",
        header: "Prev. close",
        cell: ({ row }) => number(row.original.previousClose, 2),
      },
      {
        accessorKey: "high",
        header: premarketMode ? "Premarket high" : "Ext. high",
        cell: ({ row }) => number(row.original.high, 2),
      },
      {
        accessorKey: "low",
        header: premarketMode ? "Premarket low" : "Ext. low",
        cell: ({ row }) => number(row.original.low, 2),
      },
      {
        accessorKey: "volume",
        header: premarketMode ? "Premarket volume" : "Ext. vol",
        cell: ({ row }) => compact(row.original.volume),
      },
      {
        id: "previousVolume",
        accessorFn: (r) => r.previousVolume ?? undefined,
        header: "Prev. RTH vol",
        cell: ({ row }) => compact(row.original.previousVolume),
      },
      {
        id: "relativeVolume",
        accessorFn: (r) => r.relativeVolume ?? undefined,
        header: "Rel. vol",
        cell: () => (
          <span
            className="muted"
            title="Historical matched-window denominator unavailable"
          >
            —
          </span>
        ),
      },
      {
        accessorKey: "dollarVolume",
        header: "Dollar vol",
        cell: ({ row }) => `$${compact(row.original.dollarVolume)}`,
      },
      {
        id: "firstTrigger",
        accessorFn: (r) =>
          scannerTrigger(r, Number(threshold), direction).firstTime ??
          undefined,
        header: "First crossing*",
        cell: ({ row }) =>
          timestamp(
            scannerTrigger(row.original, Number(threshold), direction)
              .firstTime,
          ),
      },
      {
        id: "maxTime",
        accessorFn: (r) =>
          scannerTrigger(r, Number(threshold), direction).maxTime,
        header: "Max gap time",
        cell: ({ row }) =>
          timestamp(
            scannerTrigger(row.original, Number(threshold), direction).maxTime,
          ),
      },
      {
        accessorKey: "latestTime",
        header: "Price time",
        cell: ({ row }) => timestamp(row.original.latestTime),
      },
    ],
    [threshold, direction, premarketMode],
  );
  const visibleColumns = useMemo(
    () =>
      researchColumns && !openingMode
        ? columns.filter(
            (column) =>
              !premarketMode ||
              !("accessorKey" in column && column.accessorKey === "gap"),
          )
        : columns.filter((column) =>
            [
              "symbol",
              "marketCap",
              "currentPrice",
              "priceChange",
              "premarketChange",
              "premarketVolume",
              "premarketSessionDate",
              "premarketTime",
              "openingGap",
              "changeFromOpen",
              premarketMode ? "volume" : "sessionVolume",
              ...(!openingMode && !premarketMode ? ["gap"] : []),
              ...(premarketMode ? ["latestTime"] : []),
            ].includes(
              column.id ??
                ("accessorKey" in column ? String(column.accessorKey) : ""),
            ),
          ),
    [columns, researchColumns, openingMode, premarketMode],
  );
  const detailChart = useQuery({
    queryKey: [
      "scanner-detail-chart",
      selected?.symbol,
      run?.context.quoteSession.date,
      run?.context.asOf,
    ],
    enabled: Boolean(openingMode && selected && run),
    queryFn: ({ signal }) =>
      request<EventChartResult>("/api/backtest/chart", {
        method: "POST",
        signal,
        body: JSON.stringify({
          symbol: selected!.symbol,
          date: run!.context.quoteSession.date,
          asOf: run!.context.asOf,
        }),
      }),
  });
  const points = useMemo(
    () => selected?.extendedBars.map((b) => ({ time: b.t, value: b.c })) ?? [],
    [selected],
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Gap Scanner</h1>
        </div>
        <div className="heading-actions">
          <span className="muted" data-testid="scanner-status">
            {run && <>Data cutoff {timestamp(run.context.asOf)} · </>}
            Scan state:{" "}
            <strong>
              {busy
                ? "IN PROGRESS"
                : run?.complete
                  ? "FINISHED"
                  : run
                    ? "PARTIAL"
                    : "NOT STARTED"}
            </strong>
          </span>
          <button
            className="primary"
            disabled={busy || !ready}
            onClick={() => {
              setSelected(null);
              void scan();
            }}
          >
            {!ready ? "Restoring…" : busy ? "Scanning…" : "Scan"}
          </button>
          {busy && <button onClick={stop}>Stop</button>}
        </div>
      </div>
      <section className="panel">
        <div className="panel-title">
          <span>Scanner filters</span>
        </div>
        <div className="filter-toolbar">
          <label>
            SESSION RULE
            <select
              aria-label="Session rule"
              value={sessionRule}
              onChange={(e) =>
                setSetting("sessionRule", e.target.value as typeof sessionRule)
              }
            >
              <option value="premarket">Pre-Market</option>
              <option value="postmarket">Post-Market</option>
              <option value="overnight">Overnight</option>
            </select>
          </label>
        </div>
        <div className="filter-toolbar scanner-percent-filters">
          <label>
            MIN PRICE CHG %
            <input
              aria-label="Minimum price change %"
              type="number"
              step="any"
              placeholder="Any"
              value={minPriceChange}
              onChange={(e) => setSetting("minPriceChange", e.target.value)}
            />
          </label>
          <label>
            MIN SESSION CHG %
            <input
              aria-label="Minimum session change %"
              type="number"
              step="any"
              placeholder="Any"
              value={minPremarketChange}
              onChange={(e) => setSetting("minPremarketChange", e.target.value)}
            />
          </label>
          <label>
            MIN OPENING GAP %
            <input
              aria-label="Minimum opening gap %"
              type="number"
              step="any"
              placeholder="Any"
              value={minOpeningGap}
              onChange={(e) => setSetting("minOpeningGap", e.target.value)}
            />
          </label>
          <label>
            MIN CHG FROM OPEN %
            <input
              aria-label="Minimum change from open %"
              type="number"
              step="any"
              placeholder="Any"
              value={minChangeFromOpen}
              onChange={(e) => setSetting("minChangeFromOpen", e.target.value)}
            />
          </label>
        </div>
        <div className="filter-toolbar scanner-range-filters">
          <label>
            MIN MARKET CAP ($)
            <input
              aria-label="Minimum market cap"
              type="number"
              min="0"
              step="any"
              placeholder="Any"
              value={minMarketCap}
              onChange={(e) => setSetting("minMarketCap", e.target.value)}
            />
          </label>
          <label>
            MAX MARKET CAP ($)
            <input
              aria-label="Maximum market cap"
              type="number"
              min="0"
              step="any"
              placeholder="Any"
              value={maxMarketCap}
              onChange={(e) => setSetting("maxMarketCap", e.target.value)}
            />
          </label>
          <label>
            MIN VOLUME
            <input
              aria-label="Minimum volume"
              type="number"
              min="0"
              placeholder="Any"
              value={premarketMode ? volume : sessionVolume}
              onChange={(e) =>
                setSetting(
                  premarketMode ? "volume" : "sessionVolume",
                  e.target.value,
                )
              }
            />
          </label>
          <label>
            MAX VOLUME
            <input
              aria-label="Maximum volume"
              type="number"
              min="0"
              placeholder="Any"
              value={maxVolume}
              onChange={(e) => setSetting("maxVolume", e.target.value)}
            />
          </label>
          <label>
            MIN PRICE
            <input
              aria-label="Minimum price"
              type="number"
              min="0"
              placeholder="Any"
              value={minPrice}
              onChange={(e) => setSetting("minPrice", e.target.value)}
            />
          </label>
          <label>
            MAX PRICE
            <input
              aria-label="Maximum price"
              type="number"
              min="0"
              placeholder="Any"
              value={maxPrice}
              onChange={(e) => setSetting("maxPrice", e.target.value)}
            />
          </label>
        </div>
        <div className="filter-toolbar">
          <label>
            MIN SESSION VOLUME
            <input
              aria-label="Minimum session volume"
              type="number"
              min="0"
              placeholder="Any"
              value={minPremarketVolume}
              onChange={(e) => setSetting("minPremarketVolume", e.target.value)}
            />
          </label>
          <label>
            MAX SESSION VOLUME
            <input
              aria-label="Maximum session volume"
              type="number"
              min="0"
              placeholder="Any"
              value={maxPremarketVolume}
              onChange={(e) => setSetting("maxPremarketVolume", e.target.value)}
            />
          </label>
        </div>
        <div className="preset-row">
          <span className="toolbar-note">
            Opening Gap and % Chg From Open start at 9:30 AM ET. Blank filters
            impose no limit.
          </span>
        </div>
      </section>
      {!valid && (
        <Notice title="Invalid filters" error>
          Enter valid numeric filters. Minimum price, market cap and volume must
          not exceed their maximums.
        </Notice>
      )}
      {status.data && !status.data.configured && (
        <Notice title="Connect market data">
          Set up a market-data connection to scan stocks.
        </Notice>
      )}
      {status.isError && (
        <Notice title="Connection status unavailable" error>
          {status.error.message}
        </Notice>
      )}
      {premarketLoading && <p role="status">Loading saved session data…</p>}
      {premarketError && (
        <Notice title="session data could not be loaded" error>
          {premarketError}{" "}
          <button type="button" onClick={retryPremarket}>
            Retry session data
          </button>
        </Notice>
      )}
      {storageError && (
        <Notice title="Local save unavailable">{storageError}</Notice>
      )}
      {capError && <Notice title="Market cap unavailable">{capError}</Notice>}
      {error && (
        <Notice title="Scan interrupted" error>
          {error} {run && "The table is not a complete universe scan."}
        </Notice>
      )}
      {run && (
        <ProvenanceNote
          value={run.context.provenance}
          warnings={run.warnings}
        />
      )}
      {busy && (
        <Progress
          done={run?.processed ?? 0}
          total={run?.total ?? 0}
          label="Scanning stocks"
        />
      )}
      <div className="scan-metrics">
        <div>
          <span>MATCHES</span>
          <strong>{run ? rows.length.toLocaleString() : "—"}</strong>
        </div>
        <div>
          <span>SYMBOLS SCANNED</span>
          <strong>
            {run
              ? `${run.processed.toLocaleString()} / ${run.total.toLocaleString()}`
              : "—"}
          </strong>
        </div>
        <div>
          <span>
            {openingMode || premarketMode
              ? "TRADING SESSION"
              : "OVERNIGHT SESSION"}
          </span>
          <strong>
            {(openingMode || premarketMode
              ? run?.context.quoteSession.date
              : run?.context.session.date) ?? "Awaiting calendar"}
          </strong>
        </div>
      </div>
      <section className="panel results-panel">
        <div className="panel-title">
          <span>
            Stocks <b className="count">{rows.length}</b>
            {run && (
              <small className="quote-session-label">
                {run.context.quoteSession.date}
              </small>
            )}
          </span>
          {!openingMode && (
            <button
              className="text-button"
              aria-pressed={researchColumns}
              onClick={() => setSetting("researchColumns", !researchColumns)}
            >
              {researchColumns
                ? "Hide research columns"
                : "Show research columns"}
            </button>
          )}
        </div>
        <DataTable
          key={`${direction}:${activeMode}`}
          data={rows}
          columns={visibleColumns}
          initialSort={[
            {
              id: "priceChange",
              desc: true,
            },
          ]}
          onRow={setSelected}
          empty={
            busy
              ? "Scanning — results appear as batches finish."
              : !run
                ? "Click Scan to find stocks."
                : run.rows.length
                  ? "No stocks meet these filters in the observed data."
                  : "Insufficient data. Check Data coverage below."
          }
        />
      </section>
      <ul className="definition-notes" aria-label="Scanner definitions">
        <li>
          <strong>Price:</strong>{" "}
          {premarketMode
            ? "The latest available premarket price."
            : "The last available share price."}
        </li>
        <li>
          <strong>Price Chg:</strong> How much the latest trade price has
          changed since the previous trading day’s close.
        </li>
        <li>
          <strong>Session Chg %:</strong> Latest price in the selected session
          compared with the regular close that came before it.
        </li>
        <li>
          <strong>Session Volume:</strong> Shares traded in the selected window,
          through the saved scan time. Missing data stays unavailable.
        </li>
        <li>
          <strong>Session rules:</strong> Pre-Market is 4–9:30 AM ET.
          Post-Market is the regular close–8 PM ET. Overnight combines
          post-market and the following premarket; it does not include 8 PM–4 AM
          trading. Weekend results retain the last available session.
        </li>
        <li>
          <strong>Opening Gap:</strong> How much higher or lower the stock
          opened than the previous day’s close.
        </li>
        <li>
          <strong>% Chg From Open:</strong> How much the price has moved since
          the market opened.
        </li>
        <li>
          <strong>{premarketMode ? "Premarket volume" : "Volume"}:</strong>{" "}
          {premarketMode
            ? "Shares traded before the open, from 4 AM ET."
            : "Shares traded on the displayed date, including extended hours."}
        </li>
        {!openingMode && !premarketMode && (
          <li>
            <strong>Ext. Gap %:</strong>{" "}
            {premarketMode
              ? "Latest premarket price versus the previous trading day’s close. Stops updating at the open."
              : "Latest extended-hours price versus the prior close."}
          </li>
        )}
        <li>
          <strong>Saved results:</strong> Scan refreshes the data. Navigation
          and reload preserve the current output. Last successful scan:{" "}
          {timestamp(lastSuccessfulRefresh)}.
        </li>
        <li>A dash means data is unavailable.</li>
      </ul>
      {run &&
        status.data?.configured &&
        status.data.feed !== run.context.provenance.feed && (
          <Notice title="Data source changed">
            Click Scan to refresh these saved results.
          </Notice>
        )}
      {run && <ScanCoverage run={run} />}
      {selected && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <section
            className="detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`${selected.symbol} details`}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSelected(null);
            }}
          >
            <div className="drawer-heading">
              <div>
                <span className="eyebrow">Stock details</span>
                <h2>
                  {selected.symbol}{" "}
                  <span className="exchange">{selected.exchange}</span>
                </h2>
                <p>{selected.name}</p>
              </div>
              <button
                autoFocus
                onClick={() => setSelected(null)}
                aria-label="Close details"
              >
                ×
              </button>
            </div>
            <div className="quote">
              <strong>
                $
                {number(
                  premarketMode ? selected.price : selected.quote?.price,
                  2,
                )}
              </strong>
              <Percent
                value={
                  premarketMode ? selected.gap : selected.quote?.priceChange
                }
              />
            </div>
            {openingMode && detailChart.isFetching && (
              <p role="status">Loading session prices…</p>
            )}
            {openingMode && detailChart.isError && (
              <Notice title="Chart unavailable" error>
                {detailChart.error.message}
              </Notice>
            )}
            {openingMode ? (
              <MarketChart
                points={[]}
                bars={detailChart.data?.bars ?? []}
                mode="line"
                reference={selected.quote?.previousClose ?? undefined}
                label={`${selected.symbol} session price chart`}
              />
            ) : (
              <MarketChart
                points={points}
                label={
                  premarketMode ? "Premarket prices" : "Extended-hours prices"
                }
              />
            )}
            <dl className="detail-grid">
              <dt>Market cap</dt>
              <dd>
                {selected.marketCap == null
                  ? "—"
                  : `$${compact(selected.marketCap)}`}
              </dd>
              {selected.marketCapInfo && (
                <>
                  <dt>Market cap retrieved</dt>
                  <dd>{timestamp(selected.marketCapInfo.fetchedAt)}</dd>
                </>
              )}
              <dt>Quote session</dt>
              <dd>{selected.quote?.sessionDate ?? "Unavailable"}</dd>
              <dt>Last trade</dt>
              <dd>{timestamp(selected.quote?.priceTime)}</dd>
              <dt>Quote retrieved</dt>
              <dd>{timestamp(selected.quote?.fetchedAt)}</dd>
              <dt>Session previous close / open</dt>
              <dd>
                {number(selected.quote?.previousClose, 2)} /{" "}
                {number(selected.quote?.open, 2)}
              </dd>
              <dt>Opening Gap / % Chg From Open</dt>
              <dd>
                <Percent value={selected.quote?.openingGap} /> /{" "}
                <Percent value={selected.quote?.changeFromOpen} />
              </dd>
              <dt>Day volume (incl. extended)</dt>
              <dd>{number(selected.quote?.volume, 0)}</dd>
              {!openingMode && (
                <>
                  <dt>
                    {premarketMode
                      ? "Premarket price / gap"
                      : "Extended price / gap"}
                  </dt>
                  <dd>
                    {number(selected.price, 2)} /{" "}
                    <Percent value={selected.gap} />
                  </dd>
                  <dt>Previous close</dt>
                  <dd>${number(selected.previousClose, 2)}</dd>
                  <dt>
                    {premarketMode
                      ? "Premarket high / low"
                      : "Extended high / low"}
                  </dt>
                  <dd>
                    {number(selected.high, 2)} / {number(selected.low, 2)}
                  </dd>
                  <dt>
                    {premarketMode ? "Premarket volume" : "Extended volume"}
                  </dt>
                  <dd>{number(selected.volume, 0)}</dd>
                  <dt>First crossing*</dt>
                  <dd>
                    {timestamp(
                      scannerTrigger(selected, Number(threshold), direction)
                        .firstTime,
                    )}
                  </dd>
                  <dt>Maximum gap time</dt>
                  <dd>
                    {timestamp(
                      scannerTrigger(selected, Number(threshold), direction)
                        .maxTime,
                    )}
                  </dd>
                  <dt>Last completed bar</dt>
                  <dd>{timestamp(selected.latestTime)}</dd>
                </>
              )}
              <dt>Instrument class</dt>
              <dd>{selected.assetType}</dd>
            </dl>
            <Link
              className="button primary full-width"
              href={`/backtest?symbol=${selected.symbol}&threshold=${threshold}&direction=${direction}&rule=${openingMode ? "opening" : "extended"}`}
            >
              Backtest This Ticker →
            </Link>
            <a
              className="button full-width"
              href={yahooFinanceLink(selected.symbol)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Yahoo Finance ↗
            </a>
            <p className="footnote">Missing prices are left blank.</p>
          </section>
        </div>
      )}
    </>
  );
}
