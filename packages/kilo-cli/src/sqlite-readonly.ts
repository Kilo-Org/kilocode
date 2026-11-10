import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { pathToFileURL } from "node:url"

/**
 * Opens a SQLite store read-only, also when it is at rest. A WAL store whose last connection closed has no `-shm` file,
 * and a read-only connection cannot create one, so SQLite fails with SQLITE_CANTOPEN at the first read. Without a `-wal`
 * file the store has no pending frames, so an immutable open reads the same data and creates no file. It takes no
 * locks, as a plain copy of a closed store does.
 */
export function openReadonly(file: string) {
  const db = new Database(file, { readonly: true })
  try {
    // SQLite opens the file lazily, so a first read surfaces SQLITE_CANTOPEN here instead of in the caller.
    db.query("SELECT count(*) FROM sqlite_master").get()
    return db
  } catch (error) {
    db.close()
    if ((error as { code?: string }).code !== "SQLITE_CANTOPEN" || existsSync(`${file}-wal`)) throw error
    return new Database(`${pathToFileURL(file).href}?immutable=1`, { readonly: true })
  }
}
