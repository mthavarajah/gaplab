import { expect, it } from "vitest";
import {
  mergeEventBars,
  visibleTriggerEvents,
} from "../src/lib/client/event-charts";
import { bar, session } from "./fixtures";
import type { GapEvent } from "../src/lib/domain/types";
it("combines overlapping sessions without duplicate bars and detects conflicting observations", () => {
  const a = bar(session.date, "07:59", 100),
    b = bar(session.date, "09:30", 103);
  expect(mergeEventBars([{ bars: [b, a] }, { bars: [a] }])).toEqual([a, b]);
  expect(() =>
    mergeEventBars([{ bars: [a] }, { bars: [{ ...a, c: 99 }] }]),
  ).toThrow("Conflicting");
});
it("marks every exact first crossing in chronological order, never nearby bars", () => {
  const event = (time: string, side: "up" | "down") =>
    ({ threshold: 4, firstTrigger: { time, side } }) as Pick<
      GapEvent,
      "threshold" | "firstTrigger"
    >;
  const a = bar(session.date, "07:59", 100),
    b = bar(session.date, "09:30", 103);
  const up = event(a.t, "up"),
    down = event(b.t, "down");
  expect(
    visibleTriggerEvents(
      [down, event(bar(session.date, "08:00", 100).t, "up"), up],
      [a.t, b.t],
    ),
  ).toEqual([up, down]);
});
