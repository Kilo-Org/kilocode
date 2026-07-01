import { expect, test } from "bun:test"
import { shouldSkip } from "./skip-files"

test("matches hosted package glob paths", () => {
  expect(shouldSkip("packages/web/package.json", ["packages/web/**"])).toBe(true)
  expect(shouldSkip("packages/web/src/content/docs/ja/zen.mdx", ["packages/web/**"])).toBe(true)
  expect(shouldSkip("packages/console/app/package.json", ["packages/console/**"])).toBe(true)
})

test("matches removed app package glob paths", () => {
  expect(shouldSkip("packages/app/package.json", ["packages/app/**"])).toBe(true)
})

test("matches upstream CLI scaffold glob paths", () => {
  expect(shouldSkip("packages/cli/package.json", ["packages/cli/**"])).toBe(true)
  expect(shouldSkip("packages/cli/src/index.ts", ["packages/cli/**"])).toBe(true)
})

test("matches upstream stats package glob paths", () => {
  expect(shouldSkip("packages/stats/app/package.json", ["packages/stats/**"])).toBe(true)
  expect(shouldSkip("packages/stats/core/src/index.ts", ["packages/stats/**"])).toBe(true)
})

test("matches removed vscode sdk glob paths", () => {
  expect(shouldSkip("sdks/vscode/package.json", ["sdks/vscode/**"])).toBe(true)
  expect(shouldSkip("sdks/vscode/src/extension.ts", ["sdks/vscode/**"])).toBe(true)
})

test("matches extension glob paths", () => {
  expect(shouldSkip(".github/VOUCHED.td", [".github/VOUCHED.*"])).toBe(true)
})
