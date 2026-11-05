import path from "path"
import type { Npm } from "@opencode/util/npm"
import { Effect } from "effect"

// The LanceDB native package is not bundled into the executable. A source checkout resolves it from the engine's
// dependencies; the executable installs the pinned version once into the npm cache and points the engine at it
// through `KILO_LANCEDB_PATH`.
export const env = "KILO_LANCEDB_PATH"
export const pkg = "@lancedb/lancedb"
export const version = "0.26.2"

export const ensure = Effect.fn("LanceDBRuntime.ensure")(function* (
  store: string | undefined,
  npm?: Npm.Interface,
  bundled = resolvable,
) {
  if (store !== "lancedb") return
  if (process.env[env]) return
  if (process.platform === "darwin" && process.arch === "x64") {
    return yield* Effect.fail(
      new Error(
        'LanceDB is not supported on Intel Macs. Set "indexing.vectorStore" to "qdrant" and configure a Qdrant server.',
      ),
    )
  }
  if (bundled()) return
  if (!npm) return yield* Effect.fail(new Error("LanceDB is unavailable: the npm installer is not available."))
  const installed = yield* npm.add(`${pkg}@${version}`)
  const manifest = yield* Effect.promise(() =>
    Bun.file(path.join(installed.directory, "package.json"))
      .json()
      .catch(() => ({})),
  )
  process.env[env] = path.join(installed.directory, typeof manifest.main === "string" ? manifest.main : "index.js")
})

function resolvable() {
  try {
    Bun.resolveSync(pkg, path.dirname(Bun.resolveSync("@kilocode/kilo-indexing/engine", import.meta.dir)))
    return true
  } catch {
    return false
  }
}
