import { createRequire } from "node:module"
import path from "node:path"

declare const KILO_LIBC: string | undefined

// The binding package is chosen at run time, so a source checkout resolves it from node_modules. A compiled build
// replaces this module with a static require of the target's platform package (packages/kilo-cli/script/build.ts),
// which is what embeds the native binding: a compiled binary has no node_modules next to the executable.
// `KILO_PARCEL_WATCHER_PATH` resolves an absolute module path instead, like the core watcher's
// `OPENCODE_PARCEL_WATCHER_PATH`.
export default function load() {
  const require = createRequire(import.meta.url)
  if (process.env.KILO_PARCEL_WATCHER_PATH) return require(process.env.KILO_PARCEL_WATCHER_PATH)
  const libc = typeof KILO_LIBC === "undefined" ? undefined : KILO_LIBC
  const binding = `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? `-${libc || "glibc"}` : ""}`
  // The platform package is an optional dependency of @parcel/watcher and is linked inside that package's own
  // node_modules, so it is not resolvable from this package by name under an isolated install.
  const main = path.dirname(require.resolve("@parcel/watcher/package.json"))
  return require(require.resolve(binding, { paths: [main] }))
}
