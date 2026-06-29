import fs from "node:fs/promises"
import { realpathSync } from "node:fs"

export namespace ConfigVariableGuard {
  const secret = new Set(["KILO_SERVER_PASSWORD", "KILO_SERVER_USERNAME"])

  export function env(name: string) {
    return !secret.has(name.toUpperCase())
  }

  export async function read(path: string, load: (path: string) => Promise<string>) {
    if (process.platform !== "linux") return load(path)
    const file = await fs.open(path, "r")
    try {
      const target = `/proc/self/fd/${file.fd}`
      const resolved = realpathSync.native(target)
      if (/^\/proc\/.*\/environ$/.test(resolved)) throw new Error("blocked process environment reference")
      return await load(target)
    } finally {
      await file.close()
    }
  }
}
