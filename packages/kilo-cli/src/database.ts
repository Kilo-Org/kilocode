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
 */
export async function select(
  env: Record<string, string | undefined>,
  input = { data: Global.Path.data, channel },
): Promise<string> {
  // A store named by the caller or by `KILO2_DB` goes through the same guard: the server would migrate a Kilo v1 store
  // in place and v1 could no longer read it.
  if (env.OPENCODE_DB) {
    await refuseV1Store(env.OPENCODE_DB)
    return env.OPENCODE_DB
  }
  const shared = env.KILO_DISABLE_CHANNEL_DB === "1" || env.KILO_DISABLE_CHANNEL_DB === "true"
  // kilo_port(unattributed:core/database:a155cf41e765)
  const file =
    shared || release.includes(input.channel)
      ? path.join(input.data, "kilo2.db")
      : path.join(input.data, `kilo2-${safe(input.channel)}.db`)
  await refuseV1Store(file)
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
 * most sessions, so an empty file of this channel cannot hide the sessions of another branch. The copy is written next
 * to `file` and linked into place, so a process that starts at the same time never opens a half-written file, and it is
 * owner-only like the file the server opens. If the copy fails, the server starts with a new database, the old file
 * stays as it is, and stderr names both files.
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
  // Each candidate is opened once.
  const populated = files
    .map((candidate) => ({ file: candidate, sessions: sessions(candidate) }))
    .filter((entry) => entry.sessions > 0)
    .toSorted((a, b) => b.sessions - a.sessions)
  const primary = legacy(data, channel, shared)
  const source = populated[0]?.file ?? (files.includes(primary) ? primary : undefined)
  if (!source) return
  // A Kilo v1 store stays where it is. Copying it would create the store that `refuseV1Store` protects, and only the
  // explicit import may convert it.
  if ((await import("./v1-store")).KiloV1Store.isKiloV1Store(source)) {
    console.error(
      `kilo2: ${source} is a Kilo v1 session store, so it stays as it is and its sessions are not adopted. Run \`kilo2 import v1\` to bring them forward, and kilo2 starts with a new database meanwhile.`,
    )
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
 * while the others wait for it, so parallel imports do not repeat the work. A failed import leaves no store behind and
 * throws. The v1 store is only read, also while `since` builds a windowed copy of it.
 */
export async function importV1(input: {
  readonly store: string
  readonly file: string
  readonly data: string
  readonly since?: number
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
    // process, so no timer can refresh the lock during them. Progress before and after each phase, and every copied
    // batch, keeps the lock fresh as long as no single step takes longer than STALE.
    const imported = await copy(input.store, input.file, {
      since: input.since,
      onProgress: () => touch(lock),
      check: (copy) =>
        KiloV1Store.convert(copy, {
          data: input.data,
          progress: (done, total) => {
            touch(lock)
            input.progress?.(done, total)
          },
        }),
    })
    if (imported === undefined) return { imported: 0, skipped: true }
    return { imported, skipped: false }
  } finally {
    if (readOwner(lock) === process.pid) releaseLock(lock, input.log)
  }
}

/**
 * Imports the Kilo v1 store at `store` into the existing kilo2 store at `file`, and returns the number of sessions it
 * added. The window is converted into a private store beside `file` first, so a failed conversion leaves `file` as it
 * is. Sessions `file` already holds are kept as they are, so running it again only adds new sessions.
 */
export async function mergeV1(input: {
  readonly store: string
  readonly file: string
  readonly data: string
  readonly since?: number
  readonly progress?: (done: number, total: number) => void
}) {
  const scratch = `${input.file}.${process.pid}.import`
  try {
    const { KiloV1Store } = await import("./v1-store")
    await copy(input.store, scratch, {
      since: input.since,
      check: (copy) => KiloV1Store.convert(copy, { data: input.data, progress: input.progress }),
    })
    const { merge } = await import("./import/merge")
    return merge(scratch, input.file)
  } finally {
    for (const suffix of ["", "-wal", "-shm", "-journal"])
      if (!remove(`${scratch}${suffix}`))
        console.error(`kilo2: could not remove ${scratch}${suffix}. Delete it by hand.`)
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
      holding.add(lock)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }
    const held = inspect(lock)
    // The owner released the lock between the two calls.
    if (!held) continue
    // A lock that names this process but is not held here is left over from an earlier run, which this process cannot be
    // waiting for.
    const stale =
      (held.owner === process.pid && !holding.has(lock)) ||
      (held.owner !== undefined && !alive(held.owner)) ||
      Date.now() - held.touched > STALE
    if (stale) {
      removeLock(lock)
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
  } catch {
    // A lock that another process took over is not ours to keep fresh, and reporting a lost lock here would turn every
    // progress report into an error. The publish step detects the loss instead.
  }
}

/**
 * Removes the lock when the import ends. A lock that stays behind is visible in the log: the next run of this process
 * takes it over at once, but another process waits for it to go stale.
 */
function releaseLock(lock: string, log?: (line: string) => void) {
  holding.delete(lock)
  try {
    rmSync(lock, { force: true })
  } catch (error) {
    log?.(`kilo2: could not remove the import lock ${lock}: ${String(error)}`)
  }
}

/** The locks this process holds, so a lock left over by an earlier run here is told apart from a running import. */
const holding = new Set<string>()

/** Removes a stale lock. A lock that cannot be removed fails the import, so `acquire` cannot spin on the same lock. */
function removeLock(lock: string) {
  try {
    rmSync(lock, { force: true })
  } catch (error) {
    throw new Error(
      `kilo2: could not remove the stale import lock ${lock}, so the import did not start. Delete it and run the import again: ${String(error)}`,
    )
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
 * Refuses to open a Kilo v1 store as the v2 store. The server would migrate that file in place, which rewrites the
 * user's only copy, and v1 could no longer read it. The v2 file name must stay distinct from v1's (`kilo2.db` and
 * `kilo2-<channel>.db` against `kilo.db` and `kilo-<channel>.db`), also after the release renames the data directory
 * from `kilo2` to `kilo`: at that point the v1 store lies in the same directory as the v2 store.
 */
export async function refuseV1Store(file: string) {
  if (!existsSync(file)) return
  const { KiloV1Store } = await import("./v1-store")
  const verdict = KiloV1Store.inspect(file)
  // Silence is only safe when the file is known not to be a v1 store, so an unreadable file stops the start instead.
  if (verdict === "unreadable")
    throw new Error(
      `${file} could not be read, so kilo2 cannot check that it is not a Kilo v1 session store. Fix its permissions or move it away, then start kilo2 again.`,
    )
  if (verdict !== "v1") return
  throw new Error(
    `${file} is a Kilo v1 session store, and kilo2 never migrates it in place: v1 could no longer read it. Keep the kilo2 store name distinct from v1's (kilo2.db or kilo2-<channel>.db), or move the v1 store before starting kilo2.`,
  )
}

/**
 * Copies the database at `source` to `file`. Without `since`, a read-only `VACUUM INTO` takes a consistent snapshot that
 * includes the pages still in the WAL; with `since`, ./import/extract builds the copy from the selected sessions only.
 * Either way the source database and its WAL are never written. The copy is written next to `file` and linked into
 * place, so a process that starts at the same time never opens a half-written file, and it is owner-only like the file
 * the server opens. `check` can change or reject the copy before it is reachable. No temporary copy stays behind.
 */
async function copy<A>(
  source: string,
  file: string,
  input: { since?: number; onProgress?: () => void; check?: (copy: string) => Promise<A> } = {},
): Promise<A | undefined> {
  const temp = `${file}.${process.pid}.adopt`
  // SQLite creates the copy with the process umask, and a full copy holds the v1 credentials until the Kilo steps clear
  // them, so the copy is written owner-only from the first byte instead of being tightened after it is complete.
  const umask = process.umask(0o077)
  try {
    if (input.since === undefined) {
      const { changed, openReadonly } = await import("./sqlite-readonly")
      const reader = openReadonly(source)
      try {
        // `VACUUM INTO` blocks for minutes on a large store, so the lock is refreshed on both sides of it.
        input.onProgress?.()
        reader.db.run("VACUUM INTO ?", [temp])
        input.onProgress?.()
      } finally {
        reader.db.close()
      }
      if (!reader.unchanged()) throw changed(source)
    } else {
      const { extract } = await import("./import/extract")
      extract(source, temp, input.since, input.onProgress)
    }
    // SQLite creates the copy with the process umask, so make it owner-only before it is reachable under `file`.
    ownerOnly(temp)
    const result = await input.check?.(temp)
    try {
      linkSync(temp, file)
    } catch (error) {
      // Another process published its copy first. That copy is the store, so this one has nothing left to do.
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined
      throw error
    }
    ownerOnly(file)
    return result
  } finally {
    process.umask(umask)
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const leftover = `${temp}${suffix}`
      // A temporary copy that cannot be removed holds session data, so it is reported rather than dropped silently.
      if (!remove(leftover)) console.error(`kilo2: could not remove the temporary copy ${leftover}. Delete it by hand.`)
    }
  }
}

function ownerOnly(file: string) {
  if (process.platform !== "win32") chmodSync(file, 0o600)
}

/**
 * Removes a temporary copy, which Windows can still hold for a moment after SQLite closes it. Returns whether the file
 * is gone, so the caller can report a copy that stays behind.
 */
function remove(file: string) {
  for (let attempt = 0; attempt <= 4; attempt++) {
    try {
      rmSync(file, { force: true })
      return true
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt === 4 || (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY")) return !existsSync(file)
      Bun.sleepSync(50)
    }
  }
  return !existsSync(file)
}
