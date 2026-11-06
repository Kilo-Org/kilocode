import { describe, expect, test } from "bun:test"
import path from "node:path"
import { resolveToolFilePath } from "../src/tool-diff-path"

// `path.resolve` qualifies every path with a drive on Windows, matching the source helper. `path.join` does not.
const root = path.resolve("/", "repo")

describe("resolveToolFilePath", () => {
  test("keeps an absolute path", () => {
    const file = path.resolve("/", "tmp", "pkg", "a.ts")
    expect(resolveToolFilePath(root, file)).toBe(file)
  })

  test("resolves a relative path in the workspace directory", () => {
    expect(resolveToolFilePath(root, "src/a.ts")).toBe(path.resolve(root, "src", "a.ts"))
  })

  test("resolves parent segments", () => {
    expect(resolveToolFilePath(path.resolve(root, "packages"), "../lib/a.ts")).toBe(path.resolve(root, "lib", "a.ts"))
    expect(resolveToolFilePath(root, "../other/a.ts")).toBe(path.resolve("/", "other", "a.ts"))
  })
})
