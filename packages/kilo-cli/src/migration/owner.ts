import { Database, SQLiteError } from "bun:sqlite"
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"

const progress = z.object({ phase: z.string(), done: z.number().optional(), total: z.number().optional() })
const failure = progress.extend({ status: z.enum(["failed", "interrupted"]), message: z.string() })
const snapshot = z.discriminatedUnion("status", [
  progress.extend({ status: z.enum(["running", "completed"]) }),
  failure,
])

export type MigrationProgress = z.infer<typeof progress>
export type MigrationState = z.infer<typeof snapshot>
export type OwnerState = MigrationState
type Work = (update: (state: MigrationProgress) => void) => Promise<void>
type Observe = (state: OwnerState) => void
type Validate = () => void | Promise<void>

export class MigrationRunError extends Error {
  readonly status: "failed" | "interrupted"
  readonly progress: MigrationProgress

  constructor(state: z.infer<typeof failure>, options?: ErrorOptions) {
    super(state.message, options)
    this.name = "MigrationRunError"
    this.status = state.status
    this.progress = progress.parse(state)
  }
}

/** Call only after consent. Each canonical source path has one owner. All terminal outcomes are replayed,
 * including failures: an interrupted conversion may already have published changes that need recovery. */
export async function withOwner(source: string, work: Work, observe?: Observe): Promise<void> {
  const dir = sidecar(source)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  using lock = new Database(path.join(dir, "owner.sqlite"))
  const notify = observer(observe)
  lock.run("PRAGMA busy_timeout = 0")
  while (!acquire(lock)) {
    const current = read(dir)
    if (current) notify(current)
    if (current && current.status !== "running") return result(current)
    await Bun.sleep(200)
  }

  const publish = publisher(dir, notify)
  const previous = read(dir)
  if (previous?.status === "running") {
    const ended = interrupted(previous)
    publish(ended)
    throw new MigrationRunError(ended)
  }
  if (previous) {
    notify(previous)
    return result(previous)
  }
  await run(work, publish)
}

/** Explicit recovery only. validate must throw unless the source is still an unconverted store and no recovery
 * backup exists. The caller must obtain fresh consent; ordinary withOwner callers cannot start a retry. */
export function retryOwner(source: string, validate: Validate, work: Work, observe?: Observe): Promise<void> {
  return recover(source, validate, (publish) => run(work, publish), observe)
}

/** Repair the result of an already-published conversion without converting again. validate must verify the full
 * published store and its recovery backup, and throw on any mismatch. Only the result sidecar is updated. */
export function finishRecovered(source: string, validate: Validate, observe?: Observe): Promise<void> {
  return recover(source, validate, (publish) => publish({ phase: "Recovery verified", status: "completed" }), observe)
}

async function recover(
  source: string,
  validate: Validate,
  resume: (publish: Observe) => void | Promise<void>,
  observe?: Observe,
) {
  const dir = sidecar(source)
  const file = path.join(dir, "owner.sqlite")
  if (!existsSync(file)) throw new Error("No migration run to recover")
  using lock = new Database(file, { readwrite: true, create: false })
  lock.run("PRAGMA busy_timeout = 0")
  // Never queue a recovery behind an active attempt: its eventual failure is not consent to start another one.
  if (!acquire(lock)) throw new Error("Migration lock is busy; recovery was not started")
  const previous = read(dir)
  if (!previous) throw new Error("No migration run to recover")
  if (previous.status === "completed") throw new Error("Migration already completed")
  // A still-'running' snapshot under our exclusive lock is an interruption. Validation failure leaves its original
  // evidence (or the recorded failure) intact. The lock spans validation, work, and the final state write.
  await validate()
  await resume(publisher(dir, observer(observe)))
}

function publisher(dir: string, notify: Observe): Observe {
  const file = path.join(dir, "state.json")
  return (state) => {
    // Only the lock holder writes. A process crash leaves readers the whole old or the whole new snapshot.
    writeFileSync(`${file}.new`, JSON.stringify(state), { mode: 0o600, flush: true })
    renameSync(`${file}.new`, file)
    notify(state)
  }
}

async function run(work: Work, publish: Observe) {
  let current: MigrationProgress = { phase: "starting" }
  publish({ ...current, status: "running" })
  let active = true
  try {
    await work((next) => {
      if (!active) return
      current = progress.parse(next)
      publish({ ...current, status: "running" })
    })
  } catch (cause) {
    const ended = {
      ...current,
      status: "failed" as const,
      message: cause instanceof Error ? cause.message : String(cause),
    }
    publish(ended)
    throw new MigrationRunError(ended, { cause })
  } finally {
    active = false
  }
  publish({ ...current, status: "completed" })
}

/** Inspect without starting or repairing a run. No sidecar exists until the first consenting caller. */
export function readOwner(source: string): OwnerState | undefined {
  const dir = existingSidecar(source)
  if (dir) return inspect(dir)
}

/** Follow the latest snapshots of an existing run, without ever competing for ownership. */
export async function observeOwner(source: string, observe: (state: OwnerState) => void): Promise<void> {
  const dir = existingSidecar(source)
  const notify = observer(observe)
  while (true) {
    const state = dir && inspect(dir)
    if (!state) throw new Error("No migration run to observe")
    notify(state)
    if (state.status !== "running") return result(state)
    await Bun.sleep(200)
  }
}

function sidecar(source: string) {
  const file = realpathSync.native(source)
  const dir = path.dirname(file)
  return path.basename(dir) === "kilo"
    ? path.join(dir, "..", "kilo2", "migration", path.basename(file))
    : `${file}.kilo2-migration`
}

function existingSidecar(source: string) {
  try {
    return sidecar(source)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
}

// SQLite holds the exclusive lock until this connection closes, even if the event loop cannot run for minutes.
// No process ever deletes this file: replacing its inode would create a second, independent lock.
function acquire(lock: Database) {
  try {
    lock.run("BEGIN EXCLUSIVE")
    return true
  } catch (error) {
    if (error instanceof SQLiteError && error.code === "SQLITE_BUSY") return false
    throw error
  }
}

function interrupted(state: OwnerState) {
  return { ...state, status: "interrupted" as const, message: "Migration owner exited before recording a result" }
}

function result(current: OwnerState) {
  if ("message" in current) throw new MigrationRunError(current)
}

function read(dir: string) {
  try {
    return snapshot.parse(JSON.parse(readFileSync(path.join(dir, "state.json"), "utf8")))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
}

function inspect(dir: string) {
  const current = read(dir)
  if (current?.status !== "running") return current
  using probe = new Database(path.join(dir, "owner.sqlite"), { readonly: true })
  probe.run("PRAGMA busy_timeout = 0")
  try {
    // A SHARED reader lock is incompatible with the owner's EXCLUSIVE lock. Hold it through the second read:
    // the owner may have completed between the first snapshot and our probe.
    probe.exec("BEGIN; PRAGMA schema_version")
  } catch (error) {
    if (error instanceof SQLiteError && error.code === "SQLITE_BUSY") return current
    throw error
  }
  const latest = read(dir)
  return latest?.status === "running" ? interrupted(latest) : latest
}

function observer(observe?: (state: OwnerState) => void) {
  let observed: string | undefined
  return (state: OwnerState) => {
    if (!observe) return
    const text = JSON.stringify(state)
    if (observed === text) return
    observed = text
    try {
      observe({ ...state })
    } catch {
      // A broken progress display must not change the outcome of the shared migration.
    }
  }
}
