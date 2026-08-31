import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` exists to fail a build when a server module is pulled
      // into the client. Under a Node test runner there is no client, so it is
      // stubbed rather than letting it throw on import.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    // Mirrors src/ and convex/, so a test's path tells you what it covers.
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Pinned, and pinned WEST of UTC on purpose. The date helpers guard against
    // a bare "YYYY-MM-DD" parsing as UTC and landing on the previous day — a
    // bug that cannot reproduce in UTC, so a UTC runner would pass while
    // broken. This is also where the hosts and their guests actually are.
    env: { TZ: "America/Los_Angeles" },
  },
});
