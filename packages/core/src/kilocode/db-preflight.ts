export * as DbPreflight from "./db-preflight"

import { accessSync, chmodSync, constants, statSync } from "fs"
import path from "path"
import { Global } from "../global"
import { Log } from "../util/log"

const log = Log.create({ service: "db-preflight" })

function writable(target: string) {
  try {
    accessSync(target, constants.W_OK)
    return true
  } catch {
    return false
  }
}

function exists(target: string) {
  try {
    statSync(target)
    return true
  } catch {
    return false
  }
}

// Startup runs `PRAGMA wal_checkpoint(PASSIVE)`, which must write the database and its
// WAL sidecars. A stray read-only file otherwise kills the process deep inside Effect
// with an opaque "attempt to write a readonly database".
export function assertWritable(filename: string, trusted: string = Global.Path.data) {
  if (!filename || filename === ":memory:" || filename.startsWith("file:")) return
  const dir = path.dirname(filename)
  const owned = path.resolve(dir) === path.resolve(trusted)
  let missing = false
  for (const file of [filename, `${filename}-wal`, `${filename}-shm`]) {
    if (!exists(file)) {
      missing = true
      continue
    }
    if (writable(file)) continue
    let cause: unknown
    if (owned) {
      // chmod only succeeds for files the current user owns, which is exactly the safe repair scope
      try {
        chmodSync(file, statSync(file).mode | 0o600)
      } catch (err) {
        cause = err
      }
      if (writable(file)) {
        // visible trail: if files keep losing their write bit, something outside kilo is doing it
        log.warn("repaired read-only database file", { file })
        continue
      }
    }
    throw new Error(
      `Database file is not writable: ${file}. Fix its permissions (chmod u+w "${file}") or point KILO_DB at a writable location.`,
      cause === undefined ? undefined : { cause },
    )
  }
  if (missing && !writable(dir)) {
    if (!exists(dir))
      throw new Error(`Database directory does not exist: ${dir}. Create it or point KILO_DB at an existing location.`)
    throw new Error(
      `Database directory is not writable: ${dir}. SQLite must create WAL files next to the database. Fix its permissions or point KILO_DB at a writable location.`,
    )
  }
}
