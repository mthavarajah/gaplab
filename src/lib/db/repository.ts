import { and, eq, gt } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { researchCache } from "./schema";
export type CacheStore = {
  get: (key: string) => Promise<unknown | undefined>;
  put: (
    key: string,
    kind: string,
    payload: unknown,
    expires: Date,
  ) => Promise<void>;
};
export function repository(
  db: Pick<PgDatabase<PgQueryResultHKT>, "select" | "insert">,
): CacheStore {
  return {
    async get(key) {
      const [row] = await db
        .select()
        .from(researchCache)
        .where(
          and(
            eq(researchCache.key, key),
            gt(researchCache.expiresAt, new Date()),
          ),
        )
        .limit(1);
      return row?.payload;
    },
    async put(key, kind, payload, expires) {
      await db
        .insert(researchCache)
        .values({ key, kind, payload, expiresAt: expires })
        .onConflictDoUpdate({
          target: researchCache.key,
          set: { payload, createdAt: new Date(), expiresAt: expires },
        });
    },
  };
}
