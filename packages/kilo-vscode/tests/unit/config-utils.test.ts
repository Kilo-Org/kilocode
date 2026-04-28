import { describe, it, expect } from "bun:test"
import { deepMerge, stripNulls, ConfigState } from "../../webview-ui/src/utils/config-utils"
import type { Config } from "../../webview-ui/src/types/messages"

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("deepMerge", () => {
  it("overrides scalar values", () => {
    const target: Config = { snapshot: true }
    const source: Partial<Config> = { snapshot: false }
    expect(deepMerge(target, source)).toEqual({ snapshot: false })
  })

  it("merges nested objects recursively", () => {
    const target: Config = { agent: { code: { temperature: 0.5 } } }
    const source: Partial<Config> = { agent: { code: { steps: 10 } } }
    const result = deepMerge(target, source)
    expect(result.agent?.code?.temperature).toBe(0.5)
    expect(result.agent?.code?.steps).toBe(10)
  })

  it("preserves keys not present in source", () => {
    const target: Config = { snapshot: true, username: "alice" }
    const source: Partial<Config> = { snapshot: false }
    expect(deepMerge(target, source)).toEqual({ snapshot: false, username: "alice" })
  })

  it("replaces arrays instead of merging them", () => {
    const target: Config = { instructions: ["a", "b"] }
    const source: Partial<Config> = { instructions: ["c"] }
    expect(deepMerge(target, source)).toEqual({ instructions: ["c"] })
  })
})

describe("stripNulls", () => {
  it("removes null values", () => {
    const cfg = { snapshot: true, username: null } as unknown as Config
    expect(stripNulls(cfg)).toEqual({ snapshot: true })
  })

  it("removes undefined values", () => {
    const cfg = { snapshot: true, username: undefined } as unknown as Config
    expect(stripNulls(cfg)).toEqual({ snapshot: true })
  })

  it("strips nulls recursively in nested objects", () => {
    const cfg = { agent: { code: { temperature: 0.5, prompt: null } } } as unknown as Config
    expect(stripNulls(cfg)).toEqual({ agent: { code: { temperature: 0.5 } } })
  })
})

// ---------------------------------------------------------------------------
// Config state machine — reproduces the actual message-handler flow
// ---------------------------------------------------------------------------

describe("ConfigState", () => {
  it("configLoaded sets config when no draft is pending", () => {
    const s = new ConfigState()
    s.handleConfigLoaded({ snapshot: true, username: "alice" })
    expect(s.config).toEqual({ snapshot: true, username: "alice" })
    expect(s.loading).toBe(false)
  })

  describe("configLoaded while draft is pending (the reported bug)", () => {
    it("preserves the user's pending toggle change", () => {
      const s = new ConfigState()

      // 1. Server sends initial config
      s.handleConfigLoaded({ snapshot: true, username: "alice" })
      expect(s.config.snapshot).toBe(true)

      // 2. User toggles snapshot off (but hasn't saved yet)
      s.updateConfig({ snapshot: false })
      expect(s.config.snapshot).toBe(false)
      expect(s.dirty).toBe(true)

      // 3. A configLoaded push arrives from the extension (e.g. SSE event,
      //    tab switch, or another webview triggers a config reload).
      //    The server still has snapshot: true.
      s.handleConfigLoaded({ snapshot: true, username: "alice" })

      // BUG (old code): config.snapshot would be reset to true here
      // FIX: the draft is re-applied, so the user's toggle stays false
      expect(s.config.snapshot).toBe(false)
      expect(s.config.username).toBe("alice")
      expect(s.dirty).toBe(true)
    })

    it("preserves nested draft changes across configLoaded pushes", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ agent: { code: { temperature: 0.7 } } })
      s.updateConfig({ agent: { code: { steps: 5 } } })

      // Server pushes a reload — temperature may have changed server-side
      s.handleConfigLoaded({ agent: { code: { temperature: 0.9 } } })

      expect(s.config.agent?.code?.steps).toBe(5)
      expect(s.config.agent?.code?.temperature).toBe(0.9)
    })
  })

  describe("configUpdated while draft is pending", () => {
    it("preserves draft when update comes from another source", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ snapshot: true, username: "alice" })
      s.updateConfig({ snapshot: false })

      // Another webview (e.g. PermissionDock) saves a different setting
      s.handleConfigUpdated({ snapshot: true, username: "bob" })

      expect(s.config.snapshot).toBe(false) // draft preserved
      expect(s.config.username).toBe("bob") // server update applied
    })

    it("clears draft when update confirms our save", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ snapshot: true })
      s.updateConfig({ snapshot: false })
      s.saveConfig()
      expect(s.saving).toBe(true)

      // Server confirms the write
      s.handleConfigUpdated({ snapshot: false })

      expect(s.config.snapshot).toBe(false)
      expect(s.dirty).toBe(false)
      expect(s.saving).toBe(false)
      expect(Object.keys(s.draft).length).toBe(0)
    })
  })

  it("configLoaded is ignored while save is in-flight", () => {
    const s = new ConfigState()
    s.handleConfigLoaded({ snapshot: true })
    s.updateConfig({ snapshot: false })
    s.saveConfig()

    // A stale configLoaded arrives during the write round-trip
    s.handleConfigLoaded({ snapshot: true })

    // Config must not revert — the save is still in flight
    expect(s.config.snapshot).toBe(false)
  })

  it("discardConfig restores server state", () => {
    const s = new ConfigState()
    s.handleConfigLoaded({ snapshot: true, username: "alice" })
    s.updateConfig({ snapshot: false })
    expect(s.dirty).toBe(true)

    s.discardConfig()

    expect(s.config.snapshot).toBe(true)
    expect(s.dirty).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Issue #9527: clearing an agent model override must unset it, not repopulate
  // -------------------------------------------------------------------------
  describe("clearing an agent model override (issue #9527)", () => {
    it("keeps null in the draft so the backend receives a delete sentinel", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ agent: { explore: { model: "anthropic/claude-sonnet-4-20250514" } } })

      // User clears the Model Override field. ModeEditView now sends `null`
      // instead of `undefined` (the fix). null is the delete sentinel that
      // patchJsonc maps to jsonc-parser's remove operation.
      s.updateConfig({ agent: { explore: { model: null } } })

      // Optimistic UI: stripNulls removes the key so the field renders empty.
      expect(s.config.agent?.explore?.model).toBeUndefined()
      expect(s.dirty).toBe(true)

      // Draft must retain the null so it survives JSON.stringify on the wire
      // and reaches patchJsonc as an explicit delete.
      expect(s.draft.agent?.explore?.model).toBeNull()
      expect(JSON.parse(JSON.stringify(s.draft))).toEqual({
        agent: { explore: { model: null } },
      })
    })

    it("undefined (the old buggy behavior) is dropped by JSON.stringify", () => {
      // Reproduction of the pre-fix bug: sending `undefined` results in an
      // empty patch on the wire, so the backend never deletes the override
      // and the next configUpdated pushes the stale model back into the UI.
      const draft = { agent: { explore: { model: undefined } } }
      expect(JSON.parse(JSON.stringify(draft))).toEqual({ agent: { explore: {} } })
    })

    it("confirms the save and drops the draft once the backend acks", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ agent: { explore: { model: "anthropic/claude-sonnet-4-20250514" } } })
      s.updateConfig({ agent: { explore: { model: null } } })
      s.saveConfig()

      // Backend removed the override and pushes the stripped config back.
      s.handleConfigUpdated({ agent: { explore: {} } })

      expect(s.config.agent?.explore?.model).toBeUndefined()
      expect(s.dirty).toBe(false)
      expect(s.saving).toBe(false)
      expect(Object.keys(s.draft).length).toBe(0)
    })
  })
})
