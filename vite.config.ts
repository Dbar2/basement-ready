import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `pnpm dev:phone` sets PHONE_CERT: serve over HTTPS on the Wi-Fi so a phone can open the camera.
const cert = process.env.PHONE_CERT;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    ...(cert ? { host: true, https: { key: readFileSync(`${cert}-key.pem`), cert: readFileSync(`${cert}.pem`) } } : {}),
    proxy: { "/api": `http://localhost:${process.env.API_PORT ?? 8787}` },
  },
});
