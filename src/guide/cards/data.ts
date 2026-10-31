// What the Build milestone's cards and visuals read: the scan's answer (priced on their design), the
// workspace and the permit set's status. One copy per scan, shared by every card in the thread and the
// visual pane, so a saved tape number updates them all at once. The example's workspace lives in this
// browser (src/workspaceApi.ts does the same calls for it), so it works with no account and no keys.
import { useEffect, useSyncExternalStore } from "react";
import { getScan, type ScanResult } from "../../api";
import { getPermitStatus, getWorkspace, saveWorkspace, type PermitStatus, type Profile, type Workspace, type WorkspaceState } from "../../workspaceApi";

export type BuildData = { result: ScanResult | null; ws: Workspace | null; status: PermitStatus | null; error: string | null };
type Entry = { data: BuildData; listeners: Set<() => void>; loading: Promise<void> | null; at: number; tries: number };

const STALE_MS = 4000;
const EMPTY: BuildData = { result: null, ws: null, status: null, error: null };
const store = new Map<string, Entry>();

function entry(scanId: string): Entry {
  let e = store.get(scanId);
  if (!e) store.set(scanId, (e = { data: EMPTY, listeners: new Set(), loading: null, at: 0, tries: 0 }));
  return e;
}

function set(scanId: string, patch: Partial<BuildData>) {
  const e = entry(scanId);
  e.data = { ...e.data, ...patch };
  for (const l of e.listeners) l();
}

// Loads (or reloads) everything. The status needs the saved workspace, so it comes last.
export function refresh(scanId: string): Promise<void> {
  const e = entry(scanId);
  e.loading = (async () => {
    try {
      const [scan, ws] = await Promise.all([getScan(scanId), getWorkspace(scanId)]);
      const status = ws.locked ? null : await getPermitStatus(scanId);
      e.at = Date.now();
      e.tries = 0;
      set(scanId, { result: scan.result ?? null, ws, status, error: ws.locked ?? null });
    } catch (err) {
      set(scanId, { error: err instanceof Error ? err.message : "That didn't load. Refresh to try again." });
      // The server may be starting or between deploys: try again a few times, further apart each time.
      if (++e.tries <= 4) setTimeout(() => void refresh(scanId), 1500 * e.tries);
    } finally {
      e.loading = null;
    }
  })();
  return e.loading;
}

// A card's save: the workspace route validates it (or this browser keeps it, for the example), then
// everything is read again so the counts and the next question follow.
export async function save(scanId: string, patch: { profile?: Profile | null; state?: WorkspaceState }) {
  const saved = await saveWorkspace(scanId, patch);
  const ws = entry(scanId).data.ws;
  if (ws) set(scanId, { ws: { ...ws, profile: saved.profile, state: saved.state } });
  await refresh(scanId);
}

// The permit's part of the workspace, one section at a time.
export function savePermit(scanId: string, patch: Partial<NonNullable<WorkspaceState["permit"]>>) {
  const now = entry(scanId).data.ws?.state.permit ?? {};
  return save(scanId, { state: { permit: { ...now, ...patch } } });
}

export function useBuild(scanId: string): BuildData {
  const e = entry(scanId);
  const data = useSyncExternalStore(
    (l) => {
      e.listeners.add(l);
      return () => e.listeners.delete(l);
    },
    () => e.data,
  );
  // A card or visual that appears reads again if what's here is more than a few seconds old: the guide
  // may have saved an answer (a money question, the plan) since.
  useEffect(() => {
    if (!e.loading && (!e.data.ws || Date.now() - e.at > STALE_MS)) void refresh(scanId);
  }, [scanId, e]);
  return data;
}

// The guide's step for a card's item (server/guide/build.ts), which the script takes as `itemId`.
export const stepFor = (item: string) => (item === "submit" ? "build.submit" : item === "apply" ? "build.money:apply" : item === "path" ? "build.builders" : `build.permit:${item}`);

export const upsert = <T extends { id: string }>(list: T[] | undefined, item: T) => [...(list ?? []).filter((x) => x.id !== item.id), item];
export const mmText = (v: number | null | undefined) => (v == null ? "" : String(v));
export const mmValue = (s: string) => (s.trim() === "" ? null : Math.max(0, Math.round(Number(s))) || null);
export const metres = (mm: number) => `${(mm / 1000).toFixed(2)} m`;
export const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
