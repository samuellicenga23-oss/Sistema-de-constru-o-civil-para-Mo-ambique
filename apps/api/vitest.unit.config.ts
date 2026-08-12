import { defineConfig } from "vitest/config";

// Pure unit tests that do not use PostgreSQL. Keeping these separate makes
// operational checks fast and usable even when the local database is offline.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/httpMetrics.test.ts"],
  },
});
