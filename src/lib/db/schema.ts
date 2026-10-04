import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
export const researchCache = pgTable("gaplab_cache", {
  key: text("key").primaryKey(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
