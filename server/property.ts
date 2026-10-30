// What open public data already says about a house, from its address point: the zone (where an
// open zoning layer exists), the building, and registered units. Each answer is one less question.
// Only layers published under an open licence are used; each is cited in data/rules/SOURCES.md:
// - Region of Waterloo Open Data Licence v2.0: addresses, building footprints, aerial photos (2024).
// - City of Cambridge Open Data Licence v2.1: the hybrid zoning by-law layer.
// Not used, because no open licence covers them: parcels anywhere in the Region (Teranet-derived),
// and the Cities of Waterloo and Kitchener's zoning layers. Those cities' zoning is "check the map".
import type { Address } from "./address";

type Link = { label: string; url: string };

export type Property = {
  address: string;
  municipality: string;
  city: string | null;
  lon: number;
  lat: number;
  zone: { code: string; label: string | null; bylaw: string | null } | null;
  residential: boolean | null; // the zone allows houses, so an ARU is allowed in principle
  lotAreaM2: number | null; // no open parcel data, so this stays empty for now
  building: { storeys: number | null; footprintM2: number | null; floorAreaM2: number | null } | null;
  unitsRegistered: number; // unit addresses at this house: an existing apartment shows up here
  inRegion: boolean; // Waterloo Region's open data covers this house
  zoningMap: Link | null; // where to look up the zone ourselves when there's no open layer
  sources: string[];
  fetchedAt: string;
};

const SQFT = 0.09290304;
const TIMEOUT = 8000;

async function query(layer: string, a: Address, outFields: string, extra = ""): Promise<Record<string, any>[]> {
  const params = `geometry=${a.lon},${a.lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=false&outFields=${outFields}${extra}&f=json`;
  try {
    const res = await fetch(`${layer}/query?${params}`, { signal: AbortSignal.timeout(TIMEOUT) });
    const json = await res.json();
    return (json.features ?? []).map((f: { attributes: Record<string, any> }) => f.attributes);
  } catch {
    return [];
  }
}

export const LAYERS = {
  // Region of Waterloo Open Data: "Building Footprints".
  footprints: "https://utility.arcgis.com/usrsvcs/servers/12d17585568d410fb3b6cca6fdc44c70/rest/services/OpenData/OpenData/MapServer/11",
  // City of Cambridge Open Data: "Hybrid Zoning Bylaw".
  cambridgeZoning: "https://services5.arcgis.com/LTaPSxJTf948f8sm/arcgis/rest/services/HybridZoningBylaw/FeatureServer/0",
};

// Each city's own zoning map, for the cities whose zoning layer isn't open data.
export const ZONING_MAPS: Record<string, Link> = {
  Waterloo: { label: "City of Waterloo zoning map", url: "https://maps.waterloo.ca/Html5Viewer/?viewer=waterlooviewer&LayerTheme=Zoning&runWorkflow=ZoningSearch" },
  Kitchener: { label: "City of Kitchener zoning map", url: "https://experience.arcgis.com/experience/c870484f904744b8bb4f1bdecf18dddb" },
  Cambridge: { label: "City of Cambridge zoning map", url: "https://experience.arcgis.com/experience/c9f28e5db04e4ff487cd62229dff156b" },
};

// Low-density residential zones in each by-law, where a house (and so an ARU) is allowed.
export function isResidentialZone(code: string) {
  return /^(\(H\))?\s*(R|RN|RES|RS|RM)[-\d\s.A-Z]*$/i.test(code.trim()) && !/^(RC|RMU)/i.test(code.trim());
}

// The zone, where an open layer has it: Cambridge only.
async function zoning(a: Address): Promise<{ zone: Property["zone"]; sources: string[] }> {
  if (a.source === "ontario" || a.municipality !== "Cambridge") return { zone: null, sources: [] };
  const z = await query(LAYERS.cambridgeZoning, a, "ZONING_CODE,ZONING_TYPE,ZONING_BYLAW");
  return {
    zone: z[0]?.ZONING_CODE ? { code: z[0].ZONING_CODE, label: z[0].ZONING_TYPE ?? null, bylaw: z[0].ZONING_BYLAW ? `By-law ${z[0].ZONING_BYLAW}` : null } : null,
    sources: ["City of Cambridge open data (zoning)"],
  };
}

// The house itself: the biggest residential footprint within a few metres of the address point.
async function building(a: Address): Promise<Property["building"]> {
  if (a.source === "ontario") return null;
  const rows = await query(LAYERS.footprints, a, "FootprintSqft,Storeys,TotalSqft,BuildingType", "&distance=12&units=esriSRUnit_Meter");
  const house = rows.filter((r) => !r.BuildingType || /resid/i.test(r.BuildingType)).sort((x, y) => (y.FootprintSqft ?? 0) - (x.FootprintSqft ?? 0))[0];
  if (!house) return null;
  const m2 = (sqft: unknown) => (typeof sqft === "number" && sqft > 0 ? Math.round(sqft * SQFT) : null);
  return { storeys: typeof house.Storeys === "number" ? house.Storeys : null, footprintM2: m2(house.FootprintSqft), floorAreaM2: m2(house.TotalSqft) };
}

const cache = new Map<string, Property>();

export async function lookupProperty(a: Address): Promise<Property> {
  const key = `${a.address}|${a.municipality}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const inRegion = a.source !== "ontario"; // no source: an older Region address
  const [z, b] = await Promise.all([zoning(a), building(a)]);
  const property: Property = {
    address: a.address,
    municipality: a.municipality,
    city: a.city,
    lon: a.lon,
    lat: a.lat,
    zone: z.zone,
    residential: z.zone ? isResidentialZone(z.zone.code) : null,
    lotAreaM2: null,
    building: b,
    unitsRegistered: a.units,
    inRegion,
    zoningMap: z.zone ? null : (ZONING_MAPS[a.municipality] ?? null),
    sources: inRegion ? ["Region of Waterloo open data (addresses, buildings)", ...z.sources] : ["Natural Resources Canada geolocation (address)"],
    fetchedAt: new Date().toISOString(),
  };
  if (cache.size > 2000) cache.clear();
  cache.set(key, property);
  return property;
}

// ---- The house as a shape, for the permit's site plan ----------------------------------------
// The Region's building footprints, asked for their outlines (WGS 84) and turned into metres around
// the address point: x east, y north. GIS data, not a survey. There's no open parcel layer, so the
// lot lines are drawn by hand; `parcel` is only filled if a licensed source is added later.

export type SiteGeometry = {
  origin: { lon: number; lat: number };
  parcel: [number, number][] | null;
  footprint: [number, number][] | null; // the house
  others: [number, number][][]; // garages and sheds on the lot (only knowable with lot lines)
  // The aerial photo's half size in metres, so a point traced on it maps to the same frame.
  aerial: { halfWidthM: number; halfHeightM: number };
  sources: string[];
};

type Ring = [number, number][];

// Metres per degree at this latitude (the standard ellipsoid series).
export function metresPerDegree(lat: number) {
  const p = (lat * Math.PI) / 180;
  return {
    lat: 111132.954 - 559.822 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p),
    lon: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p),
  };
}

async function shapes(layer: string, a: Address, outFields: string, extra = ""): Promise<{ attributes: Record<string, any>; rings: Ring[] }[]> {
  const params = `geometry=${a.lon},${a.lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=true&outSR=4326&outFields=${outFields}${extra}&f=json`;
  try {
    const res = await fetch(`${layer}/query?${params}`, { signal: AbortSignal.timeout(TIMEOUT) });
    const json = await res.json();
    return (json.features ?? []).map((f: { attributes: Record<string, any>; geometry?: { rings?: Ring[] } }) => ({ attributes: f.attributes, rings: f.geometry?.rings ?? [] }));
  } catch {
    return [];
  }
}

// Shoelace area of a ring in square metres (already local).
export function ringArea(r: Ring) {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i], [x1, y1] = r[(i + 1) % r.length];
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

export async function lookupSiteGeometry(a: Address): Promise<SiteGeometry | null> {
  if (a.source === "ontario") return null; // outside Waterloo Region: no open footprints or photo
  const m = metresPerDegree(a.lat);
  const local = (r: Ring): Ring => r.map(([lon, lat]) => [Math.round((lon - a.lon) * m.lon * 100) / 100, Math.round((lat - a.lat) * m.lat * 100) / 100]);
  // The outer ring: the one with the biggest area.
  const outer = (rings: Ring[]) => rings.map(local).sort((p, q) => ringArea(q) - ringArea(p))[0] ?? null;
  const buildings = (await shapes(LAYERS.footprints, a, "FootprintSqft,BuildingType", "&distance=40&units=esriSRUnit_Meter"))
    .map((b) => ({ ring: outer(b.rings), type: String(b.attributes.BuildingType ?? "") }))
    .filter((b): b is { ring: Ring; type: string } => Boolean(b.ring));
  // Without lot lines, the house is the home the address point sits in, or the nearest one to it.
  const homes = buildings.filter((b) => !b.type || /resid/i.test(b.type));
  const house = homes.find((b) => pointInRing([0, 0], b.ring)) ?? homes.map((b) => ({ b, d: distanceToRing([0, 0], b.ring) })).filter((x) => x.d <= 12).sort((p, q) => p.d - q.d)[0]?.b ?? null;
  return {
    origin: { lon: a.lon, lat: a.lat },
    parcel: null,
    footprint: house?.ring ?? null,
    others: [],
    aerial: { halfWidthM: Math.round(AERIAL.dx * m.lon * 100) / 100, halfHeightM: Math.round(AERIAL.dy * m.lat * 100) / 100 },
    sources: ["Region of Waterloo open data (building footprints)"],
  };
}

// Shortest distance from a point to a ring's edges, in the ring's units.
export function distanceToRing([x, y]: [number, number], r: Ring) {
  let best = Infinity;
  for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i], [x1, y1] = r[(i + 1) % r.length];
    const dx = x1 - x0, dy = y1 - y0;
    const t = dx || dy ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)));
  }
  return best;
}

export function pointInRing([x, y]: [number, number], r: Ring) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// The aerial photo's reach around the point, in degrees.
export const AERIAL = { dx: 0.00045, dy: 0.00033 };

// A square of aerial photo around the house, about 70 m across: the Region of Waterloo's 2024 photos
// (10 cm), through the WMS address its open data lists ("WMS_Imagery_Connections"). The 2025 and
// 2026 photos aren't on that list, so they aren't used.
export const AERIAL_YEAR = 2024;
export async function fetchAerial(lon: number, lat: number, size = 720): Promise<Buffer> {
  const { dx, dy } = AERIAL;
  // WMS 1.3.0 in EPSG:4326 takes the box as lat,lon: the picture is linear in degrees, like the site plan.
  const bbox = [lat - dy, lon - dx, lat + dy, lon + dx].join(",");
  const url = `https://gis.regionofwaterloo.ca/waimagery/services/Imagery_${AERIAL_YEAR}/ImageServer/WMSServer?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=Imagery_${AERIAL_YEAR}&STYLES=&CRS=EPSG:4326&BBOX=${bbox}&WIDTH=${size}&HEIGHT=${size}&FORMAT=image/jpeg`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("image")) throw new Error(`aerial ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
