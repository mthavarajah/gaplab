import { Suspense } from "react";
import { Backtester } from "@/components/backtester";
export default function Page() {
  return (
    <Suspense fallback={<p>Loading backtester…</p>}>
      <Backtester />
    </Suspense>
  );
}
