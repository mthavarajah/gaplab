"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ScannerStateProvider } from "./scanner-state";
import { BacktestStateProvider } from "./backtest-state";
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnWindowFocus: false,
            staleTime: 30000,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ScannerStateProvider>
        <BacktestStateProvider>{children}</BacktestStateProvider>
      </ScannerStateProvider>
    </QueryClientProvider>
  );
}
