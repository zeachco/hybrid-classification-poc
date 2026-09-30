import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import { defineConfig, type Plugin } from "vite";

function layaWasmAssets(): Plugin {
  const packageRoot = fileURLToPath(
    new URL("./node_modules/laya-system-one/", import.meta.url),
  );
  const wasmDir = `${packageRoot}/src/wasm-pkg`;
  const modelDir = `${packageRoot}/models`;
  const chunkDir = fileURLToPath(
    new URL("./node_modules/@sys-one/", import.meta.url),
  );
  let model: Buffer | null = null;

  const readModel = (): Buffer => {
    if (!model) {
      model = Buffer.concat(
        Array.from({ length: 13 }, (_, index) => {
          const name = `laya-model-chunk-${String(index).padStart(2, "0")}`;
          return readFileSync(`${chunkDir}/${name}/chunk.bin`);
        }),
      );
    }
    return model;
  };

  const assets: Record<string, () => Buffer> = {
    "models/laya/model.onnx": readModel,
    "models/laya/tokenizer.json": () => readFileSync(`${modelDir}/tokenizer.json`),
    "models/laya/rl_agent_config.json": () => readFileSync(`${modelDir}/rl_agent_config.json`),
    "assets/wasm-pkg/laya_inference.js": () => readFileSync(`${wasmDir}/laya_inference.js`),
    "assets/wasm-pkg/laya_inference_bg.wasm": () => readFileSync(`${wasmDir}/laya_inference_bg.wasm`),
  };

  return {
    name: "laya-wasm-assets",
    configureServer(server) {
      server.middlewares.use("/bundle/models/laya", (request, response, next) => {
        const name = request.url?.split("?")[0].replace(/^\//, "") ?? "";
        const file = name ? `models/laya/${name}` : "";
        if (!file || !(file in assets)) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader(
          "Content-Type",
          name.endsWith(".json") ? "application/json" : "application/octet-stream",
        );
        response.end(assets[file]());
      });
      server.middlewares.use("/bundle/assets/wasm-pkg", (request, response, next) => {
        const name = request.url?.split("?")[0].replace(/^\//, "") ?? "";
        const file = name ? `assets/wasm-pkg/${name}` : "";
        if (!file || !(file in assets)) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader(
          "Content-Type",
          file.endsWith(".wasm") ? "application/wasm" : "text/javascript",
        );
        response.end(assets[file]());
      });
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(assets)) {
        this.emitFile({ type: "asset", fileName, source: source() });
      }
    },
  };
}

export default defineConfig({
  base: "/bundle/",
  plugins: [layaWasmAssets()],
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
