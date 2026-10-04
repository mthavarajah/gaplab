# Implementation and validation plan

The existing scanner, backtester, Alpaca provider, calendar engine and test suites are retained.

Current requested work:

1. Add current Price, Price Chg, Opening Gap, % Chg From Open and day Volume without conflating current-session prices with the overnight gap.
2. Use the same primary metrics in the historical table; move specialist statistics and detailed columns behind research controls.
3. Preserve both workspaces, inputs and running jobs during tab navigation; save results locally for reload; require explicit scanner refresh.
4. Add per-event candlestick and line charts from source Alpaca bars.
5. Increase typography and spacing, soften panels and remove redundant labels and fixed footer clutter.
6. Validate deterministic formulas, API inputs, real provider results, browser persistence, chart modes, source-data agreement, desktop/mobile layout, and a full-universe scan. Record evidence in VALIDATION.md.

No production market records are fabricated. Market caps use Nasdaq’s public screener; unavailable instruments and relative-volume denominators stay unavailable. The local configuration now uses delayed SIP after source checks confirmed materially better extended-hours coverage. Missing-data causes are grouped and searchable; saved IEX workspaces remain intact until the user explicitly reruns them.

## Market Chameleon alignment

1. Verify the public opening-gap-plus-continuation definition and keep undocumented preset cutoffs explicit.
2. Add Gap and Go as the default scanner rule, with a snapshot-based universe that does not require extended-hours bars. Retain the separate extended-hours rule.
3. Add opening-gap historical cohorts using daily reference/OHLC, retain reversals, and report continuation as an outcome.
4. Preserve saved results and label their original rule; switching a rule requires explicit execution.
5. Validate mathematical fixtures, independent daily/snapshot source audits, both browser modes, full-universe selection, charts, and persistence.

## Premarket workflow and table cleanup

1. Add a dedicated 4 AM–regular-open scan with split-adjusted prior daily close; default new morning workspaces to Premarket and preserve saved workspaces.
2. Add the Premarket Gap column/filter, keep opening metrics separate, and validate the 8 AM cutoff and post-open freeze.
3. Put Market Cap before Price (unavailable without fundamentals), show prices to two decimals, remove the Research action column, use Yahoo Finance ticker links, and remove technical clutter.
4. Verify deterministic logic, real 8 AM source data, persistence, row interaction, mobile layout, all existing workflows and the production build.

## Connect market-cap data

1. Verify a real bulk Nasdaq source and normalize security identifiers without using common-share caps for other instruments.
2. Cache and share one fundamentals download across scanner batches, enrich all scan modes, and upgrade saved rows without rescanning prices.
3. Preserve prices on fundamentals failure; retain unavailable values where the source reports no company cap. Keep source/time details out of the main table except tooltips and detail view.
4. Validate source matching, caching/backoff, live fundamentals, sorting, saved-state migration, browser rendering, lint/typecheck and production build.

## Latest scanner and chart changes

- Keep three scan rules and separate saved outputs. Only Gap and Go requires same-direction follow-through from the open; Premarket and Extended hours accept qualifying faded gaps.
- Expose minimum gap, min/max market cap in millions, min/max price and min/max volume. Hidden legacy filters must not exclude results.
- Enrich current and legacy scans with exact-security Nasdaq market caps using one cached bulk request.
- Show the historical event’s first qualifying minute and threshold price on both candle and line charts, with signed gap, ET time and a missing-trigger-bar notice.
- Verify logic, live services, real-data browser flows, source agreement, persistence, and desktop/mobile screenshots.

- Add a separate Premarket Chg % column and optional minimum across all rules, with source-bar validation and no regular/after-hours substitution. Move workspace navigation beside the brand in the top bar.

- Replace rule selection with one quote-based scanner and independent optional percentage filters. Retain legacy saved output without fetching prices and clear obsolete implicit thresholds. Validate pre-open filtering with no opening metrics.

## All events and overnight volume

- Combine every qualifying session in candle/line charts with exact first-crossing markers; remove date selection. Bound session requests to three concurrent calls, deduplicate overlaps, and explain missing prices.
- Add optional min/max Premarket Volume filters and column using prior regular close through current open, capped by scan time.
- Replace backtest footer with summary metric definitions and suppress the missing-database configuration notice in display.
- Verify raw volume sums, all-event marker counts, UI persistence, errors, desktop/mobile rendering, automated suites and build.
