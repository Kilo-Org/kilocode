import { describe, expect, it } from "bun:test"
import { resolveModelSelection } from "../../webview-ui/src/context/model-selection"
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
  kilo: makeProvider("kilo", "Kilo Gateway", ["kilo-auto/efficient", "kilo-auto/free"]),
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

describe("resolveModelSelection", () => {
  it("prefers a valid override", () => {
    const result = resolveModelSelection({
      providers,
      connected: ["anthropic", "openai"],
      override: { providerID: "openai", modelID: "gpt-4.1" },
      mode: { providerID: "anthropic", modelID: "claude-sonnet-4" },
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
      fallback: KILO_AUTO,
    })
    expect(result).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4" })
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

  it("prefers efficient over the first available model when free is missing", () => {
    const result = resolveModelSelection({
      providers: {
        openai: providers.openai,
        kilo: makeProvider("kilo", "Kilo Gateway", ["anthropic/claude-sonnet-4", "kilo-auto/efficient"]),
      },
      connected: ["openai"],
      fallback: KILO_AUTO,
    })
    expect(result).toEqual({ providerID: "kilo", modelID: "kilo-auto/efficient" })
  })

  it("ignores stale free preferences when efficient is available", () => {
    const result = resolveModelSelection({
      providers: { kilo: makeProvider("kilo", "Kilo Gateway", ["kilo-auto/efficient"]) },
      connected: [],
      override: KILO_AUTO,
      mode: KILO_AUTO,
      global: KILO_AUTO,
      recent: [KILO_AUTO],
      fallback: KILO_AUTO,
    })
    expect(result).toEqual({ providerID: "kilo", modelID: "kilo-auto/efficient" })
  })

  it("preserves valid preferences when free is missing", () => {
    const catalog = {
      kilo: makeProvider("kilo", "Kilo Gateway", ["kilo-auto/efficient"]),
      openai: providers.openai,
    }
    const selection = { providerID: "openai", modelID: "gpt-4.1" }
    for (const preference of [
      { override: selection },
      { mode: selection },
      { global: selection },
      { recent: [selection] },
      { fallback: selection },
    ]) {
      expect(
        resolveModelSelection({ providers: catalog, connected: ["openai"], fallback: KILO_AUTO, ...preference }),
      ).toEqual(selection)
    }
  })

  it("uses the first available model when both auto models are missing", () => {
    const result = resolveModelSelection({
      providers: {
        kilo: makeProvider("kilo", "Kilo Gateway", ["openai/gpt-4.1", "anthropic/claude-sonnet-4"]),
        openai: providers.openai,
      },
      connected: ["openai"],
      fallback: KILO_AUTO,
    })
    expect(result).toEqual({ providerID: "kilo", modelID: "openai/gpt-4.1" })
  })

  it("uses the first connected model when kilo is missing", () => {
    const result = resolveModelSelection({
      providers: { openai: providers.openai },
      connected: ["openai"],
      fallback: KILO_AUTO,
    })
    expect(result).toEqual({ providerID: "openai", modelID: "gpt-4.1" })
  })

  it("skips disconnected providers and providers without models", () => {
    const result = resolveModelSelection({
      providers: {
        anthropic: providers.anthropic,
        kilo: makeProvider("kilo", "Kilo Gateway", []),
        openai: providers.openai,
      },
      connected: ["openai"],
      fallback: KILO_AUTO,
    })
    expect(result).toEqual({ providerID: "openai", modelID: "gpt-4.1" })
  })

  it("returns null when no loaded models are selectable", () => {
    const result = resolveModelSelection({
      providers: { kilo: makeProvider("kilo", "Kilo Gateway", []), openai: providers.openai },
      connected: [],
      fallback: KILO_AUTO,
    })
    expect(result).toBeNull()
  })

  it("does not choose an automatic fallback when none is requested", () => {
    for (const fallback of [undefined, null]) {
      expect(resolveModelSelection({ providers, connected: ["openai"], fallback })).toBeNull()
    }
  })

  it("keeps the explicit fallback before providers load", () => {
    expect(resolveModelSelection({ providers: {}, connected: [], fallback: KILO_AUTO })).toEqual(KILO_AUTO)
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
