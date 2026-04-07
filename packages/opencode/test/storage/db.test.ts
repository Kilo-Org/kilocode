import { describe, expect, test } from "bun:test"
import path from "path"
import { Database } from "../../src/storage/db"

describe("Database.Path", () => {
  // devilcode_change - always use devil.db regardless of channel
  test("always uses devil.db", () => {
    const file = path.basename(Database.Path)
    expect(file).toBe("devil.db")
  })
})
