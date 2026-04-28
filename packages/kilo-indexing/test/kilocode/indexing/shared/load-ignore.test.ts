import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { loadIgnore } from "../../../../src/indexing/shared/load-ignore"

describe("loadIgnore", () => {
  let root = ""

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "index-ignore-"))
  })

  afterEach(async () => {
    if (!root) {
      return
    }
    await rm(root, { recursive: true, force: true })
  })

  test("loads root .kilocodeignore in addition to root .gitignore", async () => {
    await writeFile(path.join(root, ".gitignore"), "dist/\n")
    await writeFile(path.join(root, ".kilocodeignore"), "secret/\n")

    const ig = await loadIgnore(root)

    expect(ig.ignores("dist/out.ts")).toBe(true)
    expect(ig.ignores("secret/key.ts")).toBe(true)
    expect(ig.ignores("src/app.ts")).toBe(false)
  })

  test("preserves existing .gitignore-only behavior when .kilocodeignore is absent", async () => {
    await writeFile(path.join(root, ".gitignore"), "coverage/\n")

    const ig = await loadIgnore(root)

    expect(ig.ignores("coverage/index.html")).toBe(true)
    expect(ig.ignores("src/app.ts")).toBe(false)
  })

  test("ignores the ignore files themselves", async () => {
    await writeFile(path.join(root, ".gitignore"), "dist/\n")
    await writeFile(path.join(root, ".kilocodeignore"), "secret/\n")

    const ig = await loadIgnore(root)

    expect(ig.ignores(".gitignore")).toBe(true)
    expect(ig.ignores(".kilocodeignore")).toBe(true)
  })
})
