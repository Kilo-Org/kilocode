import { Database as SQLite } from "bun:sqlite"
import path from "path"
import { Database } from "@opencode-ai/core/database/database"
import { Effect, Layer } from "effect"

const mode = process.argv[2]
const dir = process.argv[3]
if (!mode || !dir) throw new Error("Expected mode and data directory")

const file = path.join(dir, "kilo.db")

if (mode === "seed") {
  const sqlite = new SQLite(file)
  sqlite.run("PRAGMA journal_mode = WAL")
  sqlite.run("PRAGMA wal_autocheckpoint = 0")
  sqlite.run("CREATE TABLE recovery_load (value BLOB)")
  const insert = sqlite.prepare("INSERT INTO recovery_load VALUES (?)")
  const value = new Uint8Array(4096)
  sqlite.transaction(() => {
    for (const _ of Array.from({ length: 1_000 })) insert.run(value)
  })()
  await Bun.write(path.join(dir, "seed-ready"), "")
  await new Promise(() => {})
}

if (mode === "open") {
  await Bun.write(path.join(dir, `open-ready-${process.pid}`), "")
  while (!(await Bun.file(path.join(dir, "start")).exists())) await Bun.sleep(1)
  await Effect.runPromise(Layer.build(Database.layerFromPath(file).pipe(Layer.fresh)).pipe(Effect.scoped))
}
