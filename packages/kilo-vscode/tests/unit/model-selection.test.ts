import { describe, expect, it } from "bun:test"
import { orgDefaultModelID, resolveModelSelection } from "../../webview-ui/src/context/model-selection"
import { KILO_AUTO, parseModelString } from "../../src/shared/provider-model"
import type { Provider } from "../../webview-ui/src/types/messages"

function makeProvider(id: string, name: string, modelIds: string[]): Provider {
  const models: Provider["models"] = {}
  for (const modelID of modelIds) {
    models[modelID] = { id: modelID, name: modelID }
  }
  return { id, name, models }
}

const providers = {
  kilo: makeProvider("kilo", "Kilo Gateway", ["kilo-auto/free", "openai/gpt-4o:free"]),
  anthropic: makeProvider("anthropic", "Anthropic", ["claude-sonnet-4"]),
  openai: makeProvider("openai", "OpenAI", ["gpt-4.1"]),
}

describe("parseModelString", () => {
  it("parses provider/model pairs", () => {
    expect(parseModelString("anthropic/claude-sonnet-4")).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
    })
  })

  it("keeps slashes inside kilo model ids", () => {
    expect(parseModelString("kilo/kilo-auto/free")).toEqual({
      providerID: "kilo",
      modelID: "kilo-auto/free",
    })
  })

  it("returns null for invalid values", () => {
    expect(parseModelString(undefined)).toBeNull()
    expect(parseModelString("claude-sonnet-4")).toBeNull()
  })
})

describe("orgDefaultModelID", () => {
  it("uses a legacy build default for code when no canonical code default exists", () => {
    expect(
      orgDefaultModelID(
        {
          build: { options: { orgDefaultModel: "kilo-auto/free" } },
        },
        "code",
      ),
    ).toBe("kilo-auto/free")
  })

  it("prefers the canonical code default over a legacy build default", () => {
    expect(
      orgDefaultModelID(
        {
          build: { options: { orgDefaultModel: "kilo-auto/free" } },
          code: { options: { orgDefaultModel: "openai/gpt-4o:free" } },
        },
        "code",
      ),
    ).toBe("openai/gpt-4o:free")
  })
})

describe("resolveModelSelection", () => {
  it("prefers a valid override", () => {
    const result = resolveModelSelection({
      providers,
      connected: ["anthropic", "openai"],
      override: { providerID: "openai", modelID: "gpt-4.1" },
      mode: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      orgDefault: { providerID: "kilo", modelID: "openai/gpt-4o:free" },
      fallback: KILO_AUTO,
    })
    expect(result).toEqual({ providerID: "openai", modelID: "gpt-4.1" })
  })

  it("falls back from an invalid override to the mode model", () => {
    const result = resolveModelSelection({
      providers,
      connected: ["anthropic"],
      override: { providerID: "openai", modelID: "gpt-4.1" },
      mode: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      orgDefault: { providerID: "kilo", modelID: "openai/gpt-4o:free" },
      fallback: KILO_AUTO,
    })
    expect(result).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4" })
  })

  it("prefers an organization mode default over global and recent models", () => {
    const result = resolveModelSelection({
      providers,
      connected: ["openai"],
      orgDefault: { providerID: "kilo", modelID: "openai/gpt-4o:free" },
      global: { providerID: "openai", modelID: "gpt-4.1" },
      recent: [{ providerID: "openai", modelID: "gpt-4.1" }],
      fallback: KILO_AUTO,
    })
    expect(result).toEqual({ providerID: "kilo", modelID: "openai/gpt-4o:free" })
  })

  it("uses a kilo organization mode default without requiring a connected provider", () => {
    const result = resolveModelSelection({
      providers,
      connected: [],
      orgDefault: { providerID: "kilo", modelID: "openai/gpt-4o:free" },
      global: { providerID: "openai", modelID: "gpt-4.1" },
      fallback: KILO_AUTO,
    })
    expect(result).toEqual({ providerID: "kilo", modelID: "openai/gpt-4o:free" })
  })

  it("falls back from an invalid organization mode default to the global model", () => {
    const result = resolveModelSelection({
      providers,
      connected: ["openai"],
      orgDefault: { providerID: "kilo", modelID: "missing" },
      global: { providerID: "openai", modelID: "gpt-4.1" },
      fallback: KILO_AUTO,
    })
    expect(result).toEqual({ providerID: "openai", modelID: "gpt-4.1" })
  })

  it("falls back from invalid config to the first valid recent model", () => {
    const result = resolveModelSelection({
      providers,
      connected: ["openai"],
      mode: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      recent: [
        { providerID: "anthropic", modelID: "claude-sonnet-4" },
        { providerID: "openai", modelID: "gpt-4.1" },
      ],
      fallback: KILO_AUTO,
    })
    expect(result).toEqual({ providerID: "openai", modelID: "gpt-4.1" })
  })

  it("uses kilo auto as the explicit final fallback", () => {
    const result = resolveModelSelection({
      providers,
      connected: [],
      fallback: KILO_AUTO,
    })
    expect(result).toEqual(KILO_AUTO)
  })

  it("keeps the explicit fallback even when kilo is missing from the loaded catalog", () => {
    const result = resolveModelSelection({
      providers: { openai: providers.openai },
      connected: [],
      fallback: KILO_AUTO,
    })
    expect(result).toEqual(KILO_AUTO)
  })

  it("keeps the raw preference order before providers load", () => {
    const result = resolveModelSelection({
      providers: {},
      connected: [],
      override: { providerID: "openai", modelID: "gpt-4.1" },
      mode: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      fallback: KILO_AUTO,
    })
    expect(result).toEqual({ providerID: "openai", modelID: "gpt-4.1" })
  })
})
