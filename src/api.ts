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
  type: "log" | "find" | "measure" | "stage" | "done" | "error";
  text: string;
  data?: { kind?: string; label?: string; detections?: Detection[]; frameCount?: number };
};

export type Source = { title: string; url: string; section?: string; retrieved?: string };

export type Measured = { value: number; unit: string; marginM: number; limit: number; source: "model" | "user_measurement" | "door" };

export type Measurements = {
  ceilingHeightM: number | null;
  widthM: number | null;
  depthM: number | null;
  scaleSource: "model" | "user_measurement" | "door";
  confidence: string;
  expectedErrorPct: number;
  trusted?: boolean;
  warnings: string[];
  clearances: { detectionId: string; label: string; clearanceM: number }[];
};

export type PlanSide = "minX" | "maxX" | "minZ" | "maxZ";

export type Plan = {
  version: 1;
  box: { minX: number; maxX: number; minZ: number; maxZ: number };
  sides: Record<PlanSide, "wall" | "extent">;
  widthM: number;
  depthM: number;
  areaM2: number;
  ceilingHeightM: number | null;
  openings: { kind: "window" | "door"; side: PlanSide; atM: number; widthM: number; detectionId: string }[];
  stairs: { x0: number; z0: number; x1: number; z1: number; detectionId: string }[];
  fixtures: { kind: "furnace" | "panel"; x: number; z: number; detectionId: string }[];
  scaleSource: "model" | "user_measurement" | "door";
  trusted: boolean;
};

// Filmed room by room, each room gets its own 3D scan and plan. Older scans have none.
export type RoomResult = {
  index: number;
  name: string;
  startS: number;
  endS: number;
  has3d: boolean;
  plan: Plan | null;
  measurements: Measurements | null;
};

export type Vision = {
  rooms: { room: string; where: string; atSeconds: number | null; quote: string }[];
  style: string;
  mustHaves: string[];
  forWhom: string;
};

export type AnswerValue = number | boolean | "unsure";

export type Finding = {
  measured?: Measured | null;
  answer?: { value: AnswerValue; outcome: "pass" | "fail" | "unknown" } | null;
  check: { metric: string; operator: string; value: unknown; unit: string | null };
  ruleId: string;
  title: string;
  plain: string;
  category: string;
  // standard: work every suite needs, budgeted. designer_checks: a detail the designer confirms.
  status: "likely_ok" | "likely_fix" | "needs_measurement" | "needs_answer" | "standard" | "designer_checks";
  why: string | null;
  question: string | null;
  hint?: string | null;
  options?: { label: string; value: boolean | "unsure" }[];
  records?: { value: number | boolean } | null; // answered from public records
  evidence: string[];
  source: Source;
};

export type StandardWork = { ruleId: string; title: string; text: string; costLow: number | null; costHigh: number | null };

export type PlanStep = {
  id: "money" | "drawings" | "permit" | "build" | "inspect";
  title: string;
  who: string;
  time: string | null;
  costLow: number | null;
  costHigh: number | null;
  detail: string;
  items?: string[];
  source?: { title: string; url: string } | null;
};

// A starting layout inside the main room (server/layout.ts).
export type LayoutZone = { kind: "bedroom" | "bathroom" | "kitchen" | "living" | "stairs" | "mechanical"; name: string; x0: number; z0: number; x1: number; z1: number; areaM2: number };
export type Layout = {
  version: 1;
  kind: "one_bedroom" | "studio";
  zones: LayoutZone[];
  walls: { x0: number; z0: number; x1: number; z1: number }[];
  doors: { x: number; z: number; along: "x" | "z"; widthM: number }[];
  window: { side: PlanSide; atM: number; widthM: number } | null;
  checks: { label: string; ok: boolean | null; detail: string }[];
};

// "What it could look like": their own frames, finished by Muse Image, checked by SAM.
export type Concept = { n: number; frame: number; title: string; kept: boolean; checked: string };

// What public data says about the house (server/property.ts).
export type Property = {
  address: string;
  municipality: string;
  city: string | null;
  lon: number;
  lat: number;
  zone: { code: string; label: string | null; bylaw: string | null } | null;
  residential: boolean | null;
  lotAreaM2: number | null;
  building: { storeys: number | null; footprintM2: number | null; floorAreaM2: number | null } | null;
  unitsRegistered: number;
  sources: string[];
};

export type AddressHit = { address: string; municipality: string; city: string | null; lon: number; lat: number; units: number };

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
  kind?: string;
  amount: string;
  maxCAD?: number | null;
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
  has3d?: boolean;
  plan?: Plan | null;
  rooms?: RoomResult[];
  mainRoom?: number | null; // the room whose numbers the rules used
  measurements?: Measurements | null;
  vision?: Vision;
  verdict: "yes" | "fix" | "no";
  headline: string;
  route: "second_unit" | "basement_finish";
  wants: string;
  summary: string;
  transcript: string;
  detections: Detection[];
  findings: Finding[];
  fixGroups: FixGroup[];
  standard?: StandardWork[];
  steps?: PlanStep[];
  money?: { fits: number; possible: number };
  property?: Property | null;
  layout?: Layout | null;
  concepts?: { status: "pending" | "done" | "failed"; items: Concept[] } | null;
  heldBack: number;
  cost: { low: number; high: number; fixesLow?: number; fixesHigh?: number; standardLow?: number; standardHigh?: number; pricedFixes: number; unpricedFixes: number };
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
  input: {
    household: Household;
    address: string;
    addressMunicipality?: string;
    municipality: string;
    floorToJoistsM?: number | null;
    rooms?: { startS: number }[];
    ideas?: { room: number; idea: string; sec: number }[];
    spoken?: { id: string; startMs: number; endMs: number }[];
  },
  onProgress: (fraction: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("video", video);
    form.append("household", input.household);
    form.append("address", input.address);
    form.append("municipality", input.municipality);
    if (input.floorToJoistsM) form.append("floorToJoistsM", String(input.floorToJoistsM));
    if (input.addressMunicipality) form.append("addressMunicipality", input.addressMunicipality);
    if (input.rooms && input.rooms.length > 1) form.append("rooms", JSON.stringify(input.rooms));
    if (input.ideas?.length) form.append("ideas", JSON.stringify(input.ideas));
    if (input.spoken?.length) form.append("spoken", JSON.stringify(input.spoken));
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

// Address type-ahead, and what public data says about the house picked.
export async function searchAddress(q: string): Promise<AddressHit[]> {
  const res = await fetch(`/api/address?q=${encodeURIComponent(q)}`);
  return res.ok ? (await res.json()).results : [];
}
export async function getProperty(a: Pick<AddressHit, "address" | "municipality">): Promise<Property | null> {
  const res = await fetch(`/api/property?address=${encodeURIComponent(a.address)}&municipality=${encodeURIComponent(a.municipality)}`);
  return res.ok ? (await res.json()).property : null;
}
export const aerialUrl = (a: Pick<AddressHit, "address" | "municipality">) =>
  `/api/aerial?address=${encodeURIComponent(a.address)}&municipality=${encodeURIComponent(a.municipality)}`;

// The sample isn't saved on the server, so its early answers wait in this tab.
const SAMPLE_ANSWERS = "br-sample-answers";
export function sampleEarlyAnswers(): Record<string, AnswerValue> {
  try {
    return JSON.parse(sessionStorage.getItem(SAMPLE_ANSWERS) ?? "{}");
  } catch {
    return {};
  }
}

// While the scan runs: answers are kept and applied when it finishes.
export async function answerEarly(scanId: string, ruleId: string, value: AnswerValue) {
  if (scanId === "sample") {
    try {
      sessionStorage.setItem(SAMPLE_ANSWERS, JSON.stringify({ ...sampleEarlyAnswers(), [ruleId]: value }));
    } catch {
      // Private mode: the sample just asks again on the answer page.
    }
    return;
  }
  await fetch(`/api/scans/${scanId}/answers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ruleId, value }) });
}
export async function setHousehold(scanId: string, household: Household): Promise<ScanResult | null> {
  if (scanId === "sample") return null;
  const res = await fetch(`/api/scans/${scanId}/household`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ household }) });
  return res.ok ? ((await res.json()).result ?? null) : null;
}

// Saves an answer (or clears it with null) and returns the re-checked result.
export async function answerQuestion(scanId: string, current: ScanResult, sampleAnswers: Record<string, AnswerValue | null>, ruleId: string, value: AnswerValue | null) {
  const res =
    scanId === "sample"
      ? await fetch("/api/recheck", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ result: current, answers: { ...sampleAnswers, [ruleId]: value } }),
        })
      : await fetch(`/api/scans/${scanId}/answers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ruleId, value }),
        });
  if (!res.ok) throw new Error("We couldn't check that. Try again.");
  return (await res.json()).result as ScanResult;
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
