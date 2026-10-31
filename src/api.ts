// Client for the scan API, plus the frozen sample that replays the same events.
import type { PlanCheck } from "../server/planCheck";
import type { Watch } from "../server/watch";

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
  // path: the camera's walk in plan view. model: an area's 3D, ready to draw. photo: a finished photo.
  type: "log" | "find" | "measure" | "stage" | "done" | "error" | "path" | "model" | "photo" | "photos";
  text: string;
  data?: {
    kind?: string;
    label?: string;
    detections?: Detection[];
    frameCount?: number;
    photo?: number; // a photo take's find: which photo (its frame)
    room?: string; // and the room it was tagged with
    photos?: PhotoRoom[]; // a photo take's first log: its rooms, each a run of photos
    points?: [number, number][]; // path: [x, z] in metres, in the walk frame
    area?: number | "all"; // model: which area; the whole basement's files use ?room=all
    files?: { surfels: string; scan: string; mesh?: string }; // mesh: BRM1 (src/three/RealScan.tsx parseMesh)
    place?: { angle: number; scale: number; x: number; z: number } | null; // model, an area: its own frame into the walk frame; null when it couldn't be placed
    path?: [number, number][]; // model, the whole basement: the walk again, in the final frame
    n?: number; // photo
    url?: string;
    title?: string;
  };
};

// Who it's for, one tap on the start sheet with the rent folded in (server/eligibility.ts fromWho).
export type Who = "family" | "rental_capped" | "rental_market" | "unsure";

// A question the wait screen still asks (server/eligibility.ts waitQuestions). `words`: their own words welcome.
export type WaitAsk = {
  id: string;
  kind: "who" | "plans" | "rule" | "money";
  question: string;
  hint: string;
  options: { label: string; value: MoneyValue }[];
  words?: boolean;
  decides?: string[];
};

export type Source = { title: string; url: string; section?: string; retrieved?: string };

export type Measured = { value: number; unit: string; marginM: number; limit: number; source: "model" | "user_measurement" | "door" };

export type Measurements = {
  ceilingHeightM: number | null;
  widthM: number | null;
  depthM: number | null;
  scaleSource: "model" | "user_measurement" | "door" | "arkit";
  confidence: string;
  expectedErrorPct: number;
  trusted?: boolean;
  warnings: string[];
  clearances: { detectionId: string; label: string; clearanceM: number }[];
};

export type PlanSide = "minX" | "maxX" | "minZ" | "maxZ";

export const FIXTURE_LABEL: Record<Plan["fixtures"][number]["kind"], string> = {
  furnace: "Furnace",
  panel: "Panel",
  water_heater: "Water heater",
  plumbing: "Plumbing rough-in",
};

export type Plan = {
  version: 1;
  box: { minX: number; maxX: number; minZ: number; maxZ: number };
  sides: Record<PlanSide, "wall" | "extent">;
  widthM: number;
  depthM: number;
  areaM2: number;
  ceilingHeightM: number | null;
  openings: { kind: "window" | "door"; side: PlanSide; atM: number; widthM: number; detectionId: string; guess?: boolean }[];
  stairs: { x0: number; z0: number; x1: number; z1: number; detectionId: string; bottom?: [number, number] }[];
  fixtures: { kind: "furnace" | "panel" | "water_heater" | "plumbing"; x: number; z: number; detectionId: string }[];
  scaleSource: "model" | "user_measurement" | "door" | "arkit";
  trusted: boolean;
};

// Where a room sits in the one basement plan: turned by quarter turns about the vertical
// (x' = c·x − s·z, z' = s·x + c·z), then shifted on the floor (server/basement.ts). `y`: how far up its
// own floor sits from the basement's one floor, so every area's 3D stands on the same floor (0 when absent).
export type RoomPlacement = { turn: 0 | 1 | 2 | 3; x: number; z: number; y?: number };

// The basement's floor plan read from all of the 3D at once (services/scan3d/scan3d/layout.py), in the
// basement frame (metres, the floor at height 0): rooms as polygons, walls with their thickness, doors and
// windows on them, and what stands in the rooms. App takes only: their areas share the phone's one world.
export type BasementPlan = {
  version: 1;
  rotation: number; // the phone's world (x, z) turned by -rotation is this frame
  floor: { y: number; normal: number[]; spreadM: number; tiltDeg: number } | null; // in the phone's world
  areaFloors?: { area: number; y: number; offsetM: number; spreadM: number }[]; // each area's own floor, same world
  ceilingM: number | null;
  footprintM2: number;
  // entered false: nobody went in; it was drawn from what the camera saw through its door (seenFrom).
  rooms: { id: string; polygon: [number, number][]; areaM2: number; ceilingM: number | null; low: boolean; cameras: number; entered?: boolean; seenFrom?: string | null; kind: string; name?: string }[];
  walls: {
    id: string;
    a: [number, number];
    b: [number, number];
    thicknessM: number;
    kind: "foundation" | "existing";
    rooms: string[];
    seenShare: number;
    guess?: boolean;
    seenFromDoor?: boolean; // a wall of a room nobody went into
    check?: { confidence: number; agree: number; contradict: number; frames: number };
  }[];
  openings: { id: string; kind: "door" | "window"; wallId: string; offsetM: number; widthM: number; heightM: number | null; sillM?: number | null; at: [number, number]; rooms: string[]; source: string; detectionId?: string }[];
  fixtures: { id: string; kind: "stairs" | "furnace" | "water_heater" | "panel" | "plumbing" | "beam" | "duct" | "bulkhead"; at: [number, number]; sizeM?: [number, number]; heightM?: number | null; source: string; detectionId?: string; bottom?: [number, number] }[];
  // Spark's corrections, each with whether the points agreed and why.
  edits: ({ op: string; ok: boolean; why: string } & Record<string, unknown>)[];
  // notPlaced: rooms the whole-take watch saw that the 3D gave no room for.
  review?: { rounds: number; unsure: string[]; note?: string; notPlaced?: string[] } | null;
};

// Each area of the basement is measured on its own, then placed in one plan. Older scans have no placement.
export type RoomResult = {
  index: number;
  name: string;
  startS: number;
  endS: number;
  has3d: boolean;
  plan: Plan | null;
  measurements: Measurements | null;
  placement?: RoomPlacement | null;
};

export type Vision = {
  rooms: { room: string; where: string; atSeconds: number | null; quote: string }[];
  style: string;
  mustHaves: string[];
  forWhom: string;
};

export type AnswerValue = number | boolean | "unsure";
// The money questions' answers: yes/no, "unsure", a rent amount, or "none" / "market" / who it's for.
export type AnyAnswer = AnswerValue | string;

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

export type Link = { label: string; url: string };

// "How to apply" (server/steps.ts): six steps in the order they happen, each a few concrete tasks.
export type PlanTask = {
  title: string;
  detail?: string | null;
  links: Link[];
  bring?: string[];
  program?: { id: string; qualify: "yes" | "ask" } | null;
};

export type PlanStep = {
  id: "before" | "drawings" | "permit" | "build" | "after" | "tax";
  when: string;
  title: string;
  who: string;
  time: string | null;
  costLow: number | null;
  costHigh: number | null;
  costNote?: string | null;
  detail: string;
  tasks: PlanTask[];
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
  window: { side: PlanSide; atM: number; widthM: number; inBedroom?: boolean } | null; // inBedroom: see server/layout.ts
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
  inRegion?: boolean; // Waterloo Region's open data covers this house (records and the aerial photo)
  zoningMap?: { label: string; url: string } | null; // the City's own zoning map, where there's no open layer
  sources: string[];
};

// "region": from Waterloo Region's open address list. "ontario": placed by NRCan, no records.
export type AddressHit = { address: string; municipality: string; city: string | null; lon: number; lat: number; units: number; source?: "region" | "ontario" };
export type AddressSearch = { results: AddressHit[]; notCovered: { where: string | null; message: string } | null };

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
  priced?: boolean; // false: the quote can't price it yet (the design has no place for it)
  fromDesign?: boolean; // the design brought it (server/model/fixes.ts), not the rules
};

// A money program, decided in code (server/eligibility.ts): yes, no, or one answer away.
export type Qualify = "yes" | "no" | "ask";
export type MoneyValue = boolean | number | string;
export type Grant = {
  id: string;
  name: string;
  shortName: string;
  level: string;
  status: string;
  kind: string;
  amount: string;
  maxCAD: number | null;
  value: "cash" | "savings" | "financing";
  amountCAD: number | null;
  qualify: Qualify;
  reason: string;
  question: string | null;
  commitments: string[];
  note: string | null;
  apply: { when: string; paidWhen?: string | null; who: string; where: Link[]; bring: string[] } | null;
  source: Source;
  verified: boolean;
};

export type MoneyQuestion = {
  id: string;
  question: string;
  hint: string;
  options: { label: string; value: MoneyValue }[];
  decides: string[];
  answer: MoneyValue | null;
};

export type ScanResult = {
  id: string;
  household: Household;
  city?: string;
  municipality?: string; // the rules pack and the permit fee it's priced with ("waterloo-on")
  authority?: string; // who issues the permit: "City of Waterloo", "Township of Woolwich"
  coverage?: "full" | "provincial";
  coverageNote?: string | null; // what Ontario-only coverage means for this municipality
  has3d?: boolean;
  plan?: Plan | null;
  rooms?: RoomResult[];
  floorPlan?: BasementPlan | null; // the whole basement's plan, for app takes (server/floorplan.ts)
  mainRoom?: number | null; // the room whose numbers the rules used
  measurements?: Measurements | null;
  // How it was filmed; `photos`: a photo take of that many photos (its finds are by photo, not second).
  capture?: { lens: "ultrawide" | "wide" | null; wideAt: number | null; photos?: number };
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
  money?: { total: number; ifYes: number };
  moneyQuestions?: MoneyQuestion[];
  moneyAnswered?: MoneyQuestion[];
  property?: Property | null;
  layout?: Layout | null;
  concepts?: { status: "pending" | "done" | "failed"; items: Concept[] } | null;
  plans?: string | null; // what they'd like it to be, from the wait screen
  watch?: Watch | null; // what Muse Wonder watched and heard in the whole take (server/watch.ts)
  // Muse Wonder's check of the plan against the take, for "Is this your basement?" (server/planCheck.ts).
  // Lands a little after the answer; null when it failed or was skipped.
  planCheck?: PlanCheck | null;
  demo?: boolean; // the demo house: Waterloo's rules, no real address
  disclaimer?: string | null; // the rules pack's own words: a screening aid, not a permit decision
  heldBack: number;
  // `design`: the design whose quote this is (server/priced.ts); null while it's the rules' rough sum.
  cost: { low: number; high: number; fixesLow?: number; fixesHigh?: number; standardLow?: number; standardHigh?: number; pricedFixes: number; unpricedFixes: number; design?: string | null };
  // The design they picked, as the answer's 3D draws it, with its own checks (server/priced.ts).
  design?: { id: string; name: string; plan: Plan; layout: Layout } | null;
  grants: Grant[];
  process: { step: number; title: string; detail: string; source?: Source }[];
  pros: {
    registry: { name: string; url: string; searchUrl?: string; searchLinks?: Link[]; howToSearch?: string; suggestedSearch?: Record<string, unknown> };
    cityNote?: string;
    selfDraw?: { detail: string; note?: string; checklist?: Link | null; rule?: Link | null };
    designerCost?: { lowCAD: number; highCAD: number; note?: string; source?: Source };
    trades?: { title: string; detail: string; label: string; url: string; program?: string }[];
  };
  compiledAt: string;
};

// Videos picked in this tab, so the scan screen can play them before the server has its copy.
export const localVideos = new Map<string, File>();

// A photo take (instead of a video): 5–20 photos, each tagged with its room. The server keeps them in
// room order, so each room is one run of photos: frames from..to-1.
export const MIN_PHOTOS = 5;
export const MAX_PHOTOS = 20;
export const MIN_PHOTOS_3D = 3; // a room needs this many for its own 3D (server/photoInput.ts)
export type PhotoRoom = { name: string; from: number; to: number };
export type PhotoTake = { count: number; rooms: PhotoRoom[] };
// Photo takes sent from this tab, so the scan screen shows the photos before the server says so.
export const localPhotoTakes = new Map<string, PhotoTake>();

// The example, everywhere it shows: a real scan, recorded once and replayed, nothing sent.
export const EXAMPLE_LABEL = "A real basement, filmed and scanned once, replayed here. Nothing you do is sent.";
export const EXAMPLE_HOUSEHOLD = "The example household's answers";
// The demo house, for anyone outside Ontario: Waterloo's rules for a house that isn't real.
export const DEMO_LABEL = "Waterloo's rules, no real address. For trying it outside Ontario.";

// This browser's claim tokens and, when signed in, the Clerk session: what the server checks before
// anything is changed or anything private is shown.
export async function authHeaders(json = false): Promise<Record<string, string>> {
  const h: Record<string, string> = json ? { "Content-Type": "application/json" } : {};
  try {
    const claims = localStorage.getItem("br-claims");
    if (claims) h["x-claims"] = encodeURIComponent(claims);
  } catch {
    // Private mode: only a signed-in owner can change it.
  }
  const clerk = (window as unknown as { Clerk?: { session?: { getToken: () => Promise<string | null> } | null } }).Clerk;
  const token = await clerk?.session?.getToken().catch(() => null);
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// Whether a real scan can run now (server/limits.ts), asked before anyone films.
export type Allowance = { ok: boolean; reason: "no_key" | "spend" | "day" | "hour" | null; message: string | null; leftToday: number; perDay: number; resetsAt: string };
export async function getAllowance(): Promise<Allowance | null> {
  const res = await fetch("/api/scans/allowance", { cache: "no-store" }).catch(() => null);
  return res?.ok ? res.json() : null;
}

// Anonymous basements this browser created. Claimed into an account after sign-up.
export function rememberClaim(basementId: string, claimToken: string) {
  try {
    const all = JSON.parse(localStorage.getItem("br-claims") ?? "[]") as { basementId: string; claimToken: string }[];
    all.push({ basementId, claimToken });
    localStorage.setItem("br-claims", JSON.stringify(all.slice(-20)));
  } catch {
    // Private mode: the scan still works, it just can't be claimed later from this browser.
  }
  syncClaimsCookie();
}

// Scans are private (server/privacy.ts). What the browser loads by itself (a frame, the video, a 3D file,
// the event stream) can't send the x-claims header, so the same claims ride along as a cookie,
// "basementId.claimToken|…". The server only counts it on reads. It covers the whole site, so /admin
// knows this browser's own scans too. The iPhone app's web view writes br-claims before this runs, so
// its takes open too.
export function syncClaimsCookie() {
  try {
    const all = JSON.parse(localStorage.getItem("br-claims") ?? "[]") as { basementId: string; claimToken: string }[];
    const value = encodeURIComponent(all.slice(-20).map((c) => `${c.basementId}.${c.claimToken}`).join("|"));
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = value ? `br_claims=${value}; Path=/; Max-Age=31536000; SameSite=Lax${secure}` : `br_claims=; Path=/; Max-Age=0${secure}`;
  } catch {
    // Private mode or no storage: JSON calls still send the header.
  }
}
if (typeof document !== "undefined") syncClaimsCookie();

type ScanInput = {
  who?: Who;
  household: Household;
  address: string;
  addressMunicipality?: string;
  municipality: string;
  floorToJoistsM?: number | null;
  rooms?: { startS: number }[];
  ideas?: { room: number; idea: string; sec: number }[];
  spoken?: { id: string; startMs: number; endMs: number }[];
  lens?: "ultrawide" | "wide" | null; // which camera filmed it
  wideAt?: number | null; // seconds into the take of the still wide shot from a corner
  demo?: boolean; // the demo house: Waterloo's rules, no address
};

export function startScan(video: File, input: ScanInput, onProgress: (fraction: number) => void): Promise<string> {
  const form = scanForm(input);
  form.append("video", video);
  return sendScan(form, onProgress, (body) => localVideos.set(body.id, video));
}

// A photo take: each photo with its room's name ("Room 1", or one they typed).
export function startPhotoScan(photos: { blob: Blob; room: string }[], input: ScanInput, onProgress: (fraction: number) => void): Promise<string> {
  const form = scanForm(input);
  photos.forEach((p, i) => form.append("photos[]", p.blob, `photo-${i + 1}.jpg`));
  form.append("photoRooms", JSON.stringify(photos.map((p) => p.room)));
  return sendScan(form, onProgress, (body) => body.photos && localPhotoTakes.set(body.id, body.photos));
}

function scanForm(input: ScanInput) {
  const form = new FormData();
  form.append("household", input.household);
  if (input.who) form.append("who", input.who);
  form.append("address", input.address);
  form.append("municipality", input.municipality);
  if (input.floorToJoistsM) form.append("floorToJoistsM", String(input.floorToJoistsM));
  if (input.addressMunicipality) form.append("addressMunicipality", input.addressMunicipality);
  if (input.rooms && input.rooms.length > 1) form.append("rooms", JSON.stringify(input.rooms));
  if (input.ideas?.length) form.append("ideas", JSON.stringify(input.ideas));
  if (input.spoken?.length) form.append("spoken", JSON.stringify(input.spoken));
  if (input.lens) form.append("lens", input.lens);
  if (input.wideAt != null) form.append("wideAt", String(input.wideAt));
  if (input.demo) form.append("demo", "true");
  return form;
}

function sendScan(form: FormData, onProgress: (fraction: number) => void, sent: (body: { id: string; photos?: PhotoTake }) => void): Promise<string> {
  return new Promise((resolve, reject) => {
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
        sent(body);
        rememberClaim(body.basementId, body.claimToken);
        resolve(body.id);
      } else reject(Object.assign(new Error(body.error ?? "Upload failed. Check your connection and try again."), { allowance: (body.allowance as Allowance | undefined) ?? null }));
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
export async function searchAddress(q: string): Promise<AddressSearch> {
  const res = await fetch(`/api/address?q=${encodeURIComponent(q)}`);
  if (!res.ok) return { results: [], notCovered: null };
  const json = await res.json();
  return { results: json.results ?? [], notCovered: json.notCovered ?? null };
}
export async function getProperty(a: Pick<AddressHit, "address" | "municipality">): Promise<Property | null> {
  const res = await fetch(`/api/property?address=${encodeURIComponent(a.address)}&municipality=${encodeURIComponent(a.municipality)}`);
  return res.ok ? (await res.json()).property : null;
}
export const aerialUrl = (a: Pick<AddressHit, "address" | "municipality">) =>
  `/api/aerial?address=${encodeURIComponent(a.address)}&municipality=${encodeURIComponent(a.municipality)}`;

// The sample isn't saved on the server, so its early answers wait in this tab.
const SAMPLE_ANSWERS = "br-sample-answers";
export function sampleEarlyAnswers(): Record<string, AnyAnswer> {
  try {
    return JSON.parse(sessionStorage.getItem(SAMPLE_ANSWERS) ?? "{}");
  } catch {
    return {};
  }
}

// While the scan runs: answers are kept and applied when it finishes. Returns what's still worth
// asking, or null when that couldn't be worked out.
export async function answerEarly(scanId: string, ruleId: string, value: AnyAnswer): Promise<WaitAsk[] | null> {
  if (scanId === "sample") {
    try {
      sessionStorage.setItem(SAMPLE_ANSWERS, JSON.stringify({ ...sampleEarlyAnswers(), [ruleId]: value }));
    } catch {
      // Private mode: the sample just asks again on the answer page.
    }
    return waitAsks(scanId);
  }
  const res = await fetch(`/api/scans/${scanId}/answers`, { method: "POST", headers: await authHeaders(true), body: JSON.stringify({ ruleId, value }) });
  return res.ok ? ((await res.json()).asks ?? null) : null;
}

// What the wait screen still asks. The sample brings the answers it was recorded with.
export async function waitAsks(scanId: string): Promise<WaitAsk[]> {
  if (scanId === "sample") {
    const sample: ScanResult = await (await fetch("/samples/sample/result.json")).json();
    const told = Object.fromEntries((sample.moneyAnswered ?? []).filter((q) => q.id !== "household").map((q) => [q.id, q.answer]));
    const res = await fetch("/api/money", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ municipality: "waterloo-on", household: sample.household, answers: { ...told, ...sampleEarlyAnswers() } }),
    });
    return res.ok ? ((await res.json()).asks ?? []) : [];
  }
  const s = await getScan(scanId);
  return s.asks ?? [];
}
export async function setHousehold(scanId: string, household: Household): Promise<ScanResult | null> {
  if (scanId === "sample") {
    await answerEarly(scanId, "household", household);
    return null;
  }
  const res = await fetch(`/api/scans/${scanId}/household`, { method: "POST", headers: await authHeaders(true), body: JSON.stringify({ household }) });
  return res.ok ? ((await res.json()).result ?? null) : null;
}

// Saves an answer (or clears it with null) and returns the re-checked result. Who it's for has its
// own route; the sample keeps everything in this tab and re-checks without saving.
export async function answerQuestion(scanId: string, current: ScanResult, sampleAnswers: Record<string, AnyAnswer | null>, ruleId: string, value: AnyAnswer | null) {
  if (scanId === "sample") {
    const { household, ...answers } = { ...sampleAnswers, [ruleId]: value };
    const res = await fetch("/api/recheck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result: current, answers, household: household ?? current.household, model: sampleModel() }),
    });
    if (!res.ok) throw new Error("We couldn't check that. Try again.");
    return (await res.json()).result as ScanResult;
  }
  if (ruleId === "household") {
    const next = await setHousehold(scanId, value as Household);
    if (!next) throw new Error("We couldn't check that. Try again.");
    return next;
  }
  const res = await fetch(`/api/scans/${scanId}/answers`, {
    method: "POST",
    headers: await authHeaders(true),
    body: JSON.stringify({ ruleId, value }),
  });
  if (res.status === 403) throw new Error((await res.json().catch(() => ({}))).error ?? "Only the person who filmed this can change its answers.");
  if (!res.ok) throw new Error("We couldn't check that. Try again.");
  return (await res.json()).result as ScanResult;
}

// The money questions still open while the scan runs, so the wait screen asks only what matters.
export async function openMoneyQuestions(scanId: string): Promise<MoneyQuestion[]> {
  const res =
    scanId === "sample"
      ? await fetch("/api/money", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ municipality: "waterloo-on", household: sampleEarlyAnswers().household ?? "relative", answers: sampleEarlyAnswers() }),
        })
      : await fetch(`/api/scans/${scanId}/money`);
  return res.ok ? (await res.json()).questions : [];
}

// household and answers: who it's for and everything they told us (rule, money, who, plans), so nothing
// is asked twice. asks: what's still worth asking. canEdit: this browser (or the signed-in owner) filmed
// it; a shared link only reads. failure: why it stopped, and whether "Try again" can help.
export type ScanStatus = {
  status: "queued" | "running" | "done" | "error";
  result: ScanResult | null;
  photos?: PhotoTake | null; // a photo take, instead of a video
  error?: string | null;
  failure?: { cause: string; retry: boolean } | null;
  demo?: boolean;
  canEdit?: boolean;
  household?: Household;
  answers?: Record<string, AnyAnswer>;
  asks?: WaitAsk[];
};
// The example keeps its model in this browser (src/workspaceApi.ts, "br-sample-workspace").
function sampleModel(): unknown {
  try {
    return JSON.parse(localStorage.getItem("br-sample-workspace") ?? "null")?.state?.model ?? null;
  } catch {
    return null;
  }
}

// The example's answer, re-checked with what its visitor answered and priced on the design it picked
// here (server/priced.ts), as a real scan's comes from the server: one quote and one list of fixes.
async function sampleScan(): Promise<ScanStatus> {
  const result = await (await fetch("/samples/sample/result.json")).json();
  const told = Object.fromEntries(((result.moneyAnswered ?? []) as { id: string; answer: unknown }[]).filter((q) => q.id !== "household").map((q) => [q.id, q.answer]));
  const { household, ...answers } = { ...told, ...sampleEarlyAnswers() } as Record<string, unknown>;
  const res = await fetch("/api/recheck", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ result, answers, household: household ?? result.household, model: sampleModel() }),
  }).catch(() => null);
  return { status: "done", result: res?.ok ? (await res.json()).result : result, canEdit: true };
}

// Every cost on every screen is the quote for the design they picked (server/priced.ts): say which.
export const costLabel = (r: Pick<ScanResult, "cost">) => (r.cost.design ? `Hired out, ${r.cost.design.toLowerCase()}` : "Rough cost, all in");

export async function getScan(id: string): Promise<ScanStatus> {
  if (id === "sample") return sampleScan();
  const res = await fetch(`/api/scans/${id}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("not found");
  return res.json();
}

// "Try again": the stored video runs again. `waiting`: it's still in line, nothing to do yet.
export async function retryScan(id: string): Promise<{ status: string; waiting?: boolean }> {
  const res = await fetch(`/api/scans/${id}/retry`, { method: "POST", headers: await authHeaders(true) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "That didn't start. Try again in a moment.");
  return body;
}


// The sample was recorded before the wait screen drew the basement: its walk, its 3D and its photo,
// played back where a scan sends them now.
async function withSampleViews(events: ScanEvent[]): Promise<ScanEvent[]> {
  const scan = await fetch("/samples/sample/3d/scan.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const result = await fetch("/samples/sample/result.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const lastFind = events.map((e) => e.type).lastIndexOf("find");
  const at = events[lastFind]?.at ?? 0;
  const points = ((scan?.frames ?? []) as { pose: number[][] }[]).map((f): [number, number] => [f.pose[0][3], f.pose[2][3]]);
  const views: ScanEvent[] = points.length
    ? [
        { at: at + 0.5, type: "path", text: "Your walk", data: { points } },
        {
          at: at + 4,
          type: "model",
          text: "Your basement in 3D",
          data: { area: "all", files: { surfels: "/samples/sample/3d/surfels-lite.bin", mesh: "/samples/sample/3d/mesh.bin", scan: "/samples/sample/3d/scan.json" }, path: points },
        },
      ]
    : [];
  const photos: ScanEvent[] = ((result?.concepts?.items ?? []) as Concept[]).map((c, i) => ({
    at: at + 6 + i,
    type: "photo",
    text: c.title,
    data: { n: c.n, title: c.title, url: `/samples/sample/concepts/${c.n}.jpg` },
  }));
  const done = events.findIndex((e) => e.type === "done");
  const out = [...events];
  out.splice(done < 0 ? out.length : done, 0, ...[...views, ...photos].map((e) => ({ ...e, at: Math.min(e.at, events[done]?.at ?? e.at) })));
  return out;
}

// Replays the recorded sample scan with its real timing, but never waits more than 2.5 s between steps.
export function replaySample(onEvent: (e: ScanEvent) => void): () => void {
  let cancelled = false;
  const timers: number[] = [];
  fetch("/samples/sample/events.json")
    .then((r) => r.json())
    .then(withSampleViews)
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
