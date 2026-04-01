import { describe, expect, test } from "bun:test"
import path from "path"
import { Database } from "../../src/storage/db"

describe("Database.Path", () => {
  // kilocode_change - always use kilo.db regardless of channel
  test("always uses kilo.db", () => {
    const file = path.basename(Database.Path)
    expect(file).toBe("kilo.db")
  })
})
