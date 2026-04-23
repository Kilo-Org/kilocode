import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { setTimeout as sleep } from "node:timers/promises"
import { Global } from "../../src/global"
import { Log } from "../../src/util/log"

async function wait(fn: () => Promise<boolean>, left = 100): Promise<boolean> {
  if (await fn()) return true
  if (left <= 0) return false
  await sleep(100)
  return wait(fn, left - 1)
}

describe("Log", () => {
  test("keeps rotating history relative to the log directory", async () => {
    const chunks: string[] = []
    const write = process.stderr.write
    process.stderr.write = ((
      chunk: string | Uint8Array,
      enc?: BufferEncoding | ((err?: Error) => void),
      cb?: (err?: Error) => void,
    ) => {
      chunks.push(String(chunk))
      if (typeof enc === "function") enc()
      if (cb) cb()
      return true
    }) as typeof process.stderr.write

    try {
      const file = path.join(Global.Path.log, ".log-history")
      await fs.rm(file, { force: true })
      await Log.init({ print: false, dev: true, level: "DEBUG" })

      const log = Log.create({ service: "log-rotation-test-" + Date.now() })
      const msg = "x".repeat(1024 * 1024)
      Array.from({ length: 52 }).forEach(() => log.info(msg))

      const done = await wait(async () => {
        if (chunks.join("").includes("log stream error")) return true
        return Bun.file(file).exists()
      })

      expect(done).toBe(true)
      expect(chunks.join("")).not.toContain("log stream error")
      await expect(Bun.file(file).exists()).resolves.toBe(true)
    } finally {
      process.stderr.write = write
    }
  })
})
