import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import { realpathSync } from "node:fs"
import path from "node:path"
import { Global } from "@opencode-ai/core/global"

export namespace SandboxPreference {
  export const root = path.join(realpathSync.native(path.dirname(Global.Path.state)), "kilo-sandbox-preference")

  function file(directory: string) {
    return path.join(root, createHash("sha256").update(directory).digest("hex") + ".json")
  }

  export async function read(directory: string): Promise<boolean | undefined> {
    const target = file(directory)
    const text = await fs.readFile(target, "utf8").catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return undefined
      throw err
    })
    if (text === undefined) return undefined
    const value: unknown = JSON.parse(text)
    return typeof value === "boolean" ? value : undefined
  }

  export async function write(directory: string, enabled: boolean) {
    const target = file(directory)
    const temp = path.join(root, `.${randomUUID()}.tmp`)
    await fs.mkdir(root, { recursive: true, mode: 0o700 })
    await fs.writeFile(temp, JSON.stringify(enabled), { encoding: "utf8", flag: "wx", mode: 0o600 })
    await fs.rename(temp, target).catch(async (err) => {
      await fs.rm(temp, { force: true })
      throw err
    })
  }
}
