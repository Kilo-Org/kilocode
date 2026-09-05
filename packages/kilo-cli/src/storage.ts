import { constants, Database } from "bun:sqlite"
import { closeSync, lstatSync, mkdirSync, openSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { identity, preflight, type Layout } from "./paths"
import { requireRuntime } from "./runtime"

export function prepare(input: Layout) {
  requireRuntime()
  preflight(input)
  if (lstatSync(input.database, { throwIfNoEntry: false })) {
    for (const suffix of ["-wal", "-journal"]) {
      if (input.channel === "preview" && lstatSync(input.database + suffix, { throwIfNoEntry: false })?.size) {
        throw new Error("Refusing a store with pending journal data; recovery is outside this lifecycle-only preview")
      }
    }
    const url = pathToFileURL(input.database)
    url.searchParams.set("immutable", "1")
    using db = new Database(url.href, constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI)
    const legacy = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'").get()
    if (legacy) throw new Error("Refusing a legacy session store; preview startup never imports V1 data")
    const marker = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_kilo_preview'").get()
    if (!marker) throw new Error("Refusing an unrecognized database; use a new isolated preview store")
    const owner = db
      .query<
        { application: string; channel: string; version: number },
        []
      >("SELECT application, channel, version FROM _kilo_preview WHERE id = 1")
      .get()
    if (owner?.application !== identity || owner.channel !== input.channel || owner.version !== 1) {
      throw new Error("Refusing a database owned by another application or preview channel")
    }
    if (input.channel === "interactive") {
      using current = new Database(input.database, { readonly: true, strict: true })
      if (current.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'").get()) {
        throw new Error("Refusing a legacy session store; interactive startup never imports V1 data")
      }
      return
    }
    const sessions = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_v2'").get()
    if (sessions && db.query("SELECT id FROM session_v2 LIMIT 1").get()) {
      throw new Error(
        "Refusing a populated session store; execution and recovery are outside this lifecycle-only preview",
      )
    }
    return
  }
  for (const [key, directory] of Object.entries(input.paths)) {
    if (key !== "home") mkdirSync(directory, { recursive: true, mode: 0o700 })
  }
  closeSync(openSync(input.database, "wx", 0o600))
  using db = new Database(input.database, { strict: true })
  db.run(
    "CREATE TABLE _kilo_preview (id INTEGER PRIMARY KEY, application TEXT NOT NULL, channel TEXT NOT NULL, version INTEGER NOT NULL)",
  )
  db.query("INSERT INTO _kilo_preview (id, application, channel, version) VALUES (1, ?, ?, 1)").run(
    identity,
    input.channel,
  )
}
