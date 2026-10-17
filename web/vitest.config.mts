import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // server-only throws outside a React server build; the libs it guards are plain Node code under test
      "server-only": path.resolve(__dirname, "src/lib/__tests__/server-only.ts"),
    },
  },
  test: { include: ["src/**/*.test.ts"] },
});
