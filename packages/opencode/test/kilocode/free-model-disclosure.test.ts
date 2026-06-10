import { describe, expect, test } from "bun:test"
import { FreeModelDisclosure } from "../../src/kilocode/components/free-model-disclosure"

describe("FreeModelDisclosure", () => {
  test("uses compact CLI labels", () => {
    expect(FreeModelDisclosure.label).toBe("May train")
    expect(FreeModelDisclosure.panel).toBe("Free - data may be used for training")
  })

  test("only Kilo Gateway free models get the training disclosure", () => {
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
