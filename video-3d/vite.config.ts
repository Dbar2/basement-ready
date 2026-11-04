// A capture-only page for the demo video's 3D clips. It mounts the app's real scan and staged layout
// (imported from ../src, never changed) and draws one frame per call, so render.mjs can step it.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: here,
  publicDir: fileURLToPath(new URL("../public", import.meta.url)),
  plugins: [react()],
  server: { port: 5199, strictPort: true, fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] } },
  logLevel: "warn",
});
