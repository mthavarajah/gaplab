import { describe, expect, it } from "vitest";
import {
  calculateSessionQuote,
  createPremarketScannerRow,
  filterScannerRows,
} from "../src/lib/domain/scanner";
import {
  defaultScannerSettings,
  settingsForRule,
  restoreScannerSettings,
} from "../src/lib/client/scan-storage";
import { bar, previous, session } from "./fixtures";
import { marketTime } from "../src/lib/domain/time";
import type { ScanMode, ScannerRow } from "../src/lib/domain/types";
const asset = {
  symbol: "TEST",
  name: "Fixture",
  exchange: "NASDAQ",
  status: "active",
  tradable: true,
  class: "us_equity",
};
const close = bar(previous.date, "00:00", 100);
function row(gapPrice = 104, latest = 103): ScannerRow {
  const asOf = marketTime(session.date, "16:00");
  const quote = calculateSessionQuote(
    {
      prevDailyBar: close,
      dailyBar: bar(session.date, "00:00", gapPrice),
      latestTrade: { p: latest, t: marketTime(session.date, "15:59") },
    },
    session,
    previous,
    asOf,
  );
  return {
    ...createPremarketScannerRow(
      asset,
      [bar(session.date, "07:59", gapPrice)],
      close,
      previous,
      session,
      asOf,
      quote,
    )!,
    marketCap: 500_000_000,
  };
}
const filtered = (value: ScannerRow, mode: ScanMode) =>
  filterScannerRows([value], {
    mode,
    threshold: 4,
    direction: "up",
  });
describe("scan rule isolation", () => {
  it("keeps a faded upward gap in every rule when no follow-through filter is set", () => {
    const value = row();
    expect(value.quote?.openingGap).toBeCloseTo(4);
    expect(value.quote?.changeFromOpen).toBeLessThan(0);
    expect(filtered(value, "gap-and-go")).toHaveLength(1);
    expect(filtered(value, "premarket")).toHaveLength(1);
    expect(filtered(value, "extended")).toHaveLength(1);
  });
  it("accepts flat movement and unavailable opening metrics in non-Go rules", () => {
    const value = row(104, 104);
    expect(filtered(value, "gap-and-go")).toHaveLength(1);
    for (const mode of ["premarket", "extended"] as const) {
      expect(filtered(value, mode)).toHaveLength(1);
      expect(filtered({ ...value, quote: null }, mode)).toHaveLength(1);
    }
  });
  it("keeps downward reversals in every rule", () => {
    const value = row(96, 97);
    const filter = (mode: ScanMode) =>
      filterScannerRows([value], {
        mode,
        threshold: 4,
        direction: "down",
      });
    expect(value.quote?.changeFromOpen).toBeGreaterThan(0);
    expect(filter("gap-and-go")).toHaveLength(1);
    expect(filter("premarket")).toHaveLength(1);
    expect(filter("extended")).toHaveLength(1);
  });
  it("still rejects insufficient gaps in non-Go rules", () => {
    const value = row(102, 103);
    expect(filtered(value, "premarket")).toHaveLength(0);
    expect(filtered(value, "extended")).toHaveLength(0);
  });
  it("preserves explicit filters when selecting another rule", () => {
    const settings = {
      ...defaultScannerSettings,
      minChangeFromOpen: "5",
      minMarketCap: "100",
      maxVolume: "2000000",
    };
    for (const mode of ["premarket", "extended"] as const) {
      const changed = settingsForRule(settings, mode);
      expect(changed.mode).toBe(mode);
      expect(changed.minChangeFromOpen).toBe("5");
      expect(changed.minMarketCap).toBe("100");
      expect(changed.maxVolume).toBe("2000000");
    }
    expect(settingsForRule(settings, "gap-and-go").minChangeFromOpen).toBe("5");
    expect(settings.minChangeFromOpen).toBe("5");
  });
});
describe("combined scanner limits", () => {
  it("applies inclusive numeric market-cap, price, percentage and volume bounds together", () => {
    const value = {
      ...row(104, 107),
      volume: 1000,
      quote: { ...row(104, 107).quote!, volume: 10000 },
    };
    expect(
      filterScannerRows([value], {
        mode: "gap-and-go",
        threshold: 4,
        direction: "up",
        minMarketCap: 500_000_000,
        maxMarketCap: 500_000_000,
        minPrice: 107,
        maxPrice: 107,
        minPriceChange: 7,
        minChangeFromOpen: 2,
        minSessionVolume: 10000,
        maxSessionVolume: 10000,
      }),
    ).toHaveLength(1);
    for (const extra of [
      { minMarketCap: 500_000_001 },
      { maxMarketCap: 499_999_999 },
      { maxSessionVolume: 9999 },
      { minPriceChange: 7.01 },
    ])
      expect(
        filterScannerRows([value], {
          mode: "gap-and-go",
          threshold: 4,
          direction: "up",
          ...extra,
        }),
      ).toHaveLength(0);
  });
  it("uses signed percentage minima and the right volume window", () => {
    const value = {
      ...row(),
      volume: 1000,
      quote: { ...row().quote!, priceChange: -2, volume: 10000 },
    };
    expect(
      filterScannerRows([value], {
        mode: "extended",
        threshold: 4,
        direction: "up",
        minPriceChange: -3,
        minOpeningGap: 4,
        maxSessionVolume: 10000,
      }),
    ).toHaveLength(1);
    expect(
      filterScannerRows([value], {
        mode: "extended",
        threshold: 4,
        direction: "up",
        minPriceChange: -1,
      }),
    ).toHaveLength(0);
    expect(
      filterScannerRows([value], {
        mode: "premarket",
        threshold: 4,
        direction: "up",
        maxVolume: 1000,
      }),
    ).toHaveLength(1);
    expect(
      filterScannerRows([value], {
        mode: "premarket",
        threshold: 4,
        direction: "up",
        maxVolume: 999,
      }),
    ).toHaveLength(0);
  });
  it("excludes unavailable metrics only when their individual filter is set", () => {
    const value = { ...row(), marketCap: null, quote: null };
    expect(filtered(value, "premarket")).toHaveLength(1);
    for (const extra of [
      { maxMarketCap: 1e12 },
      { minOpeningGap: 0 },
      { maxSessionVolume: 10000 },
    ])
      expect(
        filterScannerRows([value], {
          mode: "premarket",
          threshold: 4,
          direction: "up",
          ...extra,
        }),
      ).toHaveLength(0);
  });
});

describe("explicit percentage inputs and market-cap units", () => {
  it("applies from-open minima only when the user supplies them, in every rule", () => {
    for (const mode of ["gap-and-go", "premarket", "extended"] as const) {
      const filters = { mode, threshold: 4, direction: "up" as const };
      const faded = row(104, 103);
      expect(filterScannerRows([faded], filters)).toHaveLength(1);
      expect(
        filterScannerRows([faded], { ...filters, minChangeFromOpen: 0 }),
      ).toHaveLength(0);
      expect(
        filterScannerRows([faded], { ...filters, minChangeFromOpen: -1 }),
      ).toHaveLength(1);
      expect(
        filterScannerRows([row(104, 107)], {
          ...filters,
          minChangeFromOpen: 2,
        }),
      ).toHaveLength(1);
      expect(
        filterScannerRows(
          [{ ...faded, quote: { ...faded.quote!, changeFromOpen: null } }],
          { ...filters, minChangeFromOpen: -5 },
        ),
      ).toHaveLength(0);
    }
  });
  it("uses the Price Chg column value rather than the separate premarket gap", () => {
    const value = row(104, 103);
    expect(
      filterScannerRows([value], {
        mode: "premarket",
        threshold: 4,
        direction: "up",
        minPriceChange: 3.5,
      }),
    ).toHaveLength(0);
  });
  it("converts saved million-dollar limits once and keeps new USD and percentage inputs", () => {
    const old = restoreScannerSettings({
      minMarketCap: "500",
      maxMarketCap: "2000",
      minChangeFromOpen: "5",
      minPriceChange: "8",
    });
    expect(old.minMarketCap).toBe("500000000");
    expect(old.maxMarketCap).toBe("2000000000");
    expect(old.minChangeFromOpen).toBe("");
    expect(old.minPriceChange).toBe("");
    const current = { ...old, minChangeFromOpen: "-1", minPriceChange: "4" };
    expect(restoreScannerSettings(current)).toEqual(current);
  });
});

describe("unified scanner", () => {
  it("has no implicit gap or continuation requirement before the open", () => {
    const value = row(104, 103);
    value.quote = {
      ...value.quote!,
      open: null,
      openingGap: null,
      changeFromOpen: null,
    };
    const filters = {
      mode: "all" as const,
      threshold: 999,
      direction: "down" as const,
    };
    expect(filterScannerRows([value], filters)).toHaveLength(1);
    expect(
      filterScannerRows([value], { ...filters, minPremarketChange: 4 }),
    ).toHaveLength(1);
    expect(
      filterScannerRows([value], { ...filters, minPremarketChange: 5 }),
    ).toHaveLength(0);
    expect(
      filterScannerRows([value], { ...filters, minOpeningGap: 0 }),
    ).toHaveLength(0);
    expect(
      filterScannerRows([value], { ...filters, minChangeFromOpen: 0 }),
    ).toHaveLength(0);
  });
  it("allows flat and negative price movements unless an explicit minimum excludes them", () => {
    const value = row(104, 99);
    const filters = {
      mode: "all" as const,
      threshold: 4,
      direction: "up" as const,
    };
    expect(filterScannerRows([value], filters)).toHaveLength(1);
    expect(
      filterScannerRows([value], { ...filters, minPriceChange: 0 }),
    ).toHaveLength(0);
    expect(
      filterScannerRows([value], { ...filters, minPriceChange: -2 }),
    ).toHaveLength(1);
  });
  it("restores legacy rules as one scanner without restoring their implicit gap threshold", () => {
    for (const mode of ["premarket", "gap-and-go", "extended"] as const) {
      const settings = restoreScannerSettings({
        mode,
        threshold: "4",
        marketCapUnit: "USD",
        minOpeningGap: "7",
      });
      expect(settings.mode).toBe("all");
      expect(settings.minOpeningGap).toBe("");
    }
    const current = { ...defaultScannerSettings, minOpeningGap: "2" };
    expect(restoreScannerSettings(current).minOpeningGap).toBe("2");
  });
});
