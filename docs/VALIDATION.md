# Validation record — 2026-10-03

## Premarket Price column removed

Removed the separate Premarket Price table column and scanner footer definition. AMC calculations and saved-data recovery retain their source price internally. Lint, TypeScript and production build pass; both affected browser workflows pass, verifying latest Price sorting, AMC values, saved-result recovery and no Premarket Price header. Isolated desktop/mobile inspection confirms the column is absent, AMC fields remain populated, and there are no page errors or page overflow.

## Missing AMC fields in saved results

Added Premarket Price from the last completed premarket bar, with two-decimal display. AMC Chg % and AMC Volume names are abbreviated in columns/filters and expanded in the definitions. Old/failed saved fields are backfilled from historical bars at the original scan cutoff through a dedicated bounded endpoint; no current-price scan is restarted and saved filters/quotes remain unchanged. Two workers apply successful batches progressively, retaining their data if another request fails. The retry control targets missing fields. Concurrent cap backfills preserve the added historical fields.

109 local tests, 3 live integration tests, lint, typecheck and production build pass. Nine browser workflows passed before the final label/progressive-fetch update; all four affected scanner workflows pass on the final build, including null-field saved results, a temporary provider failure, retry recovery, original-cutoff preservation and no rescan. Independent Alpaca audits confirm prices/change/volume for AAPL, NVDA and TSLA. Desktop screenshot `artifacts/qa/premarket-volume-scanner.png` was inspected and visibly shows AMC values: AAPL +0.88% / 8.74M, NVDA +2.24% / 25.66M, TSLA +1.68% / 5.14M; the separate premarket price is populated. Existing market prices remain unchanged. Mobile layout and page errors are checked by the isolated browser audit.

## All-event charts, overnight volume and summary definitions

The candle/line charts combine all qualifying sessions, with no date selector. Requests use three concurrent workers and existing per-session caches; overlapping bars are deduplicated and conflicting observations rejected. Each exact available first crossing receives a signed gold arrow. Missing chart sessions/trigger bars are explained without moving markers or inventing prices. Visual inspection caught the chart library’s minimum spacing hiding older sessions; reduced minimum spacing and visible-range checks now confirm the full history fits. The real TSLA extended-hours study has 28 events and 28 markers, including upward/downward events.

Premarket Volume follows the requested prior regular-close to next regular-open window, capped by scan time, summing completed minute bars. Independent Alpaca sums at 08:00 ET on October 2: AAPL 8,436,054; NVDA 20,913,021; TSLA 3,656,914. At the open: AAPL 8,740,400; NVDA 25,657,441; TSLA 5,137,624. Noon values match the open, proving the freeze. Raw observations and sums are in `artifacts/live/premarket/volume-audit.json`. Inclusive optional min/max filters, missing/zero volume, deduplication, incomplete bars and range validation are covered.

The backtest footer defines every headline metric, the arithmetic-average formulas, direction-specific continuation frequency and valid-observation denominators. Missing-database configuration notices are hidden in chart and data-details display; actual data errors remain visible. 107 local tests and 3 live integration tests pass, as do TypeScript, lint and the production build. Browser validation covers marker counts, full visible history, filters, footer text, no configuration notice and existing persistence/handoff/error workflows. Isolated manual browser checks observed no page errors or page overflow. Inspected captures: `artifacts/qa/all-events-footer.png`, `all-events-footer-mobile.png`, `premarket-volume-scanner.png`, `premarket-volume-mobile.png`, and all-event line/candle captures.

## Unified scanner without rule selection

Removed the rule and direction selectors and mandatory mode-dependent gap input. Four independent signed minima control Price Chg, Premarket Chg, Opening Gap and Change From Open. All are optional, including Opening Gap. The server retrieves the quote-based universe without requiring a regular open or continuation, then enriches premarket metrics separately. Current Price and volume use the same quote fields throughout. Existing saved output is migrated to the unified view without new price requests; obsolete implicit gap limits are not applied. Legacy internal API modes remain for stored-result and research compatibility. All 103 local tests, 3 live integration tests and 9 browser workflows pass; TypeScript, lint and production build pass. Tests cover a real captured 08:00 ET scan with missing opening metrics, independent signed minima, preservation of legacy saved output without a price scan, numeric cap/volume/price limits, sorting and ticker handoff. Source-bar comparisons now include the unified API mode. Desktop/mobile captures in `artifacts/qa/unified-scanner.png` and `unified-scanner-mobile.png` were inspected; no page errors or page overflow were observed.

## Premarket change column and header navigation

Premarket Chg % and its signed optional minimum now exist in every scanner rule. The value uses the last completed 04:00–09:30 ET bar and the adjusted prior daily close. Later regular/after-hours trades never change it. Missing premarket data stays unavailable, and supplemental retrieval failures preserve the remaining rows. Batched historical source requests are cached. The duplicate Premarket Gap table column is replaced in Premarket mode.

The independent audit confirms 08:00 ET values AAPL +0.299709%, NVDA +1.749978%, TSLA +0.533732%; all observations end at 07:59 ET. At the open, frozen values are AAPL +0.880964%, NVDA +2.243784%, TSLA +1.677445%. All three rules agree on these premarket values even though latest-trade Price Chg differs. Raw bars and references are retained in `artifacts/live/premarket/source.json`, and mode comparisons in `change-modes.json`.

Workspace tabs sit directly beside the name/logo in the top bar, with no sidebar navigation. Methodology and Eastern-time information remain in a plain footer. All 100 local tests, 3 live integration tests and 9 browser workflows pass; lint, TypeScript and production build pass. Desktop and mobile captures were inspected in `artifacts/qa/opening-gap-inclusive.png` and `scanner-filters-mobile.png`: tabs sit beside the logo, percentage inputs are above the ordered market-cap/volume/price ranges, and the page has no horizontal overflow. Tests verify explicit signed percentage limits, dollar cap units, legacy migration and saved navigation behavior.

## Optional percentage filters and range layout

Added signed minimum Price Chg and Change From Open inputs around the existing minimum gap input. They are blank by default and apply only when entered; unavailable metrics are excluded only when their filter is active. The first desktop line contains Scan Rule, Price Chg, gap, Change From Open and Direction. The second line contains min/max market cap, min/max volume and min/max price in that order. Market-cap inputs are USD, with old saved million-based limits converted once and newly active formerly hidden filters cleared for legacy saves.

## Opening-gap filter update

The scanner no longer requires positive Change From Open for gap-up or negative Change From Open for gap-down. Opening-gap thresholds and direction alone determine eligibility; flat, reversed and unavailable from-open observations remain eligible when the opening gap is known. Legacy saved from-open minima are ignored. Backtest continuation remains an outcome. Unit tests cover these cases and real-data browser expectations use opening gaps only. All 94 local tests, 3 live integration tests and 9 browser workflows pass; lint, TypeScript and production build pass. Manual review of `artifacts/qa/opening-gap-inclusive.png` confirms NVDA remains included with a +2.25% opening gap and −0.78% Change From Open. Several returned opening gaps were independently recomputed from the returned open and prior close in the real-data browser check.

## Scanner label cleanup

Removed the duplicate insufficient-data metric and moved the scan state into the heading beside the renamed Scan button. The heading no longer shows Stale Snapshot. Removed Delayed Prices badges and the rule name from the stocks table heading; the count and trading date remain. The bottom data-coverage inspection remains available.

## Latest filters, rules, market caps and chart markers

- Main inputs are minimum gap %, min/max market cap (millions of USD), min/max price and min/max volume. Gap and Go uses opening gap plus strict same-direction continuation; Premarket and Extended hours do not require positive from-open movement. Obsolete hidden percentage filters do not affect displayed results.
- Each of the three rules retains separate outputs in memory and IndexedDB. Switching to an uncached rule deliberately loads it; cached switches, tab navigation and reload make no price scan requests. Aborted jobs cannot overwrite newer results.
- Nasdaq bulk company caps are cached for 30 minutes and matched to exact securities. Live audit: 5,794 usable reported caps, 5,760 exact matches in Alpaca’s 13,200-asset universe. Independently checked AAPL, NVDA, TSLA, AAOI and BRK.B. SPY remains unavailable; fund assets are not substituted. Legacy scans are enriched without refreshing prices; failure preserves prices with a clear notice. Source artifacts: `artifacts/live/market-caps/`.
- Both event chart modes show a gold arrow at the saved first trigger minute and a gold threshold line. The annotation uses the event’s actual signed threshold, not subsequently edited inputs. Exact ET time and two-decimal threshold price are printed below. Missing trigger bars receive no displaced marker.
- Independent chart-source checks verified AAPL August 5 at 04:39 ET ($312.4738 threshold), NVDA August 4 at 06:45 ET ($208.7266), and TSLA August 4 at 04:00 ET ($325.31595), with no earlier qualifying observation. TSLA’s triggering high exceeded the target even though its closing price was below it. Evidence: `artifacts/live/chart-trigger-audit.json`.
- 94 local tests and 3 live integration tests pass. Lint and TypeScript pass. Production build passes. All 9 Playwright browser workflows pass on the final production build, covering all rule choices, inclusive ranges and market-cap units, numerical sorting, legacy cap upgrades/failures, persistence, real-data candle/line markers, Yahoo ticker links and mobile overflow. Desktop scanner, mobile filters, line trigger, upward candles and downward candles were visually inspected from the real browser captures in `artifacts/qa/`; no page errors were observed.

## Premarket and interface updates

- Added Premarket mode and Min Premarket Gap %; only completed 04:00–09:30 ET bars count, with a split-adjusted prior daily close. Opening metrics remain unavailable at 8 AM, and the premarket gap freezes at the open. This earlier iteration defaulted morning workspaces to Premarket; the latest default is Gap and Go, with all three saved rules retained.
- Real October 2, 08:00 ET audit: AAPL 331.31 / prior 330.32 = +0.299709%; NVDA 234.90 / 230.86 = +1.749978%; TSLA 356.00 / 354.11 = +0.533732%. All latest observed bars were 07:59 ET. Independent raw-bar volume checks passed. The 09:30 and noon scans retain identical premarket values. Sources: `artifacts/live/premarket/source.json`.
- Market Cap precedes Price, with missing fundamentals displayed as a dash. All displayed prices and chart axes use two decimals; thresholds use full precision. Yahoo Finance replaces external TradingView ticker links, including share-class notation. The inline Research actions column is removed; row click/keyboard access opens details.
- Main screens no longer display SIP/IEX/provider jargon. Session/date, data cutoff, delayed-price status and actual errors remain visible. Detailed calculation documentation remains on the methodology page.
- 80 local tests, 2 live integration tests, TypeScript, lint and production build pass. Eight browser workflows pass, including an 8 AM scan, unavailable opening values, Yahoo links, two-decimal formatting, row keyboard access, threshold filtering, reload/tab persistence without rescanning and mobile overflow checks. The new persistence test explicitly waits for route navigation before reloading.
- Desktop/mobile premarket screenshots and updated scanner/backtest screenshots inspected. Separate real-data browser QA covered eight symbols and AAPL/NVDA/TSLA studies with zero page errors. The earlier full-universe figures below remain a separate recorded run; the latest `artifacts/qa/report.json` describes this smaller visual regression run.

## Market Chameleon rule alignment

- Default scanner: an opening gap meeting the user threshold AND a strict same-direction move from the open. Down reverses both comparisons; Both accepts either. No pre-market trade is required.
- Public source: https://marketchameleon.com/stock-market-movers/Gap-Up-And-Go. It describes the opening gap and continuation rule but does not publish all preset cutoffs, exchange coverage or corporate-action handling. This implementation does not claim identical proprietary results.
- Price Chg uses latest trade / prior daily close; Opening Gap uses regular open / prior daily close; From Open uses latest trade / regular open. The prior daily close is explicitly split-adjusted.
- Live split check: RETO’s raw prior close was 0.0933; its adjusted prior close was 1.866, with open 1.935. Opening Gap is 3.697749%, not 1,973.954984%. No split factor is guessed.
- Default historical rule: Opening gap. It includes subsequent reversals. Gap and Go at close is a measured outcome, not an entry filter. The separate Extended-hours crossing rule retains the original any-point behavior.
- `scripts/verify-opening.ts` independently compares every qualifying event to provider daily OHLC, dates, prior close, volume, fill evidence and continuation rates. It verifies scanner percentages against captured snapshots and adjusted daily reference bars without requesting minute bars for scanner qualification.
- Opening studies, August 4–October 2: AAPL 2 events (0 continued, 2 reversed/flat); NVDA 20 (10/10); TSLA 18 (10/8). All three cover 43 sessions with zero insufficient sessions. Source data is saved in `artifacts/live/opening/`.
- Browser tests now cover both rules, chart modes, failed-follow-through retention, source/result agreement, reload/tab persistence, inputs, errors and mobile layout. Tables paginate at 100 rows to keep large-universe navigation responsive.
- Final full-universe Gap and Go browser run: 13,200 symbols processed, 12,532 usable and 668 unavailable. Both directions returned 1,666 matches at 1% and 143 at 5%. Pagination, ticker handoff and all three opening-gap studies passed with zero browser errors. The seven Playwright tests also pass.

## Requested behavior

- Scanner: current/last trade Price, Price Chg, Opening Gap, % Chg From Open and provider day Volume are separate from the overnight gap calculation.
- Backtester: the same five labels are primary; historical Price is regular close. Specialist outcomes remain in the research view.
- Event charts: real one-minute candles and line view, event-date selection, prior-close reference, plus the returns view.
- Both workspaces retain results, controls and running jobs during navigation. IndexedDB restores saved results after reload. Scanner prices refresh on an explicit scan or a deliberate switch to an uncached rule; tab navigation and reload restore saved results.
- Larger controls/table text, softer sections, fewer default columns and no fixed status bar over the chart. Both definition footers use plain-English bullet points.

## Automated checks

- 72 unit, API, provider-transport and database tests pass.
- Live Alpaca authentication, assets, calendar, snapshots, historical bars and holiday/DST checks pass (2 tests).
- TypeScript, ESLint and production build pass.
- Playwright tests cover real scanner rows, filters, sorting, TradingView popup, ticker handoff, tab/reload persistence, chart modes and event selection, backtest persistence, navigation during active jobs, input errors, no-events, missing-data, provider failure and mobile overflow.
- Browser bundle inspection checked 34 JavaScript files and found no configured Alpaca credential values. `.env` is ignored by Git.

## Source-data audit

`artifacts/live/report.json` records eleven independently checked scanner rows and three independently checked historical events, using exact captured provider responses. The source audit validates overnight reference/price/high/low/volume, current trade price, daily open/previous close/volume, and all three new percentage formulas.

Examples from the captured source responses (SIP, quote date October 2):

| Symbol | Prior daily close | Day open | Last trade | Price Chg | Opening Gap | Change from open | Day volume |
| ------ | ----------------: | -------: | ---------: | --------: | ----------: | ---------------: | ---------: |
| AAOI   |            107.32 |   110.25 |   115.0127 |   7.1680% |     2.7302% |          4.3199% | 11,070,252 |
| AAPL   |            330.32 |   333.26 |     333.60 |   0.9930% |     0.8900% |          0.1020% | 34,261,610 |
| ACVA   |             10.45 |    10.47 |      10.44 |  -0.0957% |     0.1914% |         -0.2865% |  2,862,979 |

For example, AAOI's `(115.0127 / 107.32 - 1) × 100` is 7.1680%, while its overnight gap uses a different reference of 115.52 and is -0.4391%. This confirms the two session definitions are not mixed.

Historical studies cover August 4–October 2 (43 sessions each). On SIP, AAPL has 9 observed events, NVDA 29 and TSLA 28, with **zero insufficient sessions for all three studies**. Previous IEX studies skipped 5, 6 and 11 sessions respectively.

| Event       | Prior close | First observed trigger (ET) | Max extended gap | Regular OHLC                      | Open-to-close |
| ----------- | ----------: | --------------------------- | ---------------: | --------------------------------- | ------------: |
| AAPL, Aug 5 |      309.38 | 04:39, up                   |          1.3576% | 309.16 / 311.71 / 305.67 / 310.92 |       0.5693% |
| NVDA, Aug 4 |      206.66 | 06:45, up                   |          2.3759% | 211.30 / 213.06 / 209.05 / 211.86 |       0.2650% |
| TSLA, Aug 4 |     322.095 | 04:00, up                   |          1.2869% | 324 / 329.57 / 320.7901 / 327.38  |       1.0432% |

All three audited regular sessions contain 390 observed minutes. Source OHLC, threshold target and first crossing, gap-fill evidence, extended extrema, close returns, daily volume, directional MFE/MAE and continuation are checked independently. Raw bars are retained in each `*-audit.json`; scanner source responses are in `scanner-source-audit.json`.

## Visual and functional review

Desktop scanner, details, AAPL/NVDA/TSLA candle and line charts, historical tables, event details and mobile layout have been inspected through captured real browser sessions. No critical page errors were observed. The revised layout removes the prior fixed footer overlap. The earlier Extended hours SIP scan processed all 13,200 symbols: 7,051 usable and 6,149 insufficient (compared with 99 usable on IEX). At a 1% threshold in Both mode, 1,048 matched; at 5%, 91 matched. The coverage lookup was tested for both available and unavailable tickers and displays at most 20 matches. `artifacts/qa/report.json` records all three browser backtests and zero page errors; screenshots are in the same directory.

## Known data limits

The local configuration uses delayed SIP: a 16-minute historical buffer and Alpaca’s fixed 15-minute delayed snapshots. A direct October 2 after-hours probe found 0 IEX versus 130 SIP bars for AAPL and 0 versus 231 for NVDA. IEX remains supported and its single-venue limits remain explicit. Missing closing/opening minutes and incomplete regular sessions remain unavailable. Daily snapshot volume includes extended-hours prints and can differ from the sum of one-minute bar volume because provider aggregation rules differ. Live trade/open/volume fields come from snapshots; their previous close and all historical/overnight bar requests use split adjustment. Market capitalization now comes from Nasdaq’s public screener; instruments without reported caps and relative-volume history without a denominator remain unavailable. Optional Postgres is not configured; browser persistence and bounded process caching are active. A browser reload cannot keep an unfinished network job running, but it restores its last saved partial results without restarting.


### AMC session correction — 2026-10-03

- AMC change and volume now share the calendar-selected window from the last completed regular close through the next regular open. After Friday close and over weekends, both use Friday after-hours; subsequent premarket joins that same window.
- Legacy saved rows backfill the corrected AMC fields at their original cutoff without rescanning or replacing saved quotes. Server cache key changed to avoid old calculations.
- Independently audited ARM, AAPL, NVDA against raw Alpaca bars in `artifacts/live/amc/audit.json`: ARM 307.49 close, 307.89 latest after-hours, +0.1300855%, 390,422 shares.
- 111 unit tests, 3 live integration tests, 5 affected scanner E2E workflows, lint, TypeScript, production build passed. Desktop/mobile scanner inspected; no page errors.
- Local environment currently specifies SIP/zero delay; that configuration was denied by Alpaca. Validation and running server used a process-only 16-minute delay override without editing the user's environment file.


### Session selector — 2026-10-04

- Replaced visible AMC change/volume with Session Chg % and Session Volume. Added Pre-Market, Post-Market, Overnight selector and matching minimum change/minimum-maximum volume inputs. Session date and latest completed price-bar time are visible in the table.
- The server calculates all three windows from real grouped Alpaca bars and matching daily close references. Pre-Market is 04:00–regular open; Post-Market is the latest completed regular close–20:00; Overnight combines that post-market with the next premarket. No 20:00–04:00 data is assumed.
- Switching rules selects already-loaded metrics and independently filters change/volume without restarting the scan. Saved rule and filter values survive navigation/reload; legacy rows backfill all session metrics at their original cutoff.
- Raw ARM/AAPL/NVDA audit checked latest bar, reference close, percentage, and volume for every rule. ARM Friday premarket +4.990764%, 387,384 shares; Friday post-market/overnight +0.130086%, 390,422 shares. Audit: `artifacts/live/amc/audit.json`.
- 115 unit tests, 3 live integration tests, all 9 E2E workflows passed. Final targeted E2E verified rule/filter persistence and data retry. Typecheck, lint, production build passed. Desktop/mobile scanner visually inspected, no page errors or page overflow.
