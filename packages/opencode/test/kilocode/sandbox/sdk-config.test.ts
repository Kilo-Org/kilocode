import { expect, test } from "bun:test"
import type { Config as ConfigV1 } from "@kilocode/sdk"
import type { Config as ConfigV2 } from "@kilocode/sdk/v2"

const value = {
  experimental: {
    sandbox: true,
    sandbox_restrict_network: false,
  },
}

test("both public SDK Config types expose sandbox policy fields", () => {
  const legacy = value satisfies ConfigV1
  const current = value satisfies ConfigV2
  expect(legacy.experimental).toEqual(current.experimental)
})
