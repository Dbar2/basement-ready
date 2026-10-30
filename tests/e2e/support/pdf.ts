// Opens a downloaded PDF: its page count and each page's text, enough to check the permit package's
// sheets. It reads the text pdf-lib writes with the standard fonts (our drawings); a city's own form
// pages show up as pages with little or no text.
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream, type PDFObject } from "pdf-lib";

function streamsOf(contents: PDFObject | undefined, doc: PDFDocument): PDFRawStream[] {
  if (!contents) return [];
  const obj = doc.context.lookup(contents);
  if (obj instanceof PDFRawStream) return [obj];
  if (obj instanceof PDFArray) return obj.asArray().flatMap((o) => streamsOf(o, doc));
  return [];
}

// Text-showing operators: <hex> Tj, (literal) Tj and [..] TJ.
function textOf(ops: string): string {
  const out: string[] = [];
  const unhex = (h: string) => Buffer.from(h.replace(/\s/g, ""), "hex").toString("latin1");
  const unlit = (l: string) => l.replace(/\\([()\\])/g, "$1");
  for (const m of ops.matchAll(/<([0-9A-Fa-f\s]*)>\s*Tj|\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:[^\]])*)\]\s*TJ/g)) {
    if (m[1] != null) out.push(unhex(m[1]));
    else if (m[2] != null) out.push(unlit(m[2]));
    else out.push([...m[3].matchAll(/<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^\\)])*)\)/g)].map((p) => (p[1] != null ? unhex(p[1]) : unlit(p[2]))).join(""));
  }
  return out.join("\n");
}

export async function readPdf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = doc.getPages().map((p) => {
    const text = streamsOf(p.node.Contents(), doc)
      .map((s) => textOf(Buffer.from(decodePDFRawStream(s).decode()).toString("latin1")))
      .join("\n");
    const { width, height } = p.getSize();
    return { width, height, text };
  });
  // Every drawing's title block lists the whole set ("A0  Cover and key plan") and prints its own number
  // on a line by itself (server/permit/pdf.ts frame).
  const sheets = pages.flatMap((p, i) => {
    const lines = p.text.split("\n").map((l) => l.trim());
    const number = lines.find((l) => /^A\d{1,2}$/.test(l));
    return number ? [{ page: i + 1, number }] : [];
  });
  const index = new Map<string, string>();
  for (const p of pages) for (const m of p.text.matchAll(/^(A\d{1,2}) {2}(.+)$/gm)) index.set(m[1], m[2].trim());
  return { title: doc.getTitle() ?? null, pageCount: pages.length, pages, sheets, index: Object.fromEntries(index) };
}
