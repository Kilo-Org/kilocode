import { describe, expect, it } from "bun:test"

import {
  canChangeProviderKey,
  disabledProviderOptions,
  providersWithKiloFallback,
  visibleConnectedIds,
} from "../../webview-ui/src/components/settings/provider-visibility"

describe("canChangeProviderKey", () => {
  const item = { id: "vercel", name: "Vercel", models: {}, source: "config" as const }

  it("offers replacement for configured and stored built-in API keys", () => {
    expect(canChangeProviderKey(item, undefined, undefined)).toBe(true)
    expect(canChangeProviderKey({ ...item, source: "api" }, undefined, [{ type: "api", label: "API key" }])).toBe(true)
  })

  it("excludes environment, OAuth and unknown sources", () => {
    for (const source of ["env", "custom", undefined] as const) {
      expect(canChangeProviderKey({ ...item, source }, undefined, undefined)).toBe(false)
    }
  })

  it("excludes custom providers and special credential flows", () => {
    expect(canChangeProviderKey(item, { npm: "@ai-sdk/openai-compatible" }, undefined)).toBe(false)
    for (const id of [
      "kilo",
      "anaconda-desktop",
      "atomic-chat",
      "lmstudio",
      "ollama",
      "amazon-bedrock",
      "google-vertex",
      "google-vertex-anthropic",
    ]) {
      expect(canChangeProviderKey({ ...item, id }, undefined, undefined)).toBe(false)
    }
  })

  it("excludes config keys that override a replacement stored key", () => {
    expect(canChangeProviderKey(item, { options: { apiKey: "configured" } }, undefined)).toBe(false)
    expect(canChangeProviderKey(item, { api_key: "configured" }, undefined)).toBe(false)
    expect(canChangeProviderKey(item, { models: {} }, undefined)).toBe(true)
  })

  it("excludes dialogs that select OAuth or require extra credentials", () => {
    expect(canChangeProviderKey(item, undefined, [])).toBe(false)
    expect(canChangeProviderKey(item, undefined, [{ type: "oauth", label: "Sign in" }])).toBe(false)
    expect(
      canChangeProviderKey(item, undefined, [
        { type: "api", label: "API key" },
        { type: "oauth", label: "Sign in" },
      ]),
    ).toBe(false)
    expect(
      canChangeProviderKey(item, undefined, [
        { type: "api", label: "Credentials", prompts: [{ type: "text", key: "project", message: "Project" }] },
      ]),
    ).toBe(false)
  })
})

describe("visibleConnectedIds", () => {
  it("hides Kilo from the connected list when auth is missing", () => {
    const ids = visibleConnectedIds(["kilo", "openrouter"], { openrouter: "api" })

    expect(ids).toEqual(["openrouter"])
  })

  it("keeps Kilo in the connected list when auth exists", () => {
    const ids = visibleConnectedIds(["kilo", "openrouter"], { kilo: "oauth", openrouter: "api" })

    expect(ids).toEqual(["kilo", "openrouter"])
  })

  it("leaves non-Kilo providers untouched", () => {
    const ids = visibleConnectedIds(["anthropic"], {})

    expect(ids).toEqual(["anthropic"])
  })
})

describe("disabledProviderOptions", () => {
  it("includes Kilo and excludes already disabled providers", () => {
    const options = disabledProviderOptions(
      {
        kilo: { id: "kilo", name: "Kilo Gateway", env: [], models: {} },
        openai: { id: "openai", name: "OpenAI", env: [], models: {} },
        anthropic: { id: "anthropic", name: "Anthropic", env: [], models: {} },
      },
      ["openai"],
    )

    expect(options).toEqual([
      { value: "anthropic", label: "Anthropic" },
      { value: "kilo", label: "Kilo Gateway" },
    ])
  })

  it("sorts options by provider name", () => {
    const options = disabledProviderOptions(
      {
        zed: { id: "zed", name: "Zed", env: [], models: {} },
        alpha: { id: "alpha", name: "Alpha", env: [], models: {} },
      },
      [],
    )

    expect(options).toEqual([
      { value: "alpha", label: "Alpha" },
      { value: "zed", label: "Zed" },
    ])
  })
})

describe("providersWithKiloFallback", () => {
  it("adds Kilo when backend providers omit it", () => {
    const providers = providersWithKiloFallback({
      anthropic: { id: "anthropic", name: "Anthropic", env: [], models: {} },
    })

    expect(providers.kilo?.name).toBe("Kilo Gateway")
    expect(providers.anthropic?.name).toBe("Anthropic")
  })

  it("keeps the backend Kilo provider when present", () => {
    const providers = providersWithKiloFallback({
      kilo: { id: "kilo", name: "Custom Kilo Name", env: [], models: {} },
    })

    expect(providers.kilo?.name).toBe("Custom Kilo Name")
  })
})
