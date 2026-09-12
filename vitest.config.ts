import { defineConfig, configDefaults } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "~": resolve(import.meta.dirname, "app"),
      "#shared": resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    environment: "happy-dom",
    // Extend vitest's defaults rather than replacing them: the defaults carry
    // the `**/node_modules/**` glob that keeps third-party test files out. On
    // Netlify, build plugins are installed to .netlify/plugins/node_modules,
    // which a bare "node_modules" string does not match.
    exclude: [...configDefaults.exclude, "**/e2e/**", "**/.netlify/**"],
    setupFiles: ["./tests/setup.ts"],
  },
});
