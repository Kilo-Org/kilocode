import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { root as base } from "./root"
import type { Credential, Profile } from "@kilocode/sandbox"
import type { SessionID } from "@opencode/schema/session-id"

export namespace SandboxStore {
  /** Persisted session confinement authority, refreshed from trusted settings between tool executions. */
  export type Snapshot = {
    enabled: boolean
    mode: Profile["network"]["mode"]
    allowedHosts: string[]
    writablePaths: string[]
    readPaths?: string[]
    readExceptions?: string[]
    credentials?: Credential[]
    version: number
  }

  export const root = path.join(base, "policy")

  function hash(value: string) {
    return createHash("sha256").update(value).digest("hex")
  }

  function dir(sessionID: SessionID) {
    return path.join(root, hash(sessionID))
  }

  function file(directory: string, sessionID: SessionID) {
    return path.join(dir(sessionID), hash(directory) + ".json")
  }

  function credential(value: unknown) {
    if (!value || typeof value !== "object") return false
    const entry = value as Record<string, unknown>
    return typeof entry.name === "string" && typeof entry.source === "string" && typeof entry.upstream === "string"
  }

  function strings(value: unknown) {
    return value === undefined || (Array.isArray(value) && value.every((entry) => typeof entry === "string"))
  }

  function mode(value: unknown) {
    return value === "allow" || value === "deny" || value === "proxy"
  }

  function version(value: unknown) {
    return Number.isSafeInteger(value) && Number(value) >= 0
  }

  function credentials(value: unknown) {
    return value === undefined || (Array.isArray(value) && value.every(credential))
  }

  function valid(value: unknown) {
    if (!value || typeof value !== "object") return false
    const state = value as Record<string, unknown>
    if (typeof state.enabled !== "boolean" || !mode(state.mode) || !version(state.version)) return false
    if (
      !strings(state.allowedHosts) ||
      !strings(state.writablePaths) ||
      !strings(state.readPaths) ||
      !strings(state.readExceptions) ||
      !credentials(state.credentials)
    )
      return false
    if (state.mode !== "proxy") return true
    return Array.isArray(state.allowedHosts) && state.allowedHosts.length > 0
  }

  export async function read(directory: string, sessionID: SessionID): Promise<Snapshot | undefined> {
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
      readPaths: (state.readPaths as string[] | undefined) ?? [],
      readExceptions: (state.readExceptions as string[] | undefined) ?? [],
      credentials: (state.credentials as Credential[] | undefined) ?? [],
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
