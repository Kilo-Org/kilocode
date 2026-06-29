import { describe, expect, it } from "bun:test"

import type { Provider } from "../../webview-ui/src/types/messages"
import {
  isPopularProvider,
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
