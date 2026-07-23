import { describe, it, expect } from "bun:test"
import {
  providerSortKey,
  buildTriggerLabel,
  stripSubProviderPrefix,
  sanitizeName,
  KILO_GATEWAY_ID,
  PROVIDER_ORDER,
  freeDataLabel,
  isDataCollectedModel,
  hasByok,
  isFree,
  isAuto,
  autoSummary,
  autoChoices,
  routingPreview,
} from "../../webview-ui/src/components/shared/model-selector-utils"

const labels = { select: "Select model", noProviders: "No providers", notSet: "Not set" }

describe("providerSortKey", () => {
  it("returns 0 for kilo gateway", () => {
    expect(providerSortKey(KILO_GATEWAY_ID)).toBe(0)
  })

  it("returns correct index for known providers", () => {
    expect(providerSortKey("anthropic")).toBe(1)
    expect(providerSortKey("openai")).toBe(3)
    expect(providerSortKey("google")).toBe(4)
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
    const ids = ["google", "anthropic", "kilo", "openai", "deepseek"]
    const sorted = ids.slice().sort((a, b) => providerSortKey(a) - providerSortKey(b))
    expect(sorted).toEqual(["kilo", "anthropic", "deepseek", "openai", "google"])
  })
})

describe("stripSubProviderPrefix", () => {
  it("strips prefix before ': '", () => {
    expect(stripSubProviderPrefix("Anthropic: Claude Sonnet")).toBe("Claude Sonnet")
    expect(stripSubProviderPrefix("OpenAI: GPT-4o")).toBe("GPT-4o")
  })

  it("leaves names without ': ' unchanged", () => {
    expect(stripSubProviderPrefix("GPT-4o")).toBe("GPT-4o")
    expect(stripSubProviderPrefix("claude-3-5-sonnet")).toBe("claude-3-5-sonnet")
  })

  it("does not strip 'Kilo: ' prefix", () => {
    expect(stripSubProviderPrefix("Kilo: Auto")).toBe("Kilo: Auto")
    expect(stripSubProviderPrefix("kilo: Auto")).toBe("kilo: Auto")
  })
})

describe("sanitizeName", () => {
  it("strips trailing (free) suffix", () => {
    expect(sanitizeName("Llama 3 (free)")).toBe("Llama 3")
  })

  it("is case-insensitive for parenthesized suffix", () => {
    expect(sanitizeName("Model (Free)")).toBe("Model")
    expect(sanitizeName("Model (FREE)")).toBe("Model")
  })

  it("preserves bare trailing Free in names like 'Kilo Auto Free'", () => {
    expect(sanitizeName("Kilo Auto Free")).toBe("Kilo Auto Free")
    expect(sanitizeName("Mixtral free")).toBe("Mixtral free")
    expect(sanitizeName("Mistral:free")).toBe("Mistral:free")
    expect(sanitizeName("Gemma-free")).toBe("Gemma-free")
    expect(sanitizeName("Model FREE")).toBe("Model FREE")
  })

  it("leaves names without (free) suffix unchanged", () => {
    expect(sanitizeName("GPT-4o")).toBe("GPT-4o")
    expect(sanitizeName("Claude Sonnet")).toBe("Claude Sonnet")
  })

  it("does not strip 'free' from the middle of a name", () => {
    expect(sanitizeName("FreeAgent Pro")).toBe("FreeAgent Pro")
  })

  it("handles extra whitespace around (free) suffix", () => {
    expect(sanitizeName("Llama 3 (free)  ")).toBe("Llama 3")
    expect(sanitizeName("Model  (free)  ")).toBe("Model")
  })
})

describe("freeDataLabel", () => {
  it("uses the data collection label without repeating free", () => {
    expect(freeDataLabel("Free", "Data may be used for training")).toBe("Data may be used for training")
  })
})

describe("isFree", () => {
  it("uses only explicit free metadata", () => {
    expect(isFree({ isFree: true })).toBe(true)
    expect(isFree({ isFree: false })).toBe(false)
    expect(isFree({})).toBe(false)
  })
})

describe("isAuto", () => {
  it("matches only Kilo Auto model ids", () => {
    expect(isAuto({ providerID: KILO_GATEWAY_ID, id: "kilo-auto/efficient" })).toBe(true)
    expect(isAuto({ providerID: KILO_GATEWAY_ID, id: "auto-small" })).toBe(true)
    expect(isAuto({ providerID: "anthropic", id: "kilo-auto/efficient" })).toBe(false)
    expect(isAuto({ providerID: KILO_GATEWAY_ID, id: "anthropic/claude-sonnet" })).toBe(false)
  })
})

describe("routingPreview", () => {
  const pinned = { provider: "gmicloud/fp8", name: "GMI Cloud" }
  const hovered = { provider: "chutes", name: "Chutes" }

  it("shows the Auto description instead of the pinned endpoint for the Auto row", () => {
    expect(routingPreview(null, pinned)).toBeUndefined()
  })

  it("keeps the pinned endpoint before a row receives focus", () => {
    expect(routingPreview(undefined, pinned)).toBe(pinned)
  })

  it("shows the focused endpoint", () => {
    expect(routingPreview(hovered, pinned)).toBe(hovered)
  })
})

describe("autoChoices", () => {
  it("uses backend Auto Efficient routes and resolves names when available", () => {
    expect(
      autoChoices(
        {
          providerID: KILO_GATEWAY_ID,
          id: "kilo-auto/efficient",
          autoRouting: { models: ["provider/model", "missing/model"] },
        },
        [{ id: "provider/model", name: "Provider: Model" }],
      ),
    ).toEqual([
      { id: "provider/model", name: "Model" },
      { id: "missing/model", name: "missing/model" },
    ])
  })

  it("ignores missing routes and non-efficient Auto models", () => {
    expect(autoChoices({ providerID: KILO_GATEWAY_ID, id: "kilo-auto/efficient" })).toEqual([])
    expect(
      autoChoices({
        providerID: KILO_GATEWAY_ID,
        id: "kilo-auto/frontier",
        autoRouting: { models: ["provider/model"] },
      }),
    ).toEqual([])
  })
})

describe("autoSummary", () => {
  it("uses the first description paragraph for compact tooltips", () => {
    expect(
      autoSummary({
        options: {
          description: "Routes through available models.\n\nLong details.",
        },
      }),
    ).toBe("Routes through available models.")
  })

  it("falls back when there is no description", () => {
    expect(autoSummary({})).toBe("Routes requests automatically.")
  })
})

describe("isDataCollectedModel", () => {
  it("uses only explicit prompt training metadata", () => {
    expect(isDataCollectedModel({ mayTrainOnYourPrompts: true })).toBe(true)
    expect(isDataCollectedModel({ mayTrainOnYourPrompts: false })).toBe(false)
    expect(isDataCollectedModel({})).toBe(false)
  })
})

describe("hasByok", () => {
  it("uses only explicit user BYOK metadata", () => {
    expect(hasByok({ hasUserByokAvailable: true })).toBe(true)
    expect(hasByok({ hasUserByokAvailable: false })).toBe(false)
    expect(hasByok({})).toBe(false)
  })
})

describe("buildTriggerLabel", () => {
  it("returns resolved model name for non-kilo provider unchanged", () => {
    expect(buildTriggerLabel("GPT-4o", "openai", undefined, null, false, "", true, labels)).toBe("GPT-4o")
  })

  it("strips sub-provider prefix from resolved name for kilo gateway models", () => {
    expect(
      buildTriggerLabel("Anthropic: Claude Sonnet", KILO_GATEWAY_ID, undefined, null, false, "", true, labels),
    ).toBe("Claude Sonnet")
  })

  it("does not strip prefix for non-kilo provider even if name contains ': '", () => {
    expect(buildTriggerLabel("Anthropic: Claude Sonnet", "anthropic", undefined, null, false, "", true, labels)).toBe(
      "Anthropic: Claude Sonnet",
    )
  })

  it("returns resolved name as-is when providerID is undefined", () => {
    expect(buildTriggerLabel("GPT-4o", undefined, undefined, null, false, "", true, labels)).toBe("GPT-4o")
  })

  it("returns providerName / resolvedName for non-kilo provider with providerName", () => {
    expect(buildTriggerLabel("GPT-4o", "openai", "OpenAI", null, false, "", true, labels)).toBe("OpenAI / GPT-4o")
  })

  it("returns modelID for kilo gateway raw selection", () => {
    const raw = { providerID: "kilo", modelID: "kilo-auto/frontier" }
    expect(buildTriggerLabel(undefined, undefined, undefined, raw, false, "", true, labels)).toBe("kilo-auto/frontier")
  })

  it("returns providerID / modelID for non-kilo raw selection", () => {
    const raw = { providerID: "anthropic", modelID: "claude-3-5-sonnet" }
    expect(buildTriggerLabel(undefined, undefined, undefined, raw, false, "", true, labels)).toBe(
      "anthropic / claude-3-5-sonnet",
    )
  })

  it("returns clearLabel when allowClear and no selection", () => {
    expect(buildTriggerLabel(undefined, undefined, undefined, null, true, "None", true, labels)).toBe("None")
  })

  it("falls back to labels.notSet when allowClear and clearLabel is empty", () => {
    expect(buildTriggerLabel(undefined, undefined, undefined, null, true, "", true, labels)).toBe("Not set")
  })

  it("returns labels.select when providers exist and no selection", () => {
    expect(buildTriggerLabel(undefined, undefined, undefined, null, false, "", true, labels)).toBe("Select model")
  })

  it("returns labels.noProviders when no providers available", () => {
    expect(buildTriggerLabel(undefined, undefined, undefined, null, false, "", false, labels)).toBe("No providers")
  })

  it("prefers resolvedName over raw selection", () => {
    const raw = { providerID: "anthropic", modelID: "claude-3-5-sonnet" }
    expect(buildTriggerLabel("Claude Sonnet", undefined, undefined, raw, false, "", true, labels)).toBe("Claude Sonnet")
  })

  it("ignores partial raw selection (only providerID)", () => {
    const raw = { providerID: "anthropic", modelID: "" }
    expect(buildTriggerLabel(undefined, undefined, undefined, raw, false, "", true, labels)).toBe("Select model")
  })

  it("ignores partial raw selection (only modelID)", () => {
    const raw = { providerID: "", modelID: "claude-3-5-sonnet" }
    expect(buildTriggerLabel(undefined, undefined, undefined, raw, false, "", true, labels)).toBe("Select model")
  })
})
