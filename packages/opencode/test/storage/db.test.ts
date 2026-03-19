import { describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"

describe("Database.file", () => {
  test("uses the shared database for latest", () => {
    expect(Database.file("latest")).toBe("kilo.db") // kilocode_change
  })

  test("sanitizes preview channels for filenames", () => {
    expect(Database.file("fix/windows-modified-files-tracking")).toBe("kilo-fix-windows-modified-files-tracking.db") // kilocode_change
  })
})
