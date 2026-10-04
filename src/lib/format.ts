import { DateTime } from "luxon";
export const number = (v: number | null | undefined, digits = 2) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      }).format(v);
export const percent = (v: number | null | undefined) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${number(v)}%`;
export const compact = (v: number | null | undefined) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 2,
      }).format(v);
export const timestamp = (v: string | null | undefined) =>
  v
    ? DateTime.fromISO(v)
        .setZone("America/New_York")
        .toFormat("MMM dd HH:mm ZZZZ")
    : "—";
export const yesNo = (v: boolean | null) =>
  v === null ? "—" : v ? "Yes" : "No";
