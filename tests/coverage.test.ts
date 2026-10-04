import { describe, expect, it } from "vitest";
import { scannerUnavailableReason } from "../src/lib/domain/scanner";
import { bar, previous, session, sampleBars } from "./fixtures";

describe("scanner coverage diagnostics", () => {
  const asOf = session.open;
  it("distinguishes no data, missing close and missing extended-hours observations", () => {
    expect(scannerUnavailableReason([], previous, session, asOf)).toBe(
      "No price bars returned for this period",
    );
    expect(
      scannerUnavailableReason(
        [bar(previous.date, "15:59", 100)],
        previous,
        session,
        asOf,
      ),
    ).toBe("No extended-hours bars returned for this period");
    expect(
      scannerUnavailableReason(
        [bar(session.date, "08:00", 105)],
        previous,
        session,
        asOf,
      ),
    ).toBe("No price in the previous session’s closing minute");
    expect(
      scannerUnavailableReason(
        [bar(previous.date, "12:00", 100)],
        previous,
        session,
        asOf,
      ),
    ).toBe("No closing-minute price or extended-hours bars");
    expect(
      scannerUnavailableReason(sampleBars(), previous, session, asOf),
    ).toBeNull();
  });
  it("does not treat regular-session or future bars as extended-hours evidence", () => {
    expect(
      scannerUnavailableReason(
        [
          bar(previous.date, "15:59", 100),
          bar(session.date, "09:30", 105),
          bar(session.date, "08:30", 105),
        ],
        previous,
        session,
        bar(session.date, "08:00", 100).t,
      ),
    ).toBe("No extended-hours bars returned for this period");
  });
});
