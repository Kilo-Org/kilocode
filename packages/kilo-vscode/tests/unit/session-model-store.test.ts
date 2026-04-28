import { describe, expect, it } from "bun:test"
import {
  type ModelStore,
  type ResolveEnv,
  applyModel,
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
  it("selecting a model in session A writes per-mode globally", () => {
    const store = emptyStore()
    const e = env()

    // User picks claude in session A
    const after = applyModel(store, "code", claude, "session-a")
    const updated: ModelStore = { ...store, ...after }

    // Session A should see claude (via session override)
    expect(getSessionModel(updated, e, "session-a", "code")).toEqual(claude)

    // Session B (no override) inherits the per-mode global selection.
    // This matches CLI behavior: per-mode model is global, not per-session.
    const sessionB = getSessionModel(updated, e, "session-b", "code")
    expect(sessionB).toEqual(claude)
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
  it("applyModel in a session writes to both sessionOverrides and modelSelections", () => {
    const store = emptyStore()
    const result = applyModel(store, "code", claude, "session-a")

    expect(result.sessionOverrides["session-a"]).toEqual(claude)
    expect(result.modelSelections["code"]).toEqual(claude)
  })

  it("switching modes restores per-mode model after session override is cleared", () => {
    let store = emptyStore()
    const e = env()

    // User picks claude for "code" mode in session A
    const result = applyModel(store, "code", claude, "session-a")
    store = { ...store, ...result }

    // Simulate mode switch: clear session override (like selectAgent does)
    const cleared = { ...store, sessionOverrides: {} }

    // The global modelSelections["code"] still has claude
    expect(getSelected(cleared, e, "session-a", "code")).toEqual(claude)
  })

  it("different modes remember their own model independently", () => {
    let store = emptyStore()
    const e = env()

    // User picks claude for "code" in session A
    let result = applyModel(store, "code", claude, "session-a")
    store = { ...store, ...result }

    // User switches to "ask" mode and picks gpt
    result = applyModel(store, "ask", gpt, "session-a")
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
    // Global modelSelections was updated to gpt (last write wins)
    expect(store.modelSelections["code"]).toEqual(gpt)
  })

  it("applyModel without session only writes to modelSelections, not sessionOverrides", () => {
    const store = emptyStore()
    const result = applyModel(store, "code", claude, undefined)

    expect(result.modelSelections["code"]).toEqual(claude)
    expect(Object.keys(result.sessionOverrides)).toHaveLength(0)
  })
})
