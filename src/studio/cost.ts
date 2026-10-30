// Live cost in the studio: the quote itself (server/quote/quote.ts), by trade, labour and materials,
// with contingency and HST and a source per line. Pure and fast, so it reruns on every edit.
import type { Design, Model } from "../../server/model/types";
import { quote, type Quote } from "../../server/quote/quote";

export type { Quote };
export const quoteFor = (model: Model, design: Design): Quote => quote(model, design);

// What the numbers include, in one line.
export const basisOf = (q: Quote) =>
  `Hired out, with ${Math.round(q.contingency.pctLow * 100)}–${Math.round(q.contingency.pctHigh * 100)}% contingency and HST. Shelf prices checked ${q.checked}, labour at published rates.${q.missing.length ? ` ${q.missing.length} item${q.missing.length === 1 ? " has" : "s have"} no price yet and ${q.missing.length === 1 ? "isn't" : "aren't"} counted.` : ""} Built yourself: ${cad(q.diy.low)}–${cad(q.diy.high)}.`;

export const cad = (n: number) => `$${Math.round(n / 100) * 100 >= 1000 ? `${(Math.round(n / 100) / 10).toFixed(1)}k` : Math.round(n).toLocaleString("en-CA")}`;
