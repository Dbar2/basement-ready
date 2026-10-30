// Client for the workspace (server/workspaceRoutes.ts): the owner profile and saved state, the permit
// package, the materials list, the applications and the looks. The sample basement keeps its
// workspace in this browser and gets its documents from stateless routes.
import { authHeaders as headers, type Grant, type MoneyQuestion, type PlanSide } from "./api";

export type Profile = {
  owners: { first: string; last: string }[];
  phone: string;
  email: string;
  postalCode?: string | null;
  mailingAddress?: string | null;
  legalDescription?: string | null;
  pin?: string | null;
  rollNumber?: string | null;
};

export type SiteFeature = { kind: "entrance" | "parking" | "walkway"; points: [number, number][]; label?: string | null };
export type Pro = {
  id: string;
  role: "designer" | "general" | "electrician" | "plumber" | "gas" | "hvac" | "engineer" | "other";
  name: string;
  email?: string | null;
  phone?: string | null;
  registryId?: string | null;
  wsib?: boolean | null;
  insured?: boolean | null;
  requestedAt?: string | null;
  quoteCAD?: number | null;
  quoteAt?: string | null;
  note?: string | null;
};
export type Favourite = { source: "concept" | "look"; n: number; style?: string | null; title: string };
export type Look = { style: string; status: "pending" | "done" | "failed"; items: { n: number; frame: number; title: string; kept: boolean; checked: string }[]; at: string };

export type WorkspaceState = {
  site?: { features: SiteFeature[] };
  tape?: { egressWidthMm?: number | null; egressHeightMm?: number | null; egressSillMm?: number | null; ceilingMm?: number | null; beamMm?: number | null };
  ideas?: { kind?: "one_bedroom" | "studio" | null; side?: PlanSide | null; finish?: "light" | "warm" | "deep" | null; favourites?: Favourite[] };
  build?: { path?: "hire" | "diy" | "mix" | null; pros?: Pro[] };
  apply?: Record<string, { sentAt?: string | null }>;
  permit?: PermitInputs;
  looks?: Record<string, Look>;
};

// What the owner adds for the permit set (server/workspace.ts PermitSchema).
export type PermitInputs = {
  submittedAt?: string | null;
  permitNumber?: string | null;
  signer?: "owner" | "designer" | null;
  walls?: { id: string; mm?: number | null }[];
  windows?: { id: string; widthMm?: number | null; heightMm?: number | null; sillMm?: number | null }[];
  lotLines?: { id: string; mm?: number | null }[];
  upstairs?: { bedrooms: { floor: number; at: [number, number] }[]; none?: boolean | null };
  reviewed?: { sheet: string; key: string }[];
  designer?: { name?: string | null; bcin?: string | null; firm?: string | null; firmBcin?: string | null; email?: string | null; phone?: string | null };
};

export type ReadyItem = { id: string; group: "tape" | "windows" | "owner" | "upstairs" | "lot" | "designer" | "review"; label: string; detail: string; done: boolean };
export type PermitWindow = { id: string; tag: string; room: string; widthM: number; heightM: number | null; sillM: number | null; change: "keep" | "enlarge" | "new"; escape: boolean; taped: boolean; was: { widthM: number; heightM: number | null } | null };
// Where the permit set stands (server/workspaceRoutes.ts permitPayload).
export type PermitStatus = {
  left: number;
  items: ReadyItem[];
  reviewKey: string;
  canSubmit: boolean;
  sheets: { number: string; title: string }[];
  mainWalls: { id: string; label: string; scanM: number; tapedM: number | null }[];
  windows: PermitWindow[];
  overhead: boolean;
  footprint: { widthM: number; depthM: number; stair: { u0: number; v0: number; u1: number; v1: number } | null; storeys: number } | null;
  designer: {
    needed: boolean;
    reasons: string[];
    signer: "owner" | "designer";
    ownerAllowed: boolean;
    quarts: string;
    filters: { label: string; value: string }[];
    email: { subject: string; body: string } | null;
  };
};

export type SiteGeometry = {
  origin: { lon: number; lat: number };
  parcel: [number, number][] | null;
  footprint: [number, number][] | null;
  others: [number, number][][];
  pin: string | null;
  legalDescription: string | null;
  rollNumber: string | null;
  aerial: { halfWidthM: number; halfHeightM: number };
  sources: string[];
};

export type Workspace = {
  profile: Profile | null;
  state: WorkspaceState;
  prefill: { legalDescription: string | null; pin: string | null; rollNumber: string | null; fromOtherBasement: Profile | null };
  site: SiteGeometry | null;
  // Why the workspace can't be opened here (another device, signed out), if it can't.
  locked?: string | null;
};

export type Cite = { title: string; url: string; section?: string | null; retrieved?: string; checked?: string };
export type Line = {
  id: string;
  group: string;
  item: string;
  need: number;
  needUnit: string;
  waste: number;
  buy: number;
  buyUnit: string;
  unitPriceCAD: number | null;
  totalCAD: number | null;
  price: { product: string; retailer: string; store: string; url: string; checked: string } | null;
  basis: string;
  only?: string | null;
};
export type Cost = { id: string; item: string; lowCAD: number; highCAD: number; source: { title: string; url: string; checked: string } | null; estimate: boolean; only?: string | null };
export type Trade = { id: string; title: string; owner: "yes" | "with_permit" | "ask" | "no"; detail: string; permit: string | null; registry?: { label: string; url: string } | null; source: Cite; verified: boolean; notes?: string };
export type CityForm = { id: string; title: string; url: string | null; fill: "acroform" | "summary"; who: string; when: string; required: string; source: Cite; verified: boolean; notes?: string };
export type CityPermit = {
  signer: "owner" | "brief";
  signerNote: string;
  signerSource: Cite;
  signerVerified: boolean;
  drawings: string[];
  drawingsSource: Cite;
  scaleRule: string | null;
  forms: CityForm[];
  portal: { label: string; url: string };
  upload: { what: string; where: string }[];
  ownerBuilder: { allowed: boolean; detail: string; source: Cite; verified: boolean };
  inspections: { id: string; title: string; when: string; who: string }[];
  inspectionsSource: Cite;
};
export type ProItem = { id: string; title: string; who: string; when: string; detail: string; registry?: { label: string; url: string } | null; source: Cite; verified: boolean; notes?: string; live: boolean };

export type DiyPlan = {
  city: string;
  permit: CityPermit | null;
  needsPro: ProItem[];
  egressNew: boolean;
  electrical: { text: string; verified: boolean; source: Cite };
  ownerBuilder: { allowed: boolean; detail: string; source: Cite } | null;
  trades: Trade[];
  takeoff: { lines: Line[]; assumptions: string[]; materialsCAD: number; hstCAD: number; missing: string[]; wallHeightM: number; checked: string };
  permits: Cost[];
  hires: Cost[];
  totals: { diyLow: number; diyHigh: number; hiredLow: number | null; hiredHigh: number | null };
  steps: { n: number; title: string; who: string; detail: string; inspection: string | null }[];
};

export type Application = {
  id: string;
  shortName: string;
  qualify: "yes" | "ask";
  worth: string;
  kind: "pdf" | "online_form" | "email" | "portal" | "tax" | "lender";
  when: string;
  steps: string[];
  pdf: { path: string; title: string } | null;
  email: { to: string; subject: string; body: string; attachments: string[] } | null;
  form: { url: string; sections: { title: string; fields: { label: string; value: string | null; note?: string | null }[] }[] } | null;
  documents: { label: string; have: boolean; how: string }[];
  warnings: string[];
  link: { label: string; url: string } | null;
  source: { title: string; url: string };
  // The example or the demo house: the email shows, but nothing can be sent from it.
  example?: boolean;
};

const SAMPLE_WS = "br-sample-workspace";
const isSample = (scanId: string) => scanId === "sample";

function sampleWorkspace(): { profile: Profile | null; state: WorkspaceState } {
  try {
    return JSON.parse(localStorage.getItem(SAMPLE_WS) ?? "null") ?? { profile: null, state: {} };
  } catch {
    return { profile: null, state: {} };
  }
}

export async function getWorkspace(scanId: string): Promise<Workspace> {
  const empty = { legalDescription: null, pin: null, rollNumber: null, fromOtherBasement: null };
  if (isSample(scanId)) return { ...sampleWorkspace(), prefill: empty, site: null };
  const res = await fetch(`/api/scans/${scanId}/workspace`, { headers: await headers() });
  if (res.status === 403) return { profile: null, state: {}, prefill: empty, site: null, locked: (await res.json().catch(() => ({}))).error ?? "Sign in to open your workspace." };
  if (!res.ok) throw new Error("We couldn't open your workspace.");
  return res.json();
}

export async function saveWorkspace(scanId: string, patch: { profile?: Profile | null; state?: WorkspaceState }): Promise<{ profile: Profile | null; state: WorkspaceState }> {
  if (isSample(scanId)) {
    const now = sampleWorkspace();
    const next = { profile: patch.profile === undefined ? now.profile : patch.profile, state: { ...now.state, ...(patch.state ?? {}) } };
    try {
      localStorage.setItem(SAMPLE_WS, JSON.stringify(next));
    } catch {
      // Private mode: the sample forgets on reload.
    }
    return next;
  }
  const res = await fetch(`/api/scans/${scanId}/workspace`, { method: "PUT", headers: await headers(true), body: JSON.stringify(patch) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "That didn't save. Try again.");
  return res.json();
}

async function saveBlob(res: Response, name: string) {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "That didn't download. Try again.");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// The sample's documents come from routes that take its workspace (and money answers) with the request.
const sampleBody = (extra: object = {}) => JSON.stringify({ ...sampleWorkspace(), ...extra });

export type PermitCopy = "review" | "submit" | "share";

async function permitPdf(scanId: string, copy: PermitCopy) {
  return isSample(scanId)
    ? fetch("/api/sample/permit.pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: sampleBody({ copy }) })
    : fetch(`/api/scans/${scanId}/permit.pdf?copy=${copy}`, { headers: await headers() });
}

export async function downloadPermit(scanId: string, copy: PermitCopy = "review") {
  const name = copy === "submit" ? "permit-drawings-submit.pdf" : copy === "share" ? "permit-drawings.pdf" : "permit-drawings-review.pdf";
  return saveBlob(await permitPdf(scanId, copy), name);
}

// The review copy opened at one sheet, in a tab opened right away so the browser allows it.
export async function openSheet(scanId: string, page: number) {
  const tab = window.open("about:blank", "_blank");
  const res = await permitPdf(scanId, "review");
  if (!res.ok) {
    tab?.close();
    throw new Error((await res.json().catch(() => ({}))).error ?? "That didn't open. Try again.");
  }
  const url = URL.createObjectURL(await res.blob());
  if (tab) tab.location.href = `${url}#page=${page}`;
  else window.location.href = `${url}#page=${page}`;
}

export async function getPermitStatus(scanId: string): Promise<PermitStatus> {
  const res = isSample(scanId) ? await fetch("/api/sample/permit/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: sampleBody() }) : await fetch(`/api/scans/${scanId}/permit/status`, { headers: await headers() });
  if (!res.ok) throw new Error("We couldn't check the permit set.");
  return res.json();
}

export const shareLink = (scanId: string) => `${window.location.origin}/api/scans/${scanId}/permit.pdf?copy=share`;

export async function downloadForm(scanId: string, formId: string) {
  return saveBlob(await fetch(`/api/scans/${scanId}/forms/${formId}.pdf`, { headers: await headers() }), `${formId}.pdf`);
}

export async function getDiy(scanId: string): Promise<DiyPlan> {
  const res = isSample(scanId) ? await fetch("/api/sample/diy", { method: "POST", headers: { "Content-Type": "application/json" }, body: sampleBody() }) : await fetch(`/api/scans/${scanId}/diy`, { headers: await headers() });
  if (!res.ok) throw new Error("We couldn't count the materials.");
  return res.json();
}

export async function getApplications(scanId: string, money?: { grants: Grant[]; moneyAnswered?: MoneyQuestion[] }): Promise<Application[]> {
  const res = isSample(scanId)
    ? await fetch("/api/sample/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: sampleBody(money ?? {}) })
    : await fetch(`/api/scans/${scanId}/apply`, { headers: await headers() });
  if (!res.ok) return [];
  return (await res.json()).applications;
}

export async function downloadApplication(scanId: string, programId: string, money?: { grants: Grant[]; moneyAnswered?: MoneyQuestion[] }) {
  const res = isSample(scanId)
    ? await fetch(`/api/sample/apply/${programId}.pdf`, { method: "POST", headers: { "Content-Type": "application/json" }, body: sampleBody(money ?? {}) })
    : await fetch(`/api/scans/${scanId}/apply/${programId}.pdf`, { headers: await headers() });
  return saveBlob(res, `${programId}.pdf`);
}

export async function startLook(scanId: string, style: string): Promise<Look> {
  const res = isSample(scanId)
    ? await fetch("/api/sample/looks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ style }) })
    : await fetch(`/api/scans/${scanId}/looks`, { method: "POST", headers: await headers(true), body: JSON.stringify({ style }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "That look didn't work. Try again.");
  return body.look;
}

// The example's looks come from the files committed with it (server/workspaceRoutes.ts), so they open with no keys.
export const lookUrl = (scanId: string, style: string, n: number) => `/api/scans/${scanId}/looks/${style}/${n}.jpg`;

export const LOOKS: { key: string; label: string }[] = [
  { key: "bright", label: "Bright and calm" },
  { key: "warm", label: "Warm wood" },
  { key: "green", label: "Deep green" },
  { key: "cottage", label: "Cottage" },
  { key: "modern", label: "Clean modern" },
];

export function mailto(to: string, subject: string, body: string) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
