// Persistent, versioned Cache Storage for Laya's large assets.
//
// The Vite-hashed JS/CSS are immutable URLs the browser caches on its own, but
// the model, tokenizer, config and wasm engine live at fixed, un-hashed paths
// and total ~340 MB. Without an explicit cache, every worker start (a reload
// after the shared worker was evicted, a second tab, a browser GC) can pull all
// of that back over the wire, which is what made the demo look like it
// "downloads the model every time".
//
// laya-system-one reaches for plain `fetch`, so the cache is installed by
// wrapping the global fetch once, immediately before the runtime is imported.
// Only the known asset directories are touched; everything else is passed
// straight through.

const CACHE_PREFIX = "py-decision-laya-assets-";
// Bump when the asset set or the model revision changes so stale bytes are not
// served from an older cache.
const CACHE_NAME = `${CACHE_PREFIX}v1`;

// The extensions laya fetches directly: model.onnx, tokenizer.json,
// rl_agent_config.json and laya_inference_bg.wasm.
const CACHEABLE_EXTENSIONS = [".onnx", ".json", ".wasm"];

type FetchLike = typeof fetch;

let installed = false;

/** Turn a possibly-relative asset directory into an absolute, trailing-slash URL. */
function assetDirectory(url: string | undefined, base: string): string | null {
  if (!url) return null;
  try {
    const absolute = new URL(url, base).href;
    return absolute.endsWith("/") ? absolute : `${absolute}/`;
  } catch {
    return null;
  }
}

function isCacheableAsset(requestUrl: string, directories: string[]): boolean {
  const path = requestUrl.split("?")[0] ?? requestUrl;
  return directories.some((directory) => requestUrl.startsWith(directory))
    && CACHEABLE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

export type ModelCacheOptions = {
  modelDir: string;
  wasmBase?: string;
};

/**
 * Serve Laya's model/tokenizer/wasm from Cache Storage, filling it on a miss.
 *
 * Safe to call repeatedly and from both the page and a SharedWorker. It is a
 * no-op where Cache Storage or `fetch` is missing, so the caller keeps the
 * plain network path.
 */
export async function installModelCache(options: ModelCacheOptions): Promise<void> {
  if (installed) return;
  if (typeof caches === "undefined" || typeof fetch !== "function") return;

  const base = globalThis.location?.href ?? "http://localhost/";
  const directories = [
    assetDirectory(options.modelDir, base),
    assetDirectory(options.wasmBase, base),
  ].filter((directory): directory is string => directory !== null);
  if (directories.length === 0) return;

  let cache: Cache;
  try {
    cache = await caches.open(CACHE_NAME);
  } catch {
    // Storage is unavailable (private browsing, quota pressure, …): leave the
    // network path untouched rather than breaking inference.
    return;
  }
  installed = true;

  // Drop caches from earlier versions so a model bump reclaims the space.
  try {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) {
        await caches.delete(name);
      }
    }
  } catch {
    // Cleanup is best-effort.
  }

  const nativeFetch: FetchLike = globalThis.fetch.bind(globalThis);
  const cachedFetch: FetchLike = async (input, init) => {
    let request: Request;
    try {
      request = input instanceof Request ? input : new Request(input, init);
    } catch {
      return nativeFetch(input, init);
    }

    if (request.method !== "GET" || !isCacheableAsset(request.url, directories)) {
      return nativeFetch(request);
    }

    // `ignoreVary` matters: the origin sends `Vary: accept-encoding`, which the
    // browser controls, and a strict match would miss for no real reason.
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;

    const response = await nativeFetch(request);
    if (response.ok && response.status === 200 && response.type !== "opaque") {
      // Store the clone in the background so inference starts as soon as the
      // network response arrives; a quota failure just means no persistence.
      void cache.put(request, response.clone()).catch(() => undefined);
    }
    return response;
  };

  globalThis.fetch = cachedFetch;
}
