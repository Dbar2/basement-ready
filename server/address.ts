// Address type-ahead for Waterloo Region, served from our own copy of the Region's open address
// list (scripts/fetch-addresses.ts). Kept in memory: 169k rows, a few MB, answers in a millisecond.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

export type Address = { address: string; municipality: string; city: string | null; lon: number; lat: number; units: number };

type Row = [string, string, number, number, number];

// Our rules packs by municipality. The townships get Ontario's rules with a "confirm locally" note.
const CITY: Record<string, string> = { Waterloo: "waterloo-on", Kitchener: "kitchener-on", Cambridge: "cambridge-on" };

// What people type versus how the Region writes street types.
const STREET_TYPES: Record<string, string> = {
  street: "st", avenue: "ave", road: "rd", drive: "dr", crescent: "cres", court: "crt", boulevard: "blvd",
  place: "pl", circle: "cir", terrace: "terr", parkway: "pky", square: "sq", highway: "hwy", gate: "gate",
};
const CITY_WORDS = /\b(waterloo|kitchener|cambridge|ontario|on|canada)\b/g;

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

const toAddress = (r: Row): Address => ({ address: r[0], municipality: r[1], city: CITY[r[1]] ?? null, lon: r[2], lat: r[3], units: r[4] });

export function searchAddresses(query: string, limit = 6): Address[] {
  load();
  const q = normalize(query);
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
