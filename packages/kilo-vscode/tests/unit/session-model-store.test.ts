import { describe, expect, it } from "bun:test"
import {
  COMPOSER,
  type ModelStore,
  type ResolveEnv,
  applyModel,
  getAgentModel,
  getPick,
  getSelected,
  getSessionModel,
} from "../../webview-ui/src/context/session-model-store"
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
  kilo: makeProvider("kilo", ["kilo-auto/free", "z-first", "z-personal", "z-recommended"]),
  anthropic: makeProvider("anthropic", ["claude-sonnet-4"]),
  openai: makeProvider("openai", ["gpt-4.1"]),
}

const claude: ModelSelection = { providerID: "anthropic", modelID: "claude-sonnet-4" }
const gpt: ModelSelection = { providerID: "openai", modelID: "gpt-4.1" }
const first: ModelSelection = { providerID: "kilo", modelID: "z-first" }
const personal: ModelSelection = { providerID: "kilo", modelID: "z-personal" }
const recommended: ModelSelection = { providerID: "kilo", modelID: "z-recommended" }

function env(overrides?: Partial<ResolveEnv>): ResolveEnv {
  return {
    providers,
    connected: ["kilo", "anthropic", "openai"],
    ready: true,
    organizationId: null,
    fallback: KILO_AUTO,
    getModeModel: () => null,
    getGlobalModel: () => null,
    ...overrides,
  }
}

function emptyStore(): ModelStore {
  return {
    sessionOverrides: {},
    agentSelections: {},
    recentModels: [],
  }
}

describe("per-scope per-agent model selection", () => {
  it("picking a model in one session does not leak into other sessions", () => {
    const store = emptyStore()
    const e = env()

    const updated: ModelStore = { ...store, ...applyModel(store, "code", claude, "session-a") }

    expect(getSessionModel(updated, e, "session-a", "code")).toEqual(claude)
    expect(getSessionModel(updated, e, "session-b", "code")).toEqual(KILO_AUTO)
  })

  it("each session preserves its own model independently", () => {
    let store = emptyStore()
    const e = env()

    store = { ...store, ...applyModel(store, "code", claude, "session-a") }
    store = { ...store, ...applyModel(store, "code", gpt, "session-b") }

    expect(getSessionModel(store, e, "session-a", "code")).toEqual(claude)
    expect(getSessionModel(store, e, "session-b", "code")).toEqual(gpt)
  })

  it("picks are per agent within a scope, so switching agents re-resolves", () => {
    let store = emptyStore()
    const e = env({ getModeModel: (agent) => (agent === "plan" ? gpt : null) })

    store = { ...store, ...applyModel(store, "code", claude, "session-a") }

    expect(getSelected(store, e, "session-a", "code")).toEqual(claude)
    // No plan pick exists: the plan config applies, not the code pick.
    expect(getSelected(store, e, "session-a", "plan")).toEqual(gpt)
    // Switching back restores the code pick.
    expect(getSelected(store, e, "session-a", "code")).toEqual(claude)
  })

  it("applyModel preserves the other agents' picks in the scope", () => {
    let store = emptyStore()
    store = { ...store, ...applyModel(store, "code", claude, "session-a") }
    store = { ...store, ...applyModel(store, "plan", gpt, "session-a") }

    expect(getPick(store, "session-a", "code")).toEqual(claude)
    expect(getPick(store, "session-a", "plan")).toEqual(gpt)

    const updated: ModelStore = { ...store, ...applyModel(store, "code", personal, "session-a") }
    expect(getPick(updated, "session-a", "code")).toEqual(personal)
    expect(getPick(updated, "session-a", "plan")).toEqual(gpt)
  })

  it("mode config beats stale remembered recents for scopes without picks", () => {
    const store: ModelStore = { ...emptyStore(), recentModels: [personal] }
    const e = env({ getModeModel: () => first })

    expect(getSelected(store, e, "new-session", "code")).toEqual(first)
    expect(getSessionModel(store, e, "new-session", "code")).toEqual(first)
  })

  it("recents apply when no config exists", () => {
    const store: ModelStore = { ...emptyStore(), recentModels: [claude] }

    expect(getSelected(store, env(), "new-session", "code")).toEqual(claude)
  })

  it("global config applies when mode config is missing", () => {
    const store: ModelStore = { ...emptyStore(), recentModels: [claude] }
    const e = env({ getGlobalModel: () => gpt })

    expect(getSelected(store, e, "new-session", "code")).toEqual(gpt)
  })

  it("invalid configured models fall through to the next step", () => {
    const store: ModelStore = { ...emptyStore(), recentModels: [claude] }
    const e = env({
      getModeModel: () => ({ providerID: "anthropic", modelID: "missing-model" }),
      getGlobalModel: () => gpt,
    })

    expect(getSelected(store, e, "new-session", "code")).toEqual(gpt)
  })

  it("pending catalogs hide kilo models but keep explicit picks", () => {
    const store = emptyStore()
    const e = env({ ready: false, organizationId: undefined })

    expect(getSelected(store, e, "session-a", "code")).toEqual(null)
    expect(getAgentModel(store, e, "code")).toEqual(null)
  })

  it("org users skip recents and use the recommendation", () => {
    const store: ModelStore = { ...emptyStore(), recentModels: [claude] }
    const e = env({ organizationId: "org-a", defaults: { kilo: "z-recommended" } })

    expect(getSelected(store, e, "new-session", "code")).toEqual(recommended)
  })

  it("org users fall back to the first kilo model without a recommendation", () => {
    const store: ModelStore = { ...emptyStore(), recentModels: [claude] }
    const e = env({ organizationId: "org-a" })

    expect(getSelected(store, e, "new-session", "code")).toEqual(KILO_AUTO)
  })

  it("org users keep in-scope picks", () => {
    let store = emptyStore()
    store = { ...store, ...applyModel(store, "code", claude, COMPOSER) }
    const e = env({ organizationId: "org-a", defaults: { kilo: "z-recommended" } })

    expect(getSelected(store, e, COMPOSER, "code")).toEqual(claude)
  })

  it("getAgentModel resolves mode config, then global, then recents, then fallback", () => {
    const store: ModelStore = { ...emptyStore(), recentModels: [claude] }

    expect(getAgentModel(store, env({ getModeModel: () => first }), "code")).toEqual(first)
    expect(getAgentModel(store, env({ getGlobalModel: () => gpt }), "code")).toEqual(gpt)
    expect(getAgentModel(store, env(), "code")).toEqual(claude)
    expect(getAgentModel(emptyStore(), env(), "code")).toEqual(KILO_AUTO)
  })

  it("getSessionModel resolves for the session's selected agent", () => {
    let store = emptyStore()
    store = { ...store, ...applyModel(store, "plan", gpt, "session-a") }
    store = { ...store, agentSelections: { ...store.agentSelections, "session-a": "plan" } }
    const e = env({ getModeModel: (agent) => (agent === "plan" ? personal : claude) })

    expect(getSessionModel(store, e, "session-a", "code")).toEqual(gpt)
    expect(getSessionModel({ ...store, agentSelections: {} }, e, "session-a", "code")).toEqual(claude)
  })

  it("agent manager allocations keep the manual choice without touching other agents", () => {
    let store = emptyStore()
    store = { ...store, ...applyModel(store, "code", claude, "allocated") }
    store = { ...store, agentSelections: { ...store.agentSelections, allocated: "code" } }
    const e = env({ getModeModel: (agent) => (agent === "code" ? first : null) })

    // The allocated pick beats the mode config for that session.
    expect(getSessionModel(store, e, "allocated", "code")).toEqual(claude)
    // New sessions use the mode config.
    expect(getSessionModel(store, e, "fresh", "code")).toEqual(first)
  })

  it("the composer scope key cannot collide with sessions, drafts, or pending tabs", () => {
    expect(COMPOSER).not.toMatch(/^(?:sidebar-)?pending:/)
    expect(COMPOSER).not.toMatch(/pending/)
    expect(COMPOSER).not.toMatch(/^[0-9a-f]{8}-/)
  })
})
