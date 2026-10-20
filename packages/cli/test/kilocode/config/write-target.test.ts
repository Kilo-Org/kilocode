import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { resolveConfigPath } from "../../../src/commands/handlers/mcp/add"

// `mcp add`, `plugin add` and `plugin remove` write the file that resolveConfigPath picks, like Kilo v1.

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(files: string[]) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-config-write-")))
  roots.push(root)
  for (const file of files) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await writeFile(path.join(root, file), "{}")
  }
  return root
}

describe("Kilo config write target", () => {
  test("creates kilo.json when no config file exists", async () => {
    const root = await fixture([])
    expect(await resolveConfigPath(root)).toBe(path.join(root, "kilo.json"))
    expect(await resolveConfigPath(root, true)).toBe(path.join(root, "kilo.json"))
  })

  test("prefers kilo.* over opencode.* and .jsonc over .json in the project root", async () => {
    const root = await fixture(["opencode.jsonc", "kilo.json"])
    expect(await resolveConfigPath(root)).toBe(path.join(root, "kilo.json"))
    const both = await fixture(["kilo.json", "kilo.jsonc"])
    expect(await resolveConfigPath(both)).toBe(path.join(both, "kilo.jsonc"))
    const opencode = await fixture(["opencode.json"])
    expect(await resolveConfigPath(opencode)).toBe(path.join(opencode, "opencode.json"))
  })

  test("prefers .kilo, then .kilocode, over the project root files", async () => {
    const root = await fixture(["kilo.jsonc", ".kilocode/opencode.json", ".kilo/opencode.json"])
    expect(await resolveConfigPath(root)).toBe(path.join(root, ".kilo", "opencode.json"))
    const legacy = await fixture(["kilo.jsonc", ".kilocode/opencode.json"])
    expect(await resolveConfigPath(legacy)).toBe(path.join(legacy, ".kilocode", "opencode.json"))
  })

  test("ignores .opencode", async () => {
    const root = await fixture([".opencode/opencode.json"])
    expect(await resolveConfigPath(root)).toBe(path.join(root, "kilo.json"))
  })

  test("checks only the root files of the global directory", async () => {
    const root = await fixture([".kilo/kilo.json", ".kilocode/kilo.json"])
    expect(await resolveConfigPath(root, true)).toBe(path.join(root, "kilo.json"))
    const existing = await fixture([".kilo/kilo.json", "opencode.jsonc"])
    expect(await resolveConfigPath(existing, true)).toBe(path.join(existing, "opencode.jsonc"))
  })
})
