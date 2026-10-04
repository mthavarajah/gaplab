import { DateTime } from "luxon";
import type { Bar, Session } from "./types";
export const MARKET_ZONE = "America/New_York";
export const MINUTE = 60_000;
export function marketTime(date: string, time: string): string {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: MARKET_ZONE });
  if (!dt.isValid) throw new Error("Invalid market date/time");
  return dt.toUTC().toISO()!;
}
export function marketDate(iso: string): string {
  return DateTime.fromISO(iso, { zone: "utc" })
    .setZone(MARKET_ZONE)
    .toISODate()!;
}
export function shiftDate(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: MARKET_ZONE })
    .plus({ days })
    .toISODate()!;
}
export function regularBars(bars: Bar[], session: Session): Bar[] {
  return bars.filter((b) => b.t >= session.open && b.t < session.close);
}
export function extendedBars(
  bars: Bar[],
  previous: Session,
  session: Session,
  asOf = session.open,
): Bar[] {
  // Conventional SIP/IEX extended sessions only; BOATS midnight trading is not included.
  const afterEnd = marketTime(previous.date, "20:00"),
    preStart = marketTime(session.date, "04:00");
  return bars.filter(
    (b) =>
      Date.parse(b.t) + MINUTE <= Date.parse(asOf) &&
      ((b.t >= previous.close && b.t < afterEnd) ||
        (b.t >= preStart && b.t < session.open)),
  );
}
export function scannerSessions(
  calendar: Session[],
  asOf: string,
): { previous: Session; session: Session } {
  const ordered = [...calendar].sort((a, b) => a.date.localeCompare(b.date));
  const index = ordered.findIndex((s) => asOf < s.close);
  if (index < 1)
    throw new Error("Market calendar does not bracket this timestamp");
  return { previous: ordered[index - 1], session: ordered[index] };
}
export function normalizeBars(bars: Bar[]): Bar[] {
  const unique = new Map<string, Bar>();
  for (const b of bars) {
    const t = new Date(b.t).toISOString();
    const value = { ...b, t };
    const existing = unique.get(t);
    if (existing && JSON.stringify(existing) !== JSON.stringify(value))
      throw new Error(`Conflicting bars at ${t}`);
    unique.set(t, value);
  }
  return [...unique.values()].sort((a, b) => a.t.localeCompare(b.t));
}
export function chunksOfDates(
  start: string,
  end: string,
): { start: string; end: string }[] {
  const result = [];
  for (let d = start; d <= end; d = shiftDate(d, 7))
    result.push({ start: d, end: [shiftDate(d, 6), end].sort()[0] });
  return result;
}
