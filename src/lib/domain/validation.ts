import { z } from "zod";
import { SCAN_BATCH_SIZE } from "./limits";
export const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9.\-]{0,14}$/, "Enter a valid US equity ticker.");
export const directionSchema = z.enum(["up", "down", "both"]);
const instantSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
export const backtestSchema = z
  .object({
    symbol: symbolSchema,
    rule: z.enum(["opening", "extended"]).optional(),
    threshold: z.number().finite().positive().max(1000),
    direction: directionSchema,
    start: z.iso.date(),
    end: z.iso.date(),
    asOf: instantSchema.optional(),
  })
  .refine((v) => v.start <= v.end, {
    message: "Start date must be on or before end date.",
  })
  .refine((v) => v.direction === "up" || v.threshold < 100, {
    message: "Down/both threshold must be below 100%.",
  })
  .refine(
    (v) => (Date.parse(v.end) - Date.parse(v.start)) / 86400000 <= 11000,
    {
      message: "Range cannot exceed thirty years.",
    },
  );
export const batchSchema = z.object({
  mode: z.enum(["premarket", "gap-and-go", "extended", "all"]).optional(),
  symbols: z.array(symbolSchema).min(1).max(SCAN_BATCH_SIZE),
  asOf: instantSchema,
});
export const eventChartSchema = z.object({
  symbol: symbolSchema,
  date: z.iso.date(),
  asOf: instantSchema,
});
