// Address type-ahead for all of Ontario.
// 1. Waterloo Region first: our own copy of the Region's open address list (scripts/fetch-addresses.ts,
//    Region of Waterloo Open Data Licence v2.0). Kept in memory: 169k rows, a few MB, answers in a
//    millisecond, and the house's public records follow.
// 2. Anywhere else in Ontario: Natural Resources Canada's Geolocator (geolocator.api.geo.ca, free, no
//    key), asked from the server, only its own "locate" source (not OpenStreetMap's), cached, and
//    limited to Ontario. It names the municipality, so the rules can too. NRCan's older Geolocation
//    API (geogratis.gc.ca) shuts down on 2027-03-31; this is its replacement.
// 3. Outside Ontario: a clear "Basement Ready covers Ontario" instead of a silent empty list.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { cleanAuthority, placeSlug, shortName } from "./rules";

export type Address = {
  address: string;
  municipality: string; // the name people use: "Kitchener", "Woolwich", "Toronto"
  city: string | null; // the rules: a pack's slug, or "on:<legal name>" for anywhere else in Ontario
  lon: number;
  lat: number;
  units: number;
  // Where the point came from. Waterloo Region's open data brings the house's records; NRCan only
  // places the street number on its road (an interpolated position), so there are no records.
  source?: "region" | "ontario";
};

export type NotCovered = { where: string | null; message: string };
export type AddressSearch = { results: Address[]; notCovered: NotCovered | null };

type Row = [string, string, number, number, number];

// Our rules packs by municipality. The townships get Ontario's pack plus the Region's programs.
const CITY: Record<string, string> = { Waterloo: "waterloo-on", Kitchener: "kitchener-on", Cambridge: "cambridge-on" };
// The legal names of the Region's other municipalities (and the one Brant address in the list).
const AUTHORITY: Record<string, string> = {
  Woolwich: "Township of Woolwich",
  Wilmot: "Township of Wilmot",
  "North Dumfries": "Township of North Dumfries",
  Wellesley: "Township of Wellesley",
  Brant: "County of Brant",
};

// What people type versus how the Region writes street types.
const STREET_TYPES: Record<string, string> = {
  street: "st", avenue: "ave", road: "rd", drive: "dr", crescent: "cres", court: "crt", boulevard: "blvd",
  place: "pl", circle: "cir", terrace: "terr", parkway: "pky", square: "sq", highway: "hwy", gate: "gate",
};
const CITY_WORDS = /\b(waterloo|kitchener|cambridge|ontario|on|canada)\b/g;
// The Region's townships and villages, which the list leaves out: dropped only when typed after the
// street ("10 Woolwich St Breslau"), never from the street name itself ("10 Woolwich St").
const PLACE_AT_END =
  /\s+(woolwich|wilmot|wellesley|north dumfries|elmira|breslau|st\.?\s+jacobs|conestogo|st\.?\s+clements|bloomingdale|maryhill|new hamburg|baden|petersburg|new dundee|ayr|heidelberg|linwood|hespeler|preston|galt)\s*$/i;

let rows: Row[] | null = null;
let keys: string[] = [];

function load() {
  if (rows) return;
  rows = JSON.parse(gunzipSync(readFileSync("data/addresses.json.gz")).toString("utf8")) as Row[];
  keys = rows.map((r) => normalize(r[0]));
  // Sorted keys let a typed house number find its matches by binary search.
  const order = keys.map((_, i) => i).sort((a, b) => (keys[a] < keys[b] ? -1 : keys[a] > keys[b] ? 1 : 0));
  rows = order.map((i) => rows![i]);
  keys = order.map((i) => keys[i]);
}

export function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(CITY_WORDS, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET_TYPES[w] ?? w)
    .join(" ");
}

const regionCity = (municipality: string) => CITY[municipality] ?? (AUTHORITY[municipality] ? placeSlug(AUTHORITY[municipality]) : null);
const toAddress = (r: Row): Address => ({ address: r[0], municipality: r[1], city: regionCity(r[1]), lon: r[2], lat: r[3], units: r[4], source: "region" });

// Waterloo Region only, from the list in memory.
export function searchAddresses(query: string, limit = 6): Address[] {
  load();
  const q = normalize(query.replace(/,?\s*(ontario|on|canada)\s*$/i, "").replace(PLACE_AT_END, ""));
  if (q.length < 2) return [];
  const out: Row[] = [];
  if (/^\d/.test(q)) {
    // "295 lester" → every key starting with it.
    let lo = 0, hi = keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (keys[mid] < q) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < keys.length && keys[i].startsWith(q) && out.length < limit; i++) out.push(rows![i]);
  } else {
    // A street name without a number: its first few houses, so people see they're on the right street.
    for (let i = 0; i < keys.length && out.length < limit; i++) if (keys[i].includes(` ${q}`)) out.push(rows![i]);
  }
  return out.map(toAddress);
}

// ---- Outside Waterloo Region --------------------------------------------------------------------

const GEOLOCATOR = "https://geolocator.api.geo.ca/";
const PROVINCES: Record<string, string> = {
  A: "Newfoundland and Labrador", B: "Nova Scotia", C: "Prince Edward Island", E: "New Brunswick", G: "Quebec", H: "Quebec", J: "Quebec",
  R: "Manitoba", S: "Saskatchewan", T: "Alberta", V: "British Columbia", X: "the Northwest Territories or Nunavut", Y: "Yukon",
};
const US_STATES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY";
const US_NAMES =
  /\b(usa|u\.s\.a?\.?|united states|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i;

export const COVERS_ONTARIO = "Basement Ready covers Ontario. Try the demo house to see a full answer.";

// Text that can't be an Ontario address, without asking anyone: a US state or ZIP code, or a postal
// code from another province.
export function outsideOntario(text: string): NotCovered | null {
  const t = text.trim();
  const postal = t.toUpperCase().match(/\b([A-Z])\d[A-Z]\s?\d[A-Z]\d\b/);
  if (postal && !"KLMNP".includes(postal[1])) {
    const where = PROVINCES[postal[1]] ?? null;
    return { where, message: `That postal code is in ${where ?? "another province"}. ${COVERS_ONTARIO}` };
  }
  if (US_NAMES.test(t) || new RegExp(`,\\s*(${US_STATES})\\b(\\s+\\d{5}(-\\d{4})?)?\\s*$`).test(t) || /\b\d{5}(-\d{4})?\s*$/.test(t)) {
    return { where: "the United States", message: `That looks like a US address. ${COVERS_ONTARIO}` };
  }
  if (/\b(quebec|québec|manitoba|saskatchewan|alberta|british columbia|nova scotia|new brunswick|newfoundland|prince edward island|yukon|nunavut|northwest territories)\b/i.test(t)) {
    return { where: null, message: `That's outside Ontario. ${COVERS_ONTARIO}` };
  }
  return null;
}

type Located = { key: string; name: string; province: string; category: string; lat: number; lng: number; tag?: string[] | null };

// "45 Elm Crescent, City Of Ottawa, Ontario" → the street address and the municipality.
export function fromLocate(r: Located): Address | null {
  if (r.key !== "locate" || r.category !== "Street" || !(r.tag ?? []).includes("INTERPOLATED_POSITION")) return null;
  if (r.province !== "Ontario") return null;
  const parts = r.name.split(",").map((p) => p.trim());
  if (parts.length < 3 || !/^\d/.test(parts[0])) return null;
  const authority = cleanAuthority(parts[parts.length - 2]);
  if (!authority) return null;
  const name = shortName(authority);
  return {
    address: parts[0].slice(0, 120),
    municipality: name,
    // A Region city found this way still gets its own pack.
    city: CITY[name] ?? placeSlug(authority),
    lon: Math.round(r.lng * 1e6) / 1e6,
    lat: Math.round(r.lat * 1e6) / 1e6,
    units: 0,
    source: "ontario",
  };
}

const remote = new Map<string, { at: number; hits: Located[] }>();
const inFlight = new Map<string, Promise<Located[]>>();
const DAY = 24 * 3600 * 1000;

// One NRCan lookup per distinct text a day; the same text asked twice at once shares one request.
async function locate(text: string, fetcher: typeof fetch): Promise<Located[]> {
  const key = text.toLowerCase().replace(/\s+/g, " ").trim();
  const hit = remote.get(key);
  if (hit && Date.now() - hit.at < DAY) return hit.hits;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const p = (async () => {
    try {
      const res = await fetcher(`${GEOLOCATOR}?q=${encodeURIComponent(key)}&keys=locate&lang=en`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return []; // a failure isn't an answer: ask again next time
      const json = await res.json();
      const hits = Array.isArray(json) ? (json as Located[]) : [];
      if (remote.size > 2000) remote.clear();
      remote.set(key, { at: Date.now(), hits });
      return hits;
    } catch {
      return [];
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, p);
  return p;
}

// What we offered, so the address picked from the list resolves to the same point later.
const offered = new Map<string, Address>();
const keyOf = (a: Pick<Address, "address" | "municipality">) => `${a.address}|${a.municipality}`.toLowerCase();
function remember(key: string, a: Address) {
  if (offered.size > 5000) offered.clear();
  offered.set(key, a);
}

// Worth asking NRCan: a house number and a street word, long enough to be more than a start.
const askable = (text: string) => /\d/.test(text) && /\p{L}{3,}/u.test(text) && text.trim().length >= 6;

// The type-ahead: the Region's list first, then the rest of Ontario, else a clear "not covered".
export async function searchOntario(query: string, limit = 6, fetcher: typeof fetch = fetch): Promise<AddressSearch> {
  const text = query.trim().slice(0, 120);
  const outside = outsideOntario(text);
  if (outside) return { results: [], notCovered: outside };
  const region = searchAddresses(text, limit);
  if (region.length || !askable(text)) return { results: region, notCovered: null };
  const hits = await locate(text, fetcher);
  const results = new Map<string, Address>();
  for (const a of hits.map(fromLocate)) if (a && results.size < limit) results.set(keyOf(a), a);
  for (const [k, a] of results) remember(k, a);
  if (results.size) return { results: [...results.values()], notCovered: null };
  // Only street addresses elsewhere in Canada: say so, rather than an empty list.
  const elsewhere = hits.find((h) => h.key === "locate" && h.category === "Street" && (h.tag ?? []).includes("INTERPOLATED_POSITION") && h.province && h.province !== "Ontario");
  if (elsewhere) return { results: [], notCovered: { where: elsewhere.province, message: `We only found that address in ${elsewhere.province}. ${COVERS_ONTARIO}` } };
  return { results: [], notCovered: null };
}

// The client sends back the text it picked; the server finds the point again, from the Region's list
// or NRCan (usually from the cache), and never trusts coordinates from the browser.
export async function resolveAddress(address: unknown, municipality: unknown, fetcher: typeof fetch = fetch): Promise<Address | null> {
  const text = String(address ?? "").slice(0, 120).trim();
  if (!text) return null;
  const want = municipality ? String(municipality) : null;
  const same = (a: Address) => a.address.toLowerCase() === text.toLowerCase() && (!want || a.municipality === want);
  const region = searchAddresses(text, 10).find(same);
  if (region) return region;
  if (!askable(text)) return null;
  if (want && offered.has(keyOf({ address: text, municipality: want }))) return offered.get(keyOf({ address: text, municipality: want }))!;
  for (const q of want ? [`${text}, ${want}`, text] : [text]) {
    const hit = (await locate(q, fetcher)).map(fromLocate).find((a): a is Address => a !== null && same(a));
    if (hit) return hit;
  }
  return null;
}
