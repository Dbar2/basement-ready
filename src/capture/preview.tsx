// Standalone harness for the capture flow: open /src/capture/preview.html with `pnpm dev:web`.
// Shows what onComplete received and plays the file back, so a test can confirm it is playable.
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Capture, type CaptureMeta } from "./index";

type Result = { kind: "done"; file: File; meta: CaptureMeta } | { kind: "cancelled" };

declare global {
  interface Window {
    __capture?: { name: string; type: string; size: number; meta: CaptureMeta; url: string; file: File } | { cancelled: true };
  }
}

function Harness() {
  const [result, setResult] = useState<Result | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (result?.kind !== "done") return;
    const u = URL.createObjectURL(result.file);
    setUrl(u);
    window.__capture = { name: result.file.name, type: result.file.type, size: result.file.size, meta: result.meta, url: u, file: result.file };
    return () => URL.revokeObjectURL(u);
  }, [result]);

  if (!result) {
    return (
      <Capture
        onComplete={(file, meta) => setResult({ kind: "done", file, meta })}
        onCancel={() => {
          window.__capture = { cancelled: true };
          setResult({ kind: "cancelled" });
        }}
      />
    );
  }

  return (
    <main style={{ padding: "var(--space-4) var(--space-3)", maxWidth: 720, margin: "0 auto", fontFamily: "var(--font-body)", color: "var(--color-ink)" }}>
      <p style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--color-ink-muted)" }}>Preview harness</p>
      {result.kind === "cancelled" ? (
        <h1 data-testid="cancelled">onCancel() called</h1>
      ) : (
        <>
          <h1 style={{ margin: "8px 0 16px" }}>onComplete() received</h1>
          <pre data-testid="result" style={{ fontFamily: "var(--font-mono)", fontSize: 13, background: "var(--color-surface)", padding: 16, borderRadius: 6, whiteSpace: "pre-wrap" }}>
            {JSON.stringify({ name: result.file.name, type: result.file.type, size: result.file.size, meta: result.meta }, null, 2)}
          </pre>
          {url && <video data-testid="playback" src={url} controls playsInline style={{ width: "100%", maxHeight: "60vh", background: "var(--color-ink)", borderRadius: 6 }} />}
        </>
      )}
      <p>
        <button
          onClick={() => {
            window.__capture = undefined;
            setResult(null);
          }}
          style={{ minHeight: 44, marginTop: 16, padding: "0 18px", font: "inherit", fontWeight: 700, background: "var(--color-mint)", color: "var(--color-mint-ink)", border: 0, borderRadius: 6 }}
        >
          Open capture again
        </button>
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
