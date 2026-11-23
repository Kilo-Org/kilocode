import { describe, expect, test } from "bun:test"
import { suggestMeasuredAs } from "../../src/api/custom-router"

describe("platform measurement suggestions", () => {
  test("prefers the provider and model match across catalog spelling differences", () => {
    expect(
      suggestMeasuredAs({ provider: "anthropic", model: "Claude-Opus-4_5" }, [
        "other/claude-opus-4.5",
        "anthropic/claude-opus-4.5",
      ]),
    ).toBe("anthropic/claude-opus-4.5")
  })

  test("suggests a unique model name for a different provider", () => {
    expect(
      suggestMeasuredAs({ provider: "local", model: "qwen3:large" }, ["qwen/qwen3-large", "other/different"]),
    ).toBe("qwen/qwen3-large")
  })

  test("does not choose an ambiguous or unmeasured model", () => {
    expect(suggestMeasuredAs({ provider: "local", model: "qwen3" }, ["qwen/qwen3", "other/qwen3"])).toBeNull()
    expect(suggestMeasuredAs({ provider: "local", model: "qwen3" }, ["qwen/different"])).toBeNull()
    expect(suggestMeasuredAs({ provider: "local", model: "qwen3" }, [])).toBeNull()
  })

  test("matches a gateway model ID without a client provider", () => {
    expect(
      suggestMeasuredAs({ provider: null, model: "anthropic/claude-opus-4-5" }, [
        "other/claude-opus-4.5",
        "anthropic/claude-opus-4.5",
      ]),
    ).toBe("anthropic/claude-opus-4.5")
  })
})
