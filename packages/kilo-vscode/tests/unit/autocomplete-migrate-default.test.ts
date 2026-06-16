import { describe, it, expect, afterEach, beforeEach } from "bun:test"
import * as vscode from "vscode"
import { migrateDefaultAutocompleteSettings } from "../../src/services/autocomplete/migrate-default"
import { DEFAULT_AUTOCOMPLETE_MODEL } from "../../src/shared/autocomplete-models"

type Scoped = { globalValue?: unknown; workspaceValue?: unknown }
type State = Map<string, Scoped>

type Stub = {
  getConfiguration: (section?: string) => {
    get: (key: string, fallback?: unknown) => unknown
    inspect: (key: string) => Scoped | undefined
    update: (key: string, value: unknown, target: unknown) => Promise<void>
  }
}

const original = vscode.workspace.getConfiguration

function makeContext(initial: Record<string, unknown> = {}) {
  const flag = new Map<string, unknown>(Object.entries(initial))
  return {
    flag,
    context: {
      globalState: {
        get: <T>(key: string) => flag.get(key) as T | undefined,
        update: async (key: string, value: unknown) => {
          flag.set(key, value)
        },
      },
    } as any,
  }
}

function stubConfig(state: State) {
  function entry(key: string): Scoped {
    const e = state.get(key)
    if (e) return e
    const fresh: Scoped = {}
    state.set(key, fresh)
    return fresh
  }
  ;(vscode.workspace as unknown as Stub).getConfiguration = (section?: string) => {
    if (section !== "kilo-code.new.autocomplete") {
      return {
        get: () => undefined,
        inspect: () => undefined,
        update: async () => {},
      }
    }
    return {
      get: (key: string, fallback?: unknown) => {
        const e = state.get(key)
        return e?.workspaceValue ?? e?.globalValue ?? fallback
      },
      inspect: (key: string) => state.get(key) ?? {},
      update: async (key: string, value: unknown, target: unknown) => {
        // vscode.ConfigurationTarget.Global = 1, Workspace = 2
        const scope: keyof Scoped = target === 2 ? "workspaceValue" : "globalValue"
        const e = entry(key)
        if (value === undefined) delete e[scope]
        else e[scope] = value
      },
    }
  }
}

function setGlobal(state: State, key: string, value: unknown) {
  const e = state.get(key) ?? {}
  e.globalValue = value
  state.set(key, e)
}

function setWorkspace(state: State, key: string, value: unknown) {
  const e = state.get(key) ?? {}
  e.workspaceValue = value
  state.set(key, e)
}

afterEach(() => {
  ;(vscode.workspace as unknown as Stub).getConfiguration = original as Stub["getConfiguration"]
})

describe("migrateDefaultAutocompleteSettings", () => {
  let state: State

  beforeEach(() => {
    state = new Map()
    stubConfig(state)
  })

  it("clears provider/model when both equal the current default at global scope", async () => {
    setGlobal(state, "provider", DEFAULT_AUTOCOMPLETE_MODEL.providerID)
    setGlobal(state, "model", DEFAULT_AUTOCOMPLETE_MODEL.modelID)
    const { context, flag } = makeContext()

    await migrateDefaultAutocompleteSettings(context)

    expect(state.get("provider")?.globalValue).toBeUndefined()
    expect(state.get("model")?.globalValue).toBeUndefined()
    expect(flag.get("kilo.autocomplete.defaultClearMigrationV1")).toBe(true)
  })

  it("leaves an explicitly chosen non-default model untouched", async () => {
    setGlobal(state, "provider", "inception")
    setGlobal(state, "model", "mercury-edit-2")
    const { context, flag } = makeContext()

    await migrateDefaultAutocompleteSettings(context)

    expect(state.get("provider")?.globalValue).toBe("inception")
    expect(state.get("model")?.globalValue).toBe("mercury-edit-2")
    expect(flag.get("kilo.autocomplete.defaultClearMigrationV1")).toBe(true)
  })

  it("leaves a partial match untouched", async () => {
    setGlobal(state, "provider", DEFAULT_AUTOCOMPLETE_MODEL.providerID)
    setGlobal(state, "model", "inception/mercury-edit-2")
    const { context } = makeContext()

    await migrateDefaultAutocompleteSettings(context)

    expect(state.get("provider")?.globalValue).toBe(DEFAULT_AUTOCOMPLETE_MODEL.providerID)
    expect(state.get("model")?.globalValue).toBe("inception/mercury-edit-2")
  })

  it("ignores workspace-scoped pins so they aren't mistaken for global defaults", async () => {
    setWorkspace(state, "provider", DEFAULT_AUTOCOMPLETE_MODEL.providerID)
    setWorkspace(state, "model", DEFAULT_AUTOCOMPLETE_MODEL.modelID)
    const { context } = makeContext()

    await migrateDefaultAutocompleteSettings(context)

    // Workspace value is intact — we only clear at global scope.
    expect(state.get("provider")?.workspaceValue).toBe(DEFAULT_AUTOCOMPLETE_MODEL.providerID)
    expect(state.get("model")?.workspaceValue).toBe(DEFAULT_AUTOCOMPLETE_MODEL.modelID)
  })

  it("only runs once per machine", async () => {
    setGlobal(state, "provider", DEFAULT_AUTOCOMPLETE_MODEL.providerID)
    setGlobal(state, "model", DEFAULT_AUTOCOMPLETE_MODEL.modelID)
    const { context } = makeContext({ "kilo.autocomplete.defaultClearMigrationV1": true })

    await migrateDefaultAutocompleteSettings(context)

    // Setting was preserved — second run is a no-op.
    expect(state.get("provider")?.globalValue).toBe(DEFAULT_AUTOCOMPLETE_MODEL.providerID)
    expect(state.get("model")?.globalValue).toBe(DEFAULT_AUTOCOMPLETE_MODEL.modelID)
  })

  it("sets the flag even when nothing needed clearing", async () => {
    const { context, flag } = makeContext()

    await migrateDefaultAutocompleteSettings(context)

    expect(flag.get("kilo.autocomplete.defaultClearMigrationV1")).toBe(true)
  })
})
