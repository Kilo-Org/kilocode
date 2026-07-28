import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import { realpathSync } from "node:fs"
import path from "node:path"
import { Global } from "@opencode-ai/core/global"
import type { Profile } from "@kilocode/sandbox"
import type { SessionID } from "@/session/schema"

export namespace SandboxStore {
  /** Session confinement authority captured independently from later configuration reloads. */
  export type Snapshot = {
    enabled: boolean
    mode: Profile["network"]["mode"]
    allowedHosts: string[]
    writablePaths: string[]
    version: number
  }

  export const root = path.join(realpathSync.native(path.dirname(Global.Path.state)), "kilo-sandbox-policy")

  function hash(value: string) {
    return createHash("sha256").update(value).digest("hex")
  }

  function dir(sessionID: SessionID) {
    return path.join(root, hash(sessionID))
  }

  function file(directory: string, sessionID: SessionID) {
    return path.join(dir(sessionID), hash(directory) + ".json")
  }

  function valid(value: unknown) {
    if (!value || typeof value !== "object") return false
    const state = value as Record<string, unknown>
    const base =
      typeof state.enabled === "boolean" &&
      (state.mode === "allow" || state.mode === "deny" || state.mode === "proxy") &&
      Number.isSafeInteger(state.version) &&
      Number(state.version) >= 0
    if (!base) return false
    if (state.allowedHosts !== undefined && !Array.isArray(state.allowedHosts)) return false
    if (state.writablePaths !== undefined && !Array.isArray(state.writablePaths)) return false
    if (Array.isArray(state.allowedHosts) && state.allowedHosts.some((value) => typeof value !== "string")) return false
    if (Array.isArray(state.writablePaths) && state.writablePaths.some((value) => typeof value !== "string")) return false
    if (state.mode === "proxy" && (!Array.isArray(state.allowedHosts) || state.allowedHosts.length === 0)) return false
    return true
  }

  export async function read(directory: string, sessionID: SessionID) {
    const target = file(directory, sessionID)
    const text = await fs.readFile(target, "utf8").catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return undefined
      throw err
    })
    if (text === undefined) return
    const value: unknown = JSON.parse(text)
    if (!valid(value)) throw new Error(`Invalid sandbox policy state at ${target}`)
    const state = value as Record<string, unknown>
    return {
      enabled: state.enabled as boolean,
      mode: state.mode as Snapshot["mode"],
      allowedHosts: (state.allowedHosts as string[] | undefined) ?? [],
      writablePaths: (state.writablePaths as string[] | undefined) ?? [],
      version: state.version as number,
    } satisfies Snapshot
  }

  export async function write(directory: string, sessionID: SessionID, snapshot: Snapshot) {
    const folder = dir(sessionID)
    const target = file(directory, sessionID)
    const temp = path.join(folder, `.${randomUUID()}.tmp`)
    await fs.mkdir(folder, { recursive: true, mode: 0o700 })
    await fs.writeFile(temp, JSON.stringify(snapshot), { encoding: "utf8", flag: "wx", mode: 0o600 })
    await fs.rename(temp, target).catch(async (err) => {
      await fs.rm(temp, { force: true })
      throw err
    })
  }

  export async function remove(directory: string, sessionID: SessionID) {
    await fs.rm(file(directory, sessionID), { force: true })
    await fs.rmdir(dir(sessionID)).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT" || err.code === "ENOTEMPTY") return
      throw err
    })
  }

  export async function dispose(sessionID: SessionID) {
    await fs.rm(dir(sessionID), { recursive: true, force: true })
  }
}
