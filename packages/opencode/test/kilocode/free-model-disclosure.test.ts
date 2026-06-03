import { describe, expect, test } from "bun:test"
import { FreeModelDisclosure } from "../../src/kilocode/components/free-model-disclosure"

describe("FreeModelDisclosure", () => {
  test("only Kilo Gateway free models collect data", () => {
    expect(
      FreeModelDisclosure.collectsData({
        isFree: true,
        api: { npm: "@kilocode/kilo-gateway" },
      }),
    ).toBe(true)
    expect(
      FreeModelDisclosure.collectsData({
        isFree: true,
        api: { npm: "@openrouter/ai-sdk-provider" },
      }),
    ).toBe(false)
    expect(
      FreeModelDisclosure.collectsData({
        isFree: false,
        api: { npm: "@kilocode/kilo-gateway" },
      }),
    ).toBe(false)
  })
})
