// Audit N7: gate debug console.log noise behind DEV mode so production webview bundles
// do not leak instrumentation.
//
// `__DEV__` is replaced at build time by esbuild's `define` (see esbuild.js). In production
// the body of `if (__DEV__)` is dead code and the entire console.log call gets tree-shaken.
export function debugLog(...args: unknown[]) {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    // eslint-disable-next-line no-console
    console.log(...args)
  }
}
