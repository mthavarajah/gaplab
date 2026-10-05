import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import type {
  ScanBatch,
  ScanContext,
  BacktestResult,
} from "../../src/lib/domain/types";
import { yahooFinanceLink } from "../../src/lib/domain/scanner";
test("unified scanner: live quote filters, sorting, Yahoo and persistent handoff", async ({
  page,
}) => {
  await page.route("**/api/scan/context", async (route) => {
    const response = await route.fetch();
    const context = (await response.json()) as ScanContext;
    await route.fulfill({
      response,
      json: {
        ...context,
        assets: context.assets.filter((a) =>
          ["AAPL", "NVDA", "TSLA"].includes(a.symbol),
        ),
      },
    });
  });
  await page.goto("/");
  await expect(page.getByLabel("Scan rule")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Premarket Price", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Minimum opening gap %")).toHaveValue("");
  const pending = page.waitForResponse(
    (r) => r.url().endsWith("/api/scan") && r.ok(),
  );
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  const batch = (await (await pending).json()) as ScanBatch;
  expect(batch.mode).toBe("all");
  expect(batch.rows.length).toBeGreaterThan(0);
  await expect(page.getByText("FINISHED", { exact: true })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(batch.rows.length);
  for (const row of batch.rows)
    expect(row.quote!.priceChange).toBeCloseTo(
      (row.quote!.price! / row.quote!.previousClose! - 1) * 100,
      10,
    );
  await expect(
    page.getByRole("button", {
      name: "Extended-Hours Volume",
      exact: true,
    }),
  ).toBeVisible();
  expect(batch.rows.every((r) => r.premarketVolume != null)).toBe(true);
  const minimum = Math.min(...batch.rows.map((r) => r.premarketVolume!));
  const maximum = Math.max(...batch.rows.map((r) => r.premarketVolume!));
  await page.getByLabel("Minimum extended-hours volume").fill(String(minimum));
  await page.getByLabel("Maximum extended-hours volume").fill(String(minimum));
  await expect(page.locator("tbody tr")).toHaveCount(
    batch.rows.filter((r) => r.premarketVolume === minimum).length,
  );
  await page
    .getByLabel("Minimum extended-hours volume")
    .fill(String(maximum + 1));
  await expect(
    page.getByRole("alert").filter({ hasText: "Invalid filters" }),
  ).toBeVisible();
  await page.getByLabel("Maximum extended-hours volume").fill("");
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await page.getByLabel("Minimum extended-hours volume").fill("");
  await page.getByLabel("Minimum opening gap %").fill("999");
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await page.getByLabel("Minimum opening gap %").fill("");
  await page.getByRole("button", { name: "Price Chg", exact: false }).click();
  const displayed = await page
    .locator("tbody tr td:nth-child(5)")
    .allTextContents();
  const values = displayed.map((v) => Number(v.replace("%", "")));
  expect(values).toEqual([...values].sort((a, b) => a - b));
  const selected = batch.rows[0];
  const link = page.getByRole("link", {
    name: `${selected.symbol} ↗`,
    exact: true,
  });
  await expect(link).toHaveAttribute("href", yahooFinanceLink(selected.symbol));
  const pendingPopup = page.waitForEvent("popup");
  await link.click();
  const popup = await pendingPopup;
  await expect(popup).toHaveURL(/finance\.yahoo\.com\/quote\//);
  await popup.close();
  await page
    .locator("tbody tr")
    .filter({ has: link })
    .locator("td")
    .nth(2)
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("link", { name: "Backtest This Ticker" }).click();
  await expect(page.getByLabel("Ticker", { exact: true })).toHaveValue(
    selected.symbol,
  );
  let scans = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/scan")) scans++;
  });
  await page.getByRole("link", { name: "Gap Scanner", exact: true }).click();
  await expect(page).toHaveURL(/:3000\/$/);
  await page.reload();
  await expect(page.locator("tbody tr")).toHaveCount(batch.rows.length);
  expect(scans).toBe(0);
});
test("real backtest: summary/event agreement, percentage rendering, threshold invariants and audit drawer", async ({
  page,
}) => {
  const live = JSON.parse(
    readFileSync("artifacts/live/TSLA.json", "utf8"),
  ) as BacktestResult;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    "/backtest?symbol=TSLA&threshold=1&direction=both&rule=extended",
  );
  await page.getByLabel("Start date").fill(live.start);
  await page.getByLabel("End date").fill(live.end);
  const responses: BacktestResult[] = [];
  page.on("response", async (r) => {
    if (r.url().endsWith("/api/backtest") && r.ok())
      responses.push(await r.json());
  });
  await page.getByRole("button", { name: "Run backtest" }).click();
  await expect(page.getByRole("button", { name: "Running…" })).toBeVisible();
  await expect(page.locator(".result-header")).toContainText("FINISHED", {
    timeout: 150000,
  });
  const events = responses.flatMap((r) => r.events);
  expect(events.length).toBeGreaterThan(0);
  expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  await expect(
    page.getByRole("img", { name: /Candlestick price chart/ }),
  ).toBeVisible({ timeout: 150000 });
  await expect(
    page.getByRole("button", { name: "Candles", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Line", exact: true }).click();
  await expect(
    page.getByRole("img", { name: /Line price chart/ }),
  ).toBeVisible();
  await expect(page.getByTestId("gap-trigger")).toContainText("Min gap");
  const notes = page.getByRole("list", { name: "Backtest definitions" });
  for (const name of [
    "Qualifying events:",
    "Avg. Price at Close:",
    "Avg. Price Chg:",
    "Avg. Opening Gap:",
    "Avg. % Chg From Open:",
    "Avg. Volume:",
    "Gap and Go at close:",
    "Valid observations:",
  ])
    await expect(notes).toContainText(name);
  await expect(
    page.getByText(/Persistence unavailable: DATABASE_URL/),
  ).toHaveCount(0);
  await expect(page.getByLabel("Chart event date")).toHaveCount(0);
  const allChart = page.getByRole("img", {
    name: `Line price chart for TSLA across all ${events.length} qualifying events`,
  });
  await expect(allChart).toHaveAttribute(
    "data-trigger-count",
    String(events.length),
    { timeout: 150000 },
  );
  await expect(allChart).toHaveAttribute("data-all-events-visible", "true");
  await expect(page.getByTestId("gap-trigger")).toContainText(
    `${events.length} of ${events.length}`,
  );
  await expect(page.getByTestId("gap-trigger")).toContainText("Gold arrows");
  await page.screenshot({
    path: "artifacts/qa/backtest-all-events-line.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Candles", exact: true }).click();
  await expect(
    page.getByRole("img", { name: /Candlestick price chart/ }),
  ).toHaveAttribute("data-trigger-count", String(events.length));
  await page.screenshot({
    path: "artifacts/qa/backtest-all-events-candles.png",
    fullPage: true,
  });
  expect(events.some((event) => event.side === "down")).toBe(true);
  await page.getByRole("button", { name: "Line", exact: true }).click();
  let newBacktests = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/backtest")) newBacktests++;
  });
  await page.getByRole("link", { name: "Gap Scanner" }).click();
  await expect(
    page.getByRole("heading", { name: "Gap Scanner" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Backtester" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(events.length);
  await expect(page.getByLabel("Chart event date")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Line", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator("tbody tr")).toHaveCount(events.length);
  await expect(page.getByLabel("Chart event date")).toHaveCount(0);
  expect(newBacktests).toBe(0);
  await page
    .getByRole("button", { name: "Event returns", exact: true })
    .click();
  await expect(
    page.getByRole("img", {
      name: "Historical open-to-close returns by event date",
    }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(events.length);
  await expect(page.locator(".stat.featured strong")).toHaveText(
    String(events.length),
  );
  for (const e of events) {
    expect(Math.abs(e.maxGap!) + 1e-8).toBeGreaterThanOrEqual(1);
    if (e.gapHeld) {
      expect(e.completeRegular).toBe(true);
      expect(
        e.side === "up" ? e.low! > e.previousClose : e.high! < e.previousClose,
      ).toBe(true);
    }
    if (e.followThrough2pct && e.high !== null && e.low !== null)
      expect(
        e.side === "up" ? e.high >= e.open! * 1.02 : e.low <= e.open! * 0.98,
      ).toBe(true);
    if (e.openToClose !== null)
      await expect(
        page.locator("tbody tr").filter({
          has: page.getByRole("button", { name: `${e.date} ↗`, exact: true }),
        }),
      ).toContainText(
        `${e.openToClose > 0 ? "+" : ""}${e.openToClose.toFixed(2)}%`,
      );
  }
  await page.locator("tbody tr").first().click();
  await expect(page.getByRole("dialog", { name: "Event audit" })).toBeVisible();
  await page.getByRole("button", { name: "Close event" }).click();
  await page.getByLabel("Gap threshold").fill("5");
  await page.getByRole("button", { name: "Run backtest" }).click();
  await page.getByRole("link", { name: "Gap Scanner" }).click();
  await page.getByRole("link", { name: "Backtester" }).click();
  await expect(page.getByLabel("Gap threshold")).toHaveValue("5");
  await expect(page.locator(".result-header")).toContainText("FINISHED", {
    timeout: 150000,
  });
  expect(await page.locator("tbody tr").count()).toBeLessThanOrEqual(
    events.length,
  );
  expect(errors).toEqual([]);
});
test("active scanner survives workspace navigation without restarting", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/scan/context", async (route) => {
    const response = await route.fetch();
    const context = (await response.json()) as ScanContext;
    await route.fulfill({
      response,
      json: {
        ...context,
        assets: context.assets.filter((a) => a.symbol === "TSLA"),
      },
    });
  });
  let batches = 0;
  await page.route("**/api/scan", async (route) => {
    batches++;
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  await expect(page.getByText("IN PROGRESS", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Backtester" }).click();
  release();
  await page.getByRole("link", { name: "Gap Scanner" }).click();
  await expect(page.getByText("FINISHED", { exact: true })).toBeVisible();
  expect(batches).toBe(1);
});
test("invalid input, true no-events, missing historical data, and provider failure states", async ({
  page,
}) => {
  await page.goto("/backtest");
  await page.getByLabel("Ticker", { exact: true }).fill("BAD!");
  await page.getByRole("button", { name: "Run backtest" }).click();
  await expect(page.locator(".notice[role=alert]")).toContainText(
    "valid US equity ticker",
  );
  await page.getByLabel("Ticker", { exact: true }).fill("AAPL");
  await page.getByLabel("Gap threshold").fill("999");
  await page.getByLabel("Start date").fill("2025-03-10");
  await page.getByLabel("End date").fill("2025-03-14");
  await page.getByRole("button", { name: "Run backtest" }).click();
  await expect(
    page.getByText(
      "No qualifying events in the available bars for this period.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 60000 });
  await page.getByLabel("Ticker", { exact: true }).fill("ARM");
  await page.getByLabel("Gap threshold").fill("1");
  await page.getByLabel("Start date").fill("2020-01-06");
  await page.getByLabel("End date").fill("2020-01-10");
  await page.getByRole("button", { name: "Run backtest" }).click();
  await expect(
    page.getByText("Insufficient data to evaluate this period.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 60000 });
  // A deliberately injected transport failure contains no market records.
  await page.route("**/api/backtest", (route) =>
    route.fulfill({
      status: 502,
      json: {
        error: {
          code: "PROVIDER_ERROR",
          message: "Alpaca is unavailable (transport failure test).",
        },
      },
    }),
  );
  await page.getByRole("button", { name: "Run backtest" }).click();
  await expect(page.locator(".notice[role=alert]")).toContainText(
    "Alpaca is unavailable",
  );
  await expect(page.locator("tbody tr")).toHaveCount(0);
});
test("mobile layout, methodology and parameter validation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/backtest?symbol=AAPL");
  await expect(page.getByLabel("Ticker", { exact: true })).toHaveValue("AAPL");
  await page.getByLabel("Gap threshold").fill("0");
  await page.getByRole("button", { name: "Run backtest" }).click();
  await expect(page.locator(".notice[role=alert]")).toContainText("Too small");
  expect(await page.locator("tbody tr").count()).toBe(0);
  await page.goto("/methodology");
  await expect(
    page.getByRole("heading", { name: "What the numbers mean" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("opening-gap backtest includes reversals and reports continuation as an outcome", async ({
  page,
}) => {
  const source = JSON.parse(
    readFileSync("artifacts/live/opening/TSLA.json", "utf8"),
  ) as BacktestResult;
  await page.goto(
    "/backtest?symbol=TSLA&threshold=1&direction=both&rule=opening",
  );
  await expect(page.getByLabel("Event rule")).toHaveValue("opening");
  await page.getByLabel("Start date").fill(source.start);
  await page.getByLabel("End date").fill(source.end);
  await page.getByRole("button", { name: "Run backtest" }).click();
  await expect(page.locator(".result-header")).toContainText("FINISHED", {
    timeout: 150000,
  });
  await expect(page.locator("tbody tr")).toHaveCount(source.events.length);
  expect(source.events.some((e) => e.continuedFromOpen === false)).toBe(true);
  await expect(
    page.locator(".stat").filter({ hasText: "Gap and Go at close" }),
  ).toContainText(
    `${source.summary.metrics.continuedFromOpen.value!.toFixed(2)}%`,
  );
  await expect(
    page.getByRole("img", { name: /Candlestick price chart/ }),
  ).toBeVisible({ timeout: 150000 });
  await page.getByRole("button", { name: "Line", exact: true }).click();
  await expect(
    page.getByRole("img", { name: /Line price chart/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Gap Scanner" }).click();
  await page.getByRole("link", { name: "Backtester" }).click();
  await expect(page.getByLabel("Event rule")).toHaveValue("opening");
  await expect(page.locator("tbody tr")).toHaveCount(source.events.length);
  await page.reload();
  await expect(page.locator("tbody tr")).toHaveCount(source.events.length);
});

test("market caps enrich old saved scans without rescanning, sort numerically and survive reload", async ({
  page,
}) => {
  const source = JSON.parse(
    readFileSync("artifacts/live/premarket/source.json", "utf8"),
  ) as { context: ScanContext; batch: ScanBatch };
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Scan", exact: true }),
  ).toBeEnabled();
  // Seed a legacy saved scan using actual captured market records, with the
  // formerly unconnected field removed. No market values are fabricated.
  await page.evaluate(async ({ context, batch }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("gaplab-workspace", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("scanner", "readwrite");
      tx.objectStore("scanner").put(
        {
          version: 2,
          run: {
            mode: "premarket",
            context,
            rows: batch.rows.map((row) => ({
              ...row,
              marketCap: null,
              marketCapInfo: undefined,
            })),
            unavailable: [],
            warnings: [],
            processed: batch.rows.length,
            total: batch.rows.length,
            complete: true,
          },
          settings: {
            mode: "premarket",
            threshold: "0.001",
            direction: "both",
            minPrice: "",
            maxPrice: "",
            volume: "",
            sessionVolume: "",
            dollar: "",
            researchColumns: false,
          },
          lastSuccessfulRefresh: context.asOf,
        },
        "latest",
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, source);
  let rescans = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/scan") ||
      request.url().endsWith("/api/scan/context")
    )
      rescans++;
  });
  // A transport failure must keep the saved prices and explain the cap error.
  await page.route("**/api/market-caps", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          message: "Market caps could not be loaded. Try again shortly.",
        },
      },
    }),
  );
  await page.reload();
  await expect(
    page.getByText("Market cap unavailable", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(source.batch.rows.length);
  for (const value of await page
    .locator("tbody tr td:nth-child(2)")
    .allTextContents())
    expect(value).toBe("—");
  await page.unroute("**/api/market-caps");
  const pending = page.waitForResponse(
    (r) => r.url().endsWith("/api/market-caps") && r.ok(),
  );
  await page.reload();
  const caps = (await (await pending).json()) as {
    values: Record<string, number>;
  };
  for (const row of source.batch.rows) {
    expect(caps.values[row.symbol]).toBeGreaterThan(0);
    const tr = page.locator("tbody tr").filter({
      has: page.getByRole("link", { name: `${row.symbol} ↗`, exact: true }),
    });
    await expect(tr.locator("td").nth(1)).toHaveText(
      new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 2,
      }).format(caps.values[row.symbol]),
    );
    await expect(tr.locator("td").nth(2)).toHaveText(
      row.quote?.price == null ? "—" : row.quote.price.toFixed(2),
    );
  }
  await page.getByRole("button", { name: "Market Cap", exact: true }).click();
  const displayed = (
    await page.locator("tbody tr td:first-child a").allTextContents()
  ).map((s) => s.replace(" ↗", ""));
  const amounts = displayed.map((s) => caps.values[s]);
  expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
  await page.getByRole("button", { name: /Market Cap/ }).click();
  await expect(
    page.getByRole("columnheader", { name: /Market Cap/ }),
  ).toHaveAttribute("aria-sort", "ascending");
  const ascending = (
    await page.locator("tbody tr td:first-child a").allTextContents()
  ).map((s) => caps.values[s.replace(" ↗", "")]);
  expect(ascending).toEqual([...amounts].sort((a, b) => a - b));
  await page.screenshot({
    path: "artifacts/qa/market-caps.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Backtester" }).click();
  await expect(page).toHaveURL(/\/backtest$/);
  await page.getByRole("link", { name: "Gap Scanner" }).click();
  await expect(page).toHaveURL(/:3000\/$/);
  await expect(page.locator("tbody tr")).toHaveCount(source.batch.rows.length);
  await page.reload();
  await expect(page.locator("tbody tr td:nth-child(2)").first()).not.toHaveText(
    "—",
  );
  expect(rescans).toBe(0);
});

test("unified scanner: independent percentages, ordered USD ranges and navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/scan/context", async (route) => {
    const response = await route.fetch();
    const context = (await response.json()) as ScanContext;
    await route.fulfill({
      response,
      json: {
        ...context,
        assets: context.assets.filter((a) =>
          ["AAPL", "NVDA", "TSLA", "AAOI"].includes(a.symbol),
        ),
      },
    });
  });
  await page.goto("/");
  await expect(page.getByLabel("Scan rule")).toHaveCount(0);
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(
    page
      .locator(".topbar")
      .getByRole("link", { name: "Gap Scanner", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const pending = page.waitForResponse(
    (r) => r.url().endsWith("/api/scan") && r.ok(),
  );
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  const batch = (await (await pending).json()) as ScanBatch;
  await expect(page.getByText("FINISHED", { exact: true })).toBeVisible();
  expect(batch.mode).toBe("all");
  expect(batch.rows.length).toBeGreaterThan(0);
  await expect(page.locator("tbody tr")).toHaveCount(batch.rows.length);
  const metrics = [
    [
      "Minimum price change %",
      (r: (typeof batch.rows)[number]) => r.quote?.priceChange,
    ],
    [
      "Minimum extended-hours change %",
      (r: (typeof batch.rows)[number]) => r.premarketChange,
    ],
    [
      "Minimum opening gap %",
      (r: (typeof batch.rows)[number]) => r.quote?.openingGap,
    ],
    [
      "Minimum change from open %",
      (r: (typeof batch.rows)[number]) => r.quote?.changeFromOpen,
    ],
  ] as const;
  for (const [label, value] of metrics) {
    await page.getByLabel(label).fill("999");
    await expect(page.locator("tbody tr")).toHaveCount(0);
    await page.getByLabel(label).fill("0");
    await expect(page.locator("tbody tr")).toHaveCount(
      batch.rows.filter((r) => value(r) != null && value(r)! >= 0).length,
    );
    await page.getByLabel(label).fill("");
    await expect(page.locator("tbody tr")).toHaveCount(batch.rows.length);
  }
  for (const label of [
    "Minimum market cap",
    "Minimum volume",
    "Minimum price",
  ]) {
    await page.getByLabel(label, { exact: true }).fill("999999999999999");
    await expect(page.locator("tbody tr")).toHaveCount(0);
    await page.getByLabel(label, { exact: true }).fill("");
  }
  for (const label of [
    "Maximum market cap",
    "Maximum volume",
    "Maximum price",
  ]) {
    await page.getByLabel(label, { exact: true }).fill("0");
    await expect(page.locator("tbody tr")).toHaveCount(0);
    await page.getByLabel(label, { exact: true }).fill("");
  }
  await expect(page.getByLabel("Session rule", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("columnheader", {
      name: "Extended-Hours Chg %",
      exact: true,
    }),
  ).toBeVisible();
  const cap = batch.rows.find((r) => r.marketCap != null)!.marketCap!;
  await page
    .getByLabel("Minimum market cap", { exact: true })
    .fill(String(cap * 0.999));
  await page
    .getByLabel("Maximum market cap", { exact: true })
    .fill(String(cap * 1.001));
  await expect(page.locator("tbody tr")).toHaveCount(
    batch.rows.filter(
      (r) =>
        r.marketCap != null &&
        r.marketCap >= cap * 0.999 &&
        r.marketCap <= cap * 1.001,
    ).length,
  );
  await page.getByLabel("Minimum market cap", { exact: true }).fill("");
  await page.getByLabel("Maximum market cap", { exact: true }).fill("");
  expect(
    (await page.locator(".scanner-range-filters label").allTextContents()).map(
      (v) => v.trim(),
    ),
  ).toEqual([
    "MIN MARKET CAP ($)",
    "MAX MARKET CAP ($)",
    "MIN VOLUME",
    "MAX VOLUME",
    "MIN PRICE",
    "MAX PRICE",
  ]);
  await page.screenshot({
    path: "artifacts/qa/unified-scanner.png",
    fullPage: true,
  });
  await page.getByLabel("Minimum extended-hours change %").fill("1");
  const expected = batch.rows.filter(
    (r) =>
      r.sessionMetrics!.overnight.change != null &&
      r.sessionMetrics!.overnight.change! >= 1,
  ).length;
  let scans = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/scan") || r.url().endsWith("/api/scan/context"))
      scans++;
  });
  await page.getByRole("link", { name: "Backtester", exact: true }).click();
  await page.getByRole("link", { name: "Gap Scanner", exact: true }).click();
  await expect(page).toHaveURL(/:3000\/$/);
  await page.reload();
  await expect(page.getByLabel("Minimum extended-hours change %")).toHaveValue(
    "1",
  );
  await expect(page.locator("tbody tr")).toHaveCount(expected);
  expect(scans).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/qa/unified-scanner-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("8 AM saved source data can be filtered without an opening value or new scan", async ({
  page,
}) => {
  const source = JSON.parse(
    readFileSync("artifacts/live/premarket/source.json", "utf8"),
  ) as { context: ScanContext; batch: ScanBatch };
  expect(
    source.batch.rows.every(
      (r) => r.quote?.openingGap == null && r.quote?.changeFromOpen == null,
    ),
  ).toBe(true);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Scan", exact: true }),
  ).toBeEnabled();
  await page.evaluate(async ({ context, batch }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("gaplab-workspace", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("scanner", "readwrite");
      tx.objectStore("scanner").put(
        {
          version: 2,
          run: {
            mode: "premarket",
            context,
            rows: batch.rows.map((row) => {
              const copy = { ...row };
              copy.premarketPrice = null;
              copy.premarketVolume = null;
              copy.premarketChange = null;
              return copy;
            }),
            unavailable: [],
            warnings: [],
            processed: batch.rows.length,
            total: batch.rows.length,
            complete: true,
          },
          settings: {
            mode: "premarket",
            threshold: "4",
            direction: "up",
            marketCapUnit: "USD",
          },
          lastSuccessfulRefresh: context.asOf,
        },
        "latest",
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, source);
  let scans = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/scan") || r.url().endsWith("/api/scan/context"))
      scans++;
  });
  let failed = false;
  await page.route("**/api/scan/premarket", async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        json: { error: { message: "Temporary data outage" } },
      });
    } else await route.continue();
  });
  const hydrated = page.waitForResponse(
    (r) => r.url().endsWith("/api/scan/premarket") && r.ok(),
  );
  await page.reload();
  await expect(page.getByText("Temporary data outage")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(source.batch.rows.length);
  await page.getByRole("button", { name: "Retry session data" }).click();
  const hydrationResponse = await hydrated;
  const input = hydrationResponse.request().postDataJSON() as { asOf: string };
  expect(input.asOf).toBe(source.context.asOf);
  const metrics = (await hydrationResponse.json()) as {
    metrics: Record<string, { price: number; volume: number; change: number }>;
  };
  for (const row of source.batch.rows) {
    expect(metrics.metrics[row.symbol].price).toBe(row.price);
    expect(metrics.metrics[row.symbol].volume).toBeGreaterThan(0);
    expect(metrics.metrics[row.symbol].change).toBeCloseTo(
      row.premarketChange!,
      8,
    );
    const line = page.locator("tbody tr").filter({
      has: page.getByRole("link", { name: `${row.symbol} ↗`, exact: true }),
    });
    await expect(line.locator("td").nth(3)).toContainText(
      `${metrics.metrics[row.symbol].change > 0 ? "+" : ""}${metrics.metrics[row.symbol].change.toFixed(2)}%`,
    );
  }
  await expect(page.getByText("Loading saved session data…")).toHaveCount(0);
  await expect(page.getByLabel("Scan rule")).toHaveCount(0);
  await expect(page.locator("tbody tr")).toHaveCount(source.batch.rows.length);
  await expect(page.getByLabel("Minimum opening gap %")).toHaveValue("");
  await page.getByLabel("Minimum extended-hours change %").fill("1");
  await expect(page.locator("tbody tr")).toHaveCount(
    source.batch.rows.filter((r) => r.premarketChange! >= 1).length,
  );
  await page.getByLabel("Minimum opening gap %").fill("0");
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await page.getByLabel("Minimum opening gap %").fill("");
  await expect(page.locator("tbody tr")).toHaveCount(
    source.batch.rows.filter((r) => r.premarketChange! >= 1).length,
  );
  expect(scans).toBe(0);
});
