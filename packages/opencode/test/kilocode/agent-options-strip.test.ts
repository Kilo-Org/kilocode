import { describe, expect, test } from "bun:test"
import { stripInternalOptions, INTERNAL_OPTION_KEYS } from "../../src/kilocode/agent/options"

describe("stripInternalOptions", () => {
  test("removes Kilo-internal metadata keys", () => {
    const result = stripInternalOptions({
      id: "architect",
      displayName: "Architect",
      source: "organization",
    })
    expect(result).toEqual({})
  })

  test("preserves genuine provider options", () => {
    const result = stripInternalOptions({
      id: "code-reviewer",
      displayName: "Code Reviewer",
      source: "organization",
      reasoningEffort: "high",
      reasoning: { enabled: true },
      verbosity: "low",
    })
    expect(result).toEqual({
      reasoningEffort: "high",
      reasoning: { enabled: true },
      verbosity: "low",
    })
  })

  test("does not mutate the input", () => {
    const input = { id: "ask", displayName: "Ask", temperature: 0.5 }
    const result = stripInternalOptions(input)
    expect(input).toEqual({ id: "ask", displayName: "Ask", temperature: 0.5 })
    expect(result).toEqual({ temperature: 0.5 })
  })

  test("is a no-op when there is no internal metadata", () => {
    const result = stripInternalOptions({ reasoningEffort: "medium" })
    expect(result).toEqual({ reasoningEffort: "medium" })
  })

  test("strips Scout/reference agent metadata while keeping provider options", () => {
    const result = stripInternalOptions({
      reference: { name: "docs" },
      resolved: { name: "docs", path: "/tmp/docs" },
      reasoningEffort: "high",
    })
    expect(result).toEqual({ reasoningEffort: "high" })
  })

  test("denylist covers exactly the documented internal keys", () => {
    expect([...INTERNAL_OPTION_KEYS]).toEqual(["id", "displayName", "source", "reference", "resolved"])
  })
})
