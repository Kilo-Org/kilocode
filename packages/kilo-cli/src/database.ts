// Kilo's session database file (host composition, rung 2). The host chooses the file before a server starts and gives
// it to the server as OPENCODE_DB, so the file name depends only on the Kilo build channel. A git branch or an upstream
// file name never selects it, and a rebuild from another branch opens the same sessions.
export * as KiloDatabase from "./database"

import { existsSync, linkSync, rmSync } from "node:fs"
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
  await adopt(file, legacy(input.data, input.channel, shared))
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

/**
 * Copies the database of an earlier build to `file` once, so its sessions stay. A copy through SQLite includes the
 * pages that are still in the WAL. The copy is written next to `file` and linked into place, so a process that starts
 * at the same time never opens a half-written file. If the copy fails, the server starts with a new database, the
 * old file stays as it is, and stderr names both files so the sessions can be restored by hand.
 */
async function adopt(file: string, source: string) {
  if (existsSync(file) || !existsSync(source)) return
  const { Database } = await import("bun:sqlite")
  const temp = `${file}.${process.pid}.adopt`
  try {
    const db = new Database(source, { readonly: true })
    try {
      db.run("VACUUM INTO ?", [temp])
    } finally {
      db.close()
    }
    linkSync(temp, file)
  } catch (error) {
    // Another process linked its copy first. That copy is the same database.
    if (existsSync(file)) return
    console.error(`kilo2: could not copy the sessions of ${source} to ${file}, starting with a new database:`, error)
  } finally {
    rmSync(temp, { force: true })
  }
}
