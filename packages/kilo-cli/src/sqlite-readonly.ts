import { constants, Database } from "bun:sqlite"
import { existsSync, statSync } from "node:fs"
import { pathToFileURL } from "node:url"

/**
 * Opens a SQLite store read-only without creating or changing a file beside it.
 *
 * A store with a `-wal` file is in use or has pending frames, so a read-only connection reads it with locks. A store at
 * rest has no `-wal` file, and SQLite builds differ there: Bun's bundled SQLite creates `-wal` and `-shm` files beside
 * it, and the macOS system SQLite fails with SQLITE_CANTOPEN because a read-only connection cannot create the `-shm`.
 * An immutable open reads the same data on every platform and creates no file. It takes no locks, so a writer that
 * starts meanwhile could rewrite pages under the read: `unchanged` reports whether the file stayed as it was, and a
 * caller that copies the store checks it before it trusts the copy.
 */
export function openReadonly(file: string) {
  if (existsSync(`${file}-wal`)) return { db: new Database(file, { readonly: true }), unchanged: () => true }
  const before = state(file)
  return {
    // The URI flag makes every SQLite build parse the `immutable` parameter, whatever its compile-time default.
    db: new Database(
      `${pathToFileURL(file).href}?immutable=1`,
      constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI,
    ),
    unchanged: () => state(file) === before,
  }
}

/** The error of a copy whose at-rest source changed while it was read, so the copy cannot be trusted. */
export function changed(file: string) {
  return new Error(
    `${file} changed while it was copied: Kilo v1 started during the import. Keep Kilo v1 closed or running for the whole import, and run it again.`,
  )
}

/** The state an at-rest read depends on: a checkpoint of a writer that started meanwhile changes the size or mtime. */
function state(file: string) {
  const stat = statSync(file)
  return `${stat.size}:${stat.mtimeMs}`
}
