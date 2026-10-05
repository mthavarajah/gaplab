import type { ScanRun } from "./workflows";
import type { Direction, ScanMode, SessionRule } from "../domain/types";

export type ScannerSettings = {
  marketCapUnit: "USD";
  scannerLayout?: "unified";
  mode: ScanMode;
  sessionRule: SessionRule;
  threshold: string;
  direction: Direction;
  minPrice: string;
  maxPrice: string;
  volume: string;
  sessionVolume: string;
  maxVolume: string;
  minPremarketVolume: string;
  maxPremarketVolume: string;
  minMarketCap: string;
  maxMarketCap: string;
  minPriceChange: string;
  minPremarketChange: string;
  minOpeningGap: string;
  minChangeFromOpen: string;
  dollar: string;
  researchColumns: boolean;
};
export const defaultScannerSettings: ScannerSettings = {
  marketCapUnit: "USD",
  scannerLayout: "unified",
  mode: "all",
  sessionRule: "overnight",
  threshold: "4",
  direction: "up",
  minPrice: "",
  maxPrice: "",
  volume: "",
  sessionVolume: "",
  maxVolume: "",
  minPremarketVolume: "",
  maxPremarketVolume: "",
  minMarketCap: "",
  maxMarketCap: "",
  minPriceChange: "",
  minPremarketChange: "",
  minOpeningGap: "",
  minChangeFromOpen: "",
  dollar: "",
  researchColumns: false,
};
export type SavedScanner = {
  version: 2;
  run: ScanRun | null;
  runs?: Partial<Record<ScanMode, ScanRun>>;
  settings: ScannerSettings;
  lastSuccessfulRefresh: string | null;
};

export function settingsForRule(
  settings: ScannerSettings,
  mode: ScanMode,
): ScannerSettings {
  return {
    ...settings,
    mode,
  };
}

export function restoreScannerSettings(
  settings: Partial<ScannerSettings>,
): ScannerSettings {
  const restored = { ...defaultScannerSettings, ...settings };
  if (settings.marketCapUnit !== "USD") {
    for (const key of ["minMarketCap", "maxMarketCap"] as const)
      restored[key] = settings[key]
        ? String(Number(settings[key]) * 1_000_000)
        : "";
    // These controls were hidden and ignored in the previous interface.
    restored.minPriceChange = "";
    restored.minChangeFromOpen = "";
  }
  restored.marketCapUnit = "USD";
  if (settings.scannerLayout !== "unified") restored.minOpeningGap = "";
  restored.scannerLayout = "unified";
  restored.mode = "all";
  if (!["premarket", "postmarket", "overnight"].includes(restored.sessionRule))
    restored.sessionRule = "overnight";
  return restored;
}

let connection: Promise<IDBDatabase> | undefined;
export function workspaceDatabase() {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("gaplab-workspace", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("scanner");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      connection = undefined;
      reject(request.error);
    };
    request.onblocked = () => {
      connection = undefined;
      reject(new Error("Local storage is blocked"));
    };
  });
  return connection;
}

export async function loadScanner(): Promise<SavedScanner | null> {
  const db = await workspaceDatabase();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("scanner")
      .objectStore("scanner")
      .get("latest");
    request.onsuccess = () => {
      const saved = request.result as SavedScanner | undefined;
      if (saved?.version !== 2) return resolve(null);
      resolve({ ...saved, settings: restoreScannerSettings(saved.settings) });
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveScanner(value: SavedScanner): Promise<void> {
  const db = await workspaceDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("scanner", "readwrite");
    tx.objectStore("scanner").put(value, "latest");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
