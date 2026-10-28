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

// A square of 2026 aerial photo around the house, about 70 m across. Region of Waterloo, 10 cm.
export async function fetchAerial(lon: number, lat: number, size = 720): Promise<Buffer> {
  const dx = 0.00045, dy = 0.00033;
  const bbox = [lon - dx, lat - dy, lon + dx, lat + dy].join(",");
  const url = `https://gis.regionofwaterloo.ca/waimagery/rest/services/Imagery_2026/ImageServer/exportImage?bbox=${bbox}&bboxSR=4326&imageSR=3857&size=${size},${size}&format=jpg&f=image`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("image")) throw new Error(`aerial ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
