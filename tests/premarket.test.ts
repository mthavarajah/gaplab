import { describe, expect, it } from "vitest";
import {
  calculateSessionQuote,
  calculatePremarketChange,
  calculateAMCChange,
  calculatePremarketVolume,
  createPremarketScannerRow,
  filterScannerRows,
} from "../src/lib/domain/scanner";
import { marketTime } from "../src/lib/domain/time";
import { number } from "../src/lib/format";
import { bar, previous, session } from "./fixtures";
import type { Bar } from "../src/lib/domain/types";
const asset = {
  symbol: "TEST",
  name: "Fixture",
  exchange: "NASDAQ",
  status: "active",
  tradable: true,
  class: "us_equity",
};
const prior = bar(previous.date, "00:00", 100);
const at = (time: string) => marketTime(session.date, time);
const quote = calculateSessionQuote({}, session, previous, at("08:00"));
const row = (bars: Bar[], time = "08:00", reference: Bar | null = prior) =>
  createPremarketScannerRow(
    asset,
    bars,
    reference,
    previous,
    session,
    at(time),
    quote,
  );
describe("premarket scanner", () => {
  it("at 8 AM uses only completed 4–8 AM bars, without needing an opening price", () => {
    const r = row([
      bar(previous.date, "19:59", 150),
      bar(session.date, "03:59", 140),
      bar(session.date, "04:00", 103),
      bar(session.date, "07:59", 104),
      bar(session.date, "08:00", 110),
      bar(session.date, "09:30", 120),
    ])!;
    expect(r.price).toBe(104);
    expect(r.gap).toBeCloseTo(4);
    expect(r.volume).toBe(20);
    expect(r.quote?.open).toBeNull();
    expect(r.latestTime).toBe(at("07:59"));
    expect(
      filterScannerRows([r], {
        mode: "premarket",
        threshold: 3,
        direction: "up",
      }),
    ).toHaveLength(1);
    expect(
      filterScannerRows([r], {
        mode: "premarket",
        threshold: 5,
        direction: "up",
      }),
    ).toHaveLength(0);
  });
  it("filters on latest premarket price, not an earlier peak", () => {
    const r = row([
      bar(session.date, "06:00", 106),
      bar(session.date, "07:59", 101),
    ])!;
    expect(
      filterScannerRows([r], {
        mode: "premarket",
        threshold: 4,
        direction: "up",
      }),
    ).toEqual([]);
  });
  it("freezes premarket at the open and excludes regular prices", () => {
    const bars = [
      bar(session.date, "09:29", 104),
      bar(session.date, "09:30", 120),
      bar(session.date, "11:59", 130),
    ];
    expect(row(bars, "09:30")).toEqual(row(bars, "12:00"));
    expect(row(bars, "12:00")?.price).toBe(104);
  });
  it("leaves missing premarket unavailable instead of using previous-evening prints", () => {
    expect(row([bar(previous.date, "19:59", 104)])).toBeNull();
    expect(row([bar(session.date, "03:59", 104)], "04:00")).toBeNull();
    expect(row([bar(session.date, "04:00", 104)], "04:00")).toBeNull();
  });
  it("requires the actual previous session's adjusted daily close across weekend/DST", () => {
    const bars = [bar(session.date, "07:59", 104)];
    expect(row(bars, "08:00", null)).toBeNull();
    expect(row(bars, "08:00", bar("2025-03-06", "00:00", 100))).toBeNull();
    expect(row(bars)?.previousClose).toBe(100);
    expect(row(bars)?.latestTime).toBe("2025-03-10T11:59:00.000Z");
  });
  it("uses premarket price/volume for filters even if the current quote is different", () => {
    const r = row([bar(session.date, "07:59", 96)])!;
    r.quote = { ...quote, price: 200 };
    expect(
      filterScannerRows([r], {
        mode: "premarket",
        threshold: 4,
        direction: "down",
        maxPrice: 100,
        minVolume: 10,
      }),
    ).toHaveLength(1);
    expect(
      filterScannerRows([r], {
        mode: "premarket",
        threshold: 4,
        direction: "both",
        minPrice: 100,
      }),
    ).toHaveLength(0);
    expect(
      filterScannerRows([r], {
        mode: "premarket",
        threshold: 4,
        direction: "both",
        minVolume: 11,
      }),
    ).toHaveLength(0);
  });
  it("rounds displayed prices only, keeping full precision for thresholds", () => {
    const r = row([bar(session.date, "07:59", 103.999)])!;
    expect(number(r.price)).toBe("104.00");
    expect(
      filterScannerRows([r], {
        mode: "premarket",
        threshold: 4,
        direction: "up",
      }),
    ).toHaveLength(0);
  });
});

describe("premarket change metric across scanner rules", () => {
  it("uses the latest completed premarket close and freezes it after the open", () => {
    const bars = [
      bar(previous.date, "19:59", 150),
      bar(session.date, "03:59", 140),
      bar(session.date, "07:59", 104),
      bar(session.date, "08:00", 105),
      bar(session.date, "09:29", 103),
      bar(session.date, "09:30", 120),
      bar(session.date, "16:01", 130),
    ];
    const early = calculatePremarketChange(
      bars,
      prior,
      previous,
      session,
      at("08:00"),
    );
    expect(early.change).toBeCloseTo(4);
    expect(early.time).toBe(at("07:59"));
    const open = calculatePremarketChange(
      bars,
      prior,
      previous,
      session,
      at("09:30"),
    );
    expect(open.change).toBeCloseTo(3);
    expect(open).toEqual(
      calculatePremarketChange(bars, prior, previous, session, at("17:00")),
    );
    expect(row(bars)?.premarketChange).toBeCloseTo(4);
  });
  it("leaves missing or wrong-date sources unavailable", () => {
    for (const ref of [null, bar("2025-03-06", "00:00", 100)])
      expect(
        calculatePremarketChange(
          [bar(session.date, "07:59", 104)],
          ref,
          previous,
          session,
          at("08:00"),
        ),
      ).toEqual({ change: null, time: at("07:59"), price: 104 });
    expect(
      calculatePremarketChange(
        [bar(previous.date, "19:59", 105)],
        prior,
        previous,
        session,
        at("08:00"),
      ).change,
    ).toBeNull();
  });
  it("applies a signed optional premarket change minimum independently of latest Price Chg", () => {
    const value = row([bar(session.date, "07:59", 104)])!;
    value.quote = { ...quote, priceChange: 10 };
    const filters = {
      threshold: 1,
      direction: "up" as const,
      mode: "premarket" as const,
    };
    expect(
      filterScannerRows([value], { ...filters, minPremarketChange: 4 }),
    ).toHaveLength(1);
    expect(
      filterScannerRows([value], { ...filters, minPremarketChange: 5 }),
    ).toHaveLength(0);
    expect(
      filterScannerRows([{ ...value, premarketChange: null, gap: null }], {
        ...filters,
        mode: "gap-and-go",
        minPremarketChange: 0,
      }),
    ).toHaveLength(0);
  });
});

describe("previous-close to open volume", () => {
  it("includes prior after-hours, freezes at open, excludes unfinished/regular bars and deduplicates", () => {
    const after = bar(previous.date, "16:00", 100);
    const bars = [
      bar(previous.date, "15:59", 100),
      after,
      after,
      bar(previous.date, "19:59", 100),
      bar(session.date, "07:59", 104),
      bar(session.date, "08:00", 104),
      bar(session.date, "09:29", 104),
      bar(session.date, "09:30", 104),
    ];
    expect(calculatePremarketVolume(bars, previous, session, at("08:00"))).toBe(
      30,
    );
    expect(calculatePremarketVolume(bars, previous, session, at("09:30"))).toBe(
      50,
    );
    expect(calculatePremarketVolume(bars, previous, session, at("17:00"))).toBe(
      50,
    );
    expect(
      calculatePremarketVolume([], previous, session, at("08:00")),
    ).toBeNull();
    expect(
      calculatePremarketVolume(
        [{ ...after, v: 0 }],
        previous,
        session,
        at("08:00"),
      ),
    ).toBe(0);
  });
  it("applies inclusive independent min/max volume filters and only excludes unavailable values when active", () => {
    const r = row([bar(session.date, "07:59", 104)])!;
    const filters = {
      mode: "all" as const,
      threshold: 0,
      direction: "up" as const,
    };
    expect(
      filterScannerRows([r], {
        ...filters,
        minPremarketVolume: 10,
        maxPremarketVolume: 10,
      }),
    ).toHaveLength(1);
    expect(
      filterScannerRows([r], { ...filters, minPremarketVolume: 11 }),
    ).toHaveLength(0);
    expect(
      filterScannerRows([r], { ...filters, maxPremarketVolume: 9 }),
    ).toHaveLength(0);
    expect(
      filterScannerRows([{ ...r, premarketVolume: null }], filters),
    ).toHaveLength(1);
    expect(
      filterScannerRows([{ ...r, premarketVolume: null }], {
        ...filters,
        minPremarketVolume: 0,
      }),
    ).toHaveLength(0);
  });
});

describe("AMC window after close and over weekends", () => {
  it("uses Friday close and retains Friday after-hours on Saturday, excluding Friday morning", () => {
    const bars = [
      bar(previous.date, "07:59", 104.99),
      bar(previous.date, "15:59", 100),
      bar(previous.date, "16:00", 100.2),
      bar(previous.date, "19:59", 100.13),
      bar(session.date, "07:59", 102),
    ];
    const saturday = marketTime("2025-03-08", "12:00");
    const change = calculateAMCChange(bars, prior, previous, session, saturday);
    expect(change.change).toBeCloseTo(0.13);
    expect(change.time).toBe(marketTime(previous.date, "19:59"));
    expect(calculatePremarketVolume(bars, previous, session, saturday)).toBe(
      20,
    );
    expect(
      calculateAMCChange(
        bars,
        prior,
        previous,
        session,
        marketTime(previous.date, "17:00"),
      ).change,
    ).toBeCloseTo(0.2);
    expect(
      calculatePremarketVolume(
        bars,
        previous,
        session,
        marketTime(previous.date, "17:00"),
      ),
    ).toBe(10);
    expect(
      calculateAMCChange(bars, prior, previous, session, at("08:00")).change,
    ).toBeCloseTo(2);
    expect(calculatePremarketVolume(bars, previous, session, at("08:00"))).toBe(
      30,
    );
  });
  it("does not invent a change without an eligible price or matching reference", () => {
    expect(
      calculateAMCChange([], prior, previous, session, at("08:00")).change,
    ).toBeNull();
    expect(
      calculateAMCChange(
        [bar(previous.date, "19:59", 101)],
        null,
        previous,
        session,
        at("08:00"),
      ).change,
    ).toBeNull();
  });
});
