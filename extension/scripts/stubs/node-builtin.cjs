// Browser stand-in for Node's builtin modules (`node:fs`, `node:path`, …).
//
// Laya's package entry point statically pulls in its Node/native code paths
// (laya-native.js, server.js) before the browser-only WASM path is chosen.
// Vite replaces those builtins with a throwing stub for browser builds; this
// file does the same for esbuild. Every property returns another stub, and
// calling any of them throws, so the browser bundle stays loadable while the
// Node-only code it never runs remains inert.

function unavailable(name) {
  const stub = function nodeBuiltinStub() {
    throw new Error(
      `The Node builtin "${name}" is not available in a browser extension.`,
    );
  };
  return new Proxy(stub, {
    get(_target, property) {
      if (property === "then" || property === Symbol.toPrimitive) return undefined;
      return unavailable(`${name}.${String(property)}`);
    },
    apply() {
      throw new Error(
        `The Node builtin "${name}" is not available in a browser extension.`,
      );
    },
  });
}

module.exports = unavailable("node:*");
