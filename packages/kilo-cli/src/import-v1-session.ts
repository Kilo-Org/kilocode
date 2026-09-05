import { Database } from "bun:sqlite"
import { chmodSync, createReadStream, lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { link } from "node:fs/promises"
import path from "node:path"

// Explicit, opt-in V1 session-store copy for the isolated kilo2 identity.
// This module owns the two proven-safe steps only: read-only source
// inspection and a WAL-consistent, no-clobber copy. The source is never
// opened for writing, but note that any read-only SQLite reader may still
// update the source's `-shm` wal-index read marks. No migration is wired or
// authorized here: running schema migrations or `V1Migration` against the
// copy is host wiring owned by the CLI command slice. The caller is expected
// to pass a destination inside the isolated kilo2 layout (see
// `layout()`/`preflight()` in ./paths); this module enforces only
// source/destination isolation. Auth/config import is owned elsewhere.
// Evidence: kilocode/baseline/v1-session-schema-audit.md.

const REQUIRED_TABLES = ["session", "message", "part"] as const

export type SourceInspection = {
  readonly path: string
  readonly bytes: number
  readonly walBytes: number
  readonly sessions: number
  readonly messages: number
  readonly parts: number
  /** Journal ids recorded in the store's `migration` table, when present. */
  readonly migrations: ReadonlyArray<string>
}

export type CopyReport = {
  readonly source: SourceInspection & { readonly sha256: string }
  readonly destination: string
  readonly bytes: number
}

async function digest(filename: string) {
  const stat = lstatSync(filename, { throwIfNoEntry: false })
  if (!stat) return { bytes: 0, sha256: "" }
  const hasher = new Bun.CryptoHasher("sha256")
  for await (const chunk of createReadStream(filename)) hasher.update(chunk)
  return { bytes: stat.size, sha256: hasher.digest("hex") }
}

function protectedSources(filename: string) {
  return [filename, `${filename}-wal`, `${filename}-shm`]
}

// Content-bearing source files. The `-shm` wal-index is excluded on purpose:
// it is a rebuildable index, not content, and any SQLite reader (including a
// read-only one) may update its read marks. Real content changes — WAL
// appends, checkpoints folding into the main file — always change these two.
function contentFiles(filename: string) {
  return [filename, `${filename}-wal`]
}

// Mirrors the canonical-path semantics of ./paths without importing its
// layout: resolve symlinks on the longest existing prefix.
function canonical(filename: string): string {
  if (lstatSync(filename, { throwIfNoEntry: false })) return realpathSync(filename)
  const parent = path.dirname(filename)
  if (parent === filename) throw new Error(`Cannot resolve path: ${filename}`)
  return path.join(canonical(parent), path.basename(filename))
}

function contains(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

function openReadonly(filename: string) {
  const db = new Database(filename, { readonly: true, create: false, strict: true })
  db.run("PRAGMA busy_timeout = 5000")
  return db
}

function count(db: Database, table: (typeof REQUIRED_TABLES)[number]) {
  return db.query<{ value: number }, []>(`SELECT COUNT(*) AS value FROM "${table}"`).get()?.value ?? 0
}

function requireV1Source(source: string) {
  if (!path.isAbsolute(source)) throw new Error(`V1 source path must be absolute: ${source}`)
  const stat = lstatSync(source, { throwIfNoEntry: false })
  if (!stat) throw new Error(`V1 source does not exist: ${source}`)
  if (stat.isSymbolicLink()) throw new Error(`V1 source must not be a symlink: ${source}`)
  if (!stat.isFile() || stat.nlink !== 1) throw new Error(`V1 source must be a single regular file: ${source}`)
}

/** Read-only structural probe of a candidate V1 store. Never opens the source for writing. */
export async function inspectV1Source(source: string): Promise<SourceInspection> {
  requireV1Source(source)
  using db = openReadonly(source)
  const tables = new Set(
    db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  )
  const missing = REQUIRED_TABLES.filter((table) => !tables.has(table))
  if (missing.length) throw new Error(`Not a Kilo V1 session store (missing ${missing.join(", ")}): ${source}`)
  if (tables.has("session_v2")) {
    throw new Error(`Store already contains V2 sessions; refusing to re-import: ${source}`)
  }
  return {
    path: source,
    bytes: lstatSync(source).size,
    walBytes: lstatSync(`${source}-wal`, { throwIfNoEntry: false })?.size ?? 0,
    sessions: count(db, "session"),
    messages: count(db, "message"),
    parts: count(db, "part"),
    migrations: tables.has("migration")
      ? db
          .query<{ id: string }, []>("SELECT id FROM migration ORDER BY id")
          .all()
          .map((row) => row.id)
      : [],
  }
}

/**
 * Copy a V1 store to a new destination without modifying the source.
 *
 * The source's content files (the database and its `-wal`) are hashed
 * (streamed) before the source is ever opened, and again after the copy; any
 * byte change — WAL appends, a checkpoint folding into the main file — aborts
 * before publish. The `-shm` wal-index is excluded: readers may update its
 * read marks without changing content. The check is a conservative change
 * detector, not a proof that read-only access has no observable side effects;
 * copy from a quiescent source. `VACUUM INTO` from a read-only connection
 * folds committed WAL content into a standalone destination. Publish is a
 * hard link, which fails atomically if the destination appears concurrently —
 * the destination is never overwritten. `onCopyComplete` runs after the copy
 * is verified and before the source-unchanged check, so callers can add their
 * own validation.
 */
export async function copyV1Store(input: {
  source: string
  destination: string
  onCopyComplete?: () => void | Promise<void>
}): Promise<CopyReport> {
  requireV1Source(input.source)
  if (!path.isAbsolute(input.destination)) {
    throw new Error(`Destination path must be absolute: ${input.destination}`)
  }
  const source = canonical(input.source)
  const destination = canonical(input.destination)
  const parent = path.dirname(destination)
  if (!lstatSync(parent, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Destination directory does not exist: ${parent}`)
  }
  if (protectedSources(source).includes(destination)) {
    throw new Error("Destination must not be the V1 source or its WAL/SHM siblings")
  }
  if (contains(path.dirname(source), destination)) {
    throw new Error(`Destination must be outside the V1 store directory: ${path.dirname(source)}`)
  }
  if (lstatSync(input.destination, { throwIfNoEntry: false })) {
    throw new Error(`Destination already exists; refusing to overwrite: ${input.destination}`)
  }
  const untouched = await Promise.all(contentFiles(input.source).map(digest))
  const inspected = await inspectV1Source(input.source)
  // The copy holds private transcripts: stage it in a private 0700 directory
  // next to the destination (on the packaged Bun, VACUUM INTO rejected a
  // pre-created empty file, so SQLite creates the file itself inside the
  // private directory), then pin the file to 0600 before publishing,
  // independent of umask.
  const staging = mkdtempSync(path.join(parent, ".v1-import-"))
  chmodSync(staging, 0o700)
  const temporary = path.join(staging, "store.db")
  try {
    using db = openReadonly(input.source)
    db.run(`VACUUM INTO '${temporary.replaceAll("'", "''")}'`)
    chmodSync(temporary, 0o600)
    using copied = openReadonly(temporary)
    const integrity = copied.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()
    if (integrity?.integrity_check !== "ok") {
      throw new Error(`Copied store failed integrity_check: ${integrity?.integrity_check ?? "no result"}`)
    }
    for (const table of REQUIRED_TABLES) {
      const actual = count(copied, table)
      const expected = inspected[table === "session" ? "sessions" : table === "message" ? "messages" : "parts"]
      if (actual !== expected) {
        throw new Error(`Copied store lost rows in "${table}": source has ${expected}, copy has ${actual}`)
      }
    }
    await input.onCopyComplete?.()
    const changed = (await Promise.all(contentFiles(input.source).map(digest))).some(
      (entry, index) => entry.sha256 !== untouched[index].sha256,
    )
    if (changed) throw new Error(`V1 source changed during copy: ${input.source}`)
    await link(temporary, input.destination)
    return {
      source: { ...inspected, sha256: untouched[0].sha256 },
      destination: input.destination,
      bytes: lstatSync(input.destination).size,
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
