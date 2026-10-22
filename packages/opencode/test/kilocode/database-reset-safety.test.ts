import { describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import path from "path"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const root = path.resolve(import.meta.dir, "..")
const paths = [/\bDatabase\.getPath\s*\(/, /\bDatabase\.Path\b/, /kilo\.db(?:-wal|-shm)?/]
const removals = [/\b(?:rm|rmSync|unlink|unlinkSync)\s*\(/, /\bBun\.file\s*\([^)]*\)\.delete\s*\(/]

function dangerous(source: string) {
  return paths.some((pattern) => pattern.test(source)) && removals.some((pattern) => pattern.test(source))
}

// Root cause of the session loss this protects against:
//
// 1. test/server/httpapi-sdk.test.ts was run from a directory where Bun did not
//    load the package bunfig.toml. test/preload.ts was therefore not applied,
//    so KILO_DB was not set to :memory:.
// 2. The test process inherited KILO_DISABLE_CHANNEL_DB=true from the VS Code
//    extension. Database.getPath() therefore returned the real shared database
//    at ~/.local/share/kilo/kilo.db.
// 3. The upstream resetDatabase() helper deleted kilo.db, kilo.db-wal, and
//    kilo.db-shm. The test then recreated the database and inserted its
//    identifiable "parent" and "child" sessions.
// 4. Conversations stored only in the deleted database were lost. Git
//    worktrees, branches, and .kilo/agent-manager.json survived because they are
//    stored separately.
//
// Keep both the runtime guard and this source scan so a misconfigured test run
// fails safely instead of deleting a developer's sessions again.
describe("test database safety", () => {
  test("recognizes destructive database cleanup", () => {
    expect(dangerous("const file = Database.getPath()\nawait rm(file, { force: true })")).toBe(true)
  })

  test("preserves the resolved database when the in-memory preload is missing", async () => {
    // Use a disposable sentinel inside the test's temporary directory, never a
    // user database. This simulates a disk-backed KILO_DB and verifies that the
    // reset helper rejects it before cleanup can run.
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "sessions.db")
    const previous = Flag.KILO_DB
    await Bun.write(file, "preserve me")
    Flag.KILO_DB = file

    try {
      await expect(resetDatabase()).rejects.toThrow(`Refusing to reset non-test database: ${file}`)
      expect(await Bun.file(file).text()).toBe("preserve me")
    } finally {
      Flag.KILO_DB = previous
    }
  })

  test("forbids direct database file deletion in tests", async () => {
    const violations: string[] = []
    const files = new Bun.Glob("**/*.{ts,tsx,js,mjs,cjs}").scan({ cwd: root, absolute: true })

    for await (const file of files) {
      if (file === import.meta.path) continue
      const source = await Bun.file(file).text()
      if (!dangerous(source)) continue
      violations.push(path.relative(root, file))
    }

    expect(violations).toEqual([])
  })
})
