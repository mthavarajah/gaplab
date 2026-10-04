"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="notice error" role="alert">
      <h2>Workspace could not render</h2>
      <p>Try again. Market data has not been replaced.</p>
      <button onClick={reset}>Retry</button>
    </div>
  );
}
