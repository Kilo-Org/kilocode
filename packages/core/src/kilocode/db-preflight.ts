export * as DbPreflight from "./db-preflight.js"

import { accessSync, chmodSync, constants, statSync } from "node:fs"
import path from "node:path"
import { Global } from "@opencode/util/global"

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

/**
 * Startup runs `PRAGMA wal_checkpoint(PASSIVE)`, which must write the database and its WAL sidecars.
 * A stray read-only file otherwise kills the process deep inside Effect with an opaque "attempt to
 * write a readonly database". Check the database and its `-wal`/`-shm` sidecars up front: repair a
 * read-only file only when it sits in the trusted (Kilo-owned) data directory, where chmod succeeds
 * for the current user; otherwise raise an actionable error. Also surface a missing or read-only
 * directory, where SQLite must create the WAL sidecars.
 */
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
      // chmod only succeeds for files the current user owns, which is exactly the safe repair scope.
      try {
        chmodSync(file, statSync(file).mode | 0o600)
      } catch (err) {
        cause = err
      }
      if (writable(file)) {
        // A visible trail: if files keep losing their write bit, something outside Kilo is doing it.
        process.emitWarning(`[kilo] repaired read-only database file: ${file}`)
        continue
      }
    }
    throw new Error(
      `Database file is not writable: ${file}. Fix its permissions (chmod u+w "${file}") or point KILO2_DB at a writable location.`,
      cause === undefined ? undefined : { cause },
    )
  }
  if (missing && !writable(dir)) {
    if (!exists(dir))
      throw new Error(`Database directory does not exist: ${dir}. Create it or point KILO2_DB at an existing location.`)
    throw new Error(
      `Database directory is not writable: ${dir}. SQLite must create WAL files next to the database. Fix its permissions or point KILO2_DB at a writable location.`,
    )
  }
}
