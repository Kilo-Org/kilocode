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
    mode: Extract<Profile["network"]["mode"], "allow" | "deny">
    version: number
  }

  export const root = path.join(realpathSync.native(path.dirname(Global.Path.state)), "kilo-sandbox-policy")

  function hash(value: string) {
    return createHash("sha256").update(value).digest("hex")
  }

  function dir(sessionID: SessionID) {
    return path.join(root, hash(sessionID))
  }

  function file(sessionID: SessionID) {
    return path.join(dir(sessionID), "snapshot.json")
  }

  function valid(value: unknown): value is Snapshot {
    if (!value || typeof value !== "object") return false
    const state = value as Record<string, unknown>
    return (
      typeof state.enabled === "boolean" &&
      (state.mode === "allow" || state.mode === "deny") &&
      Number.isSafeInteger(state.version) &&
      Number(state.version) >= 0
    )
  }

  async function load(target: string) {
    const text = await fs.readFile(target, "utf8").catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return undefined
      throw err
    })
    if (text === undefined) return
    const value: unknown = JSON.parse(text)
    if (!valid(value)) throw new Error(`Invalid sandbox policy state at ${target}`)
    return value
  }

  async function save(sessionID: SessionID, snapshot: Snapshot) {
    const folder = dir(sessionID)
    const target = file(sessionID)
    const temp = path.join(folder, `.${randomUUID()}.tmp`)
    await fs.mkdir(folder, { recursive: true, mode: 0o700 })
    await fs.writeFile(temp, JSON.stringify(snapshot), { encoding: "utf8", flag: "wx", mode: 0o600 })
    await fs.rename(temp, target).catch(async (err) => {
      await fs.rm(temp, { force: true })
      throw err
    })
  }

  export async function current(sessionID: SessionID) {
    return load(file(sessionID))
  }

  export async function read(_directory: string, sessionID: SessionID, seed?: Pick<Snapshot, "enabled" | "version">) {
    const snapshot = await current(sessionID)
    if (snapshot) return snapshot

    const folder = dir(sessionID)
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return []
      throw err
    })
    const targets = entries
      .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name))
      .map((entry) => path.join(folder, entry.name))
    const legacy = (await Promise.all(targets.map(load))).filter((item): item is Snapshot => item !== undefined)
    if (legacy.length === 0) return

    const initial = legacy[0]
    if (!initial) return
    const migrated = legacy.slice(1).reduce<Snapshot>(
      (state, item) => ({
        enabled: state.enabled || item.enabled,
        mode: state.mode === "deny" || item.mode === "deny" ? "deny" : "allow",
        version: Math.max(state.version, item.version),
      }),
      initial,
    )
    const stored = seed
      ? {
          ...migrated,
          enabled: migrated.enabled || seed.enabled,
          version: Math.max(migrated.version, seed.version),
        }
      : migrated
    await save(sessionID, stored)
    await Promise.all(targets.map((target) => fs.rm(target, { force: true })))
    return stored
  }

  export async function write(_directory: string, sessionID: SessionID, snapshot: Snapshot) {
    await save(sessionID, snapshot)
  }

  export async function remove(_directory: string, sessionID: SessionID) {
    await dispose(sessionID)
  }

  export async function dispose(sessionID: SessionID) {
    await fs.rm(dir(sessionID), { recursive: true, force: true })
  }
}
