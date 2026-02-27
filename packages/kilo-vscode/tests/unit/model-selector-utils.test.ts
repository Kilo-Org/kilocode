import { describe, it, expect } from "bun:test"
import {
  providerSortKey,
  isFree,
  buildTriggerLabel,
  WordBoundaryFzf,
  buildMatchSegments,
  KILO_GATEWAY_ID,
  PROVIDER_ORDER,
} from "../../webview-ui/src/components/shared/model-selector-utils"

const labels = { select: "Select model", noProviders: "No providers", notSet: "Not set" }

describe("providerSortKey", () => {
  it("returns 0 for kilo gateway", () => {
    expect(providerSortKey(KILO_GATEWAY_ID)).toBe(0)
  })

  it("returns correct index for known providers", () => {
    expect(providerSortKey("anthropic")).toBe(1)
    expect(providerSortKey("openai")).toBe(2)
    expect(providerSortKey("google")).toBe(3)
  })

  it("returns order length for unknown provider", () => {
    expect(providerSortKey("unknown-provider")).toBe(PROVIDER_ORDER.length)
  })

  it("is case-insensitive", () => {
    expect(providerSortKey("Anthropic")).toBe(providerSortKey("anthropic"))
    expect(providerSortKey("OpenAI")).toBe(providerSortKey("openai"))
  })

  it("respects custom order array", () => {
    const order = ["z-provider", "a-provider"]
    expect(providerSortKey("z-provider", order)).toBe(0)
    expect(providerSortKey("a-provider", order)).toBe(1)
    expect(providerSortKey("other", order)).toBe(2)
  })

  it("sorts providers correctly when used with sort", () => {
    const ids = ["google", "anthropic", "kilo", "openai"]
    const sorted = ids.slice().sort((a, b) => providerSortKey(a) - providerSortKey(b))
    expect(sorted).toEqual(["kilo", "anthropic", "openai", "google"])
  })
})

describe("isFree", () => {
  it("returns true when inputPrice is 0", () => {
    expect(isFree({ inputPrice: 0 })).toBe(true)
  })

  it("returns false when inputPrice is positive", () => {
    expect(isFree({ inputPrice: 0.001 })).toBe(false)
  })

  it("returns false when inputPrice is non-zero", () => {
    expect(isFree({ inputPrice: 5 })).toBe(false)
  })
})

describe("buildTriggerLabel", () => {
  it("returns resolved model name when available", () => {
    expect(buildTriggerLabel("GPT-4o", null, false, "", true, labels)).toBe("GPT-4o")
  })

  it("returns modelID for kilo gateway raw selection", () => {
    const raw = { providerID: "kilo", modelID: "kilo/auto" }
    expect(buildTriggerLabel(undefined, raw, false, "", true, labels)).toBe("kilo/auto")
  })

  it("returns providerID / modelID for non-kilo raw selection", () => {
    const raw = { providerID: "anthropic", modelID: "claude-3-5-sonnet" }
    expect(buildTriggerLabel(undefined, raw, false, "", true, labels)).toBe("anthropic / claude-3-5-sonnet")
  })

  it("returns clearLabel when allowClear and no selection", () => {
    expect(buildTriggerLabel(undefined, null, true, "None", true, labels)).toBe("None")
  })

  it("falls back to labels.notSet when allowClear and clearLabel is empty", () => {
    expect(buildTriggerLabel(undefined, null, true, "", true, labels)).toBe("Not set")
  })

  it("returns labels.select when providers exist and no selection", () => {
    expect(buildTriggerLabel(undefined, null, false, "", true, labels)).toBe("Select model")
  })

  it("returns labels.noProviders when no providers available", () => {
    expect(buildTriggerLabel(undefined, null, false, "", false, labels)).toBe("No providers")
  })

  it("prefers resolvedName over raw selection", () => {
    const raw = { providerID: "anthropic", modelID: "claude-3-5-sonnet" }
    expect(buildTriggerLabel("Claude Sonnet", raw, false, "", true, labels)).toBe("Claude Sonnet")
  })

  it("ignores partial raw selection (only providerID)", () => {
    const raw = { providerID: "anthropic", modelID: "" }
    expect(buildTriggerLabel(undefined, raw, false, "", true, labels)).toBe("Select model")
  })

  it("ignores partial raw selection (only modelID)", () => {
    const raw = { providerID: "", modelID: "claude-3-5-sonnet" }
    expect(buildTriggerLabel(undefined, raw, false, "", true, labels)).toBe("Select model")
  })
})

describe("WordBoundaryFzf", () => {
  const items = ["Claude Sonnet", "gpt-5", "OpenAI o3", "Gemini Flash"]
  const finder = new WordBoundaryFzf(items, (item) => item)

  it("returns all items with empty positions for empty query", () => {
    const result = finder.find("")
    expect(result).toHaveLength(items.length)
    expect(result.every((entry) => entry.positions.size === 0)).toBe(true)
  })

  it("matches acronym across words and captures matching positions", () => {
    const result = finder.find("clso")
    expect(result).toHaveLength(1)
    expect(result[0].item).toBe("Claude Sonnet")
    expect(Array.from(result[0].positions).sort((a, b) => a - b)).toEqual([0, 1, 7, 8])
  })

  it("supports punctuation in the query by splitting at boundaries", () => {
    const result = finder.find("gpt-")
    expect(result).toHaveLength(1)
    expect(result[0].item).toBe("gpt-5")
  })

  it("requires matches to start at word boundaries", () => {
    const result = finder.find("aude")
    expect(result).toHaveLength(0)
  })

  it("requires all words in multi-word queries to match", () => {
    const result = finder.find("claude flash")
    expect(result).toHaveLength(0)
  })
})

describe("buildMatchSegments", () => {
  it("returns a single non-highlighted segment without matches", () => {
    expect(buildMatchSegments("Claude Sonnet")).toEqual([{ text: "Claude Sonnet", highlight: false }])
  })

  it("splits contiguous highlight groups into segments", () => {
    const segments = buildMatchSegments("Claude Sonnet", new Set([0, 1, 7, 8]))
    expect(segments).toEqual([
      { text: "Cl", highlight: true },
      { text: "aude ", highlight: false },
      { text: "So", highlight: true },
      { text: "nnet", highlight: false },
    ])
  })
})
