import type { Database } from "bun:sqlite"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { openImmutable, openReadonly } from "../sqlite-readonly"

/** A new running server can have its entire schema in the first WAL. Inspect a
 * bounded private snapshot in that case; probing a live v1 WAL can change its SHM. */
export function nativeStore(file: string) {
  if (fs.statSync(`${file}-journal`, { throwIfNoEntry: false })?.size)
    throw new Error(`Resolve the rollback journal before opening ${file}`)
  using main = openImmutable(file)
  const result = classify(main, file)
  if (result !== undefined) return result
  const wal = `${file}-wal`
  const walStat = fs.statSync(wal, { bigint: true, throwIfNoEntry: false })
  if (!walStat?.size) return true // Empty SQLite file, no committed schema.
  const fileStat = fs.statSync(file, { bigint: true, throwIfNoEntry: false })
  if (!fileStat) throw changed(file)
  const before = `${stamp(fileStat)}|${stamp(walStat)}`
  if (fileStat.size + walStat.size > 32n * 1024n * 1024n)
    throw new Error(`Close clients using ${file} so its schema can be checkpointed before startup.`)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-schema-"))
  try {
    const copy = path.join(dir, "probe.db")
    copySnapshot(file, copy, file)
    copySnapshot(wal, `${copy}-wal`, file)
    if (revision(file, wal) !== before) throw changed(file)
    using db = openReadonly(copy).db
    return classify(db, file) ?? false
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function changed(file: string) {
  return new Error(`Session store changed while checking its schema: ${file}. Retry startup.`)
}

function copySnapshot(from: string, to: string, store: string) {
  try {
    fs.copyFileSync(from, to, fs.constants.COPYFILE_FICLONE)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw changed(store)
    throw error
  }
}

function stamp(st: fs.BigIntStats) {
  return `${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`
}

function revision(...files: string[]) {
  return files
    .map((f) => {
      const st = fs.statSync(f, { bigint: true, throwIfNoEntry: false })
      return st ? stamp(st) : "missing"
    })
    .join("|")
}

function classify(db: Database, file: string) {
  const tables = new Set(
    db
      .query<{ name: string }, []>("SELECT name FROM sqlite_schema WHERE type='table'")
      .all()
      .map((row) => row.name),
  )
  if (!tables.size) return undefined
  if (tables.has("_kilo_profile_cutover"))
    throw new Error(`Missing migration journal for ${file}. Inspect recovery before starting Kilo.`)
  if (!tables.has("session_v2")) {
    if (["session", "project", "message", "part"].every((name) => tables.has(name))) return false
    throw new Error(`Unrecognized session database: ${file}`)
  }
  if (!tables.has("session_message") || !tables.has("migration")) throw new Error(`Incomplete session store: ${file}`)
  if (
    tables.has("session") &&
    !db.query("SELECT 1 FROM kv WHERE key='migration.v1-v2' AND json_extract(value,'$.phase')='completed'").get()
  )
    throw new Error(`Unfinished session conversion: ${file}`)
  return true
}
