// The dated price catalog the quote reads: shelf prices with their store, SKU, link and the day they
// were checked (data/rules/prices-on.json), published labour and pro rates with their publisher, and
// the permit fees mirrored from the rules packs. Imported as JSON, not read from disk, so the browser
// runs the same quote as the server. A price that wasn't found is listed under `missing` and never
// gets a number.
import data from "../../data/rules/prices-on.json";

// One store's shelf price for an item. Home Depot rows come from the Apify refresh
// (scripts/refresh-prices.ts) and carry the store's 10-digit SKU; RONA rows were read on rona.ca.
export type Offer = { retailer: string; store: string; storeId?: string | null; priceCAD: number; url: string; sku?: string | null; checked: string };

export type CatalogItem = {
  id: string;
  item: string;
  product: string;
  unit: string;
  coverage?: string;
  per?: number | null; // how much one store unit covers, in the line's own unit
  priceCAD: number; // the price the materials list uses (server/diy/takeoff.ts)
  retailer: string;
  store: string;
  url: string;
  sku?: string | null;
  checked: string;
  note?: string;
  offers?: Offer[]; // every store price found, for the low-high range
};

export type Rate = {
  id: string;
  item: string;
  lowCAD: number;
  highCAD: number;
  unit: string; // "sqft", "lf", "each", "hour", "job"
  installed?: boolean; // the published figure includes materials
  region?: string;
  publisher: string;
  url: string;
  pageDate?: string | null;
  checked: string;
  note?: string;
  fromPack?: string; // the rules packs' costs item this mirrors (tests keep them equal)
};

export type PermitFee = { perUnitCAD?: number; perSqftCAD: number; minimumCAD?: number; extrasCAD?: number; estimate: boolean; title: string; url: string; checked: string };

// A piece of furniture's price range: a budget and a mid-range listing, each read on the retailer's own
// page. Some pieces are two buys (a bed frame and a mattress): the range adds them up, as `basis` says.
export type FurniturePrice = {
  id: string; // the model's furniture kind, or coffee_table / nightstand
  item: string;
  lowCAD: number;
  highCAD: number;
  basis: string;
  listings: { role: "low" | "high"; product: string; retailer: string; priceCAD: number; url: string; checked: string; note?: string }[];
};

export type Catalog = {
  compiledAt: string;
  hstPct: number;
  items: CatalogItem[];
  services: Rate[]; // pros a do-it-yourselfer still pays
  labour?: Rate[]; // trade labour, for the hired quote
  missing?: { id: string; item: string; searched: string; checked: string }[];
  furniture?: FurniturePrice[]; // optional furnishings, never in the build totals
  fees?: {
    permit: Record<string, PermitFee>; // by municipality slug
    esa: { homeowner: { upTo: number | null; CAD: number }[]; contractor: Rate | null; title: string; url: string; checked: string };
  };
};

export const catalog = data as unknown as Catalog;

const items = new Map(catalog.items.map((i) => [i.id, i]));
const rates = new Map([...catalog.services, ...(catalog.labour ?? [])].map((r) => [r.id, r]));

const furniture = new Map((catalog.furniture ?? []).map((f) => [f.id, f]));

export const item = (id: string) => items.get(id) ?? null;
export const furniturePrice = (id: string) => furniture.get(id) ?? null;
export const rate = (id: string) => rates.get(id) ?? null;

// The cheapest and dearest shelf price found for an item, across stores.
export function shelf(id: string): { low: number; high: number; item: CatalogItem } | null {
  const i = items.get(id);
  if (!i) return null;
  const prices = [i.priceCAD, ...(i.offers ?? []).map((o) => o.priceCAD)].filter((p) => Number.isFinite(p) && p > 0);
  if (!prices.length) return null;
  return { low: Math.min(...prices), high: Math.max(...prices), item: i };
}
