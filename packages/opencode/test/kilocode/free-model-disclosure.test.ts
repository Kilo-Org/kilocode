import { describe, expect, test } from "bun:test"
import { FreeModelDisclosure } from "../../src/kilocode/components/free-model-disclosure"

describe("FreeModelDisclosure", () => {
  test("uses compact CLI labels", () => {
    expect(FreeModelDisclosure.label).toBe("May train")
    expect(FreeModelDisclosure.panel).toBe("Data may be used for training")
  })

  test("uses only explicit prompt training metadata", () => {
    expect(FreeModelDisclosure.collectsData({ mayTrainOnYourPrompts: true })).toBe(true)
    expect(FreeModelDisclosure.collectsData({ mayTrainOnYourPrompts: false })).toBe(false)
    expect(FreeModelDisclosure.collectsData({})).toBe(false)
  })

  test("uses only explicit user BYOK metadata", () => {
    expect(FreeModelDisclosure.byok).toBe("BYOK")
    expect(FreeModelDisclosure.hasByok({ hasUserByokAvailable: true })).toBe(true)
    expect(FreeModelDisclosure.hasByok({ hasUserByokAvailable: false })).toBe(false)
    expect(FreeModelDisclosure.hasByok({})).toBe(false)
  })
})
