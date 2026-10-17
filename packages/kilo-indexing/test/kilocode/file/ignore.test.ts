import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { glob } from "glob"
import { FileIgnore } from "../../../src/file/ignore"

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tree() {
  const root = await mkdtemp(path.join(tmpdir(), "kilo-ignore-"))
  dirs.push(root)
  const files = [
    "src/a.ts",
    "packages/app/src/b.ts",
    "node_modules/pkg/index.ts",
    "packages/app/node_modules/dep/deep/c.ts",
    "dist/out.js",
    "packages/app/build/d.js",
  ]
  for (const file of files) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await writeFile(path.join(root, file), "x")
  }
  return root
}

describe("FileIgnore.globs", () => {
  test("expands bare folder names and keeps path globs", () => {
    const globs = FileIgnore.globs()
    expect(globs).toContain("**/node_modules/**")
    expect(globs).toContain("**/dist/**")
    expect(globs).toContain("**/*.swp")
    expect(globs).not.toContain("node_modules")
  })

  test("globs prune ignored directories so their contents are never walked", async () => {
    const root = await tree()
    const found = await glob("**/*", { cwd: root, ignore: FileIgnore.globs() })
    expect(found.map((file) => file.replaceAll("\\", "/")).sort()).toEqual([
      "packages",
      "packages/app",
      "packages/app/src",
      "packages/app/src/b.ts",
      "src",
      "src/a.ts",
    ])
  })
})
