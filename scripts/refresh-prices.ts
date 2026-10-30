// Refresh the shelf prices in data/rules/prices-on.json from Home Depot Canada, the way Gablebird gets
// them: the public Apify actor yugenox~home-depot-canada-scraper, run offline (never by the app), at
// the Home Depot stores nearest Waterloo Region. A row counts only when it's in CAD, at an Ontario
// store, with a 10-digit SKU and a homedepot.ca https link, and its name matches the product we
// asked for at the same pack size. Every existing entry and its source stays; a store price we found
// is added beside it as an offer. Anything not found is listed under `missing`, never guessed.
//
//   APIFY_TOKEN=... pnpm tsx scripts/refresh-prices.ts           run the actor (it costs money), then write
//   pnpm tsx scripts/refresh-prices.ts --dataset <id|file.json>  use the rows of a run already made
//   ... --dry                                                     print what would change, write nothing
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = new URL("../data/rules/prices-on.json", import.meta.url);
const ACTOR = "yugenox~home-depot-canada-scraper";
const NEAR = "N2J 1N8"; // uptown Waterloo
const STORES = 2;
const PER_QUERY = 5;

type Row = { query?: string; name?: string; brand?: string; sku?: string; price?: number; currency?: string; storeId?: string; storeName?: string; storeCity?: string; storeProvince?: string; url?: string; position?: number; onSale?: boolean; wasPrice?: number | null; dataType?: string };

// What to look for: the search, a name it must match (and must not), and for a new item what it is.
// `per` for a new item: how much one unit covers in the quote's own unit, read off the product name.
type Add = { item: string; unit: string; coverage: string; per: number | null; perFrom?: (name: string) => number | null };
type Target = { id: string; search: string; want: RegExp[]; avoid?: RegExp; productId?: string; add?: Add };

const T = (id: string, search: string, want: RegExp | RegExp[], avoid?: RegExp, add?: Add, productId?: string): Target => ({ id, search, want: Array.isArray(want) ? want : [want], avoid, add, productId });
const EACH = (item: string, coverage = "one"): Add => ({ item, unit: "each", coverage, per: 1 });
const num = (re: RegExp) => (name: string) => {
  const m = re.exec(name);
  return m ? Number.parseFloat(m[1]) : null;
};

export const TARGETS: Target[] = [
  // Framing
  T("stud_2x4_8", "2x4x8 stud", [/\b2\s*-?(in(ch)?|")?\s*x\s*4\s*-?(in(ch)?|")?\s*x\s*(8\s*-?\s*(ft\.?|feet|')|96)/i], /treated|metal|steel|truss|precut|92/i),
  T("pt_2x4_8", "2x4x8 pressure treated lumber", [/\b2\s*-?(in(ch)?|")?\s*x\s*4\s*-?(in(ch)?|")?\s*x\s*8\s*(ft|feet|')/i, /treated/i]),
  T("concrete_fasteners", "Tapcon 1/4 x 2-1/4 concrete screws 100", [/tapcon|concrete screw/i, /1\/4/, /2[- ]1\/4/, /\b100(?!\d)/]),
  T("framing_screws", "#8 x 3 inch construction screws", [/#?8\s*x\s*3/i, /screw/i, /\b1,?100(?!\d)/], /drywall/i),
  T("sill_gasket", "foam sill gasket", [/sill/i, /gasket|seal/i], undefined, { item: "Foam sill gasket under bottom plates on the slab", unit: "roll", coverage: "one roll (length in ft)", per: null, perFrom: num(/(\d+(?:\.\d+)?)\s*-?\s*(?:ft|feet)\b/i) }),
  // Drywall
  T("drywall_typex_58", "5/8 type x drywall 4x8", [/5\/8/, /type\s*x|fire/i, /4\s*(ft\.?|feet|')?\s*x\s*8/i], /12\s*(ft\.?|feet|')|10\s*(ft\.?|feet|')/i),
  T("drywall_regular_12", "1/2 inch drywall 4x8", [/1\/2/, /4\s*(ft\.?|feet|')?\s*x\s*8/i], /moisture|mold|mould|type\s*x|fire|sound|12\s*(ft\.?|feet|')/i),
  T("drywall_mr_12", "1/2 moisture resistant drywall 4x8", [/1\/2/, /moisture|mold|mould/i, /4\s*(ft\.?|feet|')?\s*x\s*8/i]),
  T("joint_compound", "all purpose joint compound 17 L", [/compound/i, /\b17\s*l/i], /quick|setting|90|45|20 ?min/i),
  T("drywall_tape", "paper drywall tape 500 ft", [/tape/i, /paper/i, /500\s*(ft\.?|feet|')/i], /mesh/i),
  T("drywall_screws", "drywall screws 1-1/4 1000", [/drywall/i, /1[- ]1\/4/, /\b1,?000(?!\d)/], /collated|steel/i),
  T("resilient_channel", "resilient channel 12 ft", [/resilient/i, /12\s*(ft\.?|feet|')/i]),
  // Insulation and sound
  T("insul_r14_comfortbatt", "ROCKWOOL R14 Comfortbatt", [/comfortbatt/i, /r\s*14/i, /59\.7/], undefined, undefined, "1000122327"),
  T("insul_safe_n_sound", "ROCKWOOL Safe n Sound 3 inch", [/safe.?n.?sound/i, /59\.7/], undefined, undefined, "1000421954"),
  T("poly_6mil", "6 mil vapour barrier 10 x 100", [/6\s*mil/i, /10\s*(ft\.?|feet|')?\s*x\s*100/i]),
  T("acoustic_sealant", "acoustical sealant", [/acoust/i, /seal/i]),
  T("sheathing_tape", "Tuck Tape sheathing tape 60 mm x 55 m", [/tuck|sheathing/i, /60\s*mm/i, /55\s*m/i]),
  // Flooring and trim
  T("underlay", "vinyl plank flooring underlay", [/underlay/i], /laminate only|carpet|tile/i, { item: "Underlay for vinyl plank flooring", unit: "roll", coverage: "one roll (sq ft)", per: null, perFrom: num(/(\d+(?:\.\d+)?)\s*sq\.?\s*ft/i) }),
  T("baseboard_mdf", "MDF baseboard primed", [/baseboard/i, /mdf/i]),
  T("casing_mdf", "MDF casing primed 7 ft", [/casing/i, /mdf/i, /10[- ]?pack/i, /\b(7\s*(ft\.?|feet|')|84)/i]), // same pack as the RONA entry: 10 x 7 ft
  // Doors
  T("door_prehung_30", "30 x 80 prehung interior door", [/30\s*-?(in|inch|")?\s*x\s*80/i, /pre.?hung/i, /interior/i], /exterior|steel|front|hidden|shel/i),
  T("door_prehung_32", "32 x 80 prehung interior door", [/32\s*-?(in|inch|")?\s*x\s*80/i, /pre.?hung/i, /interior/i], /exterior|steel|front|hidden|shel/i),
  T("door_fire_20min", "20 minute fire rated door", [/20[- ]?min/i, /fire/i, /door/i], undefined, EACH("20-minute fire-rated pre-hung door between the two homes (steel; check it suits an inside doorway)", "one door")),
  T("door_closer", "spring hinge 3-1/2 inch", [/spring/i, /hinge/i]),
  T("lever_privacy", "privacy door lever", [/privacy/i, /lever/i]),
  T("lever_passage", "passage door lever", [/passage|hall/i, /lever/i]),
  // Alarms
  T("alarm_combo_hardwired", "hardwired smoke and carbon monoxide alarm", [/smoke/i, /carbon|\bco\b/i, /hard.?wired|120\s*v/i]),
  T("alarm_smoke_hardwired", "hardwired smoke alarm with strobe", [/smoke/i, /strobe/i, /hard.?wire/i], /combination|carbon|\bco\b|pack/i),
  T("alarm_combo_strobe", "hardwired smoke alarm with strobe", [/smoke/i, /\bco\b|carbon/i, /strobe/i, /hard.?wire/i, /interconnect/i], /pack/i, EACH("Hard-wired interconnected smoke and CO alarm with a strobe", "one alarm")),
  T("alarm_strobe", "smoke alarm strobe light", [/strobe/i, /smoke/i], /combination|carbon|\bco\b|pack/i),
  T("alarm_co_hardwired", "hardwired carbon monoxide alarm", [/carbon|\bco\b/i, /hard.?wired|120\s*v/i], /smoke/i),
  // Windows
  T("egress_window", "basement egress window", [/window/i, /egress|basement|slider/i], /well|cover|film|blind/i),
  T("window_well", "basement window well", [/window\s*well/i, /\b(2[2-9]|[3-4]\d)\s*(in\.?|")?\s*p\b/i], /cover|ladder/i), // at least 22 in (550 mm) out from the window
  // Electrical
  T("receptacle_tr_15a", "15 amp tamper resistant receptacle 10 pack", [/tamper/i, /15\s*a/i, /10[- ]?pack|\(10\)|10 ?pk/i]),
  T("receptacle_tr_20a", "20 amp tamper resistant receptacle", [/tamper/i, /20\s*a/i], /gfci|usb/i, EACH("20 A tamper-resistant receptacle (kitchen counter)", "one receptacle")),
  T("receptacle_gfci", "15 amp GFCI receptacle tamper resistant", [/gfci/i, /15\s*a/i], /2[- ]?pack|usb/i),
  T("switch_single", "single pole light switch white", [/single.?pole/i, /switch/i], /dimmer|smart|10[- ]?pack/i),
  T("pot_light_4in", "4 inch slim LED recessed light", [/4\s*-?(in|inch|")/i, /recessed|pot|slim/i, /\b8[- ]?pack|\(8\)/i]), // same pack as the RONA entry: 8 lights
  T("bath_fan", "bathroom exhaust fan 80 CFM", [/fan/i, /\b(5\d|[6-9]\d|1\d\d)\s*cfm/i], /light only|switch/i),
  T("device_box", "single gang device box plastic", [/box/i, /device|switch|outlet/i], /cover|plate|pack/i),
  T("wire_14_2", "NMD90 14/2 75 m", [/14\/2/, /75\s*m/i]),
  T("wire_12_2", "NMD90 12/2 75 m", [/12\/2/, /75\s*m/i]),
  T("breaker_afci_15", "15 amp AFCI breaker", [/arc|afci/i, /15\s*a/i]),
  // Plumbing and fixtures
  T("toilet", "two piece elongated toilet", [/toilet/i], /seat only|wax|plunger|tank only/i),
  T("vanity", "24 inch bathroom vanity with top", [/vanity/i, /24\s*-?(in|inch|")/i], /mirror|light|cabinet only/i),
  T("bath_faucet", "4 inch centerset bathroom faucet", [/faucet/i, /centerset|centreset|4\s*-?(in|inch|")/i]),
  T("tub", "60 x 30 alcove bathtub", [/60/, /30/, /tub/i], /wall|surround|door|faucet/i),
  T("tub_walls", "60 x 30 tub wall kit", [/60/, /wall|surround/i, /tub|bath/i]),
  T("kitchen_sink", "double kitchen sink stainless 31 x 20", [/sink/i, /double/i, /stainless/i], /faucet|strainer/i),
  T("kitchen_faucet", "pull down kitchen faucet", [/kitchen/i, /faucet/i]),
  T("pex_12", "1/2 inch PEX pipe 100 ft", [/pex/i, /1\/2/, /100\s*(ft\.?|feet|')/i]),
  T("abs_3", "3 inch ABS pipe 12 ft", [/abs/i, /3\s*-?(in|inch|")/i, /12\s*(ft\.?|feet|')/i]),
  T("abs_1_5", "1-1/2 inch ABS pipe 12 ft", [/abs/i, /1[- ]1\/2/i, /12\s*(ft\.?|feet|')/i]),
  T("shutoff_valve", "angle stop valve 1/2 x 3/8 2 pack", [/angle|stop/i, /1\/2/, /3\/8/, /2[- ]?pack|\(2\)|2 ?pk/i]),
  T("shutoff_main", "3/4 inch ball valve", [/ball valve/i, /3\/4/], undefined, EACH("3/4\" full-port ball valve: the suite's own shut-off", "one valve")),
  T("mixing_valve", "thermostatic mixing valve", [/thermostatic|mixing|tempering/i, /valve/i], undefined, EACH("Thermostatic mixing valve (hot water held to 49 °C)", "one valve")),
  T("laundry_box", "washing machine outlet box", [/washing|washer|laundry/i, /box/i], undefined, EACH("Recessed washer outlet box with valves", "one box")),
  T("dryer_vent_kit", "dryer vent kit 4 inch", [/dryer/i, /vent/i, /kit/i], /indoor|to duct|cu\.?\s*ft/i, EACH("4\" dryer vent kit to the outside", "one kit")),
  // Kitchen
  T("cabinet_base_30", "30 inch base cabinet 2 door", [/base/i, /cabinet/i, /30\s*-?(in|inch|")/i], /wall|sink base/i),
  T("cabinet_wall_30", "30 x 30 wall cabinet", [/wall/i, /cabinet/i, /30\s*-?(in|inch|")/i], /base/i),
  T("countertop_8ft", "8 ft laminate countertop", [/countertop/i, /8\s*(ft\.?|feet|')|96/i, /laminate/i]),
  // Paint
  T("primer", "interior drywall primer 3.78 L", [/primer/i, /3\.7\d?\s*l/i], /exterior|spray/i),
  T("paint_walls", "interior paint eggshell 3.78 L", [/interior/i, /eggshell/i, /3\.7\d?\s*l/i]),
  T("paint_ceiling", "ceiling paint flat white 3.78 L", [/ceiling/i, /3\.7\d?\s*l/i]),
];

export const keep = (r: Row) => r.currency === "CAD" && r.storeProvince === "ON" && /^\d{10}$/.test(r.sku ?? "") && /^https:\/\/www\.homedepot\.ca\//.test(r.url ?? "") && typeof r.price === "number" && r.price > 0;
const matches = (t: Target, r: Row) => {
  const name = `${r.brand ?? ""} ${r.name ?? ""}`;
  return t.want.every((re) => re.test(name)) && !(t.avoid && t.avoid.test(name));
};

// The best match for each target at the first store, and the same SKU's price at every store.
export function pick(rows: Row[]) {
  const ok = rows.filter(keep);
  const first = ok.find((r) => r.query)?.storeId ?? ok[0]?.storeId;
  return TARGETS.map((t) => {
    const mine = ok.filter((r) => (t.productId && r.sku === t.productId) || r.query === t.search);
    const best = mine.filter((r) => r.storeId === first && matches(t, r)).sort((a, b) => (a.position ?? 99) - (b.position ?? 99))[0] ?? mine.filter((r) => matches(t, r))[0] ?? null;
    const offers = best ? [...new Map(ok.filter((r) => r.sku === best.sku).map((r) => [r.storeId, r])).values()] : [];
    return { target: t, best, offers };
  });
}

async function runActor(token: string): Promise<Row[]> {
  const input = {
    searchTerms: [...new Set(TARGETS.filter((t) => !t.productId).map((t) => t.search))],
    productIds: TARGETS.filter((t) => t.productId).map((t) => t.productId),
    nearLocation: NEAR,
    nearestStores: STORES,
    maxItemsPerQuery: PER_QUERY,
    language: "en",
    includeStoreRows: true,
  };
  const res = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?maxTotalChargeUsd=2&timeout=900`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  if (!res.ok) throw new Error(`Apify said ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as Row[];
}

async function rowsFrom(dataset: string, token?: string): Promise<Row[]> {
  if (dataset.endsWith(".json")) return JSON.parse(readFileSync(dataset, "utf8"));
  const res = await fetch(`https://api.apify.com/v2/datasets/${encodeURIComponent(dataset)}/items?clean=true&format=json`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
  if (!res.ok) throw new Error(`Couldn't read dataset ${dataset}: ${res.status}`);
  return (await res.json()) as Row[];
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

export function apply(catalog: any, picks: ReturnType<typeof pick>, checked: string) {
  const items: any[] = catalog.items;
  const missing: any[] = (catalog.missing ?? []).filter((m: any) => !picks.some((p) => p.target.id === m.id));
  const changes: string[] = [];
  for (const { target: t, best, offers } of picks) {
    const have = items.find((i) => i.id === t.id);
    if (!best) {
      if (!have) missing.push({ id: t.id, item: t.add?.item ?? t.id, searched: `Home Depot Canada, "${t.search}", ${STORES} stores near Waterloo`, checked });
      changes.push(`${t.id}: not found at Home Depot${have ? " (keeps its RONA price)" : " (missing)"}`);
      continue;
    }
    const hd = offers.map((r) => ({ retailer: "Home Depot Canada", store: `Home Depot ${r.storeName ?? r.storeCity ?? ""} (#${r.storeId})`.replace(/\s+/g, " "), storeId: r.storeId ?? null, priceCAD: r.price!, url: r.url!, sku: r.sku!, checked }));
    if (have) {
      // The existing entry and its source stay as they are; Home Depot's prices go beside it.
      const others = (have.offers ?? []).filter((o: any) => o.retailer !== "Home Depot Canada");
      have.offers = [...others, ...hd];
      if (have.retailer === "Home Depot Canada" && have.url === best.url) have.sku = best.sku;
      changes.push(`${t.id}: ${best.name} $${best.price} (${hd.length} stores)`);
    } else {
      const per = t.add?.perFrom ? t.add.perFrom(best.name ?? "") : (t.add?.per ?? null);
      if (t.add?.perFrom && !per) {
        missing.push({ id: t.id, item: t.add.item, searched: `Home Depot Canada, "${t.search}": found "${best.name}" but couldn't read its size`, checked });
        changes.push(`${t.id}: found ${best.name} but couldn't read its size (missing)`);
        continue;
      }
      items.push({
        id: t.id,
        item: t.add?.item ?? t.id,
        product: best.name,
        unit: t.add?.unit ?? "each",
        coverage: t.add?.coverage ?? "one",
        per,
        priceCAD: best.price,
        retailer: "Home Depot Canada",
        store: hd.find((o) => o.sku === best.sku && o.storeId === best.storeId)?.store ?? hd[0].store,
        url: best.url,
        sku: best.sku,
        checked,
        offers: hd,
        note: "From the Home Depot Canada Apify refresh; check the pack size on the product page.",
      });
      changes.push(`${t.id}: NEW ${best.name} $${best.price}`);
    }
  }
  catalog.missing = missing;
  catalog.refreshed = { homeDepot: { actor: ACTOR, near: NEAR, stores: STORES, checked } };
  return changes;
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const di = args.indexOf("--dataset");
  const token = process.env.APIFY_TOKEN;
  let rows: Row[];
  if (di >= 0) rows = await rowsFrom(args[di + 1], token);
  else if (token) rows = await runActor(token);
  else throw new Error("Give an APIFY_TOKEN to run the actor, or --dataset <id|file.json> to read a run already made.");
  const products = rows.filter((r) => r.dataType !== "store");
  const kept = products.filter(keep);
  console.log(`${products.length} rows, ${kept.length} pass the CAD / Ontario / 10-digit SKU / homedepot.ca checks; stores: ${[...new Set(kept.map((r) => `${r.storeName} #${r.storeId}`))].join(", ")}`);
  const catalog = JSON.parse(readFileSync(FILE, "utf8"));
  const changes = apply(catalog, pick(products), today());
  for (const c of changes) console.log(`  ${c}`);
  if (dry) return;
  writeFileSync(FILE, JSON.stringify(catalog, null, 2) + "\n");
  console.log(`Wrote ${FILE.pathname}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
