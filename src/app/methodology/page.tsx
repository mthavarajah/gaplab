import Link from "next/link";
export default function Methodology() {
  return (
    <article className="methodology">
      <div className="eyebrow">CALCULATION REFERENCE / VERSION 3</div>
      <h1>What the numbers mean</h1>
      <p>
        Gaplab describes observations from your selected Alpaca feed. It does
        not estimate missing trades or present historical frequencies as
        forecasts.
      </p>
      <h2>Scanner</h2>
      <ul>
        <li>
          One scanner, with no rule selector or automatic gap/continuation
          condition. Each minimum filter applies only when entered. Blank
          filters impose no limit.
        </li>
        <li>
          Price is the latest available trade. Price Chg % = (latest price /
          adjusted previous regular close − 1) × 100.
        </li>
        <li>
          AMC Chg % = (latest completed premarket price / adjusted previous
          regular close − 1) × 100. Only 4 AM through the regular open counts.
          Later prices do not enter it; it freezes at the open.
        </li>
        <li>
          AMC Volume sums completed one-minute bar volumes from the prior
          trading session’s regular close through today’s open, capped by the
          scan time. It includes prior after-hours and current premarket.
          Min/max limits are inclusive and separate from the current date’s
          provider day volume. Missing observations are not filled.
        </li>
        <li>
          Opening Gap % = (regular open / adjusted previous regular close − 1) ×
          100. Change From Open % = (latest price / regular open − 1) × 100.
          Both are unavailable before the open.
        </li>
        <li>
          At 8 AM, use AMC Chg % and leave opening-based filters blank. If a
          filter is active, missing values for that metric are excluded.
        </li>
        <li>
          Market-cap inputs use dollars. Price and volume filters use the
          displayed latest-trade price and provider day volume, including
          extended-hours prints. Displayed prices have two decimals;
          calculations keep full precision.
        </li>
        <li>
          Navigation and reload restore saved output without price requests.
          Scan refreshes the unified universe. Existing output from the previous
          interface remains until you refresh it.
        </li>
        <li>
          The backtest has its own event rules. It remains a historical study,
          not a prediction or trade simulation.
        </li>
      </ul>
      <h2>Opening-gap backtests</h2>
      <p>
        A historical day qualifies at the regular open when its opening gap
        meets the selected threshold. Days that later reverse remain included.
        Gap and Go at close measures how often the regular close ended above the
        open for upward gaps, or below the open for downward gaps. It is an
        outcome, not a condition used to select the historical sample. This is a
        descriptive daily study, not a simulation of entering every intraday
        scanner signal.
      </p>
      <p>
        Completed historical daily bars provide prior close and regular OHLC.
        Minute bars provide observed gap-fill times and extended-hours details.
        Missing extended-hours bars do not exclude an opening-gap event. If
        daily range proves a gap filled but its minute is unavailable, the fill
        is reported with no invented timestamp.
      </p>
      <h2>Calendar and reference prices</h2>
      <p>
        The Alpaca US market calendar supplies trading dates, opens and closes,
        including holidays and early closes. All market boundaries use
        America/New_York and convert to UTC with DST. In the optional Extended
        hours rule, we use the close of the final regular-session minute as the
        reference, and the open of the first regular-session minute as the
        regular open. These are feed-specific bar observations, not a claim to
        the official opening/closing auction price. A missing boundary minute
        makes its price unavailable.
      </p>
      <h2>Extended-hours window</h2>
      <p>
        Prior calendar session close through 20:00 ET, plus 04:00 ET through the
        next calendar session open. On an early-close day, after-hours begins at
        the calendar close. Weekend and holiday timestamps are not included as
        extra trading sessions. BOATS overnight trading from 20:00 to 04:00 is
        not included. At midnight the latest eligible earlier bar remains
        visible with its timestamp. During regular hours, the scanner preserves
        the preceding extended session; at the close it advances to the next
        session.
      </p>
      <h2>Extended-hours gap and first crossing</h2>
      <p>
        <code>gap = (observed price / previous regular close − 1) × 100</code>.
        In Extended hours mode, the scanner filters on the latest completed
        extended minute’s close. Backtests test every eligible minute’s high
        (up) or low (down). A touch counts, even if the price fades before the
        open. Only bars completed by the snapshot time are eligible.
      </p>
      <p>
        The first crossing timestamp identifies the first observed triggering
        minute, not an exact trade. Its reported price is the bar open if
        already beyond the threshold, otherwise its high/low. The threshold
        level is shown separately. Missing earlier bars may hide earlier
        crossings. In Both mode, there is one event per symbol/session, using
        the first direction. If both directions first cross within the same
        minute, intrabar ordering is unknown and directional outcomes are
        unavailable.
      </p>
      <h2>Returns, MFE and MAE</h2>
      <p>
        Open return is regular open versus previous close. The 5/15/30/60 minute
        returns use the closing price of minutes 09:34/09:44/09:59/10:29 for a
        09:30 open, relative to that open. Missing target bars remain
        unavailable. Open-to-close and previous-close-to-close use the last
        regular minute close.
      </p>
      <p>
        MFE/MAE use regular open as reference. For up events, MFE is max(0,
        high/open−1) × 100 and MAE is min(0, low/open−1) × 100. For down events,
        MFE is max(0, 1−low/open) × 100 and MAE is min(0, 1−high/open) × 100. In
        Extended hours mode, full-session extrema and MFE/MAE are withheld
        unless every regular minute has a bar. Opening-gap studies can instead
        use a completed daily bar. No interpolation fills sparse IEX or halted
        periods.
      </p>
      <h2>Deterministic outcomes</h2>
      <ul>
        <li>
          Gap filled: a regular low touches/breaches previous close for up, or a
          regular high touches/breaches it for down. Fill time is the first
          observed minute.
        </li>
        <li>
          Gap held: every regular-session low is strictly above prior close for
          up; every high strictly below for down. This is a whole-session rule,
          distinct from closing above or below the prior close.
        </li>
        <li>
          Failed gap: closes at/below prior close for up, at/above for down. A
          separate “closed above prior close” metric follows the literal
          signed-price rule.
        </li>
        <li>
          Continued: regular high strictly exceeds extended high for up; low
          strictly breaks extended low for down. Exceeded extended-hours high
          separately measures regular high above extended high for either
          direction.
        </li>
        <li>
          2% directional follow-through: high ≥ open × 1.02 for up, low ≤ open ×
          0.98 for down.
        </li>
      </ul>
      <p>
        Positive evidence can establish a fill, continuation or follow-through
        in partial data. Negative full-session claims require complete minute
        coverage or, for opening-gap studies, a completed daily bar. Summary
        rates exclude null outcomes and show their individual denominators.
        Both-mode averages of raw returns are not simulated strategy P&amp;L.
      </p>
      <h2>Current-session scanner columns</h2>
      <p>
        Price is the latest Alpaca trade, with its own timestamp. Price Chg is
        (Price / previous daily close − 1) × 100. Opening Gap is (regular open /
        previous daily close − 1) × 100. % Chg From Open is (Price / regular
        open − 1) × 100. The open comes from the snapshot daily bar; the prior
        close comes from the matching split-adjusted historical daily bar so
        splits do not create artificial gaps; pre-market opening metrics remain
        unavailable. An older trade cannot establish movement after today’s
        open. Volume is provider daily volume, including extended-hours trades
        on the displayed quote-session date. It is feed-specific, not all-market
        volume on IEX.
      </p>
      <p>
        On non-trading days, quote columns describe the most recent trading
        date. After the close, the overnight scanner advances to the next
        trading session, while quote columns continue to describe the current
        day. These references are intentionally separate. Quotes are fetched per
        batch and may be newer than the fixed cutoff used for overnight bars.
        Open the detail panel for both references, quote retrieval time and
        last-trade time. Price filters use the latest trade; the gap threshold
        uses the opening gap in Gap and Go mode and extended-hours movement in
        Extended hours mode.
      </p>
      <p>
        Scans run only on request. Results and filters are saved in this
        browser; switching tabs or reloading restores them without starting
        another scan. A running scan continues when switching workspace tabs. A
        page reload interrupts an unfinished scan and restores the last saved
        partial results. Click Scan to fetch a new scan. No automatic refresh is
        scheduled.
      </p>
      <h2>Volume, coverage and provenance</h2>
      <p>
        Extended volume sums only returned extended bars. Previous regular
        volume is available only with all regular minutes. Dollar volume is
        latest extended price × observed extended volume (not the sum of trade
        notional). Relative volume would require current cumulative extended
        volume divided by the average volume over the same elapsed windows of
        prior sessions; the MVP does not fetch a reliable denominator, so the
        field and filter are unavailable.
      </p>
      <p>
        Market cap comes from{" "}
        <a
          href="https://www.nasdaq.com/market-activity/stocks/screener"
          target="_blank"
          rel="noreferrer"
        >
          Nasdaq’s stock screener
        </a>
        , in US dollars, cached for up to 30 minutes. We use the reported value
        directly, not an estimate from trading volume. The retrieval time is
        available in the column tooltip and stock details; the source does not
        always provide its valuation timestamp. Market caps update independently
        of scan prices and are current reference values, not historical values
        at the scan cutoff. Share classes are matched separately. ETFs, warrants
        and other instruments without a reported company market cap remain
        unavailable. Saved price scans can receive market caps without rerunning
        the price scan.
      </p>
      <p>
        IEX covers one venue and has limited extended-hours observations. SIP
        aggregates exchanges but does not guarantee every minute has an eligible
        trade. No-event means no observed crossing, not proven absence of an
        event. Split adjustments prevent split-driven artificial gaps; dividend
        gaps remain. Historical symbol mapping is disabled, so renamed-symbol
        history may be incomplete. The scanner uses today’s eligible active
        Alpaca assets; no survivorship-free universe claim is made.
      </p>
      <h2>Reproducibility and persistence</h2>
      <p>
        Every result carries feed, adjustment, timeframe, snapshot time and
        engine version. Requests run in bounded batches with full provider
        pagination. A scan keeps one cutoff while filters change. Historical
        date ranges use weekly chunks with a shared cutoff. Drizzle stores cache
        entries and result chunks in Postgres when configured. Without a
        database, a visible warning identifies process-only caching. Failed
        writes are reported.
      </p>
      <p>
        <a
          href="https://docs.alpaca.markets/us/reference/stockbars"
          target="_blank"
          rel="noreferrer"
        >
          Alpaca bar definitions ↗
        </a>{" "}
        ·{" "}
        <a
          href="https://docs.alpaca.markets/us/docs/market-data-faq"
          target="_blank"
          rel="noreferrer"
        >
          Alpaca feed and aggregation FAQ ↗
        </a>
      </p>
      <Link href="/">← Return to scanner</Link>
    </article>
  );
}
