import { constants, Database, SQLiteError } from "bun:sqlite"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const sidecars = ["-wal", "-shm", "-journal"]

/** Consent-only. Publish a standalone recovery database in an existing, trusted backup directory.
 * Call before opening the source in the host. Keep legacy clients stopped through the subsequent cutover:
 * this function fences writers only while capturing. SQLite may update its ephemeral WAL index. */
export async function snapshot(source: string, backup: string, onProgress?: (msg: string) => void): Promise<void> {
  const file = fs.realpathSync.native(source)
  const dir = fs.realpathSync.native(path.dirname(backup))
  const dest = path.join(dir, path.basename(backup))
  if (["", ...sidecars].some((suffix) => `${file}${suffix}`.toLowerCase() === dest.toLowerCase()))
    throw new Error(`Backup overlaps the source database: ${dest}`)
  requireUnused(dest)
  const main = fs.statSync(file, { bigint: true })
  if (!main.isFile() || main.size < 100n) throw new Error(`Expected a SQLite database at ${file}`)
  if (main.nlink !== 1n) throw new Error(`Cannot safely snapshot a database with multiple hard links: ${file}`)
  fs.accessSync(file, fs.constants.W_OK) // A read-only handle cannot reserve the writer slot.
  const scratch = fs.mkdtempSync(path.join(dir, ".kilo-snapshot-")) // 0700 on POSIX
  const staged = path.join(scratch, "recovery.db")
  try {
    // Closing a non-SQLite fd for the source can drop process-wide POSIX locks. If the clone syscall fails,
    // close both connections and reacquire SQLite's writer reservation before starting the portable copy.
    if (!capture(file, staged, main.dev === fs.statSync(dir, { bigint: true }).dev, onProgress)) {
      fs.rmSync(staged, { force: true })
      capture(file, staged, false, onProgress)
    }
    onProgress?.("Verifying recovery database")
    verify(staged)
    fs.chmodSync(staged, 0o600)
    sync(staged, "r+")
    requireUnused(dest)
    // Scratch is on the destination volume. link(), unlike rename(), cannot replace an existing recovery file.
    fs.linkSync(staged, dest)
    if (process.platform !== "win32") sync(dir, "r")
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 3 })
  }
}

function requireUnused(dest: string) {
  for (const suffix of ["", ...sidecars]) {
    if (fs.lstatSync(dest + suffix, { throwIfNoEntry: false }))
      throw new Error(`Recovery file already exists: ${dest + suffix}`)
  }
}

function capture(source: string, staged: string, tryClone: boolean, progress?: (msg: string) => void) {
  // Do not run crash recovery against the original. An ordinary writer also owns this journal while
  // it is updating the main file. In either case the user must quiesce it before migration.
  if (fs.existsSync(`${source}-journal`))
    throw new Error(`Close SQLite clients and recover the rollback journal for ${source} before migrating`)
  using pin = new Database(source, { readonly: true })
  using lock = new Database(source, { readwrite: true, create: false })
  reserveWriter(source, pin, lock)

  const before = stamp(source)
  const wal = fs.statSync(`${source}-wal`, { bigint: true, throwIfNoEntry: false })?.size ?? 0n
  requireSpace(path.dirname(staged), fs.statSync(source, { bigint: true }).size + wal)

  if (tryClone && wal === 0n && !fs.existsSync(`${source}-journal`)) {
    progress?.("Cloning recovery database")
    if (!clone(source, staged)) return false
    if (
      stamp(source) !== before ||
      fs.statSync(`${source}-wal`, { throwIfNoEntry: false })?.size ||
      fs.existsSync(`${source}-journal`)
    )
      throw new Error(`Source changed while cloning ${source}`)
    return true
  }

  progress?.("Copying recovery database with SQLite")
  // VACUUM cannot run inside the pinned transaction. Its own reader sees all committed WAL frames.
  using reader = new Database(source, { readonly: true })
  reader.run("VACUUM INTO ?", [staged])
  if (stamp(source) !== before) throw new Error(`Source changed while copying ${source}`)
  return true
}

function pinRead(db: Database) {
  db.run("BEGIN")
  db.query("PRAGMA schema_version").get()
}

function reserveWriter(source: string, pin: Database, lock: Database) {
  try {
    // Keep a readonly reader alive across the writable connection's close, preventing any last-close
    // checkpoint. Protect existing WAL frames first. At rest Darwin needs the writable handle to go
    // first: a readonly handle can't initialize a missing WAL or promote a rollback-mode file lock.
    pin.run("PRAGMA busy_timeout=0")
    if (fs.existsSync(`${source}-wal`)) pinRead(pin)
    lock.run("PRAGMA busy_timeout=0")
    lock.run("BEGIN IMMEDIATE") // No DML, PRAGMA that writes, or checkpoint on this handle.
    if (!pin.inTransaction) pinRead(pin)
  } catch (cause) {
    if (cause instanceof SQLiteError && /^(SQLITE_BUSY|SQLITE_LOCKED)/.test(cause.code ?? ""))
      throw new Error(`Another SQLite client is using ${source}. Close it before migrating.`, { cause })
    throw cause
  }
}

function stamp(file: string) {
  const st = fs.statSync(file, { bigint: true })
  return `${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`
}

function requireSpace(dir: string, needed: bigint) {
  const volume = fs.statfsSync(dir, { bigint: true })
  const available = volume.bavail * volume.bsize
  if (available < needed)
    throw new Error(`Insufficient space for recovery database: need ${needed} bytes, have ${available}`)
}

function clone(source: string, dest: string) {
  try {
    fs.copyFileSync(source, dest, fs.constants.COPYFILE_FICLONE_FORCE | fs.constants.COPYFILE_EXCL)
    return true
  } catch (cause) {
    if (
      ["EXDEV", "ENOTSUP", "EOPNOTSUPP", "EINVAL", "ENOTTY", "ENOSYS"].includes(
        (cause as NodeJS.ErrnoException).code ?? "",
      )
    )
      return false
    throw cause
  }
}

function verify(file: string) {
  if (fs.statSync(file).size < 100) throw new Error("Recovery database has no SQLite header")
  // A clone may inherit WAL mode. Make the *private copy* readable even by a readonly connection
  // on systems that cannot initialize a missing WAL. Never change the source's journal mode.
  {
    using staged = new Database(file, { readwrite: true, create: false })
    if (staged.query<{ journal_mode: string }, []>("PRAGMA journal_mode=DELETE").get()?.journal_mode !== "delete")
      throw new Error("Recovery database still requires a journal")
  }
  // Verify the standalone file, without sidecar-assisted recovery making a broken backup appear good.
  using db = new Database(
    `${pathToFileURL(file).href}?immutable=1`,
    constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI,
  )
  const rows = db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").all()
  if (rows.length !== 1 || rows[0]?.integrity_check !== "ok")
    throw new Error(`Recovery database integrity check failed: ${rows[0]?.integrity_check}`)
}

function sync(file: string, flags: string) {
  const fd = fs.openSync(file, flags)
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}
