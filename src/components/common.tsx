import type { Provenance } from "@/lib/domain/types";
import { timestamp } from "@/lib/format";
export function Percent({ value }: { value: number | null | undefined }) {
  return (
    <span
      className={
        value == null
          ? "muted"
          : value > 0
            ? "positive"
            : value < 0
              ? "negative"
              : ""
      }
    >
      {value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`}
    </span>
  );
}
export function Notice({
  title,
  children,
  error = false,
}: {
  title: string;
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`notice ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      <strong>{title}</strong>
      <div>{children}</div>
    </div>
  );
}
export function visibleDataWarning(warning: string) {
  return !warning.startsWith(
    "Persistence unavailable: DATABASE_URL is not configured.",
  );
}

export function ProvenanceNote({
  value,
  warnings = [],
}: {
  value: Provenance;
  warnings?: string[];
}) {
  return (
    <details className="provenance">
      <summary>Data details</summary>
      <p>
        Data through {timestamp(value.asOf)}. Missing prices are left blank.
      </p>
      <a href="/methodology">How calculations work</a>
      {warnings.filter(visibleDataWarning).map((w) => (
        <p key={w}>{w}</p>
      ))}
    </details>
  );
}
export function Progress({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label: string;
}) {
  return (
    <div className="progress-block" role="status">
      <div>
        <span>{label}</span>
        <span>
          {done.toLocaleString()} / {total.toLocaleString()}
        </span>
      </div>
      <progress value={done} max={total || 1} />
    </div>
  );
}
