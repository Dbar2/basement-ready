// Client for the scan API, plus the frozen sample that replays the same events.

export type Household = "relative" | "renter" | "unsure";

export type Detection = {
  id: string;
  kind: string;
  label: string;
  frame: number;
  seconds: number;
  box: { x: number; y: number; w: number; h: number };
  framesSeen: number;
  track: [number, number, number, number, number][];
};

export type ScanEvent = {
  at: number;
  type: "log" | "find" | "stage" | "done" | "error";
  text: string;
  data?: { kind?: string; label?: string; detections?: Detection[]; frameCount?: number };
};

export type Source = { title: string; url: string; section?: string; retrieved?: string };

export type Finding = {
  ruleId: string;
  title: string;
  plain: string;
  category: string;
  status: "likely_ok" | "likely_fix" | "needs_measurement" | "needs_answer";
  why: string | null;
  question: string | null;
  evidence: string[];
  source: Source;
};

export type FixGroup = {
  category: string;
  title: string;
  description: string;
  ruleIds: string[];
  evidence: string[];
  why: string[];
  costLow: number | null;
  costHigh: number | null;
  sources: Source[];
};

export type Grant = {
  id: string;
  name: string;
  level: string;
  status: string;
  amount: string;
  fit: "fits" | "depends" | "no" | "cancelled";
  fitNote: string | null;
  nextStep: string | null;
  source: Source;
};

export type ScanResult = {
  id: string;
  household: Household;
  city?: string;
  coverage?: "full" | "provincial";
  verdict: "yes" | "fix" | "no";
  headline: string;
  route: "second_unit" | "basement_finish";
  wants: string;
  summary: string;
  transcript: string;
  detections: Detection[];
  findings: Finding[];
  fixGroups: FixGroup[];
  heldBack: number;
  cost: { low: number; high: number; pricedFixes: number; unpricedFixes: number };
  grants: Grant[];
  process: { step: number; title: string; detail: string; source?: Source }[];
  pros: { registry: { name: string; url: string; suggestedSearch?: Record<string, unknown> } };
  compiledAt: string;
};

// Videos picked in this tab, so the scan screen can play them before the server has its copy.
export const localVideos = new Map<string, File>();

// Anonymous basements this browser created. Claimed into an account after sign-up.
export function rememberClaim(basementId: string, claimToken: string) {
  try {
    const all = JSON.parse(localStorage.getItem("br-claims") ?? "[]") as { basementId: string; claimToken: string }[];
    all.push({ basementId, claimToken });
    localStorage.setItem("br-claims", JSON.stringify(all.slice(-20)));
  } catch {
    // Private mode: the scan still works, it just can't be claimed later from this browser.
  }
}

export function startScan(
  video: File,
  input: { household: Household; address: string; municipality: string },
  onProgress: (fraction: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("video", video);
    form.append("household", input.household);
    form.append("address", input.address);
    form.append("municipality", input.municipality);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/scans");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const body = (() => {
        try {
          return JSON.parse(xhr.responseText);
        } catch {
          return {};
        }
      })();
      if (xhr.status >= 200 && xhr.status < 300) {
        localVideos.set(body.id, video);
        rememberClaim(body.basementId, body.claimToken);
        resolve(body.id);
      } else reject(new Error(body.error ?? "Upload failed. Check your connection and try again."));
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.send(form);
  });
}

export function subscribe(id: string, onEvent: (e: ScanEvent) => void): () => void {
  const source = new EventSource(`/api/scans/${id}/events`);
  source.onmessage = (m) => {
    const e = JSON.parse(m.data) as ScanEvent;
    onEvent(e);
    if (e.type === "done" || e.type === "error") source.close();
  };
  return () => source.close();
}

export async function getScan(id: string): Promise<{ status: "queued" | "running" | "done" | "error"; result: ScanResult | null }> {
  if (id === "sample") return { status: "done", result: await (await fetch("/samples/sample/result.json")).json() };
  const res = await fetch(`/api/scans/${id}`);
  if (!res.ok) throw new Error("not found");
  return res.json();
}


// Replays the recorded sample scan with its real timing, but never waits more than 2.5 s between steps.
export function replaySample(onEvent: (e: ScanEvent) => void): () => void {
  let cancelled = false;
  const timers: number[] = [];
  fetch("/samples/sample/events.json")
    .then((r) => r.json())
    .then((events: ScanEvent[]) => {
      let t = 0;
      let prev = 0;
      for (const e of events) {
        t += Math.min(2.5, Math.max(0.35, e.at - prev));
        prev = e.at;
        timers.push(window.setTimeout(() => !cancelled && onEvent({ ...e, at: t }), t * 1000));
      }
    });
  return () => {
    cancelled = true;
    timers.forEach(clearTimeout);
  };
}

export const frameUrl = (scanId: string, frame: number) =>
  scanId === "sample"
    ? `/samples/sample/frames/${String(frame).padStart(4, "0")}.jpg`
    : `/api/scans/${scanId}/frames/${frame}`;

export const ANALYSIS_FPS = 5;
