// Kilo's session database file (host composition, rung 2). The host chooses the file before a server starts and gives
// it to the server as OPENCODE_DB, so the file name depends only on the Kilo build channel. A git branch or an upstream
// file name never selects it, and a rebuild from another branch opens the same sessions.
export * as KiloDatabase from "./database"

import { chmodSync, existsSync, linkSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
 * `KILO_DISABLE_V1_IMPORT` starts a new database without the Kilo v1 sessions.
 */
export async function select(
  env: Record<string, string | undefined>,
  input = { data: Global.Path.data, channel },
): Promise<string> {
  if (env.OPENCODE_DB) return env.OPENCODE_DB
  const flag = (value: string | undefined) => value === "1" || value === "true"
  const shared = flag(env.KILO_DISABLE_CHANNEL_DB)
  // kilo_port(unattributed:core/database:a155cf41e765)
  const file =
    shared || release.includes(input.channel)
      ? path.join(input.data, "kilo2.db")
      : path.join(input.data, `kilo2-${safe(input.channel)}.db`)
  await adopt(file, input.data, input.channel, shared, !flag(env.KILO_DISABLE_V1_IMPORT))
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
 * Copies the sessions of an earlier install to `file` once, when this channel has no database yet. The source is the
 * earlier kilo2 build file with the most sessions, so an empty file of this channel cannot hide the sessions of another
 * branch; else the Kilo v1 store; else the empty earlier file of this channel. A v1 copy is converted before it is
 * linked into place (./v1-store). If the copy or the conversion fails, the server starts with a new database, the
 * source stays as it is, and stderr names both files.
 */
async function adopt(file: string, data: string, channel: string, shared: boolean, v1: boolean) {
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
  // Each candidate is opened once.
  const populated = files
    .map((file) => ({ file, sessions: sessions(file) }))
    .filter((entry) => entry.sessions > 0)
    .toSorted((a, b) => b.sessions - a.sessions)
  const primary = legacy(data, channel, shared)
  const store = v1 ? v1Store(data) : undefined
  const source =
    populated[0]?.file ??
    (store && existsSync(store) ? store : undefined) ??
    (files.includes(primary) ? primary : undefined)
  if (!source) return
  if (source === store) return importV1(store, file, data)
  try {
    await copy(source, file)
  } catch (error) {
    // Another process linked its copy first. That copy is the same database.
    if (existsSync(file)) return
    console.error(
      `kilo2: could not copy the sessions of ${source} to ${file}, starting with a new database. Free the space or stop the other process, delete ${file} if it holds no sessions, and start again:`,
      error,
    )
  }
}

/**
 * Imports the Kilo v1 store into a new store at `file`. One process converts while the others wait for it, so parallel
 * starts (VS Code windows, the CLI) do not repeat the work. Every line starts with `kilo2: importing`, which the VS Code
 * client reads as progress while it waits for the server. A failed import leaves no store, so the server starts empty.
 */
async function importV1(store: string, file: string, data: string) {
  const lock = `${file}.import.lock`
  if (!(await acquire(lock, file))) return
  try {
    if (existsSync(file)) return
    console.error(`kilo2: importing Kilo v1 sessions from ${store} once; ${store} stays as it is.`)
    const { KiloV1Store } = await import("./v1-store")
    const started = Date.now()
    await copy(store, file, (copy) =>
      KiloV1Store.convert(copy, {
        data,
        progress: (done, total) => console.error(`kilo2: importing Kilo v1 sessions ${done}/${total}`),
      }).then((total) =>
        console.error(`kilo2: importing Kilo v1 sessions done, ${total} sessions in ${Date.now() - started} ms.`),
      ),
    )
  } catch (error) {
    if (existsSync(file)) return
    console.error(
      `kilo2: importing Kilo v1 sessions failed, starting with a new database. ${store} stays as it is; delete ${file} and start again to retry:`,
      error,
    )
  } finally {
    if (readOwner(lock) === process.pid) rmSync(lock, { force: true })
  }
}

/**
 * Takes the import lock. While another live process holds it, waits until that process ends or `file` exists, and
 * returns false when `file` appeared. A lock of a process that no longer runs is taken over.
 */
async function acquire(lock: string, file: string) {
  const notice = { last: 0 }
  while (true) {
    if (existsSync(file)) return false
    try {
      writeFileSync(lock, String(process.pid), { flag: "wx" })
      return true
    } catch {}
    const owner = readOwner(lock)
    if (owner === undefined || !alive(owner)) {
      rmSync(lock, { force: true })
      continue
    }
    if (Date.now() - notice.last >= 5_000) {
      notice.last = Date.now()
      console.error(`kilo2: importing Kilo v1 sessions in process ${owner}, waiting for it.`)
    }
    await Bun.sleep(250)
  }
}

function readOwner(lock: string) {
  try {
    const pid = Number(readFileSync(lock, "utf8"))
    return Number.isInteger(pid) && pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

/**
 * The release session store of Kilo v1: `kilo.db` in the `kilo` data directory. While kilo2 runs from its own `kilo2`
 * directory (D-4) that is the directory beside it; once the release renames the directory to `kilo`, it is the same
 * directory, and this keeps working as long as the kilo2 file names (`kilo2.db`, `kilo2-<channel>.db`) stay distinct
 * from v1's (`kilo.db`, `kilo-<channel>.db`).
 */
export function v1Store(data = Global.Path.data) {
  return path.join(path.dirname(data), "kilo", "kilo.db")
}

/**
 * Copies the database at `source` to `file` through SQLite. A read-only `VACUUM INTO` takes a consistent snapshot that
 * includes the pages still in the WAL, also while another process writes, and never writes the source database or its
 * WAL. The copy is written next to `file` and linked into place, so a process that starts at the same time never opens
 * a half-written file, and it is owner-only like the file the server opens. `check` can change or reject the copy
 * before it is reachable. No temporary copy stays behind.
 */
async function copy(source: string, file: string, check?: (copy: string) => Promise<void>) {
  const { Database } = await import("bun:sqlite")
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
    await check?.(temp)
    linkSync(temp, file)
    ownerOnly(file)
  } finally {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(`${temp}${suffix}`, { force: true })
  }
}

function ownerOnly(file: string) {
  if (process.platform !== "win32") chmodSync(file, 0o600)
}
