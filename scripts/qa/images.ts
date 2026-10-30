// Image work (size, crop, tile, compare, blank check) done in a headless Chromium canvas, so the harness
// needs no native image library. One page serves every call.
import { createHash } from "node:crypto";
import { chromium, type Browser, type Page } from "playwright";
import { chromiumPath } from "./browsers";

export type Box = { x: number; y: number; w: number; h: number };

export const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

// Width and height from the PNG header (IHDR), or a JPEG's first frame header.
export function imageSize(b: Buffer): { w: number; h: number } {
  if (b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  let o = 2;
  while (o < b.length) {
    const marker = b.readUInt16BE(o);
    const len = b.readUInt16BE(o + 2);
    if (marker >= 0xffc0 && marker <= 0xffcf && marker !== 0xffc4 && marker !== 0xffc8 && marker !== 0xffcc) return { h: b.readUInt16BE(o + 5), w: b.readUInt16BE(o + 7) };
    o += 2 + len;
  }
  throw new Error("not a PNG or JPEG");
}

export class Images {
  private constructor(
    private browser: Browser,
    private page: Page,
  ) {}

  static async open() {
    const browser = await chromium.launch({ executablePath: chromiumPath() });
    const page = await browser.newPage();
    await page.setContent("<!doctype html><title>qa images</title>");
    return new Images(browser, page);
  }

  async close() {
    await this.browser.close();
  }

  // Draws a region of the image at a new size. Region and size in source pixels / output pixels.
  private async draw(src: Buffer, region: Box | null, out: { w: number; h: number }, type: "png" | "jpeg", quality = 0.86): Promise<Buffer> {
    const b64 = await this.page.evaluate(
      async ({ data, region, out, type, quality }) => {
        const blob = await (await fetch(`data:image/*;base64,${data}`)).blob();
        const bmp = await createImageBitmap(blob);
        const r = region ?? { x: 0, y: 0, w: bmp.width, h: bmp.height };
        const c = new OffscreenCanvas(out.w, out.h);
        const g = c.getContext("2d")!;
        g.imageSmoothingQuality = "high";
        g.fillStyle = "#ffffff";
        g.fillRect(0, 0, out.w, out.h);
        g.drawImage(bmp, r.x, r.y, r.w, r.h, 0, 0, out.w, out.h);
        const res = await c.convertToBlob({ type: `image/${type}`, quality });
        const bytes = new Uint8Array(await res.arrayBuffer());
        let s = "";
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
      },
      { data: src.toString("base64"), region, out, type, quality },
    );
    return Buffer.from(b64, "base64");
  }

  // Fits the image inside maxW × maxH (never enlarging). Returns the scale applied (output / source).
  async fit(src: Buffer, maxW: number, maxH: number, type: "png" | "jpeg" = "jpeg") {
    const { w, h } = imageSize(src);
    const scale = Math.min(1, maxW / w, maxH / h);
    const out = { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
    return { data: await this.draw(src, null, out, type), w: out.w, h: out.h, scale };
  }

  async crop(src: Buffer, box: Box, pad = 24, maxW = 900) {
    const { w, h } = imageSize(src);
    const x = Math.max(0, Math.floor(box.x - pad));
    const y = Math.max(0, Math.floor(box.y - pad));
    const r = { x, y, w: Math.min(w - x, Math.ceil(box.w + pad * 2)), h: Math.min(h - y, Math.ceil(box.h + pad * 2)) };
    if (r.w < 2 || r.h < 2) return null;
    const scale = Math.min(1, maxW / r.w);
    return this.draw(src, r, { w: Math.round(r.w * scale), h: Math.round(r.h * scale) }, "png");
  }

  // Cuts a tall screenshot into pieces of at most tileH source pixels, top to bottom.
  async tiles(src: Buffer, tileH: number, maxTiles: number): Promise<{ data: Buffer; y: number; h: number; w: number }[]> {
    const { w, h } = imageSize(src);
    const n = Math.min(maxTiles, Math.max(1, Math.ceil(h / tileH)));
    const out = [];
    for (let i = 0; i < n; i++) {
      const y = i * tileH;
      const th = Math.min(tileH, h - y);
      if (th <= 4) break;
      out.push({ data: n === 1 ? src : await this.draw(src, { x: 0, y, w, h: th }, { w, h: th }, "png"), y, h: th, w });
    }
    return out;
  }

  // How much of two images differs: both drawn at 1/4 size, a pixel counts when any channel moves
  // more than 32. Different sizes compare over the shared top-left area, and the rest counts as changed.
  async diff(a: Buffer, b: Buffer): Promise<number> {
    return this.page.evaluate(
      async ({ a, b }) => {
        const load = async (d: string) => createImageBitmap(await (await fetch(`data:image/*;base64,${d}`)).blob());
        const [ia, ib] = await Promise.all([load(a), load(b)]);
        const w = Math.ceil(Math.max(ia.width, ib.width) / 4);
        const h = Math.ceil(Math.max(ia.height, ib.height) / 4);
        const px = (bmp: ImageBitmap) => {
          const c = new OffscreenCanvas(w, h);
          const g = c.getContext("2d")!;
          g.fillStyle = "#ff00ff";
          g.fillRect(0, 0, w, h);
          g.drawImage(bmp, 0, 0, bmp.width / 4, bmp.height / 4);
          return g.getImageData(0, 0, w, h).data;
        };
        const pa = px(ia);
        const pb = px(ib);
        let changed = 0;
        for (let i = 0; i < pa.length; i += 4) {
          if (Math.abs(pa[i] - pb[i]) > 32 || Math.abs(pa[i + 1] - pb[i + 1]) > 32 || Math.abs(pa[i + 2] - pb[i + 2]) > 32) changed++;
        }
        return changed / (w * h);
      },
      { a: a.toString("base64"), b: b.toString("base64") },
    );
  }

  // The share of a region held by its single most common colour (coarsely binned): near 1 means blank.
  async blankness(src: Buffer, region?: Box): Promise<number> {
    return this.page.evaluate(
      async ({ data, region }) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/*;base64,${data}`)).blob());
        const r = region ?? { x: 0, y: 0, w: bmp.width, h: bmp.height };
        const w = Math.max(1, Math.round(r.w / 4));
        const h = Math.max(1, Math.round(r.h / 4));
        const c = new OffscreenCanvas(w, h);
        const g = c.getContext("2d")!;
        g.drawImage(bmp, r.x, r.y, r.w, r.h, 0, 0, w, h);
        const d = g.getImageData(0, 0, w, h).data;
        const bins = new Map<number, number>();
        for (let i = 0; i < d.length; i += 4) {
          const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
          bins.set(k, (bins.get(k) ?? 0) + 1);
        }
        return Math.max(...bins.values()) / (w * h);
      },
      { data: src.toString("base64"), region: region ?? null },
    );
  }
}
