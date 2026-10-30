// What public data already says about a house, from its address point: zoning, lot size, the
// building, and registered units. Each answer is one less question for the homeowner.
// Sources (credited on screen):
// - Region of Waterloo Open Data: addresses, building footprints, 2026 aerial imagery.
// - City of Waterloo: Zoning By-law 2018-050 and property fabric map services.
// - City of Kitchener: zoning by address map service. Not open data (Teranet-derived parcels); used
//   with permission pending, and switched off with PROPERTY_KITCHENER=0.
// - City of Cambridge: open zoning by-law layer and parcel map service.
import type { Address } from "./address";

export type Property = {
  address: string;
  municipality: string;
  city: string | null;
  lon: number;
  lat: number;
  zone: { code: string; label: string | null; bylaw: string | null } | null;
  residential: boolean | null; // the zone allows houses, so an ARU is allowed in principle
  lotAreaM2: number | null;
  building: { storeys: number | null; footprintM2: number | null; floorAreaM2: number | null } | null;
  unitsRegistered: number; // unit addresses at this house: an existing apartment shows up here
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

const LAYERS = {
  footprints: "https://utility.arcgis.com/usrsvcs/servers/d4d0c6dedec14e59930688f3830776c6/rest/services/OpenData/OpenData/MapServer/11",
  waterlooZoning: "https://gis.waterloo.ca/maps/rest/services/Public/Public_Operations/MapServer/49",
  waterlooParcels: "https://services.arcgis.com/ZpeBVw5o1kjit7LT/arcgis/rest/services/Property_Fabric/FeatureServer/1358",
  kitchenerZoning: "https://utility.arcgis.com/usrsvcs/servers/cf51b9b72889410cb9ed4a6017ed0433/rest/services/OnPoint_Int_Ext/Zoning/MapServer/28",
  cambridgeZoning: "https://services5.arcgis.com/LTaPSxJTf948f8sm/arcgis/rest/services/HybridZoningBylaw/FeatureServer/0",
  cambridgeParcels: "https://maps.cambridge.ca/arcgispub03/rest/services/Zoning/MapServer/0",
};

// Low-density residential zones in each by-law, where a house (and so an ARU) is allowed.
export function isResidentialZone(code: string) {
  return /^(\(H\))?\s*(R|RN|RES|RS|RM)[-\d\s.A-Z]*$/i.test(code.trim()) && !/^(RC|RMU)/i.test(code.trim());
}

async function zoning(a: Address): Promise<{ zone: Property["zone"]; lotAreaM2: number | null; sources: string[] }> {
  const round = (n: unknown) => (typeof n === "number" && n > 0 ? Math.round(n) : null);
  if (a.municipality === "Waterloo") {
    const [z, p] = await Promise.all([
      query(LAYERS.waterlooZoning, a, "ZONE_CODE,ZONE_LABEL,BYLAW"),
      query(LAYERS.waterlooParcels, a, "AREA_SQM,PARCELTYPE"),
    ]);
    return {
      zone: z[0]?.ZONE_CODE ? { code: z[0].ZONE_CODE, label: z[0].ZONE_LABEL ?? null, bylaw: z[0].BYLAW ? `By-law ${z[0].BYLAW}` : null } : null,
      lotAreaM2: round(p[0]?.AREA_SQM),
      sources: ["City of Waterloo zoning and property maps"],
    };
  }
  if (a.municipality === "Kitchener") {
    if (process.env.PROPERTY_KITCHENER === "0") return { zone: null, lotAreaM2: null, sources: [] };
    const z = await query(LAYERS.kitchenerZoning, a, "ZONE_LABEL,BASE_BYLAW,SHAPE.AREA");
    return {
      zone: z[0]?.ZONE_LABEL ? { code: z[0].ZONE_LABEL, label: null, bylaw: z[0].BASE_BYLAW ?? null } : null,
      lotAreaM2: round(z[0]?.["SHAPE.AREA"]),
      sources: ["City of Kitchener zoning map"],
    };
  }
  if (a.municipality === "Cambridge") {
    const [z, p] = await Promise.all([
      query(LAYERS.cambridgeZoning, a, "ZONING_CODE,ZONING_TYPE,ZONING_BYLAW"),
      query(LAYERS.cambridgeParcels, a, "HOUSE_NUMBER,SHAPE.AREA"),
    ]);
    // The point can sit on a shared line; prefer the parcel with this house number.
    const number = a.address.split(" ")[0];
    const parcel = p.find((x) => String(x.HOUSE_NUMBER) === number) ?? (p.length === 1 ? p[0] : null);
    return {
      zone: z[0]?.ZONING_CODE ? { code: z[0].ZONING_CODE, label: z[0].ZONING_TYPE ?? null, bylaw: z[0].ZONING_BYLAW ? `By-law ${z[0].ZONING_BYLAW}` : null } : null,
      lotAreaM2: round(parcel?.["SHAPE.AREA"]),
      sources: ["City of Cambridge open data (zoning) and parcel map"],
    };
  }
  return { zone: null, lotAreaM2: null, sources: [] };
}

// The house itself: the biggest residential footprint within a few metres of the address point.
async function building(a: Address): Promise<Property["building"]> {
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
  const [z, b] = await Promise.all([zoning(a), building(a)]);
  const property: Property = {
    address: a.address,
    municipality: a.municipality,
    city: a.city,
    lon: a.lon,
    lat: a.lat,
    zone: z.zone,
    residential: z.zone ? isResidentialZone(z.zone.code) : null,
    lotAreaM2: z.lotAreaM2,
    building: b,
    unitsRegistered: a.units,
    sources: ["Region of Waterloo open data (addresses, buildings)", ...z.sources],
    fetchedAt: new Date().toISOString(),
  };
  if (cache.size > 2000) cache.clear();
  cache.set(key, property);
  return property;
}

// ---- The lot and the house as shapes, for the permit's site plan ----------------------------
// Same layers as above, asked for their outlines (WGS 84) and turned into metres around the address
// point: x east, y north. Good to a few centimetres over a lot; it's GIS data, not a survey.

export type SiteGeometry = {
  origin: { lon: number; lat: number };
  parcel: [number, number][] | null;
  footprint: [number, number][] | null; // the house
  others: [number, number][][]; // garages and sheds on the lot
  pin: string | null;
  legalDescription: string | null;
  rollNumber: string | null;
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

export async function lookupSiteGeometry(a: Address): Promise<SiteGeometry> {
  const m = metresPerDegree(a.lat);
  const local = (r: Ring): Ring => r.map(([lon, lat]) => [Math.round((lon - a.lon) * m.lon * 100) / 100, Math.round((lat - a.lat) * m.lat * 100) / 100]);
  // The outer ring: the one with the biggest area.
  const outer = (rings: Ring[]) => rings.map(local).sort((p, q) => ringArea(q) - ringArea(p))[0] ?? null;
  const sources = ["Region of Waterloo open data (building footprints)"];
  let parcel: Ring | null = null, pin: string | null = null, legal: string | null = null, roll: string | null = null;
  if (a.municipality === "Waterloo") {
    const p = (await shapes(LAYERS.waterlooParcels, a, "PIN,PARCELTYPE"))[0];
    if (p) {
      parcel = outer(p.rings);
      pin = p.attributes.PIN ? String(p.attributes.PIN) : null;
      sources.push("City of Waterloo property fabric");
    }
  } else if (a.municipality === "Cambridge") {
    const number = a.address.split(" ")[0];
    const all = await shapes(LAYERS.cambridgeParcels, a, "PIN,HOUSE_NUMBER");
    const p = all.find((x) => String(x.attributes.HOUSE_NUMBER) === number) ?? (all.length === 1 ? all[0] : null);
    if (p) {
      parcel = outer(p.rings);
      pin = p.attributes.PIN ? String(p.attributes.PIN) : null;
      sources.push("City of Cambridge parcel map");
    }
  } else if (a.municipality === "Kitchener" && process.env.PROPERTY_KITCHENER !== "0") {
    const p = (await shapes(LAYERS.kitchenerZoning, a, "LEGAL_DESCRIPTION,ROLL_NUMBER"))[0];
    if (p) {
      parcel = outer(p.rings);
      legal = p.attributes.LEGAL_DESCRIPTION ? String(p.attributes.LEGAL_DESCRIPTION).trim() : null;
      roll = p.attributes.ROLL_NUMBER ? String(p.attributes.ROLL_NUMBER) : null;
      sources.push("City of Kitchener zoning map");
    }
  }
  // Buildings within a few metres of the point; the biggest residential one is the house.
  const buildings = (await shapes(LAYERS.footprints, a, "FootprintSqft,BuildingType", "&distance=40&units=esriSRUnit_Meter"))
    .map((b) => ({ ring: outer(b.rings), type: String(b.attributes.BuildingType ?? "") }))
    .filter((b): b is { ring: Ring; type: string } => Boolean(b.ring));
  const onLot = (r: Ring) => {
    if (!parcel) return true;
    const cx = r.reduce((s, p) => s + p[0], 0) / r.length, cy = r.reduce((s, p) => s + p[1], 0) / r.length;
    return pointInRing([cx, cy], parcel);
  };
  const near = buildings.filter((b) => onLot(b.ring));
  const house = near.filter((b) => !b.type || /resid/i.test(b.type)).sort((p, q) => ringArea(q.ring) - ringArea(p.ring))[0] ?? null;
  return {
    origin: { lon: a.lon, lat: a.lat },
    parcel,
    footprint: house?.ring ?? null,
    others: near.filter((b) => b !== house).map((b) => b.ring),
    pin,
    legalDescription: legal,
    rollNumber: roll,
    aerial: { halfWidthM: Math.round(AERIAL.dx * m.lon * 100) / 100, halfHeightM: Math.round(AERIAL.dy * m.lat * 100) / 100 },
    sources,
  };
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

// A square of 2026 aerial photo around the house, about 70 m across. Region of Waterloo, 10 cm.
export async function fetchAerial(lon: number, lat: number, size = 720): Promise<Buffer> {
  const { dx, dy } = AERIAL;
  const bbox = [lon - dx, lat - dy, lon + dx, lat + dy].join(",");
  const url = `https://gis.regionofwaterloo.ca/waimagery/rest/services/Imagery_2026/ImageServer/exportImage?bbox=${bbox}&bboxSR=4326&imageSR=3857&size=${size},${size}&format=jpg&f=image`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("image")) throw new Error(`aerial ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
