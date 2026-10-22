import { describe, expect, it } from "bun:test"
import { resolveModelSelection } from "../../webview-ui/src/context/model-selection"
import type { ModelSelection, Provider } from "../../webview-ui/src/types/messages"

function makeProvider(id: string, models: string[]): Provider {
  const result: Provider = { id, name: id, models: {} }
  for (const m of models) {
    result.models[m] = { id: m, name: m }
  }
  return result
}

const KILO_AUTO: ModelSelection = { providerID: "kilo", modelID: "kilo-auto/free" }

const providers: Record<string, Provider> = {
  kilo: makeProvider("kilo", ["kilo-auto/free", "z-first", "z-recommended"]),
  anthropic: makeProvider("anthropic", ["claude-sonnet-4"]),
  openai: makeProvider("openai", ["gpt-4.1"]),
}

const claude: ModelSelection = { providerID: "anthropic", modelID: "claude-sonnet-4" }
const gpt: ModelSelection = { providerID: "openai", modelID: "gpt-4.1" }
const first: ModelSelection = { providerID: "kilo", modelID: "z-first" }
const recommended: ModelSelection = { providerID: "kilo", modelID: "z-recommended" }

function base() {
  return {
    providers,
    connected: ["kilo", "anthropic", "openai"],
    ready: true,
    organizationId: null,
    fallback: KILO_AUTO,
  }
}

describe("resolveModelSelection", () => {
  it("returns null when providers are pending", () => {
    const result = resolveModelSelection({ ...base(), ready: false, session: first })
    expect(result).toBeNull()
  })

  it("returns null when organization is pending", () => {
    const result = resolveModelSelection({ ...base(), ready: true, organizationId: undefined, session: first })
    expect(result).toBeNull()
  })

  it("returns the session pick when set", () => {
    const result = resolveModelSelection({ ...base(), session: claude, mode: gpt, global: first })
    expect(result).toEqual(claude)
  })

  it("returns the mode model over the global model", () => {
    const result = resolveModelSelection({ ...base(), mode: gpt, global: first })
    expect(result).toEqual(gpt)
  })

  it("returns the global model when no session or mode is set", () => {
    const result = resolveModelSelection({ ...base(), global: gpt })
    expect(result).toEqual(gpt)
  })

  it("returns the org recommendation for org users", () => {
    const result = resolveModelSelection({ ...base(), organizationId: "org-a", defaults: { kilo: "z-recommended" } })
    expect(result).toEqual(recommended)
  })

  it("skips recents for org users", () => {
    const result = resolveModelSelection({
      ...base(),
      organizationId: "org-a",
      defaults: { kilo: "z-recommended" },
      recent: [claude],
    })
    expect(result).toEqual(recommended)
  })

  it("returns the first kilo model for org users when no recommendation exists", () => {
    const result = resolveModelSelection({ ...base(), organizationId: "org-a", recent: [claude] })
    expect(result).toEqual(KILO_AUTO)
  })

  it("returns the first valid recent model for non-org users", () => {
    const result = resolveModelSelection({
      ...base(),
      recent: [{ providerID: "anthropic", modelID: "missing" }, claude, gpt],
    })
    expect(result).toEqual(claude)
  })

  it("returns the fallback when nothing else matches", () => {
    const result = resolveModelSelection({ ...base() })
    expect(result).toEqual(KILO_AUTO)
  })

  it("pending kilo models are hidden until the catalog is ready", () => {
    const result = resolveModelSelection({
      ...base(),
      ready: false,
      organizationId: "org-a",
      defaults: { kilo: "z-recommended" },
      session: recommended,
    })
    expect(result).toBeNull()
  })

  it("falls through invalid candidates to the fallback", () => {
    const resolved = resolveModelSelection({ ...base(), session: { providerID: "unknown", modelID: "m" } })
    expect(resolved).toEqual(KILO_AUTO)
  })
})
