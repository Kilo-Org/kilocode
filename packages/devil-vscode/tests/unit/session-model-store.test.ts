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
  it("selecting a model in session A does not affect session B", () => {
    const store = emptyStore()
    const e = env()

    // User picks claude in session A
    const after = applyModel(store, "code", claude, "session-a")
    const updated: ModelStore = { ...store, ...after }

    // Session A should see claude
    expect(getSessionModel(updated, e, "session-a", "code")).toEqual(claude)

    // Session B should NOT see claude — it should fall back to the default
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
