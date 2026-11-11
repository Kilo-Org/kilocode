import { describe, expect, test } from "bun:test"
import { minimatch } from "minimatch"
import { FileIgnore } from "../../../../src/file/ignore"

describe("FileIgnore.globs", () => {
  test("anchors bare directory names so nested directories are pruned", () => {
    const globs = FileIgnore.globs()
    expect(globs).toContain("**/node_modules")
    expect(globs).toContain("**/node_modules/**")
  })

  test("prunes nested directories that the raw pattern list would walk", () => {
    const globs = FileIgnore.globs()
    const nested = "packages/a/node_modules/dep/index.js"
    const matched = globs.some((pattern) => minimatch(nested, pattern, { dot: true }))
    expect(matched).toBe(true)
  })

  test("keeps multi-segment and already-globbed patterns untouched", () => {
    const globs = FileIgnore.globs()
    expect(globs).toContain("**/*.log")
    expect(globs).toContain("**/.kilo/worktrees/**")
  })

  test("does not add directory expansions for multi-segment patterns", () => {
    const globs = FileIgnore.globs()
    expect(globs).not.toContain("**/*.log/**")
  })
})
