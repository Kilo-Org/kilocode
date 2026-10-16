import { Npm } from "@opencode-ai/core/npm"

export namespace ValkeyRuntime {
  export const env = "KILO_VALKEY_GLIDE_PATH"
  export const pkg = "@valkey/valkey-glide"
  export const version = "2.5.2"
  export const external = [
    pkg,
    "@valkey/valkey-glide-darwin-arm64",
    "@valkey/valkey-glide-darwin-x64",
    "@valkey/valkey-glide-linux-arm64-gnu",
    "@valkey/valkey-glide-linux-arm64-musl",
    "@valkey/valkey-glide-linux-x64-gnu",
    "@valkey/valkey-glide-linux-x64-musl",
  ] as const

  const box = { ready: undefined as Promise<void> | undefined }

  export function clear() {
    delete process.env[env]
    box.ready = undefined
  }

  export async function ensure(store?: string) {
    if (store !== "valkey") return
    if (process.env[env]) return
    if (process.platform === "win32") {
      throw new Error('Valkey is not supported on Windows. Set "indexing.vectorStore" to "lancedb" or "qdrant".')
    }
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
