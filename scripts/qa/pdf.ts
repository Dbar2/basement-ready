// A downloaded PDF as one PNG per page, plus each page's text for the cross-screen number check.
// Pages are split with pdf-lib and drawn by macOS `sips` (PDFKit), which keeps vector text sharp.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream, type PDFObject } from "pdf-lib";

function streamsOf(contents: PDFObject | undefined, doc: PDFDocument): PDFRawStream[] {
  if (!contents) return [];
  const obj = doc.context.lookup(contents);
  if (obj instanceof PDFRawStream) return [obj];
  if (obj instanceof PDFArray) return obj.asArray().flatMap((o) => streamsOf(o, doc));
  return [];
}

// Text-showing operators: <hex> Tj, (literal) Tj and [..] TJ, as pdf-lib writes them with the standard
// fonts (our drawings). A city's own scanned form shows up with little or no text.
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

export type PdfPage = { page: number; file: string; text: string; width: number; height: number };

// Writes <dir>/<name>-p01.png … and returns the pages. Long edge `px` pixels.
export async function renderPdf(bytes: Uint8Array, dir: string, name: string, px = 2000): Promise<PdfPage[]> {
  mkdirSync(dir, { recursive: true });
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages: PdfPage[] = [];
  for (let i = 0; i < src.getPageCount(); i++) {
    const page = src.getPage(i);
    let text = "";
    try {
      text = streamsOf(page.node.Contents(), src)
        .map((s) => textOf(Buffer.from(decodePDFRawStream(s).decode()).toString("latin1")))
        .join("\n");
    } catch {
      text = "";
    }
    const one = await PDFDocument.create();
    const [copy] = await one.copyPages(src, [i]);
    one.addPage(copy);
    const n = String(i + 1).padStart(2, "0");
    const pdf = join(dir, `${name}-p${n}.pdf`);
    const png = join(dir, `${name}-p${n}.png`);
    writeFileSync(pdf, await one.save());
    execFileSync("sips", ["-s", "format", "png", "-Z", String(px), pdf, "--out", png], { stdio: "ignore" });
    const { width, height } = page.getSize();
    pages.push({ page: i + 1, file: png, text, width, height });
  }
  return pages;
}

export const readPdfFile = (path: string) => new Uint8Array(readFileSync(path));
