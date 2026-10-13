import { expect, test } from "bun:test"
import { shouldSkip } from "./skip-files"
import { defaultConfig } from "../utils/config"

test("matches explicit and glob patterns", () => {
  expect(shouldSkip("README.md", ["README.md"])).toBe(true)
  expect(shouldSkip("docs/guide.md", ["docs/**"])).toBe(true)
  expect(shouldSkip(".github/VOUCHED.td", [".github/VOUCHED.*"])).toBe(true)
})

test("does not match files outside the patterns", () => {
  expect(shouldSkip("packages/core/src/index.ts", ["README.md", "docs/**"])).toBe(false)
})

test("the v2 config does not skip live v2 packages", () => {
  for (const file of [
    "packages/cli/package.json",
    "packages/web/src/content/docs/zen.mdx",
    "packages/app/package.json",
    "packages/desktop/package.json",
    "packages/console/app/package.json",
  ]) {
    expect(shouldSkip(file, defaultConfig.skipFiles)).toBe(false)
  }
})
