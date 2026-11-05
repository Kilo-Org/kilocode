// Kilo's session database file (host composition, rung 2). The host chooses the file before a server starts and gives
// it to the server as OPENCODE_DB, so the file name depends only on the Kilo build channel. A git branch or an upstream
// file name never selects it, and a rebuild from another branch opens the same sessions.
export * as KiloDatabase from "./database"

import { chmodSync, existsSync, linkSync, readdirSync, rmSync } from "node:fs"
import path from "node:path"
import { Global } from "@opencode/util/global"

declare const KILO2_CHANNEL: string | undefined

/** The build channel (`KILO_CHANNEL` when `script/build.ts` ran). A run from source is `local`. */
export const channel = typeof KILO2_CHANNEL === "string" ? KILO2_CHANNEL : "local"

/** The release channels share `kilo2.db`. Each other channel has its own file, so a preview never migrates it. */
const release = ["latest", "beta", "prod"]

/**
 * Sets OPENCODE_DB to the Kilo database file and returns it. `KILO2_DB` (copied to OPENCODE_DB by ./env) wins, and a
 * child process keeps the file of its parent. `KILO_DISABLE_CHANNEL_DB` puts every channel in `kilo2.db`.
 */
export async function select(
  env: Record<string, string | undefined>,
  input = { data: Global.Path.data, channel },
): Promise<string> {
  if (env.OPENCODE_DB) return env.OPENCODE_DB
  const shared = env.KILO_DISABLE_CHANNEL_DB === "1" || env.KILO_DISABLE_CHANNEL_DB === "true"
  // kilo_port(unattributed:core/database:a155cf41e765)
  const file =
    shared || release.includes(input.channel)
      ? path.join(input.data, "kilo2.db")
      : path.join(input.data, `kilo2-${safe(input.channel)}.db`)
  await adopt(file, input.data, input.channel, shared)
  env.OPENCODE_DB = file
  return file
}

function safe(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-")
}

// Builds before the Kilo file names let the upstream server name the file. Remove when no preview install has one.
function legacy(data: string, channel: string, shared: boolean) {
  if (shared || ["latest", "dev", "beta", "next", "prod"].includes(channel)) return path.join(data, "opencode.db")
  return path.join(data, `opencode-${safe(channel)}.db`)
}

// The file of an earlier build for this channel, plus every other earlier build file on the machine. A build from
// another branch wrote its sessions to its own file, and only the copy can bring them forward.
function candidates(data: string, channel: string, shared: boolean) {
  const primary = legacy(data, channel, shared)
  const siblings = readdirSync(data)
    .filter((name) => name.startsWith("opencode") && name.endsWith(".db"))
    .map((name) => path.join(data, name))
  return [...new Set([primary, ...siblings])].filter(existsSync)
}

/**
 * Copies the database of an earlier build to `file` once, so its sessions stay. The source is the earlier file with the
 * most sessions, so an empty file of this channel cannot hide the sessions of another branch. A copy through SQLite
 * includes the pages that are still in the WAL. The copy is written next to `file` and linked into place, so a process
 * that starts at the same time never opens a half-written file, and it is owner-only like the file the server opens. If
 * the copy fails, the server starts with a new database, the old file stays as it is, and stderr names both files.
 */
async function adopt(file: string, data: string, channel: string, shared: boolean) {
  if (existsSync(file)) return
  const { Database } = await import("bun:sqlite")
  const sessions = (source: string) => {
    try {
      const db = new Database(source, { readonly: true })
      try {
        return db.query<{ n: number }, []>("SELECT count(*) AS n FROM session_v2").get()?.n ?? 0
      } finally {
        db.close()
      }
    } catch {
      return -1
    }
  }
  const files = candidates(data, channel, shared)
  // The earlier file with the most sessions, so an empty file of this channel cannot hide the sessions of a branch.
  const populated = files
    .filter((file) => sessions(file) > 0)
    .reduce<{ file: string; sessions: number } | undefined>(
      (winner, file) => (!winner || sessions(file) > winner.sessions ? { file, sessions: sessions(file) } : winner),
      undefined,
    )
  const source = populated?.file ?? (files.includes(legacy(data, channel, shared)) ? legacy(data, channel, shared) : undefined)
  if (!source) return
  const temp = `${file}.${process.pid}.adopt`
  try {
    const db = new Database(source, { readonly: true })
    try {
      db.run("VACUUM INTO ?", [temp])
    } finally {
      db.close()
    }
    // SQLite creates the copy with the process umask, so make it owner-only before it is reachable under `file`.
    ownerOnly(temp)
    linkSync(temp, file)
    ownerOnly(file)
  } catch (error) {
    // Another process linked its copy first. That copy is the same database.
    if (existsSync(file)) return
    console.error(
      `kilo2: could not copy the sessions of ${source} to ${file}, starting with a new database. Free the space or stop the other process, delete ${file} if it holds no sessions, and start again:`,
      error,
    )
  } finally {
    rmSync(temp, { force: true })
  }
}

function ownerOnly(file: string) {
  if (process.platform !== "win32") chmodSync(file, 0o600)
}
