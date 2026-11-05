import { describe, expect, test } from "bun:test"
import path from "node:path"
import { filePosition, resolveToolFilePath } from "../src/tool-diff-path"

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

describe("filePosition", () => {
  test("converts a 1-based line and column to zero-based values", () => {
    expect(filePosition(3, 5)).toEqual({ line: 2, column: 4 })
  })

  test("defaults the column to the start of the line", () => {
    expect(filePosition(1)).toEqual({ line: 0, column: 0 })
    expect(filePosition(2, 0)).toEqual({ line: 1, column: 0 })
  })

  test("has no position without a positive line", () => {
    expect(filePosition()).toBeUndefined()
    expect(filePosition(0, 3)).toBeUndefined()
  })
})
