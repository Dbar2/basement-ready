import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/qa/**/*.test.ts"],
    env: { PGLITE_DIR: "memory://", MODEL_API_KEY: "" },
    pool: "forks",
    // The permit tests draw whole PDF sets (1–3 s alone); on a busy machine 5 s isn't enough.
    testTimeout: 20_000,
  },
});
