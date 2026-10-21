import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { resolveConfigPath } from "../../../src/commands/handlers/mcp/add"

// `mcp add`, `plugin add` and `plugin remove` use v1's write preference with the isolated internal v2 names.

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
  test("creates kilo2.json when no config file exists", async () => {
    const root = await fixture([])
    expect(await resolveConfigPath(root)).toBe(path.join(root, "kilo2.json"))
    expect(await resolveConfigPath(root, true)).toBe(path.join(root, "kilo2.json"))
  })

  test("prefers kilo2.jsonc over kilo2.json and never picks opencode files", async () => {
    const root = await fixture(["opencode.jsonc", "kilo2.json"])
    expect(await resolveConfigPath(root)).toBe(path.join(root, "kilo2.json"))
    const both = await fixture(["kilo2.json", "kilo2.jsonc"])
    expect(await resolveConfigPath(both)).toBe(path.join(both, "kilo2.jsonc"))
    const opencode = await fixture(["opencode.json", "opencode.jsonc"])
    expect(await resolveConfigPath(opencode)).toBe(path.join(opencode, "kilo2.json"))
  })

  test("prefers .kilo2 over the project root files", async () => {
    const root = await fixture(["kilo2.jsonc", ".kilo2/kilo2.json"])
    expect(await resolveConfigPath(root)).toBe(path.join(root, ".kilo2", "kilo2.json"))
  })

  test("ignores v1 Kilo and OpenCode files and directories", async () => {
    const root = await fixture([
      "kilo.json",
      "kilo.jsonc",
      ".kilo/kilo.json",
      ".kilo/kilo2.json",
      ".opencode/opencode.json",
      ".kilocode/kilo.json",
    ])
    expect(await resolveConfigPath(root)).toBe(path.join(root, "kilo2.json"))
    expect(await resolveConfigPath(root, true)).toBe(path.join(root, "kilo2.json"))
  })

  test("checks only the root files of the global directory", async () => {
    const root = await fixture([".kilo2/kilo2.json"])
    expect(await resolveConfigPath(root, true)).toBe(path.join(root, "kilo2.json"))
    const existing = await fixture([".kilo2/kilo2.json", "kilo2.jsonc"])
    expect(await resolveConfigPath(existing, true)).toBe(path.join(existing, "kilo2.jsonc"))
  })
})
