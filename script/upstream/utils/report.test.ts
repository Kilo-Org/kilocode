import { expect, test } from "bun:test"
import { getRecommendation } from "./report"

test("recommends skip for hosted package globs", () => {
  expect(getRecommendation("packages/web/src/content/docs/ja/zen.mdx", [], ["packages/web/**"]).recommendation).toBe(
    "skip",
  )
  expect(getRecommendation("packages/console/app/package.json", [], ["packages/console/**"]).recommendation).toBe(
    "skip",
  )
})

test("does not recommend skip for unrelated packages", () => {
  expect(getRecommendation("packages/app/package.json", [], ["packages/web/**"]).recommendation).toBe(
    "package-transform",
  )
})

test("recommends keep ours for Kilo directories", () => {
  expect(getRecommendation("packages/kilo-vscode/.prettierignore", [], []).recommendation).toBe("keep-ours")
  expect(getRecommendation("packages/kilo-i18n/tsconfig.json", [], []).recommendation).toBe("keep-ours")
})
