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
    "packages/core/src/index.ts",
    "packages/tui/package.json",
    "packages/ui/package.json",
    "packages/kilo-plugin/package.json",
    "packages/plugin-browser/package.json",
    "script/dev-isolated.ts",
  ]) {
    expect(shouldSkip(file, defaultConfig.skipFiles)).toBe(false)
  }
})

test("the v2 config skips the product areas Kilo removed", () => {
  for (const file of [
    "packages/desktop/package.json",
    "packages/app/src/index.tsx",
    "packages/console/app/package.json",
    "packages/web/src/content/docs/zen.mdx",
    "infra/app.ts",
    "sst.config.ts",
    "sdks/vscode/package.json",
  ]) {
    expect(shouldSkip(file, defaultConfig.skipFiles)).toBe(true)
  }
})
