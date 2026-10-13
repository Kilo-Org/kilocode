import { expect, test } from "bun:test"
import { shouldKeepOurs } from "./keep-ours"

test("keeps Kilo-owned v2 paths", () => {
  expect(shouldKeepOurs("packages/kilo-gateway/src/x.ts", [])).toBe(true)
  expect(shouldKeepOurs("packages/core/src/kilocode/x.ts", [])).toBe(true)
  expect(shouldKeepOurs(".kilo/agent/x.md", [])).toBe(true)
  expect(shouldKeepOurs("script/upstream/x.ts", [])).toBe(true)
})

test("does not keep shared upstream files", () => {
  expect(shouldKeepOurs("packages/core/src/index.ts", [])).toBe(false)
})

test("keeps explicitly configured files", () => {
  expect(shouldKeepOurs("README.md", ["README.md"])).toBe(true)
})
