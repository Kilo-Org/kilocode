import { describe, expect, test } from "bun:test"
import { KiloAutocomplete } from "../src/index.js"

// A custom server keeps the expected URLs independent of KILO_API_URL and KILO_AI_GATEWAY_URL.
const server = "https://kilo.example.test"

describe("Next Edit target", () => {
  test("routes the Inception Next Edit model to the Inception edit endpoint", () => {
    expect(KiloAutocomplete.resolveEditTarget("inception", "mercury-next-edit", server)).toEqual({
      provider: "inception",
      model: "mercury-edit-2",
      url: "https://api.inceptionlabs.ai/v1/edit/completions",
    })
  })

  test("does not route the Mercury FIM model to an edit endpoint", () => {
    expect(KiloAutocomplete.resolveEditTarget("inception", "mercury-edit-2", server)).toEqual({
      provider: "kilo",
      model: "mercury-edit-2",
      url: "",
    })
  })

  test("routes the Kilo Next Edit model and the default model through the Gateway", () => {
    const target = {
      provider: "kilo",
      model: "inception/mercury-edit-2",
      url: "https://kilo.example.test/api/gateway/edit/completions",
    } as const
    expect(KiloAutocomplete.resolveEditTarget("kilo", "inception/mercury-next-edit", server)).toEqual(target)
    expect(KiloAutocomplete.resolveEditTarget(undefined, undefined, server)).toEqual(target)
  })

  test("returns a Kilo target without URL for models that are not Next Edit models", () => {
    expect(KiloAutocomplete.resolveEditTarget("kilo", "mistralai/codestral-2508", server)).toEqual({
      provider: "kilo",
      model: "mistralai/codestral-2508",
      url: "",
    })
  })
})

describe("extractFencedBody", () => {
  test("extracts the fenced body with or without a language tag", () => {
    expect(KiloAutocomplete.extractFencedBody("```\nconst x = 1\n```")).toBe("const x = 1")
    expect(KiloAutocomplete.extractFencedBody("```typescript\nconst x = 1\n```")).toBe("const x = 1")
  })

  test("strips the code_to_edit sentinels", () => {
    expect(KiloAutocomplete.extractFencedBody("```\n<|code_to_edit|>\nconst x = 2\n<|/code_to_edit|>\n```")).toBe(
      "const x = 2",
    )
  })

  test("returns a message without a fence as is and an empty message as empty", () => {
    expect(KiloAutocomplete.extractFencedBody("just text, no fence")).toBe("just text, no fence")
    expect(KiloAutocomplete.extractFencedBody("")).toBe("")
  })

  test("suppresses a truncated replacement when the closing fence is missing", () => {
    expect(KiloAutocomplete.extractFencedBody("```\nconst x = 1\nconst y = ")).toBe("")
  })

  test("keeps blank lines and indentation inside the body", () => {
    const body = "def f():\n    if True:\n\n        return 1"
    expect(KiloAutocomplete.extractFencedBody("```python\n" + body + "\n```")).toBe(body)
  })
})
