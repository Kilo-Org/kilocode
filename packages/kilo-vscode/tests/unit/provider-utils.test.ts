import { describe, it, expect } from "bun:test"
import { flattenModels, findModel, isModelValid } from "../../webview-ui/src/context/provider-utils"
import type { Provider } from "../../webview-ui/src/types/messages"

function makeProvider(id: string, name: string, modelIds: string[]): Provider {
  const models: Provider["models"] = {}
  for (const mid of modelIds) {
    models[mid] = { id: mid, name: mid.toUpperCase() }
  }
  return { id, name, models }
}

describe("flattenModels", () => {
  it("returns empty array for empty providers", () => {
    expect(flattenModels({})).toEqual([])
  })

  it("enriches each model with providerID and providerName", () => {
    const providers = { openai: makeProvider("openai", "OpenAI", ["gpt-4"]) }
    const models = flattenModels(providers)
    expect(models).toHaveLength(1)
    expect(models[0]!.providerID).toBe("openai")
    expect(models[0]!.providerName).toBe("OpenAI")
    expect(models[0]!.id).toBe("gpt-4")
  })

  it("flattens multiple providers", () => {
    const providers = {
      openai: makeProvider("openai", "OpenAI", ["gpt-4", "gpt-3.5"]),
      anthropic: makeProvider("anthropic", "Anthropic", ["claude-3"]),
    }
    const models = flattenModels(providers)
    expect(models).toHaveLength(3)
    const ids = models.map((m) => m.id)
    expect(ids).toContain("gpt-4")
    expect(ids).toContain("gpt-3.5")
    expect(ids).toContain("claude-3")
  })

  it("handles provider with no models", () => {
    const providers = { empty: makeProvider("empty", "Empty", []) }
    expect(flattenModels(providers)).toEqual([])
  })

  it("orders standard reasoning variants from weakest to strongest", () => {
    const provider = makeProvider("openai", "OpenAI", ["gpt-5"])
    provider.models["gpt-5"]!.variants = {
      low: { reasoningEffort: "low" },
      high: { reasoningEffort: "high" },
      none: { reasoningEffort: "none" },
      max: { reasoning: { enabled: true, effort: "xhigh" }, verbosity: "max" },
      xhigh: { reasoningEffort: "xhigh" },
      minimal: { reasoningEffort: "minimal" },
      medium: { reasoningEffort: "medium" },
    }

    const model = flattenModels({ openai: provider })[0]!

    expect(Object.keys(model.variants ?? {})).toEqual(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
    expect(model.variants?.max).toEqual({ reasoning: { enabled: true, effort: "xhigh" }, verbosity: "max" })
  })

  it("orders reasoning subsets used by cloud model families", () => {
    const cases = {
      openai: {
        input: ["low", "high", "none", "xhigh", "medium"],
        output: ["none", "low", "medium", "high", "xhigh"],
      },
      codex: {
        input: ["low", "high", "xhigh", "medium"],
        output: ["low", "medium", "high", "xhigh"],
      },
      claude: {
        input: ["low", "high", "none", "max", "medium"],
        output: ["none", "low", "medium", "high", "max"],
      },
      opus: {
        input: ["low", "high", "none", "xhigh", "max", "medium"],
        output: ["none", "low", "medium", "high", "xhigh", "max"],
      },
      gemini25: {
        input: ["max", "high"],
        output: ["high", "max"],
      },
      deepseek: {
        input: ["high", "none", "xhigh"],
        output: ["none", "high", "xhigh"],
      },
    }
    const result = Object.fromEntries(
      Object.entries(cases).map(([id, sample]) => {
        const provider = makeProvider(id, id, ["model"])
        provider.models.model!.variants = Object.fromEntries(sample.input.map((name) => [name, { name }]))
        const model = flattenModels({ [id]: provider })[0]!
        return [id, Object.keys(model.variants ?? {})]
      }),
    )

    expect(result).toEqual(Object.fromEntries(Object.entries(cases).map(([id, sample]) => [id, sample.output])))
  })

  it("orders cloud toggle and mixed reasoning variants", () => {
    const cases = {
      binary: {
        input: ["thinking", "instant"],
        output: ["instant", "thinking"],
      },
      thinkingOnly: {
        input: ["thinking"],
        output: ["thinking"],
      },
      mercury: {
        input: ["low", "high", "instant", "medium"],
        output: ["instant", "low", "medium", "high"],
      },
    }
    const result = Object.fromEntries(
      Object.entries(cases).map(([id, sample]) => {
        const provider = makeProvider(id, id, ["model"])
        provider.models.model!.variants = Object.fromEntries(sample.input.map((name) => [name, { name }]))
        const model = flattenModels({ [id]: provider })[0]!
        return [id, Object.keys(model.variants ?? {})]
      }),
    )

    expect(result).toEqual(Object.fromEntries(Object.entries(cases).map(([id, sample]) => [id, sample.output])))
  })

  it("preserves provider order when variants include custom names", () => {
    const provider = makeProvider("custom", "Custom", ["model"])
    provider.models.model!.variants = {
      high: { reasoningEffort: "high" },
      turbo: { reasoningEffort: "high" },
      low: { reasoningEffort: "low" },
    }

    const model = flattenModels({ custom: provider })[0]!

    expect(Object.keys(model.variants ?? {})).toEqual(["high", "turbo", "low"])
  })
})

describe("findModel", () => {
  const providers = {
    openai: makeProvider("openai", "OpenAI", ["gpt-4", "gpt-3.5"]),
    anthropic: makeProvider("anthropic", "Anthropic", ["claude-3"]),
  }
  const models = flattenModels(providers)

  it("returns undefined for null selection", () => {
    expect(findModel(models, null)).toBeUndefined()
  })

  it("finds model by providerID and modelID", () => {
    const result = findModel(models, { providerID: "openai", modelID: "gpt-4" })
    expect(result).not.toBeUndefined()
    expect(result?.id).toBe("gpt-4")
    expect(result?.providerID).toBe("openai")
  })

  it("returns undefined when providerID does not match", () => {
    expect(findModel(models, { providerID: "unknown", modelID: "gpt-4" })).toBeUndefined()
  })

  it("returns undefined when modelID does not match", () => {
    expect(findModel(models, { providerID: "openai", modelID: "unknown-model" })).toBeUndefined()
  })

  it("finds model from second provider", () => {
    const result = findModel(models, { providerID: "anthropic", modelID: "claude-3" })
    expect(result?.providerName).toBe("Anthropic")
  })

  it("returns undefined for empty model list", () => {
    expect(findModel([], { providerID: "openai", modelID: "gpt-4" })).toBeUndefined()
  })
})

describe("isModelValid", () => {
  const providers = {
    kilo: makeProvider("kilo", "Kilo Gateway", ["kilo-auto/free"]),
    openai: makeProvider("openai", "OpenAI", ["gpt-4o"]),
  }

  it("accepts a connected provider model", () => {
    expect(isModelValid(providers, ["openai"], { providerID: "openai", modelID: "gpt-4o" })).toBe(true)
  })

  it("rejects a disconnected non-kilo provider", () => {
    expect(isModelValid(providers, [], { providerID: "openai", modelID: "gpt-4o" })).toBe(false)
  })

  it("accepts kilo models when present in the catalog", () => {
    expect(isModelValid(providers, [], { providerID: "kilo", modelID: "kilo-auto/free" })).toBe(true)
  })

  it("rejects unknown models", () => {
    expect(isModelValid(providers, ["openai"], { providerID: "openai", modelID: "missing" })).toBe(false)
  })
})
