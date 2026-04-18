// Audit N7: build-time injected flag from esbuild `define` (see esbuild.js).
// `true` in dev builds, `false` in production. Lets us tree-shake debug logs.
declare const __DEV__: boolean
