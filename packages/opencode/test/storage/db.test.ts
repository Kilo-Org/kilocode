import { describe, expect, test } from "bun:test"
import path from "path"
import { Flag } from "../../src/flag/flag" // kilocode_change
import { Global } from "../../src/global"
import { Installation } from "../../src/installation"
import { Database } from "../../src/storage/db"

describe("Database.Path", () => {
  test("returns database path for the current channel", () => {
    // kilocode_change start — test preload sets KILO_DB=:memory:
    if (Flag.KILO_DB) {
      const expected =
        Flag.KILO_DB === ":memory:" || path.isAbsolute(Flag.KILO_DB)
          ? Flag.KILO_DB
          : path.join(Global.Path.data, Flag.KILO_DB)
      expect(Database.Path).toBe(expected)
      return
    }
    // kilocode_change end
    const expected = ["latest", "beta"].includes(Installation.CHANNEL)
      ? path.join(Global.Path.data, "kilo.db")
      : path.join(Global.Path.data, `kilo-${Installation.CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
    expect(Database.Path).toBe(expected)
  })
})
