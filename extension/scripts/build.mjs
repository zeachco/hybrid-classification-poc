// Build the Laya Command Guard extension into `extension/dist`.
//
// MV3 needs three different bundle formats, so esbuild is run once per format:
//   * background / offscreen / popup  → ES modules
//   * content script                  → IIFE (content scripts are not modules)
//
// The Laya model is ~340 MB and is assembled from the `@sys-one/laya-model-*`
// chunks exactly like the client's Vite plugin does, then copied next to the
// bundled extension. The assets are git-ignored and rebuilt on demand.
//
// The Laya package and its model chunks are reused from `extension/node_modules`
// when present (after `bun install` here) and otherwise from `client/node_modules`
// so the two projects do not have to duplicate a 340 MB download.

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import * as esbuild from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const srcDir = join(root, "src");
const outDir = join(root, "dist");
const assetsDir = join(outDir, "assets");
const watch = process.argv.includes("--watch");

const MODEL_CHUNKS = 13;

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `None of these paths exist:\n${candidates.map((path) => `  - ${path}`).join("\n")}\n` +
      "Run `bun install` in extension/ or client/ to fetch the Laya package.",
  );
}

const layaRoot = firstExisting([
  join(root, "node_modules", "laya-system-one"),
  join(root, "..", "client", "node_modules", "laya-system-one"),
]);
const chunkRoot = firstExisting([
  join(root, "node_modules", "@sys-one"),
  join(root, "..", "client", "node_modules", "@sys-one"),
]);
const nodePaths = [
  join(root, "node_modules"),
  join(root, "..", "client", "node_modules"),
];
const nodeBuiltinStub = join(root, "scripts", "stubs", "node-builtin.cjs");

// Laya's package entry pulls in Node-only code paths; replace their builtins
// with a throwing stub, the same thing Vite does for the browser client.
const nodeBuiltinStubPlugin = {
  name: "node-builtin-stub",
  setup(build) {
    build.onResolve({ filter: /^node:/ }, () => ({ path: nodeBuiltinStub }));
  },
};

const wasmSrc = join(layaRoot, "src", "wasm-pkg");
const modelSrc = join(layaRoot, "models");

async function assembleModel(destination) {
  const sources = Array.from({ length: MODEL_CHUNKS }, (_, index) => {
    const name = `laya-model-chunk-${String(index).padStart(2, "0")}`;
    return join(chunkRoot, name, "chunk.bin");
  });
  await pipeline(
    Readable.from(
      (async function* () {
        for (const source of sources) yield await readFile(source);
      })(),
    ),
    createWriteStream(destination),
  );
}

async function copyAssets() {
  const modelDir = join(assetsDir, "models", "laya");
  const wasmDir = join(assetsDir, "wasm-pkg");
  await mkdir(modelDir, { recursive: true });
  await mkdir(wasmDir, { recursive: true });

  console.info("[build] assembling model.onnx from 13 chunks…");
  await assembleModel(join(modelDir, "model.onnx"));
  await cp(join(modelSrc, "tokenizer.json"), join(modelDir, "tokenizer.json"));
  await cp(join(modelSrc, "rl_agent_config.json"), join(modelDir, "rl_agent_config.json"));
  await cp(wasmSrc, wasmDir, { recursive: true });
}

async function copyStatic() {
  await cp(join(srcDir, "manifest.json"), join(outDir, "manifest.json"));
  await cp(join(srcDir, "offscreen.html"), join(outDir, "offscreen.html"));
  await cp(join(srcDir, "popup.html"), join(outDir, "popup.html"));
}

const shared = {
  bundle: true,
  platform: "browser",
  target: "chrome116",
  format: "esm",
  sourcemap: true,
  logLevel: "info",
  nodePaths,
  alias: { "laya-system-one": join(layaRoot, "src", "index.js") },
  plugins: [nodeBuiltinStubPlugin],
  define: { "process.env.NODE_ENV": '"production"' },
};

async function runBundle() {
  await esbuild.build({
    ...shared,
    entryPoints: [
      join(srcDir, "background.ts"),
      join(srcDir, "offscreen.ts"),
      join(srcDir, "popup.ts"),
    ],
    outdir: outDir,
  });

  await esbuild.build({
    ...shared,
    format: "iife",
    entryPoints: [join(srcDir, "content.ts")],
    outfile: join(outDir, "content.js"),
  });
}

async function runBuild() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await copyStatic();
  await copyAssets();
  await runBundle();
  await writeFile(
    join(outDir, "BUILD_INFO.txt"),
    `built ${new Date().toISOString()}\nlaya: ${layaRoot}\n`,
  );
  console.info(`[build] extension ready in ${outDir}`);
}

if (watch) {
  await runBuild();
  const context = await esbuild.context({
    ...shared,
    entryPoints: [join(srcDir, "background.ts"), join(srcDir, "offscreen.ts"), join(srcDir, "popup.ts")],
    outdir: outDir,
  });
  await context.watch();
  console.info("[build] watching src/ for changes (static assets are not watched)");
} else {
  await runBuild();
}
