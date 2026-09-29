import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";

export default defineConfig({
  base: "/bundle/",
  build: {
    emptyOutDir: true,
    outDir: fileURLToPath(new URL("../public/bundle", import.meta.url)),
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
