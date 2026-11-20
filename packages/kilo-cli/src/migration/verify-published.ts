import { constants, Database } from "bun:sqlite"
import { lstatSync } from "node:fs"
import { pathToFileURL } from "node:url"

/** Validate both sides of a published switch whose owner died before reporting completion.
 * Open only standalone files: immutable reads would miss outstanding WAL frames. */
export function verifyPublished(source: string, backup: string) {
  for (const file of [source, backup]) {
    const stat = lstatSync(file)
    if (file === backup && stat.mode & 0o077) throw new Error(`Recovery database is not private: ${file}`)
    if (!stat.isFile() || stat.nlink !== 1)
      throw new Error(`Incomplete publication: keep both files and inspect ${file}`)
    for (const suffix of ["-wal", "-journal"]) {
      if (lstatSync(file + suffix, { throwIfNoEntry: false })?.size)
        throw new Error(`Recovery requires a closed, checkpointed database: ${file}`)
    }
  }
  const uri = (file: string) => `${pathToFileURL(file).href}?immutable=1&mode=ro`
  using db = new Database(uri(source), constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI)
  db.run("ATTACH DATABASE ? AS recovery", [uri(backup)])
  const expected = lstatSync(backup, { bigint: true })
  if (
    !db
      .query("SELECT 1 FROM main._kilo_profile_cutover WHERE version=2 AND original_file=?")
      .get(`${expected.dev}:${expected.ino}`)
  )
    throw new Error("Recovery copy does not match this cutover")
  for (const schema of ["main", "recovery"]) {
    if (
      db.query<{ integrity_check: string }, []>(`PRAGMA ${schema}.integrity_check(1)`).get()?.integrity_check !== "ok"
    )
      throw new Error(`Invalid ${schema} database; preserve both files for recovery`)
  }
  if (db.query("SELECT id FROM recovery.session EXCEPT SELECT id FROM main.session_v2 LIMIT 1").get())
    throw new Error("A recovered session is missing from the published profile")
}
