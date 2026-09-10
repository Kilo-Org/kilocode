import { describe, expect, test } from "bun:test"
import { isFree, sanitizeName, isAuto, autoChoices } from "../webview-ui/src/components/shared/model-selector-utils"

describe("model-selector-utils price and free guards", () => {
  test("isFree excludes models when cost.available === false", () => {
    // When cost.available is false, model must NEVER be labeled Free even if isFree was set
    expect(isFree({ isFree: true, cost: { available: false } })).toBe(false)
    expect(isFree({ isFree: false, cost: { available: false } })).toBe(false)

    // When cost.available is true or undefined, retains v1 behavior (true zero stays Free)
    expect(isFree({ isFree: true, cost: { available: true } })).toBe(true)
    expect(isFree({ isFree: true, cost: undefined })).toBe(true)
    expect(isFree({ isFree: true })).toBe(true)

    expect(isFree({ isFree: false, cost: { available: true } })).toBe(false)
    expect(isFree({ isFree: false, cost: undefined })).toBe(false)
    expect(isFree({ isFree: false })).toBe(false)
    expect(isFree({})).toBe(false)
  })

  test("free filter excludes unavailable untiered models from free-only results", () => {
    const models = [
      { id: "free-model", isFree: true, cost: { available: true } },
      { id: "free-legacy", isFree: true, cost: undefined },
      { id: "unavailable-model", isFree: true, cost: { available: false } },
      { id: "paid-model", isFree: false, cost: { available: true } },
    ]

    const freeModels = models.filter(isFree)
    expect(freeModels.map((m) => m.id)).toEqual(["free-model", "free-legacy"])
    expect(freeModels.some((m) => m.id === "unavailable-model")).toBe(false)
  })

  test("sanitizeName strips parenthesized free suffix without touching bare Free names", () => {
    expect(sanitizeName("Llama 3 (free)")).toBe("Llama 3")
    expect(sanitizeName("Mistral 7B (FREE)")).toBe("Mistral 7B")
    expect(sanitizeName("Kilo Auto Free")).toBe("Kilo Auto Free")
  })

  test("isAuto identifies auto routing models", () => {
    expect(isAuto({ providerID: "kilo", id: "kilo-auto/balanced" })).toBe(true)
    expect(isAuto({ providerID: "kilo", id: "kilo-auto/small" })).toBe(true)
    expect(isAuto({ providerID: "kilo", id: "auto-small" })).toBe(true)
    expect(isAuto({ providerID: "kilo", id: "gpt-4o" })).toBe(false)
    expect(isAuto({ providerID: "openai", id: "kilo-auto/balanced" })).toBe(false)
  })
})
