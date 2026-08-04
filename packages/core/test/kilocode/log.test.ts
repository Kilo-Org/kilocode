import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Log } from "@opencode-ai/core/util/log"
import { tmpdir } from "../fixture/tmpdir"

async function files(dir: string, retries = 50): Promise<string[]> {
  const list = (await fs.readdir(dir)).sort()
  if (retries === 0 || list.length === 11) return list
  await Bun.sleep(10)
  return files(dir, retries - 1)
}

describe("Kilo logger compatibility", () => {
  test("cleanup keeps the newest timestamped logs", async () => {
    const previous = Global.Path.log
    await using tmp = await tmpdir()
    Global.Path.log = tmp.path

    try {
      const list = Array.from({ length: 12 }, (_, idx) => `2000-01-${String(idx + 1).padStart(2, "0")}T000000.log`)
      await Promise.all(list.map((file) => fs.writeFile(path.join(tmp.path, file), file)))

      await Log.init({ print: false, dev: false })
      const next = await files(tmp.path)

      expect(next).not.toContain(list[0]!)
      expect(next).toContain(list.at(-1)!)
    } finally {
      await Log.init({ print: true })
      Global.Path.log = previous
    }
  })

  test("does not truncate the dev log twice during one run", async () => {
    const previous = Global.Path.log
    const run = process.env.KILO_RUN_ID
    const initialized = process.env.KILO_LOG_INITIALIZED_RUN_ID
    await using tmp = await tmpdir()
    Global.Path.log = tmp.path
    process.env.KILO_RUN_ID = "run-1"
    delete process.env.KILO_LOG_INITIALIZED_RUN_ID

    try {
      await Log.init({ print: false, dev: true })
      await fs.writeFile(path.join(tmp.path, "dev.log"), "main startup\n")
      await Log.init({ print: false, dev: true })

      expect(await fs.readFile(path.join(tmp.path, "dev.log"), "utf8")).toContain("main startup")
    } finally {
      await Log.init({ print: true })
      Global.Path.log = previous
      if (run === undefined) delete process.env.KILO_RUN_ID
      else process.env.KILO_RUN_ID = run
      if (initialized === undefined) delete process.env.KILO_LOG_INITIALIZED_RUN_ID
      else process.env.KILO_LOG_INITIALIZED_RUN_ID = initialized
    }
  })
})
