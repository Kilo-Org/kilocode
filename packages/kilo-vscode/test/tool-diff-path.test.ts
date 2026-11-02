import { describe, expect, test } from "bun:test"
import path from "node:path"
import { resolveToolFilePath, virtualDiffPath } from "../src/tool-diff-path"

const root = path.join("/", "repo")

describe("resolveToolFilePath", () => {
  test("keeps an absolute path", () => {
    expect(resolveToolFilePath(root, path.join("/", "tmp", "pkg", "a.ts"))).toBe(path.join("/", "tmp", "pkg", "a.ts"))
  })

  test("resolves a relative path in the workspace directory", () => {
    expect(resolveToolFilePath(root, "src/a.ts")).toBe(path.join(root, "src", "a.ts"))
  })

  test("resolves parent segments", () => {
    expect(resolveToolFilePath(path.join(root, "packages"), "../lib/a.ts")).toBe(path.join(root, "lib", "a.ts"))
    expect(resolveToolFilePath(root, "../other/a.ts")).toBe(path.join("/", "other", "a.ts"))
  })
})

describe("virtualDiffPath", () => {
  test("keeps a nested path after the diff id and side", () => {
    expect(virtualDiffPath("3", "before", "src/components/a.tsx")).toBe("/3/before/src/components/a.tsx")
    expect(virtualDiffPath("3", "after", "src/components/a.tsx")).toBe("/3/after/src/components/a.tsx")
  })

  test("drops leading slashes so the id stays the first segment", () => {
    expect(virtualDiffPath("4", "before", "/abs/path/f.ts")).toBe("/4/before/abs/path/f.ts")
    expect(virtualDiffPath("4", "after", "//abs/path/f.ts")).toBe("/4/after/abs/path/f.ts")
  })
})
