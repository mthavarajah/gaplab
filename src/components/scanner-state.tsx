"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { request, runScan, type ScanRun } from "@/lib/client/workflows";
import {
  loadSavedPremarket,
  withPremarketMetrics,
} from "@/lib/client/premarket";
import type { ScanMode } from "@/lib/domain/types";
import {
  withMarketCaps,
  type MarketCapSnapshot,
} from "@/lib/domain/market-caps";
import {
  defaultScannerSettings,
  settingsForRule,
  loadScanner,
  saveScanner,
  type ScannerSettings,
} from "@/lib/client/scan-storage";

function useScannerState() {
  const [runs, setRuns] = useState<Partial<Record<ScanMode, ScanRun>>>({});
  const [settings, setSettings] = useState(defaultScannerSettings);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [premarketError, setPremarketError] = useState<string | null>(null);
  const [premarketLoading, setPremarketLoading] = useState(false);
  const [premarketRetry, setPremarketRetry] = useState(0);
  const [marketCapError, setMarketCapError] = useState<string | null>(null);
  const [lastSuccessfulRefresh, setLastSuccessfulRefresh] = useState<
    string | null
  >(null);
  const controller = useRef<AbortController | null>(null);
  const job = useRef(0);
  const premarketAttempts = useRef(new Set<string>());
  const run = runs[settings.mode] ?? null;
  const latestRun = useRef(run);
  useEffect(() => {
    latestRun.current = run;
  }, [run]);

  useEffect(() => {
    let mounted = true;
    void loadScanner()
      .then((saved) => {
        if (!mounted) return;
        if (!saved) {
          setSettings(defaultScannerSettings);
          return;
        }
        const restored = { ...saved.runs };
        if (saved.run) restored[saved.run.mode ?? "extended"] ??= saved.run;
        // Preserve the most recently viewed output without a new market request.
        if (!restored.all) {
          const legacy = saved.run ?? restored[saved.settings.mode];
          if (legacy) restored.all = { ...legacy, mode: "all" };
        }
        setRuns(restored);
        setSettings({ ...defaultScannerSettings, ...saved.settings });
        setLastSuccessfulRefresh(saved.lastSuccessfulRefresh);
        // Upgrade saved caps without restarting any of the saved price scans.
        if (
          Object.values(restored).some((value) =>
            value?.rows.some((row) => !row.marketCapInfo),
          )
        ) {
          void request<MarketCapSnapshot>("/api/market-caps")
            .then((caps) => {
              if (!mounted) return;
              setRuns((current) => {
                const updated = { ...current };
                for (const mode of Object.keys(restored) as ScanMode[]) {
                  const value = restored[mode];
                  const active = current[mode];
                  if (value && active && active.context === value.context)
                    updated[mode] = {
                      ...active,
                      rows: withMarketCaps(active.rows, caps),
                    };
                }
                return updated;
              });
            })
            .catch((err) => {
              if (mounted && !controller.current)
                setMarketCapError(
                  err instanceof Error
                    ? err.message
                    : "Market caps could not be loaded.",
                );
            });
        }
      })
      .catch(() => {
        if (mounted)
          setStorageError(
            "Browser storage is unavailable. Results survive tab navigation, but cannot be restored after a page reload.",
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

  const premarketSymbols =
    run?.rows
      .filter(
        (row) =>
          row.amcVersion !== 1 ||
          row.premarketPrice == null ||
          row.premarketVolume == null ||
          row.premarketChange == null,
      )
      .map((row) => row.symbol) ?? [];
  const premarketKey =
    ready && !busy && run && premarketSymbols.length
      ? JSON.stringify({
          mode: settings.mode,
          asOf: run.context.asOf,
          symbols: run.rows.map((row) => row.symbol),
        })
      : "";
  useEffect(() => {
    if (!premarketKey) return;
    const attempt = `${premarketRetry}:${premarketKey}`;
    const attempts = premarketAttempts.current;
    if (attempts.has(attempt)) return;
    attempts.add(attempt);
    let finished = false;
    const input = JSON.parse(premarketKey) as {
      mode: ScanMode;
      asOf: string;
      symbols: string[];
    };
    const c = new AbortController();
    const symbols =
      latestRun.current?.rows
        .filter(
          (row) =>
            row.amcVersion !== 1 ||
            row.premarketPrice == null ||
            row.premarketVolume == null ||
            row.premarketChange == null,
        )
        .map((row) => row.symbol) ?? [];
    const applyBatch = (data: Parameters<typeof withPremarketMetrics>[1]) => {
      if (c.signal.aborted) return;
      setRuns((current) => {
        const value = current[input.mode];
        if (!value || value.context.asOf !== input.asOf) return current;
        return {
          ...current,
          [input.mode]: {
            ...value,
            rows: withPremarketMetrics(value.rows, data),
            warnings: [...new Set([...value.warnings, ...data.warnings])],
          },
        };
      });
    };
    void Promise.resolve()
      .then(() => {
        c.signal.throwIfAborted();
        setPremarketLoading(true);
        setPremarketError(null);
        return loadSavedPremarket(symbols, input.asOf, c.signal, applyBatch);
      })
      .then((data) => {
        if (!c.signal.aborted && data.failures.length)
          setPremarketError(data.failures.join(" · "));
      })
      .catch((err) => {
        if (!c.signal.aborted)
          setPremarketError(
            err instanceof Error ? err.message : "Premarket data unavailable.",
          );
      })
      .finally(() => {
        finished = true;
        if (!c.signal.aborted) setPremarketLoading(false);
      });
    return () => {
      c.abort();
      if (!finished) attempts.delete(attempt);
    };
  }, [premarketKey, premarketRetry]);

  useEffect(() => {
    if (!ready) return;
    void saveScanner({
      version: 2,
      run,
      runs,
      settings,
      lastSuccessfulRefresh,
    }).catch(() => {
      setStorageError(
        "Could not save this scan in the browser. Keep this page open to retain the current results.",
      );
    });
  }, [ready, run, runs, settings, lastSuccessfulRefresh]);

  async function scanMode(mode: ScanMode) {
    if (!ready) return;
    const id = ++job.current;
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setError(null);
    setMarketCapError(null);
    setPremarketError(null);
    try {
      await runScan(
        c.signal,
        (value) => {
          if (id === job.current)
            setRuns((current) => ({ ...current, [mode]: value }));
        },
        mode,
      );
      if (id === job.current)
        setLastSuccessfulRefresh(new Date().toISOString());
    } catch (err) {
      c.abort();
      if (id === job.current)
        setError(
          err instanceof Error && err.name === "AbortError"
            ? "Scan stopped. Displayed results are partial."
            : err instanceof Error
              ? err.message
              : "Scan failed.",
        );
    } finally {
      if (id === job.current) {
        setBusy(false);
        controller.current = null;
      }
    }
  }
  function setRule(mode: ScanMode) {
    if (!ready || mode === settings.mode) return;
    const hadScan = Boolean(run) || busy;
    controller.current?.abort();
    controller.current = null;
    job.current++;
    setBusy(false);
    setError(null);
    setSettings((current) => settingsForRule(current, mode));
    // A deliberate rule switch loads only an uncached rule. Navigation and
    // reload restore saved outputs and never start a price scan.
    if (!runs[mode] && hadScan) void scanMode(mode);
  }
  function scan() {
    if (!busy) void scanMode(settings.mode);
  }
  function setSetting<K extends keyof ScannerSettings>(
    key: K,
    value: ScannerSettings[K],
  ) {
    setSettings((current) => ({ ...current, [key]: value }));
  }
  return {
    run,
    settings,
    setSetting,
    setRule,
    ready,
    busy,
    error,
    storageError,
    marketCapError,
    premarketError,
    premarketLoading: Boolean(premarketKey) && premarketLoading,
    retryPremarket: () => setPremarketRetry((value) => value + 1),
    lastSuccessfulRefresh,
    scan,
    stop: () => controller.current?.abort(),
  };
}
const ScannerContext = createContext<ReturnType<typeof useScannerState> | null>(
  null,
);
export function ScannerStateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const state = useScannerState();
  return (
    <ScannerContext.Provider value={state}>{children}</ScannerContext.Provider>
  );
}
export function useScanner() {
  const value = useContext(ScannerContext);
  if (!value) throw new Error("ScannerStateProvider is required");
  return value;
}
