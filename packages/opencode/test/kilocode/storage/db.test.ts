import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { InstallationChannel } from "@opencode-ai/core/installation/version"
import { Database } from "../../../src/storage/db"
import { tmpdir } from "../../fixture/fixture"

const custom = ["latest", "beta", "prod"].includes(InstallationChannel) ? test.skip : test

describe("kilo channel database paths", () => {
  custom("falls back to the old opencode channel database", async () => {
    await using dir = await tmpdir()
    const data = Global.Path.data
    ;(Global.Path as { data: string }).data = dir.path

    try {
      const safe = InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")
      const old = path.join(dir.path, `opencode-${safe}.db`)
      await Bun.write(old, "")

      expect(Database.getChannelPath({ disableChannelDb: false })).toBe(old)
    } finally {
      ;(Global.Path as { data: string }).data = data
    }
  })
})
