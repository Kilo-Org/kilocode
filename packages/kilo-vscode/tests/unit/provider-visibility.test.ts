import { describe, expect, it } from "bun:test"

import {
  disabledProviderOptions,
  visibleConnectedIds,
} from "../../webview-ui/src/components/settings/provider-visibility"

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
  it("excludes Kilo and already disabled providers", () => {
    const options = disabledProviderOptions(
      {
        kilo: { id: "kilo", name: "Kilo Gateway", env: [], models: {} },
        openai: { id: "openai", name: "OpenAI", env: [], models: {} },
        anthropic: { id: "anthropic", name: "Anthropic", env: [], models: {} },
      },
      ["openai"],
    )

    expect(options).toEqual([{ value: "anthropic", label: "Anthropic" }])
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
