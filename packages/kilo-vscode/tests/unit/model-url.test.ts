import { describe, expect, test } from "bun:test"
import { modelLabel, modelUrl } from "../../webview-ui/agent-manager/model-url"

describe("Kilo model URLs", () => {
  test("uses an already canonical provider/model id", () => {
    expect(modelLabel("kilo", "openai/gpt-5.5")).toBe("openai/gpt-5.5")
    expect(modelUrl("kilo", "openai/gpt-5.5")).toBe("https://kilo.ai/models/openai-gpt-5-5")
  })

  test("combines separate provider and model ids", () => {
    expect(modelLabel("anthropic", "claude-sonnet-4.5")).toBe("anthropic/claude-sonnet-4.5")
    expect(modelUrl("anthropic", "claude-sonnet-4.5")).toBe("https://kilo.ai/models/anthropic-claude-sonnet-4-5")
  })

  test("removes the outer Kilo Gateway prefix", () => {
    expect(modelLabel("kilo", "kilo/openai/gpt-5.5")).toBe("openai/gpt-5.5")
    expect(modelUrl("kilo", "kilo/openai/gpt-5.5")).toBe("https://kilo.ai/models/openai-gpt-5-5")
  })
})
