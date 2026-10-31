// How a script reads a scan now that scans are private (server/privacy.ts): with the claim the server
// handed back when the script made the scan, and the admin key from .env when it's set (ADMIN_TOKEN),
// which reads any scan.
export function scanHeaders(created?: { basementId?: string; claimToken?: string } | null): Record<string, string> {
  const h: Record<string, string> = {};
  if (created?.basementId && created.claimToken) h["x-claims"] = encodeURIComponent(JSON.stringify([{ basementId: created.basementId, claimToken: created.claimToken }]));
  const key = process.env.ADMIN_TOKEN?.trim();
  if (key) h.authorization = `Bearer ${key}`;
  return h;
}
