import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
config({ path: [".env.local", ".env"], quiet: true });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  await sql.unsafe(
    await readFile(
      new URL("../drizzle/0000_cache.sql", import.meta.url),
      "utf8",
    ),
  );
  console.log("Gaplab migration applied.");
} finally {
  await sql.end();
}
