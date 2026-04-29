import { expect, test } from "bun:test"
import { shouldSkip } from "./skip-files"

test("matches hosted package glob paths", () => {
  expect(shouldSkip("packages/web/package.json", ["packages/web/**"])).toBe(true)
  expect(shouldSkip("packages/web/src/content/docs/ja/zen.mdx", ["packages/web/**"])).toBe(true)
  expect(shouldSkip("packages/console/app/package.json", ["packages/console/**"])).toBe(true)
})

test("does not match sibling package glob paths", () => {
  expect(shouldSkip("packages/app/package.json", ["packages/web/**"])).toBe(false)
})

test("matches extension glob paths", () => {
  expect(shouldSkip(".github/VOUCHED.td", [".github/VOUCHED.*"])).toBe(true)
})
