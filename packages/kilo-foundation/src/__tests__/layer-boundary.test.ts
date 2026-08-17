import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "bun:test"

const srcRoot = path.join(import.meta.dir, "..")

async function collectTs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue
      files.push(...(await collectTs(full)))
    } else if (entry.name.endsWith(".ts")) {
      files.push(full)
    }
  }
  return files
}

describe("kilo-foundation stays generic", () => {
  test("source does not name product-specific team roles or task statuses", async () => {
    const files = await collectTs(srcRoot)
    expect(files.length).toBeGreaterThan(0)
    const banned = /Engineering Manager|Reviewer|Tester|Discovery|MILESTONE_GATE|REVIEW_APPROVED|TEST_FAILED|DB_AGENT/
    for (const file of files) {
      const source = await readFile(file, "utf8")
      expect(source, file).not.toMatch(banned)
    }
  })
})
