// Opens a downloaded PDF: its page count and each page's text, enough to check the permit package's
// sheets and the book. It reads the text pdf-lib writes with the standard fonts (our drawings) and with
// embedded fonts (the book's Hanken Grotesk and Geist Mono, through each font's ToUnicode map); a city's
// own form pages show up as pages with little or no text.
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, type PDFObject } from "pdf-lib";

function streamsOf(contents: PDFObject | undefined, doc: PDFDocument): PDFRawStream[] {
  if (!contents) return [];
  const obj = doc.context.lookup(contents);
  if (obj instanceof PDFRawStream) return [obj];
  if (obj instanceof PDFArray) return obj.asArray().flatMap((o) => streamsOf(o, doc));
  return [];
}

// An embedded font's ToUnicode map: two-byte glyph codes to text (bfchar and bfrange entries).
type CMap = Map<number, string>;
function cmapOf(stream: PDFRawStream): CMap {
  const src = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
  const map: CMap = new Map();
  const uni = (h: string) => Buffer.from(h, "hex").swap16().toString("utf16le");
  for (const block of src.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(parseInt(m[1], 16), uni(m[2]));
  for (const block of src.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/g)) {
      const [lo, hi] = [parseInt(m[1], 16), parseInt(m[2], 16)];
      if (m[3].startsWith("[")) [...m[3].matchAll(/<([0-9A-Fa-f]+)>/g)].forEach((d, i) => map.set(lo + i, uni(d[1])));
      else for (let c = lo, u = parseInt(m[3].slice(1, -1), 16); c <= hi; c++, u++) map.set(c, String.fromCodePoint(u));
    }
  return map;
}

// The page's fonts that carry a ToUnicode map, by resource name (/F1 …).
function cmapsOf(page: PDFDict, doc: PDFDocument): Map<string, CMap> {
  const out = new Map<string, CMap>();
  const resources = doc.context.lookup(page.get(PDFName.of("Resources")));
  const fonts = resources instanceof PDFDict ? doc.context.lookup(resources.get(PDFName.of("Font"))) : null;
  if (!(fonts instanceof PDFDict)) return out;
  for (const [name, ref] of fonts.entries()) {
    const font = doc.context.lookup(ref);
    const to = font instanceof PDFDict ? font.get(PDFName.of("ToUnicode")) : null;
    const stream = to instanceof PDFRef ? doc.context.lookup(to) : null;
    if (stream instanceof PDFRawStream) out.set(name.asString(), cmapOf(stream));
  }
  return out;
}

// Text-showing operators: <hex> Tj, (literal) Tj and [..] TJ, decoded through the current font (Tf).
function textOf(ops: string, cmaps: Map<string, CMap>): string {
  const out: string[] = [];
  let cmap: CMap | undefined;
  const unhex = (h: string) => {
    const hex = h.replace(/\s/g, "");
    if (!cmap) return Buffer.from(hex, "hex").toString("latin1");
    let t = "";
    for (let i = 0; i + 4 <= hex.length; i += 4) t += cmap.get(parseInt(hex.slice(i, i + 4), 16)) ?? "";
    return t;
  };
  const unlit = (l: string) => l.replace(/\\([()\\])/g, "$1");
  for (const m of ops.matchAll(/(\/[^\s/<>\[\]()]+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f\s]*)>\s*Tj|\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:[^\]])*)\]\s*TJ/g)) {
    if (m[1] != null) cmap = cmaps.get(m[1]);
    else if (m[2] != null) out.push(unhex(m[2]));
    else if (m[3] != null) out.push(unlit(m[3]));
    else out.push([...m[4].matchAll(/<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^\\)])*)\)/g)].map((p) => (p[1] != null ? unhex(p[1]) : unlit(p[2]))).join(""));
  }
  return out.join("\n");
}

export async function readPdf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = doc.getPages().map((p) => {
    const cmaps = cmapsOf(p.node, doc);
    const text = streamsOf(p.node.Contents(), doc)
      .map((s) => textOf(Buffer.from(decodePDFRawStream(s).decode()).toString("latin1"), cmaps))
      .join("\n");
    const { width, height } = p.getSize();
    return { width, height, text };
  });
  // Every drawing's title block lists the whole set ("A0  Cover and key plan") and prints its own number
  // on a line by itself (server/permit/pdf.ts frame): "A2", or "A2.1" and "A2.2" when a plan takes two sheets.
  const sheets = pages.flatMap((p, i) => {
    const lines = p.text.split("\n").map((l) => l.trim());
    const number = lines.find((l) => /^A\d{1,2}(\.\d+)?$/.test(l));
    return number ? [{ page: i + 1, number }] : [];
  });
  const index = new Map<string, string>();
  for (const p of pages) for (const m of p.text.matchAll(/^(A\d{1,2}) {2}(.+)$/gm)) index.set(m[1], m[2].trim());
  return { title: doc.getTitle() ?? null, pageCount: pages.length, pages, sheets, index: Object.fromEntries(index) };
}
