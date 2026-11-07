import { describe, expect, it } from "bun:test"

import type { Provider } from "../../webview-ui/src/types/messages"
import {
  isPopularProvider,
  providerApiKeyUrl,
  providerIcon,
  popularProviderIndex,
  sortProviders,
} from "../../webview-ui/src/components/settings/provider-catalog"

function provider(id: string, metadata?: Provider["metadata"]): Provider {
  return {
    id,
    name: id,
    models: {},
    metadata,
  }
}

describe("provider catalog", () => {
  it("treats known provider objects as popular when metadata is unavailable", () => {
    expect(isPopularProvider(provider("openai"))).toBe(true)
    expect(isPopularProvider(provider("anthropic"))).toBe(true)
    expect(isPopularProvider(provider("unknown"))).toBe(false)
  })

  it("uses fallback ordering for provider objects without metadata", () => {
    const items = [provider("openai"), provider("anthropic"), provider("unknown")]
    const ids = sortProviders(items).map((item) => item.id)

    expect(ids).toEqual(["anthropic", "openai", "unknown"])
  })

  it("prefers metadata priority over fallback ordering", () => {
    expect(popularProviderIndex(provider("openai", { priority: 1 }))).toBe(1)
  })
})

describe("Ace Data Cloud catalog identity", () => {
  it("uses the provider logo instead of the generic icon", () => {
    expect(providerIcon(provider("acedatacloud"))).toBe("acedatacloud")
    expect(providerIcon(provider("unknown"))).toBe("synthetic")
  })

  it("links its API key prompt to the application credential console", () => {
    const url = new URL(providerApiKeyUrl("acedatacloud")!)
    expect(url.origin + url.pathname).toBe("https://platform.acedata.cloud/console/applications")
    expect(url.searchParams.get("utm_source")).toBe("vscode_marketplace")
    expect(url.searchParams.get("utm_medium")).toBe("referral")
    expect(url.searchParams.get("utm_campaign")).toBe("evergreen")
    expect(url.searchParams.get("utm_content")).toBe("kilo_provider_api_key")
    expect(providerApiKeyUrl("openai")).toBeUndefined()
    expect(providerApiKeyUrl("custom-acedatacloud")).toBeUndefined()
  })
})
