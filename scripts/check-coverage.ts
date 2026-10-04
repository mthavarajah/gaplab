import { config } from "dotenv";
import { AlpacaClient } from "../src/lib/provider/alpaca";
import { getContext } from "../src/lib/server/services";
import { extendedBars } from "../src/lib/domain/time";
config({ path: [".env.local", ".env"], quiet: true });
const base = new AlpacaClient();
for (const feed of ["iex", "sip"] as const) {
  const client = new AlpacaClient({
    ...base.config,
    feed,
    delayMinutes: feed === "sip" ? 16 : 0,
  });
  try {
    const context = await getContext(client);
    const data = await client.bars(
      ["AAPL", "A", "AA", "NVDA", "TSLA"],
      context.previous.open,
      context.asOf,
    );
    const rows = Object.entries(data).map(([symbol, bars]) => ({
      symbol,
      totalBars: bars.length,
      closingMinute: bars.some(
        (b) => Date.parse(b.t) === Date.parse(context.previous.close) - 60000,
      ),
      extendedBars: extendedBars(
        bars,
        context.previous,
        context.session,
        context.asOf,
      ).length,
      lastBar: bars.at(-1)?.t,
    }));
    console.log(JSON.stringify({ feed, rows }));
    try {
      const snap = await client.snapshots(["AAPL", "NVDA", "TSLA"]);
      console.log(JSON.stringify({ feed, snapshotSymbols: Object.keys(snap) }));
    } catch (err) {
      console.log(
        JSON.stringify({
          feed,
          snapshotError: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  } catch (err) {
    console.log(
      JSON.stringify({
        feed,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
const current = new AlpacaClient();
const context = await getContext(current);
const symbols = ["RETO", "AMOD"];
const snapshots = await current.snapshots(symbols);
const daily = await current.bars(
  symbols,
  context.quotePrevious.date,
  context.asOf,
  "1Day",
);
for (const symbol of symbols)
  console.log(
    JSON.stringify({
      symbol,
      snapshot: snapshots[symbol],
      daily: daily[symbol],
    }),
  );
