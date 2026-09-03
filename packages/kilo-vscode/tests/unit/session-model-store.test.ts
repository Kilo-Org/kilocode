import { describe, expect, it } from "bun:test"
import {
  type ModelStore,
  type ResolveEnv,
  applyModel,
  getAgentModel,
  getSessionModel,
  getSelected,
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
  kilo: makeProvider("kilo", ["kilo-auto/free"]),
  anthropic: makeProvider("anthropic", ["claude-sonnet-4"]),
  openai: makeProvider("openai", ["gpt-4.1"]),
}

function env(): ResolveEnv {
  return {
    providers,
    connected: ["kilo", "anthropic", "openai"],
    fallback: KILO_AUTO,
    getModeModel: () => null,
    getGlobalModel: () => null,
  }
}

function emptyStore(): ModelStore {
  return {
    modelSelections: {},
    sessionOverrides: {},
    agentSelections: {},
    recentModels: [],
  }
}

const claude: ModelSelection = { providerID: "anthropic", modelID: "claude-sonnet-4" }
const gpt: ModelSelection = { providerID: "openai", modelID: "gpt-4.1" }

describe("per-session model selection", () => {
  it("selecting a model in session A does not write per-mode globally", () => {
    const store = emptyStore()
    const e = env()

    // User picks claude in session A
    const after = applyModel(store, "code", claude, "session-a")
    const updated: ModelStore = { ...store, ...after }

    // Session A should see claude (via session override)
    expect(getSessionModel(updated, e, "session-a", "code")).toEqual(claude)

    // Session B (no override) keeps the default model.
    const sessionB = getSessionModel(updated, e, "session-b", "code")
    expect(sessionB).toEqual(KILO_AUTO)
  })

  it("each session preserves its own model independently", () => {
    let store = emptyStore()
    const e = env()

    // User picks claude in session A
    const a = applyModel(store, "code", claude, "session-a")
    store = { ...store, ...a }

    // User picks gpt in session B
    const b = applyModel(store, "code", gpt, "session-b")
    store = { ...store, ...b }

    // Both sessions should keep their own model
    expect(getSessionModel(store, e, "session-a", "code")).toEqual(claude)
    expect(getSessionModel(store, e, "session-b", "code")).toEqual(gpt)
  })

  it("getSelected returns per-session override when session is active", () => {
    let store = emptyStore()
    const e = env()

    const a = applyModel(store, "code", claude, "session-a")
    store = { ...store, ...a }

    expect(getSelected(store, e, "session-a", "code")).toEqual(claude)
  })

  it("getSelected returns global model when no session is active", () => {
    let store = emptyStore()
    const e = env()

    // Sidebar mode (no session) — writes globally
    const result = applyModel(store, "code", claude, undefined)
    store = { ...store, ...result }

    expect(getSelected(store, e, undefined, "code")).toEqual(claude)
  })

  it("sidebar model selection writes globally and is visible to new sessions without overrides", () => {
    let store = emptyStore()
    const e = env()

    // User picks claude in sidebar (no session)
    const result = applyModel(store, "code", claude, undefined)
    store = { ...store, ...result }

    // A new session without an override should see the global model
    expect(getSessionModel(store, e, "session-new", "code")).toEqual(claude)
  })

  it("setSessionModel (compare mode) only writes per-session override", () => {
    const store = emptyStore()

    // Simulate setSessionModel — writes only to sessionOverrides
    store.sessionOverrides["session-a"] = claude
    store.sessionOverrides["session-b"] = gpt

    const e = env()
    expect(getSessionModel(store, e, "session-a", "code")).toEqual(claude)
    expect(getSessionModel(store, e, "session-b", "code")).toEqual(gpt)
  })

  it("switching sessions preserves model selection after multiple changes", () => {
    let store = emptyStore()
    const e = env()

    // Simulate: user in session A picks claude
    let result = applyModel(store, "code", claude, "session-a")
    store = { ...store, ...result }

    // Switch to session B — picks gpt
    result = applyModel(store, "code", gpt, "session-b")
    store = { ...store, ...result }

    // Switch back to session A — picks gpt this time
    result = applyModel(store, "code", gpt, "session-a")
    store = { ...store, ...result }

    // Switch back to session B — should still have gpt
    expect(getSessionModel(store, e, "session-b", "code")).toEqual(gpt)
    // Session A was updated to gpt
    expect(getSessionModel(store, e, "session-a", "code")).toEqual(gpt)
  })
})

describe("per-mode model memory", () => {
  it("uses remembered model selections for modes without configured models", () => {
    const store = { ...emptyStore(), modelSelections: { ask: gpt } }

    expect(getAgentModel(store, env(), "ask")).toEqual(gpt)
  })

  it("ignores stale remembered selections when a configured mode model is user-set", () => {
    const configured: ResolveEnv = {
      ...env(),
      getModeModel: (name) => (name === "code" ? claude : null),
    }
    const store = { ...emptyStore(), modelSelections: { code: gpt } }

    expect(getAgentModel(store, configured, "code", true)).toEqual(claude)
  })

  it("applyModel in a session writes only to sessionOverrides", () => {
    const store = emptyStore()
    const result = applyModel(store, "code", claude, "session-a")

    expect(result.sessionOverrides["session-a"]).toEqual(claude)
    expect(result.modelSelections["code"]).toBeUndefined()
  })

  it("switching modes falls back to default after session override is cleared", () => {
    let store = emptyStore()
    const e = env()

    // User picks claude for "code" mode in session A
    const result = applyModel(store, "code", claude, "session-a")
    store = { ...store, ...result }

    // Simulate mode switch: clear session override (like selectAgent does)
    const cleared = { ...store, sessionOverrides: {} }

    expect(getSelected(cleared, e, "session-a", "code")).toEqual(KILO_AUTO)
  })

  it("different modes remember their own model independently", () => {
    let store = emptyStore()
    const e = env()

    // User picks claude for "code" globally
    let result = applyModel(store, "code", claude, undefined)
    store = { ...store, ...result }

    // User switches to "ask" mode and picks gpt globally
    result = applyModel(store, "ask", gpt, undefined)
    store = { ...store, ...result }

    // Clear session overrides (simulating mode switch)
    const cleared: ModelStore = { ...store, sessionOverrides: {} }

    // Each mode should have its own saved model
    expect(getSelected(cleared, e, undefined, "code")).toEqual(claude)
    expect(getSelected(cleared, e, undefined, "ask")).toEqual(gpt)
  })

  it("per-session override still takes priority over global modelSelections", () => {
    let store = emptyStore()
    const e = env()

    // User picks claude globally for "code"
    let result = applyModel(store, "code", claude, undefined)
    store = { ...store, ...result }

    // Session A overrides with gpt
    result = applyModel(store, "code", gpt, "session-a")
    store = { ...store, ...result }

    // Session A sees gpt (its override), not the global claude
    expect(getSelected(store, e, "session-a", "code")).toEqual(gpt)
    // Global modelSelections stays at the sidebar/default choice.
    expect(store.modelSelections["code"]).toEqual(claude)
  })

  it("applyModel without session only writes to modelSelections, not sessionOverrides", () => {
    const store = emptyStore()
    const result = applyModel(store, "code", claude, undefined)

    expect(result.modelSelections["code"]).toEqual(claude)
    expect(Object.keys(result.sessionOverrides)).toHaveLength(0)
  })

  it("switching from plan to implementation uses implementation config after clearing stale memory", () => {
    let store = emptyStore()
    const configured: ResolveEnv = {
      ...env(),
      getModeModel: (name) => (name === "code" ? gpt : name === "plan" ? claude : null),
    }

    // Old manual memory says implementation/code should use claude.
    let result = applyModel(store, "code", claude, undefined)
    store = { ...store, ...result }

    // Current plan session is using its own model.
    result = applyModel(store, "plan", claude, "session-a")
    store = { ...store, ...result, agentSelections: { "session-a": "plan" } }

    const switched: ModelStore = {
      ...store,
      agentSelections: { "session-a": "code" },
      sessionOverrides: {},
      modelSelections: { ...store.modelSelections, code: null },
    }

    expect(getSelected(switched, configured, "session-a", "code")).toEqual(gpt)
  })
})

describe("organization model store", () => {
  const first = { providerID: "kilo", modelID: "first" }
  const recommendation = { providerID: "kilo", modelID: "org-default" }
  const organization: ResolveEnv = {
    ...env(),
    ready: true,
    organizationId: "org-a",
    providers: { ...providers, kilo: makeProvider("kilo", [first.modelID, recommendation.modelID, KILO_AUTO.modelID]) },
    defaults: { kilo: recommendation.modelID },
  }

  it("ignores implicit mode memory and generic recents across every accessor", () => {
    const store: ModelStore = {
      ...emptyStore(),
      modelSelections: { code: KILO_AUTO, ask: first },
      recentModels: [KILO_AUTO, gpt],
    }
    const before = structuredClone(store)
    expect(getSelected(store, organization, undefined, "code")).toEqual(recommendation)
    expect(getSelected(store, organization, "session-a", "code")).toEqual(recommendation)
    expect(getSessionModel(store, organization, "session-a", "code")).toEqual(recommendation)
    expect(getAgentModel(store, organization, "ask")).toEqual(recommendation)
    expect(store).toEqual(before)
  })

  it.each([undefined, "session-a"])("preserves explicit free selections in scope %s", (scope) => {
    const store = emptyStore()
    const updated = { ...store, ...applyModel(store, "code", KILO_AUTO, scope) }
    expect(getSelected(updated, organization, scope, "code")).toEqual(KILO_AUTO)
    expect(getSessionModel(updated, organization, "session-a", "code")).toEqual(KILO_AUTO)
    if (!scope) expect(getAgentModel(updated, organization, "code")).toEqual(KILO_AUTO)
  })

  it.each([undefined, "session-a"])("restores explicit X through X to Y to X in scope %s without writes", (scope) => {
    const store = emptyStore()
    const updated = { ...store, ...applyModel(store, "code", KILO_AUTO, scope) }
    const before = structuredClone(updated)
    const restricted = { ...organization, providers: { kilo: makeProvider("kilo", [recommendation.modelID]) } }
    expect(getSelected(updated, env(), scope, "code")).toEqual(KILO_AUTO)
    expect(getSelected(updated, restricted, scope, "code")).toEqual(recommendation)
    expect(getSessionModel(updated, restricted, "session-a", "code")).toEqual(recommendation)
    expect(getSelected(updated, env(), scope, "code")).toEqual(KILO_AUTO)
    expect(getSessionModel(updated, env(), "session-a", "code")).toEqual(KILO_AUTO)
    if (!scope) {
      expect(getAgentModel(updated, restricted, "code")).toEqual(recommendation)
      expect(getAgentModel(updated, env(), "code")).toEqual(KILO_AUTO)
    }
    expect(updated).toEqual(before)
  })

  it("falls through an unavailable session override to a valid explicit manual choice", () => {
    const store = {
      ...emptyStore(),
      modelSelections: { code: gpt },
      userSetAgents: { code: true },
      sessionOverrides: { "session-a": { providerID: "kilo", modelID: "missing" } },
    }
    expect(getSelected(store, organization, "session-a", "code")).toEqual(gpt)
    expect(getSessionModel(store, organization, "session-a", "code")).toEqual(gpt)
  })

  it("validates history overrides without deleting them when the catalog is empty or pending", () => {
    const store = { ...emptyStore(), sessionOverrides: { "session-a": KILO_AUTO } }
    const before = structuredClone(store)
    for (const pending of [{ ready: false }, { providers: {} }, { organizationId: undefined }]) {
      expect(getSelected(store, { ...organization, ...pending }, "session-a", "code")).toBeNull()
      expect(getSessionModel(store, { ...organization, ...pending }, "session-a", "code")).toBeNull()
    }
    expect(getSessionModel(store, organization, "session-a", "code")).toEqual(KILO_AUTO)
    expect(store).toEqual(before)
  })

  it("preserves connected external session choices while Kilo refreshes", () => {
    const store = { ...emptyStore(), sessionOverrides: { "session-a": gpt } }
    expect(getSessionModel(store, { ...organization, ready: false }, "session-a", "code")).toEqual(gpt)
    expect(getSessionModel(store, { ...organization, connected: [] }, "session-a", "code")).toEqual(recommendation)
  })

  it("keeps Agent Manager mode configuration precedence without destroying the manual choice", () => {
    const store = { ...emptyStore(), modelSelections: { code: KILO_AUTO }, userSetAgents: { code: true } }
    const configured = { ...organization, getModeModel: () => first, getGlobalModel: () => gpt }
    expect(getAgentModel(store, configured, "code")).toEqual(first)
    expect(getSelected(store, configured, undefined, "code")).toEqual(KILO_AUTO)
    expect(store.modelSelections.code).toEqual(KILO_AUTO)
    expect(getAgentModel(store, organization, "code")).toEqual(KILO_AUTO)
  })

  it("uses valid mode and global config before the recommendation when implicit memory is stale", () => {
    const store = { ...emptyStore(), modelSelections: { code: KILO_AUTO } }
    expect(getAgentModel(store, { ...organization, getModeModel: () => first }, "code")).toEqual(first)
    expect(getSelected(store, { ...organization, getGlobalModel: () => gpt }, undefined, "code")).toEqual(gpt)
  })
})
