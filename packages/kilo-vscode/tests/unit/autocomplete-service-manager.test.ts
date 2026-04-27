import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as vscode from "vscode"

// Keep the shared vscode preload in place; just instrument the bits we observe.
const registerInlineCompletionItemProvider = spyOn(
  vscode.languages,
  "registerInlineCompletionItemProvider",
).mockImplementation(() => ({ dispose: mock() }))

let activeTextEditor: unknown = null
Object.defineProperty(vscode.window, "activeTextEditor", {
  configurable: true,
  get: () => activeTextEditor,
})

mock.module("../../src/services/autocomplete/AutocompleteModel", () => ({
  AutocompleteModel: class {
    profileName = "test-profile"
    setModel() {}
    getModelName() {
      return "test-model"
    }
    getProviderDisplayName() {
      return "test-provider"
    }
    hasValidCredentials() {
      return true
    }
  },
}))

mock.module("../../src/services/autocomplete/AutocompleteStatusBar", () => ({
  AutocompleteStatusBar: class {
    update = mock()
    dispose = mock()
  },
}))

mock.module("../../src/services/autocomplete/AutocompleteCodeActionProvider", () => ({
  AutocompleteCodeActionProvider: class {},
}))

mock.module("../../src/services/autocomplete/classic-auto-complete/AutocompleteInlineCompletionProvider", () => ({
  AutocompleteInlineCompletionProvider: class {
    provideInlineCompletionItems_Internal = mock()
    resetBackoff = mock()
    dispose = mock()
  },
}))

mock.module("../../src/services/autocomplete/classic-auto-complete/AutocompleteTelemetry", () => ({
  AutocompleteTelemetry: class {},
}))

mock.module("../../src/services/telemetry", () => ({
  TelemetryProxy: { capture: mock() },
  TelemetryEventName: { INLINE_ASSIST_AUTO_TASK: "inline_assist_auto_task", GHOST_SERVICE_DISABLED: "disabled" },
}))

const { AutocompleteServiceManager } = await import("../../src/services/autocomplete/AutocompleteServiceManager")

function createManager() {
  const context = { subscriptions: [] } as unknown as import("vscode").ExtensionContext
  const connection = {
    onStateChange: mock(() => () => {}),
    onEventFiltered: mock(() => () => {}),
  }
  return new AutocompleteServiceManager(context, connection as never)
}

describe("AutocompleteServiceManager", () => {
  beforeEach(() => {
    registerInlineCompletionItemProvider.mockClear()
    activeTextEditor = null
    AutocompleteServiceManager._resetInstance()
  })

  afterEach(() => {
    activeTextEditor = null
  })

  describe("codeSuggestion()", () => {
    it("calls the provider and inserts the first completion into the editor", async () => {
      const manager = createManager()

      const document = { uri: vscode.Uri.parse("file:///test.ts") }
      const position = new vscode.Position(0, 0)
      const inserted: { position?: unknown; text?: string } = {}

      activeTextEditor = {
        document,
        selection: { active: position },
        edit: mock(async (cb: (builder: unknown) => void) => {
          cb({
            insert: (pos: unknown, text: string) => {
              inserted.position = pos
              inserted.text = text
            },
          })
          return true
        }),
      }

      const provider = manager.inlineCompletionProvider as unknown as {
        provideInlineCompletionItems_Internal: ReturnType<typeof mock>
      }
      provider.provideInlineCompletionItems_Internal.mockResolvedValueOnce([
        { insertText: "// suggestion", range: new vscode.Range(position, position) },
      ])

      await manager.codeSuggestion()

      expect(provider.provideInlineCompletionItems_Internal).toHaveBeenCalledWith(
        document,
        position,
        expect.objectContaining({ triggerKind: vscode.InlineCompletionTriggerKind.Invoke }),
        expect.any(Object),
      )

      expect(inserted.position).toBe(position)
      expect(inserted.text).toBe("// suggestion")
    })

    it("does nothing when there is no active editor", async () => {
      const manager = createManager()

      activeTextEditor = null

      await manager.codeSuggestion()

      const provider = manager.inlineCompletionProvider as unknown as {
        provideInlineCompletionItems_Internal: ReturnType<typeof mock>
      }
      expect(provider.provideInlineCompletionItems_Internal).not.toHaveBeenCalled()
    })
  })

  describe("ensureInlineCompletionProviderRegistration()", () => {
    it("registers the provider when enableAutoTrigger is true and not snoozed", async () => {
      const manager = createManager()

      const disposable = { dispose: mock() }
      registerInlineCompletionItemProvider.mockReturnValue(disposable)
      ;(manager as unknown as { settings: unknown }).settings = {
        enableAutoTrigger: true,
        enableSmartInlineTaskKeybinding: true,
      }

      await (
        manager as unknown as { ensureInlineCompletionProviderRegistration(): Promise<void> }
      ).ensureInlineCompletionProviderRegistration()

      expect(registerInlineCompletionItemProvider).toHaveBeenCalledWith(
        { scheme: "file" },
        manager.inlineCompletionProvider,
      )
      expect(
        (manager as unknown as { inlineCompletionProviderDisposable: unknown }).inlineCompletionProviderDisposable,
      ).toBe(disposable)
    })

    it("does not register the provider when snoozed", async () => {
      const manager = createManager()

      registerInlineCompletionItemProvider.mockClear()
      ;(manager as unknown as { settings: unknown }).settings = {
        enableAutoTrigger: true,
        snoozeUntil: Date.now() + 60_000,
        enableSmartInlineTaskKeybinding: true,
      }

      await (
        manager as unknown as { ensureInlineCompletionProviderRegistration(): Promise<void> }
      ).ensureInlineCompletionProviderRegistration()

      expect(registerInlineCompletionItemProvider).not.toHaveBeenCalled()
      expect(
        (manager as unknown as { inlineCompletionProviderDisposable: unknown }).inlineCompletionProviderDisposable,
      ).toBeNull()
    })

    it("disposes an existing registration before applying the new registration decision", async () => {
      const manager = createManager()

      const existing = { dispose: mock() }
      ;(manager as unknown as { inlineCompletionProviderDisposable: unknown }).inlineCompletionProviderDisposable =
        existing
      ;(manager as unknown as { settings: unknown }).settings = {
        enableAutoTrigger: false,
        enableSmartInlineTaskKeybinding: true,
      }

      await (
        manager as unknown as { ensureInlineCompletionProviderRegistration(): Promise<void> }
      ).ensureInlineCompletionProviderRegistration()

      expect(existing.dispose).toHaveBeenCalledTimes(1)
      expect(
        (manager as unknown as { inlineCompletionProviderDisposable: unknown }).inlineCompletionProviderDisposable,
      ).toBeNull()
    })
  })

  describe("snooze state helpers", () => {
    it("isSnoozed() returns false when snoozeUntil is not set", () => {
      const manager = createManager()
      ;(manager as unknown as { settings: unknown }).settings = { enableAutoTrigger: true }

      expect(manager.isSnoozed()).toBe(false)
    })

    it("isSnoozed() returns false when snoozeUntil is in the past", () => {
      const manager = createManager()
      ;(manager as unknown as { settings: unknown }).settings = { snoozeUntil: Date.now() - 1000 }

      expect(manager.isSnoozed()).toBe(false)
    })

    it("isSnoozed() returns true when snoozeUntil is in the future", () => {
      const manager = createManager()
      ;(manager as unknown as { settings: unknown }).settings = { snoozeUntil: Date.now() + 60_000 }

      expect(manager.isSnoozed()).toBe(true)
    })

    it("getSnoozeRemainingSeconds() returns 0 when not snoozed", () => {
      const manager = createManager()
      ;(manager as unknown as { settings: unknown }).settings = {}

      expect(manager.getSnoozeRemainingSeconds()).toBe(0)
    })

    it("getSnoozeRemainingSeconds() returns a positive number when snoozed", () => {
      const manager = createManager()
      ;(manager as unknown as { settings: unknown }).settings = { snoozeUntil: Date.now() + 30_000 }

      const remaining = manager.getSnoozeRemainingSeconds()
      expect(remaining).toBeGreaterThan(0)
      expect(remaining).toBeLessThanOrEqual(30)
    })
  })
})
