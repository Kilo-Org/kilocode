import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import fs from "fs/promises"
import { readFileSync, readdirSync } from "fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { JsonMigration } from "@/storage/json-migration"

function db() {
  const sqlite = new Database(":memory:")
  sqlite.exec("PRAGMA foreign_keys = ON")

  const dir = path.join(import.meta.dirname, "../../../migration")
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      sql: readFileSync(path.join(dir, entry.name, "migration.sql"), "utf-8"),
      timestamp: Number(entry.name.split("_")[0]),
      name: entry.name,
    }))
    .sort((a, b) => a.timestamp - b.timestamp)

  const client = drizzle({ client: sqlite })
  migrate(client, entries)
  return { client, sqlite }
}

describe("json migration progress", () => {
  test("reports scan progress before migrating legacy files", async () => {
    const storage = path.join(Global.Path.data, "storage")
    await fs.rm(storage, { recursive: true, force: true })
    await fs.mkdir(path.join(storage, "project"), { recursive: true })
    await fs.mkdir(path.join(storage, "session"), { recursive: true })
    await fs.mkdir(path.join(storage, "message"), { recursive: true })
    await fs.mkdir(path.join(storage, "part"), { recursive: true })
    await fs.mkdir(path.join(storage, "todo"), { recursive: true })
    await fs.mkdir(path.join(storage, "permission"), { recursive: true })
    await fs.mkdir(path.join(storage, "session_share"), { recursive: true })

    const events: string[] = []
    const { client, sqlite } = db()

    try {
      await JsonMigration.run(client, {
        progress: (event) => events.push(event.label),
      })
    } finally {
      sqlite.close()
      await fs.rm(storage, { recursive: true, force: true })
    }

    expect(events.slice(0, 7)).toEqual([
      "scan-projects",
      "scan-sessions",
      "scan-messages",
      "scan-parts",
      "scan-todos",
      "scan-permissions",
      "scan-shares",
    ])
    expect(events).toContain("starting")
    expect(events.at(-1)).toBe("complete")
  })
})
