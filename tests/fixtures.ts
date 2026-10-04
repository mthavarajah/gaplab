// Controlled mathematical fixtures ONLY. Never imported by production code.
import type { Bar, Session } from "../src/lib/domain/types";
import { marketTime } from "../src/lib/domain/time";
export const previous: Session = {
  date: "2025-03-07",
  open: marketTime("2025-03-07", "09:30"),
  close: marketTime("2025-03-07", "16:00"),
};
export const session: Session = {
  date: "2025-03-10",
  open: marketTime("2025-03-10", "09:30"),
  close: marketTime("2025-03-10", "16:00"),
};
export function bar(
  date: string,
  time: string,
  price: number,
  overrides: Partial<Bar> = {},
): Bar {
  return {
    t: marketTime(date, time),
    o: price,
    h: price,
    l: price,
    c: price,
    v: 10,
    ...overrides,
  };
}
export function sampleBars(): Bar[] {
  return [
    bar(previous.date, "15:59", 100),
    bar(previous.date, "16:15", 101),
    bar(session.date, "06:10", 104.3),
    bar(session.date, "08:45", 102.5),
    bar(session.date, "09:29", 101.5),
    ...Array.from({ length: 390 }, (_, i) => ({
      t: new Date(Date.parse(session.open) + i * 60000).toISOString(),
      o: 102,
      h: 103,
      l: 101,
      c: 102.5,
      v: 10,
    })),
  ];
}
