"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { request } from "@/lib/client/workflows";
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const status = useQuery({
    queryKey: ["status"],
    queryFn: () =>
      request<{
        configured: boolean;
        feed: string;
        persistence: string;
        delayMinutes: number;
      }>("/api/status"),
  });
  return (
    <div className="terminal">
      <header className="topbar">
        <div className="header-navigation">
          <Link href="/" className="brand">
            <span className="brand-mark">G/</span> GAPLAB
          </Link>
          <nav className="header-tabs" aria-label="Workspace tabs">
            <Link
              className={path === "/" ? "nav active" : "nav"}
              aria-current={path === "/" ? "page" : undefined}
              href="/"
            >
              Gap Scanner
            </Link>
            <Link
              className={path === "/backtest" ? "nav active" : "nav"}
              aria-current={path === "/backtest" ? "page" : undefined}
              href="/backtest"
            >
              Backtester
            </Link>
          </nav>
        </div>
        <div className="system-state">
          <span className={`led ${status.data?.configured ? "ready" : ""}`} />
          <span>
            {status.data?.configured
              ? "DATA CONNECTED"
              : "DATA CONNECTION REQUIRED"}
          </span>
        </div>
      </header>
      <div className="workspace">
        <main>{children}</main>
      </div>
      <footer className="workspace-footer">
        <span>All times Eastern</span>
        <Link href="/methodology">Calculation methodology ↗</Link>
      </footer>
    </div>
  );
}
