import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "../../src/global"
import { Installation } from "../../src/installation"
import { Database } from "../../src/storage/db"

describe("Database.Path", () => {
  test("returns database path for the current channel", () => {
    const db = process.env["KILO_DB"]
    const expected = db
      ? path.isAbsolute(db)
        ? db
        : path.join(Global.Path.data, db)
      : ["latest", "beta"].includes(Installation.CHANNEL)
        ? path.join(Global.Path.data, "kilo.db") // kilcode_change
        : path.join(Global.Path.data, `kilo-${Installation.CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`) // kilocode_change
    expect(Database.Path).toBe(expected)
  })
})
