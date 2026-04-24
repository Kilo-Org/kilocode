import { describe, expect, test } from "bun:test"
import path from "path"
import { Flag } from "../../src/flag/flag" // kilocode_change
import { Global } from "../../src/global"
import { InstallationChannel } from "../../src/installation/version"
import { Database } from "../../src/storage"

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
    const expected = ["latest", "beta"].includes(InstallationChannel)
      ? path.join(Global.Path.data, "kilo.db")
      : path.join(Global.Path.data, `opencode-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
    expect(Database.getChannelPath()).toBe(expected)
  })
})
