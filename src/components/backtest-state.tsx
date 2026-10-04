"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";
import type { BacktestResult, Direction } from "@/lib/domain/types";
import { runBacktest } from "@/lib/client/workflows";
import { workspaceDatabase } from "@/lib/client/scan-storage";
import type { backtestSchema } from "@/lib/domain/validation";
import type { z } from "zod";

type Settings = {
  rule: "opening" | "extended";
  symbol: string;
  threshold: string;
  direction: Direction;
  start: string;
  end: string;
  researchColumns: boolean;
  chartMode: "candles" | "line" | "returns";
};
type Saved = {
  version: 2;
  settings: Settings;
  result: BacktestResult | null;
  finished: boolean;
};

function useBacktestState() {
  const [settings, setSettings] = useState<Settings>(() => {
    const now = DateTime.now().setZone("America/New_York");
    return {
      rule: "opening",
      symbol: "",
      threshold: "4",
      direction: "up",
      start: now.minus({ months: 3 }).toISODate()!,
      end: now.minus({ days: 1 }).toISODate()!,
      researchColumns: false,
      chartMode: "candles",
    };
  });
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let mounted = true;
    void workspaceDatabase()
      .then(
        (db) =>
          new Promise<Saved | undefined>((resolve, reject) => {
            const request = db
              .transaction("scanner")
              .objectStore("scanner")
              .get("backtest");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          }),
      )
      .then((saved) => {
        if (mounted && saved?.version === 2) {
          setSettings({
            ...saved.settings,
            rule: saved.settings.rule ?? "opening",
          });
          setResult(saved.result);
          setFinished(saved.finished);
        }
      })
      .catch(() => {
        if (mounted)
          setStorageError(
            "Browser storage is unavailable. Backtest results survive tab navigation but cannot be restored after reload.",
          );
      })
      .finally(() => {
        if (mounted) setReady(true);
      });
    return () => {
      mounted = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    void workspaceDatabase()
      .then(
        (db) =>
          new Promise<void>((resolve, reject) => {
            const tx = db.transaction("scanner", "readwrite");
            tx.objectStore("scanner").put(
              { version: 2, settings, result, finished } satisfies Saved,
              "backtest",
            );
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          }),
      )
      .catch(() =>
        setStorageError(
          "Could not save this backtest locally. Keep the page open to retain results.",
        ),
      );
  }, [ready, settings, result, finished]);

  function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }
  async function execute(input: z.infer<typeof backtestSchema>) {
    if (!ready || busy) return;
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setError(null);
    setResult(null);
    setFinished(false);
    try {
      await runBacktest(input, c.signal, (done, total, value) => {
        setProgress({ done, total });
        setResult(value);
      });
      setFinished(true);
    } catch (err) {
      c.abort();
      setError(
        err instanceof Error && err.name === "AbortError"
          ? "Backtest stopped. Results are partial."
          : err instanceof Error
            ? err.message
            : "Backtest failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return {
    settings,
    setSetting,
    result,
    busy,
    finished,
    error,
    setError,
    storageError,
    ready,
    progress,
    execute,
    stop: () => controller.current?.abort(),
  };
}
const BacktestContext = createContext<ReturnType<
  typeof useBacktestState
> | null>(null);
export function BacktestStateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const value = useBacktestState();
  return (
    <BacktestContext.Provider value={value}>
      {children}
    </BacktestContext.Provider>
  );
}
export function useBacktest() {
  const value = useContext(BacktestContext);
  if (!value) throw new Error("BacktestStateProvider is required");
  return value;
}
