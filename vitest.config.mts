import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": fileURLToPath(
        new URL("./__mocks__/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    clearMocks: true,
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "e2e/**",
      ".worktrees/**",
      "**/node_modules/**",
      ".next/**",
    ],
  },
});
