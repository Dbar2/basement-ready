import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/qa/**/*.test.ts"],
    env: { PGLITE_DIR: "memory://", MODEL_API_KEY: "" },
    pool: "forks",
  },
});
