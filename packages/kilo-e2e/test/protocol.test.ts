import { describe, expect, test } from "bun:test"
import { readdir, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import z from "zod"
import { ProtocolError, ensureDir, exists, readJson, readJsonAs, remove, writeJson } from "../src/protocol"
import { sandbox } from "./helpers"

describe("private JSON protocol files", () => {
  test("writes private directories and files atomically", async () => {
    await sandbox(async (dir) => {
      const runDir = join(dir, "run")
      const file = join(runDir, "request.json")
      await ensureDir(runDir)
      await writeJson(file, { schemaVersion: 1 })

      expect(await readJson(file)).toEqual({ schemaVersion: 1 })
      expect((await readdir(runDir)).filter((name) => name.includes(".tmp"))).toEqual([])
      if (process.platform !== "win32") {
        expect((await stat(runDir)).mode & 0o777).toBe(0o700)
        expect((await stat(file)).mode & 0o777).toBe(0o600)
      }
    })
  })

  test("rejects invalid JSON and schema mismatches without echoing content", async () => {
    await sandbox(async (dir) => {
      const invalid = join(dir, "invalid.json")
      await writeFile(invalid, '{"secretValue":')
      await expect(readJson(invalid)).rejects.toBeInstanceOf(ProtocolError)

      const wrong = join(dir, "wrong.json")
      await writeJson(wrong, { schemaVersion: "one" })
      await expect(readJsonAs(wrong, z.object({ schemaVersion: z.literal(1) }))).rejects.toBeInstanceOf(ProtocolError)
    })
  })

  test("removes files and reports existence", async () => {
    await sandbox(async (dir) => {
      const file = join(dir, "result.json")
      await writeJson(file, {})
      expect(await exists(file)).toBe(true)
      await remove(file)
      expect(await exists(file)).toBe(false)
      await remove(file)
    })
  })
})
