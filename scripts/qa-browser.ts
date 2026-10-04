import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type {
  BacktestResult,
  ScanBatch,
  ScanContext,
} from "../src/lib/domain/types";

// Isolated headless Chromium. Never touches the user's desktop/browser profile.
await mkdir("artifacts/qa", { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(20000);
if (
  process.argv.includes("--changes") ||
  process.argv.includes("--scanner-only")
) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/scan/context", async (route) => {
    const response = await route.fetch();
    const value = (await response.json()) as ScanContext;
    await route.fulfill({
      response,
      json: {
        ...value,
        assets: value.assets.filter((a) =>
          ["AAPL", "NVDA", "TSLA"].includes(a.symbol),
        ),
      },
    });
  });
  await page.goto("http://127.0.0.1:3000");
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  await expect(page.getByText("FINISHED", { exact: true })).toBeVisible({
    timeout: 60000,
  });
  await page.screenshot({
    path: "artifacts/qa/premarket-volume-scanner.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "artifacts/qa/premarket-volume-mobile.png",
    fullPage: true,
  });
  if (process.argv.includes("--scanner-only")) {
    await expect(
      page.getByRole("button", { name: "Premarket Price", exact: true }),
    ).toHaveCount(0);
    assert.deepEqual(errors, []);
    await browser.close();
    console.log(
      "Verified revised scanner columns, mobile fit and no page errors.",
    );
    process.exit(0);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const raw = JSON.parse(
    await readFile("artifacts/live/TSLA.json", "utf8"),
  ) as BacktestResult;
  await page.goto(
    "http://127.0.0.1:3000/backtest?symbol=TSLA&threshold=1&direction=both&rule=extended",
  );
  await page.getByLabel("Start date").fill(raw.start);
  await page.getByLabel("End date").fill(raw.end);
  await page.getByRole("button", { name: "Run backtest" }).click();
  await expect(page.locator(".result-header")).toContainText("FINISHED", {
    timeout: 150000,
  });
  await expect(
    page.getByRole("img", { name: /Candlestick price chart/ }),
  ).toHaveAttribute("data-all-events-visible", "true", { timeout: 150000 });
  await page.screenshot({
    path: "artifacts/qa/all-events-footer.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "artifacts/qa/all-events-footer-mobile.png",
    fullPage: true,
  });
  await expect(page.getByLabel("Chart event date")).toHaveCount(0);
  await expect(
    page.getByText(/Persistence unavailable: DATABASE_URL/),
  ).toHaveCount(0);
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    "Verified overnight volume, all-event chart, footer, mobile fit and no page errors.",
  );
  process.exit(0);
}

if (process.argv.includes("--quick") || process.argv.includes("--tail")) {
  await page.route("**/api/scan/context", async (route) => {
    const response = await route.fetch();
    const value = (await response.json()) as ScanContext;
    await route.fulfill({
      response,
      json: {
        ...value,
        assets: process.argv.includes("--tail")
          ? value.assets.slice(10000)
          : value.assets.filter((a) =>
              [
                "AAOI",
                "ACVA",
                "AIXI",
                "AMAT",
                "AMOD",
                "AAPL",
                "NVDA",
                "TSLA",
              ].includes(a.symbol),
            ),
      },
    });
  });
}
const errors: string[] = [],
  batches: ScanBatch[] = [];
let context: ScanContext | undefined,
  processed = 0,
  reported = 0;
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", async (response) => {
  if (response.url().includes("/api/") && !response.ok()) {
    console.log(
      "API failure",
      response.status(),
      response.url(),
      await response.text(),
    );
  }
  if (response.url().endsWith("/api/scan/context") && response.ok())
    context = await response.json();
  if (response.url().endsWith("/api/scan") && response.ok()) {
    const batch = (await response.json()) as ScanBatch;
    batches.push(batch);
    processed += batch.rows.length + batch.unavailable.length;
    if (processed - reported >= 1000) {
      reported = processed;
      console.log(
        `Full-universe scan: ${processed}/${context?.assets.length ?? "?"}`,
      );
    }
  }
});
try {
  await page.goto("http://127.0.0.1:3000");
  await page.getByRole("button", { name: "Scan" }).click();
  await page.getByLabel("Minimum price change %").fill("1");
  await Promise.race([
    page.getByText("FINISHED", { exact: true }).waitFor({ timeout: 900000 }),
    page
      .locator(".notice[role=alert]")
      .first()
      .waitFor({ timeout: 900000 })
      .then(async () => {
        throw new Error(
          await page.locator(".notice[role=alert]").first().innerText(),
        );
      }),
  ]);
  assert.ok(context);
  assert.equal(processed, context.assets.length);
  const rows = batches.flatMap((b) => b.rows),
    ids = new Set(rows.map((r) => r.symbol));
  assert.equal(ids.size, rows.length);
  const missing = batches.flatMap((batch) => batch.unavailable);
  await page.getByText(/^Data coverage ·/).click();
  await expect(page.locator(".coverage-matches p")).toHaveCount(0);
  if (missing.length) {
    await page
      .getByLabel("Check an unavailable ticker")
      .fill(missing[0].symbol);
    await expect(page.locator(".coverage-matches")).toContainText(
      missing[0].reason,
    );
    assert.ok((await page.locator(".coverage-matches p").count()) <= 22);
  }
  await page.getByLabel("Check an unavailable ticker").fill("AAPL");
  if (ids.has("AAPL"))
    await expect(page.locator(".coverage-matches")).toContainText(
      "AAPL has usable data",
    );
  await page.screenshot({
    path: "artifacts/qa/scanner-coverage.png",
    fullPage: true,
  });
  await page.getByText(/^Data coverage ·/).click();
  for (const row of rows) {
    assert.ok(
      row.quote &&
        row.quote.open !== null &&
        row.quote.previousClose !== null &&
        row.quote.price !== null,
    );
    assert.ok(
      Math.abs(
        row.quote.openingGap! -
          (row.quote.open / row.quote.previousClose - 1) * 100,
      ) < 1e-9,
    );
    assert.ok(
      Math.abs(
        row.quote.changeFromOpen! -
          (row.quote.price / row.quote.open - 1) * 100,
      ) < 1e-9,
    );
  }
  const matches = (row: (typeof rows)[number], threshold: number) => {
    const q = row.quote!;
    return q.priceChange != null && q.priceChange >= threshold - 1e-10;
  };
  const expected1 = rows.filter((r) => matches(r, 1)),
    expected5 = rows.filter((r) => matches(r, 5));
  assert.equal(
    await page.locator(".table-scroll tbody tr").count(),
    Math.min(100, expected1.length),
  );
  await page.screenshot({
    path: "artifacts/qa/scanner-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("Minimum price change %").fill("5");
  assert.equal(
    await page.locator(".table-scroll tbody tr").count(),
    Math.min(100, expected5.length),
  );
  assert.ok(
    expected5.every((r) => expected1.some((s) => s.symbol === r.symbol)),
  );
  await page.getByLabel("Minimum price change %").fill("0.001");
  if (rows.filter((r) => matches(r, 0.001)).length > 100) {
    const firstSymbol = await page.locator("tbody tr").first().innerText();
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(page.locator("tbody tr").first()).not.toHaveText(firstSymbol);
    await page
      .getByRole("button", { name: "Previous page", exact: true })
      .click();
  }
  const selectedLabel = await page
    .locator("tbody tr")
    .first()
    .getByRole("link")
    .innerText();
  const selected = rows.find((r) => selectedLabel === `${r.symbol} ↗`);
  assert.ok(selected);
  await page.locator("tbody tr").first().locator("td").nth(2).click();
  await page.screenshot({
    path: "artifacts/qa/scanner-detail.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Backtest This Ticker" }).click();
  await expect(page.getByLabel("Ticker", { exact: true })).toHaveValue(
    selected.symbol,
    { timeout: 20000 },
  );
  const studies = [];
  for (const symbol of ["AAPL", "NVDA", "TSLA"]) {
    const raw = JSON.parse(
      await readFile(`artifacts/live/opening/${symbol}.json`, "utf8"),
    ) as BacktestResult;
    await page.getByLabel("Ticker", { exact: true }).fill(symbol);
    await page.getByLabel("Gap threshold").fill("1");
    await page.getByLabel("Direction", { exact: true }).selectOption("both");
    await page.getByLabel("Start date").fill(raw.start);
    await page.getByLabel("End date").fill(raw.end);
    await page.getByRole("button", { name: "Run backtest" }).click();
    await page
      .locator(".result-header")
      .filter({ hasText: "FINISHED" })
      .waitFor({ timeout: 180000 });
    const count = await page.locator(".table-scroll tbody tr").count();
    assert.equal(count, raw.events.length);
    studies.push({ symbol, count });
    await page.getByRole("img", { name: /Candlestick price chart/ }).waitFor();
    await page.screenshot({
      path: `artifacts/qa/${symbol}-backtest.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Line", exact: true }).click();
    await page.getByRole("img", { name: /Line price chart/ }).waitFor();
    await page.screenshot({
      path: `artifacts/qa/${symbol}-line.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Candles", exact: true }).click();
    await page.locator(".table-scroll tbody tr").first().click();
    await page.screenshot({
      path: `artifacts/qa/${symbol}-event.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Close event" }).click();
    console.log(
      `UI verified ${symbol}: ${count} events; detail drawer and chart stable`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/qa/backtest-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  const result = {
    checkedAt: new Date().toISOString(),
    universe: processed,
    eligible: rows.length,
    insufficient: batches.flatMap((b) => b.unavailable).length,
    countAt1: expected1.length,
    countAt5: expected5.length,
    studies,
    consoleErrors: errors,
    provenance: batches[0].provenance,
  };
  await writeFile(
    process.argv.includes("--quick") || process.argv.includes("--tail")
      ? "artifacts/qa/quick-report.json"
      : "artifacts/qa/report.json",
    JSON.stringify(result, null, 2),
  );
  await writeFile(
    process.argv.includes("--quick") || process.argv.includes("--tail")
      ? "artifacts/qa/quick-scanner-data.json"
      : "artifacts/qa/scanner-data.json",
    JSON.stringify({ context, rows }, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await page
    .screenshot({ path: "artifacts/qa/failure.png", fullPage: true })
    .catch(() => {});
  await writeFile(
    "artifacts/qa/failure.json",
    JSON.stringify(
      {
        error: String(error),
        processed,
        url: page.url(),
        context,
        batches,
        pageErrors: errors,
        alerts: await page
          .locator(".notice")
          .allTextContents()
          .catch(() => []),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
