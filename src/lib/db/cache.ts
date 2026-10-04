import "server-only";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { repository, type CacheStore } from "./repository";
type Database = ReturnType<typeof drizzle>;
let database: Database | undefined;
const memory = new Map<
  string,
  { value: unknown; expires: number; warnings: string[] }
>();
export function cacheKey(kind: string, inputs: unknown): string {
  return `${kind}:v3:${createHash("sha256").update(JSON.stringify(inputs)).digest("hex")}`;
}
function db() {
  if (!database && process.env.DATABASE_URL)
    database = drizzle(
      postgres(process.env.DATABASE_URL, {
        max: 1,
        prepare: false,
        connect_timeout: 5,
        idle_timeout: 20,
      }),
    );
  return database;
}
export type Cached<T> = { value: T; warnings: string[]; cached: boolean };
export async function cached<T>(
  key: string,
  kind: string,
  ttlMs: number,
  load: () => Promise<T>,
  storage?: CacheStore | null,
): Promise<Cached<T>> {
  const warnings: string[] = [];
  const connection =
    storage === undefined ? (db() ? repository(db()!) : null) : storage;
  if (!connection)
    warnings.push(
      "Persistence unavailable: DATABASE_URL is not configured. Results are cached only in this server process.",
    );
  const hit = storage === undefined ? memory.get(key) : undefined;
  if (hit && hit.expires > Date.now())
    return {
      value: hit.value as T,
      warnings: [...new Set([...warnings, ...hit.warnings])],
      cached: true,
    };
  if (connection)
    try {
      const payload = await connection.get(key);
      if (payload !== undefined)
        return { value: payload as T, warnings, cached: true };
    } catch {
      warnings.push(
        "Database read failed; retrieving data from Alpaca. Check the connection and migrations.",
      );
    }
  const value = await load();
  if (connection)
    try {
      await connection.put(key, kind, value, new Date(Date.now() + ttlMs));
    } catch {
      warnings.push("Database write failed; results have NOT been persisted.");
    }
  if (storage === undefined) {
    if (memory.size >= 100) memory.delete(memory.keys().next().value!);
    memory.set(key, { value, expires: Date.now() + ttlMs, warnings });
  }
  return { value, warnings, cached: false };
}
