import { Npm } from "@/npm"

export namespace LanceDBRuntime {
  export const env = "KILO_LANCEDB_PATH"
  export const pkg = "@lancedb/lancedb"
  export const version = "0.26.2"
  export const external = [
    pkg,
    "@lancedb/lancedb-darwin-arm64",
    "@lancedb/lancedb-linux-arm64-gnu",
    "@lancedb/lancedb-linux-arm64-musl",
    "@lancedb/lancedb-linux-x64-gnu",
    "@lancedb/lancedb-linux-x64-musl",
    "@lancedb/lancedb-win32-arm64-msvc",
    "@lancedb/lancedb-win32-x64-msvc",
  ] as const

  const box = { ready: undefined as Promise<void> | undefined }

  export function clear() {
    delete process.env[env]
    box.ready = undefined
  }

  export async function ensure(store?: string) {
    if (store !== "lancedb") return
    if (process.env[env]) return
    if (box.ready) return box.ready

    box.ready = (async () => {
      const result = await Npm.add(`${pkg}@${version}`)
      if (result.entrypoint) process.env[env] = result.entrypoint
    })().catch((err) => {
      box.ready = undefined
      throw err
    })

    return box.ready
  }
}
