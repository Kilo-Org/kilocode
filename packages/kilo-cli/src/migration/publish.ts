import { Database, SQLiteError } from "bun:sqlite"
import fs from "node:fs"
import path from "node:path"
import { snapshot } from "./snapshot"
import { beginStage, identity, recordedStage, syncDir } from "./stage-record"

const family = ["", "-wal", "-journal", "-shm"]

/** Consent-only: the caller owns the migration, has stopped all clients, and keeps them stopped through cutover.
 * build must close its connections before returning. Only a fully checkpointed, verified stage may be renamed. */
export async function stageAndPublish(
  source: string,
  backup: string,
  build: (stage: string) => Promise<void>,
  progress: (phase: string) => void,
  options: { journal?: string } = {},
): Promise<void> {
  const dir = fs.realpathSync.native(path.dirname(source))
  const file = path.join(dir, path.basename(source)) // Resolve parent aliases, never follow a database symlink.
  const dest = path.join(dir, path.basename(backup))
  if (dir !== fs.realpathSync.native(path.dirname(backup))) throw new Error("Recovery must be beside the database")
  if (family.some((s) => family.some((b) => (file + s).toLowerCase() === (dest + b).toLowerCase())))
    throw new Error(`Recovery path overlaps the database: ${dest}`)
  checkVolume(dir, file)
  unused(dest)
  const before = state(file)
  const scratch = fs.mkdtempSync(path.join(dir, ".kilo-cutover-"))
  const stage = path.join(scratch, "converted.db")
  let registered = false
  try {
    const beforeLink = options.journal ? beginStage(options.journal, file, scratch) : undefined
    registered = !!beforeLink
    await snapshot(file, stage, progress)
    unchanged(file, before)
    await build(stage)
    progress("Verifying converted database")
    prepareStage(stage)
    progress("Publishing database and recovery file")
    unused(dest)
    unchanged(file, before)
    const standalone = checkpointSource(file, before)
    publish(file, standalone, stage, dest, beforeLink)
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
    // If publication was interrupted, explicit recovery consumes its journal.
    // Successful publication keeps the journal until the recovery inode is verified.
    if (registered && options.journal && !fs.existsSync(dest)) recordedStage(options.journal, file)?.remove()
  }
}

export function linkedOriginal(source: string, backup: string) {
  return fs.existsSync(backup) && identity(source) === identity(backup)
}

/** Only under the owner lock after renewed consent. Both names must still identify
 * the exact private original for which this run recorded its intent to link. */
export function retryPublication(source: string, backup: string, journal: string) {
  const stage = recordedStage(journal, source)
  if (fs.lstatSync(backup, { throwIfNoEntry: false })) {
    const st = fs.lstatSync(source)
    if (
      !stage?.linking ||
      !linkedOriginal(source, backup) ||
      !st.isFile() ||
      st.nlink !== 2 ||
      st.uid !== process.geteuid?.() ||
      st.mode & 0o077
    )
      throw new Error(`Unverified recovery link; keep both files and inspect ${backup}`)
    if (
      family
        .slice(1)
        .some(
          (s) =>
            fs.lstatSync(backup + s, { throwIfNoEntry: false }) || fs.lstatSync(source + s, { throwIfNoEntry: false }),
        )
    )
      throw new Error(`Close clients and inspect recovery sidecars at ${backup}`)
    using guard = exclusive(source)
    if (guard.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode !== "delete")
      throw new Error(`Recovery link is not standalone: ${backup}`)
    if (!linkedOriginal(source, backup) || fs.lstatSync(source).nlink !== 2)
      throw new Error(`Recovery link changed: ${backup}`)
    fs.unlinkSync(backup)
    syncDir(path.dirname(backup))
  }
  stage?.remove()
}

function checkVolume(dir: string, file: string) {
  // Darwin's statfs f_type is assigned at boot, not a stable APFS identifier. df queries the mount by pathname.
  const local =
    process.platform === "darwin"
      ? Bun.spawnSync(["/bin/df", "-t", "apfs", dir], { stdout: "ignore", stderr: "ignore" }).exitCode === 0
      : process.platform === "linux" && ["ext4", "xfs", "btrfs"].includes(linuxVolume(dir))
  if (!local) throw new Error(`Safe database replacement requires local APFS, ext4, XFS or Btrfs: ${dir}`)
  const parent = fs.statSync(dir)
  if (parent.uid !== process.geteuid?.() || parent.mode & 0o022) throw new Error(`Untrusted database directory: ${dir}`)
  if (fs.lstatSync(file).dev !== parent.dev) throw new Error(`Database and recovery must be on one filesystem: ${file}`)
}

function linuxVolume(dir: string) {
  // ext2/3/4 share a magic number. Use the actual mount behind this fd (including bind mounts).
  const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY)
  try {
    const id = /^mnt_id:\s*(\d+)$/m.exec(fs.readFileSync(`/proc/self/fdinfo/${fd}`, "utf8"))?.[1]
    const mount = fs
      .readFileSync("/proc/self/mountinfo", "utf8")
      .split("\n")
      .find((line) => line.startsWith(`${id} `))
    return mount?.split(" - ")[1]?.split(" ")[0] ?? ""
  } finally {
    fs.closeSync(fd)
  }
}

function unused(dest: string) {
  for (const suffix of family) {
    if (fs.lstatSync(dest + suffix, { throwIfNoEntry: false }))
      throw new Error(`Recovery file already exists: ${dest + suffix}`)
  }
}

function regular(file: string) {
  const st = fs.lstatSync(file, { bigint: true, throwIfNoEntry: false })
  if (st && (!st.isFile() || st.nlink !== 1n)) throw new Error(`Expected an unaliased regular file: ${file}`)
  return st
}

function stamp(st: fs.BigIntStats) {
  return `${st.dev}:${st.ino}:${st.size}:${st.ctimeNs}:${st.mtimeNs}`
}

function state(file: string) {
  const main = regular(file)
  if (!main) throw new Error(`Missing database: ${file}`)
  if (regular(file + "-journal")) throw new Error(`Resolve the rollback journal before migrating: ${file}`)
  // SQLite readers may create/rebuild shm and create an empty WAL. Neither carries committed history.
  regular(file + "-shm")
  const wal = regular(file + "-wal")
  return `${stamp(main)}|${wal?.size ? stamp(wal) : ""}`
}

function unchanged(file: string, expected: string) {
  if (state(file) !== expected) throw new Error(`Database changed since staging: ${file}`)
}

function exclusive(file: string) {
  const db = new Database(file, { readwrite: true, create: false })
  try {
    // BEGIN EXCLUSIVE alone in WAL mode would still allow readers. Exclusive locking mode takes the
    // database-file lock, and retains it after COMMIT so SQLite can checkpoint outside a transaction.
    db.exec("PRAGMA busy_timeout = 0; PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT")
    requireReaderBlocked(file)
    return db
  } catch (cause) {
    db.close()
    if (cause instanceof SQLiteError && /^(SQLITE_BUSY|SQLITE_LOCKED)/.test(cause.code ?? ""))
      throw new Error(`Another SQLite client is using ${file}. Close it before migrating.`, { cause })
    throw cause
  }
}

function requireReaderBlocked(file: string) {
  // SQLite may fall back from READWRITE to a readonly connection. BEGIN EXCLUSIVE can then succeed
  // while only taking a shared lock. Verify the actual exclusion with an independent SQLite reader.
  try {
    using reader = new Database(file, { readonly: true })
    reader.exec("PRAGMA busy_timeout = 0; PRAGMA schema_version")
  } catch (cause) {
    if (cause instanceof SQLiteError && /^(SQLITE_BUSY|SQLITE_LOCKED)/.test(cause.code ?? "")) return
    throw cause
  }
  throw new Error(`SQLite did not exclude other readers: ${file}`)
}

function standalone(db: Database) {
  const checkpoint = db
    .query<{ busy: number; log: number; checkpointed: number }, []>("PRAGMA wal_checkpoint(TRUNCATE)")
    .get()
  if (!checkpoint || checkpoint.busy !== 0 || checkpoint.log !== checkpoint.checkpointed)
    throw new Error("SQLite could not checkpoint all committed history")
  const mode = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode = DELETE").get()
  if (mode?.journal_mode !== "delete") throw new Error("SQLite could not leave WAL mode")
}

function prepareStage(stage: string) {
  if (!regular(stage)?.size) throw new Error(`Missing converted database: ${stage}`)
  for (const suffix of family.slice(1)) regular(stage + suffix)
  {
    using db = exclusive(stage)
    standalone(db)
    const check = db.query<{ quick_check: string }, []>("PRAGMA quick_check").all()
    if (check.length !== 1 || check[0]?.quick_check !== "ok")
      throw new Error("Converted database failed SQLite verification")
  }
  if (regular(stage + "-wal") || regular(stage + "-journal")) throw new Error("Converted database still needs sidecars")
  fs.chmodSync(stage, 0o600)
  sync(stage)
  sync(path.dirname(stage))
}

function checkpointSource(file: string, before: string) {
  using db = exclusive(file)
  unchanged(file, before)
  standalone(db)
  // Capture under the lock, not after close: the final guard must detect writes even in this handoff.
  return `${stamp(fs.lstatSync(file, { bigint: true }))}|`
}

function publish(file: string, expected: string, stage: string, dest: string, beforeLink?: () => void) {
  const dir = path.dirname(file)
  // Open no non-SQLite fds on the original inside the fence: closing one releases POSIX process locks.
  sync(file)
  unchanged(file, expected)
  using guard = exclusive(file)
  guard.exec("BEGIN EXCLUSIVE")
  unchanged(file, expected)
  // This fresh handle never entered WAL mode or opened a journal. Its close after rename must not
  // checkpoint/unlink sidecars at the canonical name, which will then belong to another inode.
  if (
    guard.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode !== "delete" ||
    regular(file + "-wal")
  )
    throw new Error(`Database is not standalone: ${file}`)
  // VACUUM INTO can rebuild indexes. Verify the actual checkpointed inode that recovery will expose,
  // not just the reconstructed snapshot. Do not open the same DB at its hard-link name.
  const check = guard.query<{ integrity_check: string }, []>("PRAGMA integrity_check(1)").get()
  if (check?.integrity_check !== "ok") throw new Error(`Original database failed integrity check: ${file}`)
  if (regular(file + "-shm")) fs.renameSync(file + "-shm", path.join(path.dirname(stage), "obsolete-shm"))
  unused(dest)
  // Tighten the existing inode before a second name can expose it. Do not
  // open and close another fd on it while SQLite holds its POSIX lock.
  beforeLink?.()
  protectRecovery(file)
  fs.linkSync(file, dest) // Atomic no-replace. Never remove an existing recovery path, even on error.
  sync(dir)
  fs.renameSync(stage, file)
  try {
    sync(dir)
  } catch (cause) {
    throw new Error(`Database replaced, but final directory sync failed. Inspect ${file} and recovery ${dest}.`, {
      cause,
    })
  }
}

function protectRecovery(file: string) {
  if (fs.lstatSync(file).uid !== process.geteuid?.())
    throw new Error(`Recovery database must belong to this user: ${file}`)
  // Darwin ACL grants are independent of the POSIX mode. Do not silently strip a user's ACL.
  if (process.platform === "darwin") {
    const list = Bun.spawnSync(["/bin/ls", "-lde", file], { env: { LC_ALL: "C" } })
    if (list.exitCode || /\n\s*\d+:/.test(list.stdout.toString()))
      throw new Error(`Review recovery file ACL before migration: ${file}`)
  }
  fs.chmodSync(file, 0o600)
  if ((fs.lstatSync(file).mode & 0o7777) !== 0o600) throw new Error(`Cannot make recovery private: ${file}`)
}

function sync(file: string) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}
