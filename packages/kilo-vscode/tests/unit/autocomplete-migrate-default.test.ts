import { describe, it, expect, afterEach, beforeEach } from "bun:test"
import * as vscode from "vscode"
import { migrateDefaultAutocompleteSettings } from "../../src/services/autocomplete/migrate-default"
import { DEFAULT_AUTOCOMPLETE_MODEL } from "../../src/shared/autocomplete-models"

type Stub = {
  getConfiguration: (section?: string) => {
    get: (key: string, fallback?: unknown) => unknown
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

function stubConfig(state: Map<string, unknown>) {
  ;(vscode.workspace as unknown as Stub).getConfiguration = (section?: string) => {
    if (section !== "kilo-code.new.autocomplete") {
      return { get: () => undefined, update: async () => {} }
    }
    return {
      get: (key: string, fallback?: unknown) => state.get(key) ?? fallback,
      update: async (key: string, value: unknown) => {
        if (value === undefined) state.delete(key)
        else state.set(key, value)
      },
    }
  }
}

afterEach(() => {
  ;(vscode.workspace as unknown as Stub).getConfiguration = original as Stub["getConfiguration"]
})

describe("migrateDefaultAutocompleteSettings", () => {
  let state: Map<string, unknown>

  beforeEach(() => {
    state = new Map()
    stubConfig(state)
  })

  it("clears provider/model when both equal the current default", async () => {
    state.set("provider", DEFAULT_AUTOCOMPLETE_MODEL.providerID)
    state.set("model", DEFAULT_AUTOCOMPLETE_MODEL.modelID)
    const { context, flag } = makeContext()

    await migrateDefaultAutocompleteSettings(context)

    expect(state.has("provider")).toBe(false)
    expect(state.has("model")).toBe(false)
    expect(flag.get("kilo.autocomplete.defaultClearMigrationV1")).toBe(true)
  })

  it("leaves an explicitly chosen non-default model untouched", async () => {
    state.set("provider", "inception")
    state.set("model", "mercury-edit-2")
    const { context, flag } = makeContext()

    await migrateDefaultAutocompleteSettings(context)

    expect(state.get("provider")).toBe("inception")
    expect(state.get("model")).toBe("mercury-edit-2")
    expect(flag.get("kilo.autocomplete.defaultClearMigrationV1")).toBe(true)
  })

  it("leaves a partial match untouched", async () => {
    state.set("provider", DEFAULT_AUTOCOMPLETE_MODEL.providerID)
    state.set("model", "inception/mercury-edit-2")
    const { context } = makeContext()

    await migrateDefaultAutocompleteSettings(context)

    expect(state.get("provider")).toBe(DEFAULT_AUTOCOMPLETE_MODEL.providerID)
    expect(state.get("model")).toBe("inception/mercury-edit-2")
  })

  it("only runs once per machine", async () => {
    state.set("provider", DEFAULT_AUTOCOMPLETE_MODEL.providerID)
    state.set("model", DEFAULT_AUTOCOMPLETE_MODEL.modelID)
    const { context } = makeContext({ "kilo.autocomplete.defaultClearMigrationV1": true })

    await migrateDefaultAutocompleteSettings(context)

    // Setting was preserved — second run is a no-op.
    expect(state.get("provider")).toBe(DEFAULT_AUTOCOMPLETE_MODEL.providerID)
    expect(state.get("model")).toBe(DEFAULT_AUTOCOMPLETE_MODEL.modelID)
  })

  it("sets the flag even when nothing needed clearing", async () => {
    const { context, flag } = makeContext()

    await migrateDefaultAutocompleteSettings(context)

    expect(flag.get("kilo.autocomplete.defaultClearMigrationV1")).toBe(true)
  })
})
