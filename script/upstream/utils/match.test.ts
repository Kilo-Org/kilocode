import { expect, test } from "bun:test"
import { matches } from "./match"
import { isKiloOwned } from "./owned"

test("**/ matches zero or more directories", () => {
  const patterns = ["packages/ui/src/components/**/*.tsx"]
  expect(matches("packages/ui/src/components/button.tsx", patterns)).toBe(true)
  expect(matches("packages/ui/src/components/button/index.tsx", patterns)).toBe(true)
  expect(matches("packages/ui/src/components/button/index.ts", patterns)).toBe(false)
  expect(matches("packages/web/src/content/docs/x.mdx", ["packages/web/src/content/docs/**/*.mdx"])).toBe(true)
  expect(matches("packages/web/src/content/docs/a/b.mdx", ["packages/web/src/content/docs/**/*.mdx"])).toBe(true)
})

test("* stays inside one path segment", () => {
  expect(matches("script/check-workflows.ts", ["script/check-*.ts"])).toBe(true)
  expect(matches("script/nested/check-x.ts", ["script/check-*.ts"])).toBe(false)
})

test("Kilo-owned patterns cover direct children and nested packages", () => {
  for (const file of [
    "packages/kilo-plugin/package.json",
    "packages/kilo-plugin/src/index.ts",
    "packages/core/src/kilocode/a.ts",
    "packages/console/app/src/kilocode/x.ts",
    "packages/core/test/kilocode/a.test.ts",
    "packages/stats/app/test/kilocode/a.test.ts",
  ])
    expect(isKiloOwned(file)).toBe(true)
})
