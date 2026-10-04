"use client";
import { useMemo, useState } from "react";
import type { ScanRun } from "@/lib/client/workflows";

export function ScanCoverage({ run }: { run: ScanRun }) {
  const [search, setSearch] = useState("");
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of run.unavailable)
      counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [run.unavailable]);
  const query = search.trim().toUpperCase();
  const matches = useMemo(
    () =>
      query
        ? run.unavailable.filter((row) => row.symbol.startsWith(query))
        : [],
    [query, run.unavailable],
  );
  const available = query && run.rows.some((row) => row.symbol === query);
  return (
    <details className="provenance coverage">
      <summary>
        Data coverage · {run.rows.length.toLocaleString()} usable ·{" "}
        {run.unavailable.length.toLocaleString()} unavailable
      </summary>
      <p>
        {run.mode === "premarket"
          ? `Premarket on ${run.context.quoteSession.date}, from 4 AM to the open. Prices stop at the scan’s data cutoff.`
          : run.mode === "gap-and-go"
            ? `This scan uses the ${run.context.quoteSession.date} opening price, the previous trading day's close, and the latest available price. Extended-hours bars are not required.`
            : `This scan checks extended hours after ${run.context.previous.date}’s close, ahead of the ${run.context.session.date} open.`}{" "}
        Missing prices are left blank.
      </p>
      <ul className="coverage-reasons">
        {groups.map(([reason, count]) => (
          <li key={reason}>
            {count.toLocaleString()} symbols: {reason}.
          </li>
        ))}
      </ul>
      <label className="coverage-search">
        Check an unavailable ticker
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Enter a symbol, e.g. AAPL"
          autoComplete="off"
        />
      </label>
      <div aria-live="polite" className="coverage-matches">
        {available && (
          <p>
            {query} has usable data. Your filters determine whether it appears
            in the table.
          </p>
        )}
        {query && !available && !matches.length && (
          <p>
            No unavailable ticker matches “{query}” in the processed results.
          </p>
        )}
        {matches.slice(0, 20).map((row) => (
          <p key={row.symbol}>
            <strong>{row.symbol}</strong>: {row.reason}.
          </p>
        ))}
        {matches.length > 20 && (
          <p>
            Showing 20 of {matches.length.toLocaleString()} matches. Enter more
            of the symbol to narrow the list.
          </p>
        )}
      </div>
    </details>
  );
}
