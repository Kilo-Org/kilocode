import { describe, expect, test } from "bun:test"
import { KiloAutoPreview } from "../src/index.js"

describe("KiloAutoPreview.preview", () => {
  test("classifies an authentication refactoring prompt with high risk and Frontier guidance", () => {
    const result = KiloAutoPreview.preview({
      prompt: "Refactor the authentication helper to handle expired tokens and add tests.",
      agent: "code",
      currentModel: { providerID: "kilo", id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6" },
    })

    expect(result.profile).toBe("efficient")
    expect(result.illustrative).toBe(true)
    expect(result.task.category).toBe("Code refactoring & tests")
    expect(result.attributes.risk).toEqual({ level: "high", detail: "authentication" })
    expect(result.attributes.toolsRequired).toBe(true)
    expect(result.selection.modelName).toBe("Claude Sonnet")
    expect(result.candidates).toHaveLength(3)
    expect(result.candidates.find((c) => c.predicted)?.modelName).toBe("Claude Sonnet")
    expect(result.candidates.find((c) => c.current)?.modelName).toBe("Claude Opus")
    expect(result.recommendation?.suggestedProfile).toBe("frontier")
  })

  test("appends a distinct explicit current model with estimated cost from pricing", () => {
    const result = KiloAutoPreview.preview({
      prompt: "Refactor the authentication helper to handle expired tokens and add tests.",
      currentModel: {
        providerID: "kilo",
        id: "openai/gpt-5.4",
        name: "GPT-5.4",
        cost: { input: 5, output: 15 },
      },
    })

    expect(result.candidates).toHaveLength(4)
    const current = result.candidates.find((c) => c.current)
    expect(current).toEqual({
      modelID: "openai/gpt-5.4",
      modelName: "GPT-5.4",
      estimatedCostUsd: 0.07,
      taskFit: "very_high",
      predicted: false,
      current: true,
    })
  })

  test("sets estimatedCostUsd to null when an uncatalogued current model has no pricing", () => {
    const result = KiloAutoPreview.preview({
      prompt: "Add a dark mode toggle to the settings card.",
      currentModel: { providerID: "custom", id: "acme/custom-coder", name: "Acme Coder" },
    })

    const current = result.candidates.find((c) => c.current)
    expect(current?.modelName).toBe("Acme Coder")
    expect(current?.estimatedCostUsd).toBeNull()
  })

  test("classifies read-only questions cleanly with lightweight selection", () => {
    const result = KiloAutoPreview.preview({
      prompt: "Explain how session inbox delivery works.",
      agent: "ask",
    })

    expect(result.task.category).toBe("Explanation & Q&A")
    expect(result.attributes.toolsRequired).toBe(false)
    expect(result.selection.modelName).toBe("Gemini Flash")
    expect(result.recommendation?.suggestedProfile).toBe("efficient")
  })

  test("respects explicit frontier profile override", () => {
    const result = KiloAutoPreview.preview({
      prompt: "Design a distributed migration architecture for the event store.",
      profile: "frontier",
    })

    expect(result.profile).toBe("frontier")
    expect(result.task.category).toBe("Architecture & system design")
    expect(result.selection.modelName).toBe("Claude Opus")
    expect(result.candidates.find((c) => c.predicted)?.modelName).toBe("Claude Opus")
    expect(result.recommendation?.suggestedProfile).toBe("efficient")
  })
})
