// Downloads every civic address in Waterloo Region for the address type-ahead.
// Source: Region of Waterloo Open Data, "Addresses" (Region Open Data Licence v2.0).
// Writes data/addresses.json.gz: [address, municipality, lon, lat, units] per civic address,
// where units counts the unit addresses registered at it (an existing apartment shows up there).
// Usage: pnpm tsx scripts/fetch-addresses.ts
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const LAYER = "https://utility.arcgis.com/usrsvcs/servers/d4d0c6dedec14e59930688f3830776c6/rest/services/OpenData/OpenData/MapServer/1/query";
const PAGE = 1000;

type Row = { FullAddress: string; AddressNumber: string; FullStreetName: string; UnitNumber: string | null; Municipality: string; AddressPointType: string };

async function page(offset: number): Promise<{ attributes: Row; geometry: { x: number; y: number } }[]> {
  const params = new URLSearchParams({
    where: "AddressPointType NOT IN ('Theoretical','Utility')",
    outFields: "FullAddress,AddressNumber,FullStreetName,UnitNumber,Municipality,AddressPointType",
    outSR: "4326",
    orderByFields: "OBJECTID",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE),
    f: "json",
  });
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${LAYER}?${params}`, { signal: AbortSignal.timeout(60_000) });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.features;
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

const countRes = await fetch(`${LAYER}?where=${encodeURIComponent("AddressPointType NOT IN ('Theoretical','Utility')")}&returnCountOnly=true&f=json`);
const { count } = (await countRes.json()) as { count: number };
console.log(`${count} address points`);

const offsets = Array.from({ length: Math.ceil(count / PAGE) }, (_, i) => i * PAGE);
const civic = new Map<string, [string, string, number, number, number]>();
const units = new Map<string, number>();
let done = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let o = offsets.shift(); o !== undefined; o = offsets.shift()) {
      for (const f of await page(o)) {
        const a = f.attributes;
        const key = `${a.AddressNumber} ${a.FullStreetName}|${a.Municipality}`;
        if (a.UnitNumber) units.set(key, (units.get(key) ?? 0) + 1);
        else if (!civic.has(key) && f.geometry) {
          civic.set(key, [a.FullAddress, a.Municipality, Math.round(f.geometry.x * 1e6) / 1e6, Math.round(f.geometry.y * 1e6) / 1e6, 0]);
        }
      }
      if (++done % 25 === 0) console.log(`${done} pages`);
    }
  }),
);
for (const [key, n] of units) {
  const row = civic.get(key);
  if (row) row[4] = n;
}
const rows = [...civic.values()].sort((a, b) => a[0].localeCompare(b[0]));
writeFileSync("data/addresses.json.gz", gzipSync(JSON.stringify(rows)));
console.log(`wrote ${rows.length} civic addresses to data/addresses.json.gz`);
