import { describe, it, expect } from "bun:test"
import { getProviderFallback } from "../../webview-ui/src/context/provider-utils"

type Provider = {
  id: string
  name: string
  env: string[]
  models: Record<string, { id: string; name: string }>
}

function makeProvider(id: string, models: string[]): Provider {
  return {
    id,
    name: id,
    env: [],
    models: Object.fromEntries(models.map((modelID) => [modelID, { id: modelID, name: modelID }])),
  }
}

describe("provider default fallback", () => {
  it("prefers the kilo provider default when valid", () => {
    const providers = {
      kilo: makeProvider("kilo", ["kilo-auto/frontier"]),
      openai: makeProvider("openai", ["gpt-5"]),
    }

    expect(getProviderFallback(providers, { openai: "gpt-5", kilo: "kilo-auto/frontier" })).toEqual({
      providerID: "kilo",
      modelID: "kilo-auto/frontier",
    })
  })

  it("uses another valid provider default when kilo default is missing", () => {
    const providers = {
      anthropic: makeProvider("anthropic", ["claude-sonnet-4"]),
      openai: makeProvider("openai", ["gpt-5"]),
    }

    expect(getProviderFallback(providers, { openai: "gpt-5" })).toEqual({
      providerID: "openai",
      modelID: "gpt-5",
    })
  })

  it("falls back deterministically when provider defaults are stale", () => {
    const providers = {
      openai: makeProvider("openai", ["gpt-5", "gpt-5-mini"]),
      anthropic: makeProvider("anthropic", ["claude-sonnet-4"]),
    }

    expect(getProviderFallback(providers, { kilo: "kilo-auto/frontier", zed: "bad" })).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
    })
  })

  it("does not depend on arbitrary default object order", () => {
    const providers = {
      openai: makeProvider("openai", ["gpt-5"]),
      anthropic: makeProvider("anthropic", ["claude-sonnet-4"]),
    }

    expect(getProviderFallback(providers, { openai: "gpt-5", anthropic: "claude-sonnet-4" })).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
    })

    expect(getProviderFallback(providers, { anthropic: "claude-sonnet-4", openai: "gpt-5" })).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
    })
  })

  it("falls back to the first available provider model when defaults are missing", () => {
    const providers = {
      openai: makeProvider("openai", ["gpt-5"]),
      anthropic: makeProvider("anthropic", ["claude-sonnet-4"]),
    }

    expect(getProviderFallback(providers, {})).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
    })
  })

  it("uses frontier only as a last resort when no providers have models", () => {
    const providers = {
      kilo: makeProvider("kilo", []),
    }

    expect(getProviderFallback(providers, {})).toEqual({
      providerID: "kilo",
      modelID: "kilo-auto/frontier",
    })
  })
})
