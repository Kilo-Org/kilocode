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
  it("prefers backend defaults when present and valid", () => {
    const providers = {
      kilo: makeProvider("kilo", ["kilo-auto/frontier"]),
      openai: makeProvider("openai", ["gpt-5"]),
    }

    expect(getProviderFallback(providers, { openai: "gpt-5", kilo: "kilo-auto/frontier" })).toEqual({
      providerID: "openai",
      modelID: "gpt-5",
    })
  })

  it("falls back to the first available provider model when backend default is invalid", () => {
    const providers = {
      openai: makeProvider("openai", ["gpt-5"]),
      anthropic: makeProvider("anthropic", ["claude-sonnet-4"]),
    }

    expect(getProviderFallback(providers, { kilo: "kilo-auto/frontier" })).toEqual({
      providerID: "openai",
      modelID: "gpt-5",
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
