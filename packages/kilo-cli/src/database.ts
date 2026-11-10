// Kilo's session database file (host composition, rung 2). The host chooses the file before a server starts and gives
// it to the server as OPENCODE_DB, so the file name depends only on the Kilo build channel. A git branch or an upstream
// file name never selects it, and a rebuild from another branch opens the same sessions.
export * as KiloDatabase from "./database"

import {
  chmodSync,
  existsSync,
  linkSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
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
  await refuseV1Store(file)
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
  if (source === store) {
    const started = Date.now()
    try {
      const result = await importV1({
        store,
        file,
        data,
        log: (line) => console.error(line),
        onStart: () => console.error(`kilo2: importing Kilo v1 sessions from ${store} once; ${store} stays as it is.`),
        progress: (done, total) => console.error(`kilo2: importing Kilo v1 sessions ${done}/${total}`),
      })
      if (!result.skipped)
        console.error(
          `kilo2: importing Kilo v1 sessions done, ${result.imported} sessions in ${Date.now() - started} ms.`,
        )
    } catch (error) {
      if (existsSync(file)) return
      console.error(
        `kilo2: importing Kilo v1 sessions failed, starting with a new database. ${store} stays as it is; delete ${file} and start again to retry:`,
        error,
      )
    }
    return
  }
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

export type ImportResult = { readonly imported: number; readonly skipped: boolean }

/**
 * Imports the Kilo v1 store at `store` into a new store at `file`, and returns the session count. One process converts
 * while the others wait for it, so parallel starts (VS Code windows, the CLI) do not repeat the work. A failed import
 * leaves no store behind and throws; the caller starts with a new database. The v1 store is only read.
 *
 * Progress and log lines are the caller's: the automatic first start writes the `kilo2:` lines the VS Code client reads,
 * and the `import v1` command writes its own.
 */
export async function importV1(input: {
  readonly store: string
  readonly file: string
  readonly data: string
  readonly log?: (line: string) => void
  readonly onStart?: () => void
  readonly progress?: (done: number, total: number) => void
}): Promise<ImportResult> {
  const lock = `${input.file}.import.lock`
  try {
    if (!(await acquire(lock, input.file, input.log))) return { imported: 0, skipped: true }
    if (existsSync(input.file)) return { imported: 0, skipped: true }
    input.onStart?.()
    const { KiloV1Store } = await import("./v1-store")
    // The copy, the Kilo steps and the conversion run one after another, and the copy and the Kilo steps block the
    // process, so no timer can refresh the lock during them. Progress before and after each phase keeps the lock
    // fresh as long as no single phase takes longer than STALE.
    const imported =
      (await copy(input.store, input.file, (copy) =>
        KiloV1Store.convert(copy, {
          data: input.data,
          progress: (done, total) => {
            touch(lock)
            input.progress?.(done, total)
          },
        }),
      )) ?? 0
    return { imported, skipped: false }
  } finally {
    if (readOwner(lock) === process.pid) rmSync(lock, { force: true })
  }
}

/**
 * A lock whose owner has not reported progress for this long is stale: its process is stuck, or it died and its PID now
 * belongs to another process. The owner touches the lock with every progress line, about every two seconds.
 */
const STALE = 120_000

/**
 * Takes the import lock. While another process holds it and keeps it fresh, waits until `file` exists, and returns false
 * then. A lock of a process that no longer runs, or a stale one, is taken over. Any other failure to take the lock
 * throws, so the caller starts with a new database instead of waiting.
 */
async function acquire(lock: string, file: string, log?: (line: string) => void) {
  const notice = { last: 0 }
  while (true) {
    if (existsSync(file)) return false
    try {
      writeFileSync(lock, String(process.pid), { flag: "wx" })
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }
    const held = inspect(lock)
    // The owner released the lock between the two calls.
    if (!held) continue
    if ((held.owner !== undefined && !alive(held.owner)) || Date.now() - held.touched > STALE) {
      rmSync(lock, { force: true })
      continue
    }
    if (Date.now() - notice.last >= 5_000) {
      notice.last = Date.now()
      log?.(`kilo2: importing Kilo v1 sessions in process ${held.owner ?? "?"}, waiting for it.`)
    }
    await Bun.sleep(250)
  }
}

/** The owner of an existing lock and when it last reported progress; undefined when the lock is gone. */
function inspect(lock: string) {
  try {
    const stat = statSync(lock)
    if (!stat.isFile()) throw new Error(`${lock} is not a lock file`)
    return { owner: readOwner(lock), touched: stat.mtimeMs }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

function touch(lock: string) {
  const now = new Date()
  try {
    utimesSync(lock, now, now)
  } catch {}
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
 * Refuses to open a Kilo v1 store as the v2 store. The server would migrate that file in place, which rewrites the
 * user's only copy, and v1 could no longer read it. The v2 file name must stay distinct from v1's (`kilo2.db` and
 * `kilo2-<channel>.db` against `kilo.db` and `kilo-<channel>.db`), also after the release renames the data directory
 * from `kilo2` to `kilo`: at that point the v1 store lies in the same directory as the v2 store.
 */
export async function refuseV1Store(file: string) {
  if (!existsSync(file)) return
  const { KiloV1Store } = await import("./v1-store")
  if (!KiloV1Store.isV1Store(file)) return
  throw new Error(
    `${file} is a Kilo v1 session store, and kilo2 never migrates it in place: v1 could no longer read it. Keep the kilo2 store name distinct from v1's (kilo2.db or kilo2-<channel>.db), or move the v1 store before starting kilo2.`,
  )
}

/**
 * Copies the database at `source` to `file` through SQLite. A read-only `VACUUM INTO` takes a consistent snapshot that
 * includes the pages still in the WAL, also while another process writes, and never writes the source database or its
 * WAL. The copy is written next to `file` and linked into place, so a process that starts at the same time never opens
 * a half-written file, and it is owner-only like the file the server opens. `check` can change or reject the copy
 * before it is reachable. No temporary copy stays behind.
 */
async function copy<A>(source: string, file: string, check?: (copy: string) => Promise<A>): Promise<A | undefined> {
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
    const result = await check?.(temp)
    linkSync(temp, file)
    ownerOnly(file)
    return result
  } finally {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(`${temp}${suffix}`, { force: true })
  }
}

function ownerOnly(file: string) {
  if (process.platform !== "win32") chmodSync(file, 0o600)
}
