import { describe, expect, test } from "bun:test"
import path from "path"
import { Installation } from "../../src/installation"
import { Database } from "../../src/storage/db"

describe("Database.Path", () => {
  test("returns database path for the current channel", () => {
    const file = path.basename(Database.Path)
    // kilocode_change start
    const expected = ["latest", "beta"].includes(Installation.CHANNEL)
      ? "kilo.db"
      : `kilo-${Installation.CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`
    // kilocode_change end
    expect(file).toBe(expected)
  })
})
