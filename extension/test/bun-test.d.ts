// Minimal ambient declarations so `tsc --noEmit` understands the Bun test
// runner without pulling in the full `@types/bun` global surface (which would
// collide with the DOM + WebWorker libs the extension needs).

declare module "bun:test" {
  type Matchers = {
    [matcher: string]: (expected?: unknown, ...rest: never[]) => void;
    not: Matchers;
  };

  export function describe(name: string, callback: () => void): void;
  export function test(name: string, callback: () => void | Promise<void>): void;
  // `expect` is intentionally loosely typed here; the tests exercise the real
  // Bun matchers at runtime.
  export function expect(value: unknown): Matchers;
}
