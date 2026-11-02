import { describe, expect, test } from "bun:test"
import { connectableProviders } from "../webview-ui/src/components/settings/provider-visibility"

const provider = (id: string, connections: unknown[] = []) => ({ id, connections })

describe("connectableProviders", () => {
  test("offers providers with no connection", () => {
    const items = [provider("openai"), provider("anthropic")]
    expect(connectableProviders(items, [])).toEqual(items)
  })

  test("excludes a provider that is already connected", () => {
    const items = [provider("openai", [{ type: "credential" }]), provider("anthropic")]
    expect(connectableProviders(items, [])).toEqual([provider("anthropic")])
  })

  test("excludes a provider denied by a provider.use policy", () => {
    const items = [provider("openai"), provider("anthropic")]
    const policies = [{ action: "provider.use", resource: "openai", effect: "deny" }]
    expect(connectableProviders(items, policies)).toEqual([provider("anthropic")])
  })

  test("keeps a provider when the deny is the catch-all resource", () => {
    const items = [provider("openai")]
    const policies = [{ action: "provider.use", resource: "*", effect: "deny" }]
    expect(connectableProviders(items, policies)).toEqual(items)
  })
})
