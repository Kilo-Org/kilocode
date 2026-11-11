import { constants, Database } from "bun:sqlite"
import { existsSync, statSync } from "node:fs"
import { pathToFileURL } from "node:url"

/**
 * Opens a SQLite store read-only without creating or changing a file beside it.
 *
 * A store with a `-wal` file is in use or has pending frames, so a read-only connection reads it with locks. A store at
 * rest has no `-wal` file, and SQLite builds differ there: Bun's bundled SQLite creates `-wal` and `-shm` files beside
 * it, and the macOS system SQLite fails with SQLITE_CANTOPEN because a read-only connection cannot create the `-shm`.
 * An immutable open reads the same data on every platform and creates no file. It takes no locks and ignores any WAL,
 * so a writer that starts meanwhile can add frames the read never sees or rewrite pages under it: `unchanged` reports
 * whether the store stayed at rest, and a caller that copies the store checks it before it trusts the copy.
 */
export function openReadonly(file: string) {
  // One look at the store both picks the read and is the baseline of `unchanged`, so a writer that starts between a
  // probe and a baseline cannot end up in the baseline of a read that ignores its WAL.
  const before = state(file)
  if (before.wal) return { db: new Database(file, { readonly: true }), unchanged: () => true }
  return {
    // The URI flag makes every SQLite build parse the `immutable` parameter, whatever its compile-time default.
    db: new Database(
      `${pathToFileURL(file).href}?immutable=1`,
      constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI,
    ),
    unchanged: () => {
      const now = state(file)
      return now.size === before.size && now.mtime === before.mtime && now.wal === before.wal && now.shm === before.shm
    },
  }
}

/** The error of a copy whose at-rest source changed while it was read, so the copy cannot be trusted. */
export function changed(file: string) {
  return new Error(
    `${file} changed while it was copied, because a program started writing to it (Kilo v1, or the build that wrote this file). Keep that program closed, or running, for the whole copy, then try again.`,
  )
}

/**
 * The state an at-rest read depends on. A store at rest has no `-wal` or `-shm` file, so either one appearing shows a
 * writer that started, also before it rewrites the file at a checkpoint, which changes the size or mtime.
 */
function state(file: string) {
  const stat = statSync(file)
  return { size: stat.size, mtime: stat.mtimeMs, wal: existsSync(`${file}-wal`), shm: existsSync(`${file}-shm`) }
}
