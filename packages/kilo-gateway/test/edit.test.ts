import { describe, expect, test } from "bun:test"
import { extractFencedBody, resolveEditTarget } from "../src/edit"

describe("Edit target resolution", () => {
  test("routes the Inception next-edit model to Inception's edit endpoint", () => {
    expect(resolveEditTarget("inception", "mercury-next-edit")).toEqual({
      provider: "inception",
      model: "mercury-edit-2",
      url: "https://api.inceptionlabs.ai/v1/edit/completions",
    })
  })

  test("does NOT route the FIM Mercury model to the edit endpoint", () => {
    // `mercury-edit-2` (kind: fim) must fall through to the kilo placeholder,
    // not the edit endpoint — only `mercury-next-edit` (kind: edit) is NES.
    expect(resolveEditTarget("inception", "mercury-edit-2").provider).toBe("kilo")
  })

  test("routes the Kilo Gateway next-edit model to the gateway proxy", () => {
    const target = resolveEditTarget("kilo", "inception/mercury-next-edit")
    expect(target.provider).toBe("kilo")
    expect(target.model).toBe("inception/mercury-edit-2")
    expect(target.url).toMatch(/\/api\/edit\/completions$/)
  })

  test("falls back to a kilo placeholder (no upstream) for non-edit models", () => {
    expect(resolveEditTarget("kilo", "mistralai/codestral-2508")).toEqual({
      provider: "kilo",
      model: "mistralai/codestral-2508",
      url: "",
    })
    expect(resolveEditTarget()).toMatchObject({ provider: "kilo", url: "" })
  })
})

describe("extractFencedBody", () => {
  test("extracts a plain triple-backtick fenced body", () => {
    expect(extractFencedBody("```\nconst x = 1\n```")).toBe("const x = 1")
  })

  test("handles a language tag on the opening fence", () => {
    expect(extractFencedBody("```typescript\nconst x = 1\n```")).toBe("const x = 1")
  })

  test("strips embedded <|code_to_edit|> sentinels", () => {
    expect(extractFencedBody("```\n<|code_to_edit|>\nconst x = 2\n<|/code_to_edit|>\n```")).toBe("const x = 2")
  })

  test("returns the raw message when there is no fence", () => {
    expect(extractFencedBody("just text, no fence")).toBe("just text, no fence")
  })

  test("returns the empty string for empty input", () => {
    expect(extractFencedBody("")).toBe("")
  })

  test("suppresses a replacement when the closing fence is missing", () => {
    expect(extractFencedBody("```\nconst x = 1\nconst y = ")).toBe("")
  })

  test("preserves internal blank lines and indentation", () => {
    const body = "def f():\n    if True:\n\n        return 1"
    expect(extractFencedBody("```python\n" + body + "\n```")).toBe(body)
  })
})
