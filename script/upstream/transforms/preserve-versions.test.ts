import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getCurrentVersion, preserveVersion } from "./preserve-versions"

describe("getCurrentVersion", () => {
  test("reads the root package.json version", async () => {
    const root = new URL("../../../package.json", import.meta.url)
    const expected = (await Bun.file(root).json()).version
    expect(await getCurrentVersion()).toBe(expected)
  })
})

describe("preserveVersion", () => {
  test("writes the target version into a package.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kilo-version-"))
    const file = join(dir, "package.json")
    try {
      await writeFile(file, `${JSON.stringify({ name: "x", version: "0.0.1" }, null, 2)}\n`)

      expect(await preserveVersion(file, { targetVersion: "7.3.18" })).toMatchObject({
        file,
        originalVersion: "0.0.1",
        preserved: true,
      })
      expect(JSON.parse(await readFile(file, "utf8")).version).toBe("7.3.18")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("does not write in dry-run mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kilo-version-"))
    const file = join(dir, "package.json")
    try {
      await writeFile(file, `${JSON.stringify({ name: "x", version: "0.0.1" }, null, 2)}\n`)

      expect(await preserveVersion(file, { targetVersion: "7.3.18", dryRun: true })).toMatchObject({
        preserved: true,
        dryRun: true,
      })
      expect(JSON.parse(await readFile(file, "utf8")).version).toBe("0.0.1")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
