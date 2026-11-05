// A capture-only page for the demo video's 3D clips. It mounts the app's real scan and staged layout
// (imported from ../src, never changed) and draws one frame per call, so render.mjs can step it.
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = fileURLToPath(new URL(".", import.meta.url));

// A private scan, read in place and never copied into the repo: SCAN_DIR is its downloaded folder (laid out
// like public/samples/sample), SCAN_EXISTING the as-built plan seed-existing.ts wrote for it.
const scanDir = process.env.SCAN_DIR, scanExisting = process.env.SCAN_EXISTING;
const TYPES: Record<string, string> = { ".json": "application/json", ".jpg": "image/jpeg", ".bin": "application/octet-stream" };
const privateScan = {
  name: "private-scan",
  configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: NodeJS.WritableStream & { statusCode: number; setHeader: (k: string, v: string) => void; end: () => void }, next: () => void) => void) => void } }) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url ?? "").split("?")[0];
      let file: string | undefined;
      if (scanExisting && url === "/private-existing.json") file = scanExisting;
      else if (scanDir && url.startsWith("/private-scan/")) {
        file = normalize(join(scanDir, decodeURIComponent(url.slice("/private-scan/".length))));
        if (!file.startsWith(normalize(scanDir))) file = undefined;
      }
      if (!file) return next();
      if (!existsSync(file)) return void ((res.statusCode = 404), res.end());
      res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
      createReadStream(file).pipe(res);
    });
  },
};

export default defineConfig({
  root: here,
  publicDir: fileURLToPath(new URL("../public", import.meta.url)),
  plugins: [react(), privateScan],
  server: { port: 5199, strictPort: true, fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] } },
  logLevel: "warn",
});
