import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import * as vscode from "vscode"
import { AutocompleteServiceManager } from "../AutocompleteServiceManager"
import { AUTOCOMPLETE_SECTION } from "../settings"
import { t } from "../../i18n"
import type { Connection } from "../connection"
import { DEFAULT_AUTOCOMPLETE_MODEL } from "../../../shared/autocomplete-models"

type Stub = {
  getConfiguration: (section?: string) => {
    get: <T>(key: string, fallback?: T) => T | undefined
    update: (key: string, value: unknown, target?: unknown) => Promise<void>
  }
}

const state = new Map<string, unknown>()
const updates: Array<[string, unknown]> = []
const registered: Array<{ selector: unknown; provider: unknown }> = []
const disposables: Array<{ dispose: ReturnType<typeof mock> }> = []
const commands: unknown[][] = []

const originals = {
  getConfiguration: vscode.workspace.getConfiguration,
  registerInlineCompletionItemProvider: vscode.languages.registerInlineCompletionItemProvider,
  executeCommand: vscode.commands.executeCommand,
  showErrorMessage: vscode.window.showErrorMessage,
  showWarningMessage: vscode.window.showWarningMessage,
  openExternal: vscode.env.openExternal,
  activeTextEditor: vscode.window.activeTextEditor,
}

function stubConfig() {
  ;(vscode.workspace as unknown as Stub).getConfiguration = (section?: string) => {
    if (section !== AUTOCOMPLETE_SECTION) return { get: <T>(_key: string, fallback?: T) => fallback, update: async () => {} }
    return {
      get: <T>(key: string, fallback?: T) => (state.has(key) ? (state.get(key) as T) : fallback),
      update: async (key: string, value: unknown) => {
        updates.push([key, value])
      },
    }
  }
}

function stubRegistration() {
  ;(vscode.languages as unknown as Record<string, unknown>).registerInlineCompletionItemProvider = (
    selector: unknown,
    provider: unknown,
  ) => {
    const disposable = { dispose: mock() }
    registered.push({ selector, provider })
    disposables.push(disposable)
    return disposable
  }
}

function stubCommands() {
  ;(vscode.commands as unknown as Record<string, unknown>).executeCommand = async (...args: unknown[]) => {
    commands.push(args)
  }
}

const managers: AutocompleteServiceManager[] = []

async function createManager(): Promise<AutocompleteServiceManager> {
  AutocompleteServiceManager._resetInstance()
  const context = { subscriptions: [] } as unknown as vscode.ExtensionContext
  const connection = {
    connected: () => true,
    onStateChange: () => () => {},
    onAuthChange: () => () => {},
  } as unknown as Connection
  const manager = new AutocompleteServiceManager(context, connection)
  managers.push(manager)
  await manager.load()
  return manager
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe("AutocompleteServiceManager (less mocked logic)", () => {
  beforeEach(() => {
    state.clear()
    updates.length = 0
    registered.length = 0
    disposables.length = 0
    commands.length = 0
    // The default keeps the unset auto trigger off so a bare construction does not register a provider.
    state.set("enableAutoTrigger", false)
    stubConfig()
    stubRegistration()
    stubCommands()
  })

  afterEach(() => {
    for (const manager of managers) manager.dispose()
    managers.length = 0
    ;(vscode.workspace as unknown as Stub).getConfiguration = originals.getConfiguration as unknown as Stub["getConfiguration"]
    ;(vscode.languages as unknown as Record<string, unknown>).registerInlineCompletionItemProvider =
      originals.registerInlineCompletionItemProvider
    ;(vscode.commands as unknown as Record<string, unknown>).executeCommand = originals.executeCommand
    ;(vscode.window as unknown as Record<string, unknown>).showErrorMessage = originals.showErrorMessage
    ;(vscode.window as unknown as Record<string, unknown>).showWarningMessage = originals.showWarningMessage
    ;(vscode.env as unknown as Record<string, unknown>).openExternal = originals.openExternal
    ;(vscode.window as unknown as Record<string, unknown>).activeTextEditor = originals.activeTextEditor
  })

  describe("codeSuggestion()", () => {
    it("calls the provider and inserts the first completion into the editor", async () => {
      const manager = await createManager()

      const document = { uri: vscode.Uri.parse("file:///test.ts") }
      const position = new vscode.Position(0, 0)
      const inserted: { position?: unknown; text?: string } = {}

      ;(vscode.window as unknown as Record<string, unknown>).activeTextEditor = {
        document,
        selection: { active: position },
        edit: async (callback: (builder: { insert: (pos: unknown, text: string) => void }) => void) => {
          callback({
            insert: (pos, text) => {
              inserted.position = pos
              inserted.text = text
            },
          })
          return true
        },
      }

      const provider = manager.inlineCompletionProvider as unknown as {
        provideInlineCompletionItems_Internal: ReturnType<typeof mock>
      }
      provider.provideInlineCompletionItems_Internal = mock().mockResolvedValueOnce([
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
      const manager = await createManager()
      ;(vscode.window as unknown as Record<string, unknown>).activeTextEditor = null

      const provider = manager.inlineCompletionProvider as unknown as {
        provideInlineCompletionItems_Internal: ReturnType<typeof mock>
      }
      provider.provideInlineCompletionItems_Internal = mock()

      await manager.codeSuggestion()

      expect(provider.provideInlineCompletionItems_Internal).not.toHaveBeenCalled()
    })
  })

  describe("ensureInlineCompletionProviderRegistration()", () => {
    it("registers the provider when enableAutoTrigger is true", async () => {
      const manager = await createManager()
      ;(manager as unknown as { settings: unknown }).settings = { enableAutoTrigger: true }

      await (manager as unknown as { ensureInlineCompletionProviderRegistration: () => Promise<void> }).ensureInlineCompletionProviderRegistration()

      expect(registered).toHaveLength(1)
      expect(registered[0]?.selector).toEqual([{ scheme: "file" }, { scheme: "vscode-notebook-cell" }])
      expect(registered[0]?.provider).toBe(manager.inlineCompletionProvider)
      expect((manager as unknown as { inlineCompletionProviderDisposable: unknown }).inlineCompletionProviderDisposable).toBe(
        disposables[0],
      )
    })

    it("does not register the provider when enableAutoTrigger is false", async () => {
      const manager = await createManager()
      ;(manager as unknown as { settings: unknown }).settings = { enableAutoTrigger: false }

      await (manager as unknown as { ensureInlineCompletionProviderRegistration: () => Promise<void> }).ensureInlineCompletionProviderRegistration()

      expect(registered).toHaveLength(0)
      expect(
        (manager as unknown as { inlineCompletionProviderDisposable: unknown }).inlineCompletionProviderDisposable,
      ).toBeNull()
    })

    it("disposes an existing registration before applying the new registration decision", async () => {
      const manager = await createManager()

      const existingDisposable = { dispose: mock() }
      ;(manager as unknown as { inlineCompletionProviderDisposable: unknown }).inlineCompletionProviderDisposable =
        existingDisposable
      ;(manager as unknown as { settings: unknown }).settings = { enableAutoTrigger: false }

      await (manager as unknown as { ensureInlineCompletionProviderRegistration: () => Promise<void> }).ensureInlineCompletionProviderRegistration()

      expect(existingDisposable.dispose).toHaveBeenCalledTimes(1)
      expect(
        (manager as unknown as { inlineCompletionProviderDisposable: unknown }).inlineCompletionProviderDisposable,
      ).toBeNull()
    })
  })

  describe("load()", () => {
    it("asks for the server again when it stopped, at most once every five seconds", async () => {
      AutocompleteServiceManager._resetInstance()
      state.set("enableAutoTrigger", true)
      const start = mock()
      const connection = {
        connected: () => false,
        start,
        onStateChange: () => () => {},
        onAuthChange: () => () => {},
      } as unknown as Connection
      const manager = new AutocompleteServiceManager({ subscriptions: [] } as unknown as vscode.ExtensionContext, connection)
      managers.push(manager)
      await manager.load()
      await manager.load()
      expect(start).toHaveBeenCalledTimes(1)
    })

    it("resets the error backoff when the provider or model changes", async () => {
      const manager = await createManager()
      let resets = 0
      manager.inlineCompletionProvider.resetBackoff = () => {
        resets++
      }
      await manager.load()
      expect(resets).toBe(0)

      state.set("provider", "mistral")
      state.set("model", "codestral-2508")
      await manager.load()
      expect(resets).toBe(1)
    })
  })

  describe("updateGlobalContext()", () => {
    it("sets the smart keybinding context key from the settings", async () => {
      state.set("enableAutoTrigger", false)
      state.set("enableSmartInlineTaskKeybinding", true)
      const manager = await createManager()
      commands.length = 0

      await (manager as unknown as { updateGlobalContext: () => Promise<void> }).updateGlobalContext()

      expect(commands).toContainEqual([
        "setContext",
        "kilo-code.v2.autocomplete.enableSmartInlineTaskKeybinding",
        true,
      ])
    })
  })

  describe("disable()", () => {
    it("writes the disabled settings", async () => {
      const manager = await createManager()
      updates.length = 0

      await manager.disable()

      expect(updates).toEqual([
        ["enableAutoTrigger", false],
        ["enableSmartInlineTaskKeybinding", false],
      ])
    })
  })

  describe("status bar", () => {
    it("updates the status bar with the current settings", async () => {
      const manager = await createManager()
      const statusBar = { update: mock(), dispose: mock() }
      ;(manager as unknown as { statusBar: unknown }).statusBar = statusBar

      await manager.load()

      expect(statusBar.update).toHaveBeenCalled()
      const last = statusBar.update.mock.calls.at(-1)?.[0] as {
        enabled: boolean
        model: string
        provider: string
      }
      expect(last.enabled).toBe(false)
      expect(last.model).toBe(DEFAULT_AUTOCOMPLETE_MODEL.label)
      expect(last.provider).toBe(DEFAULT_AUTOCOMPLETE_MODEL.provider)
    })
  })

  describe("showIncompatibilityExtensionPopup()", () => {
    it("disables Copilot when the user picks that action", async () => {
      ;(vscode.window as unknown as Record<string, unknown>).showErrorMessage = async () =>
        t("kilocode:autocomplete.incompatibilityExtensionPopup.disableCopilot")
      const manager = await createManager()
      commands.length = 0

      await manager.showIncompatibilityExtensionPopup()

      expect(commands).toContainEqual(["github.copilot.completions.disable"])
    })

    it("disables autocomplete when the user picks that action", async () => {
      ;(vscode.window as unknown as Record<string, unknown>).showErrorMessage = async () =>
        t("kilocode:autocomplete.incompatibilityExtensionPopup.disableInlineAssist")
      const manager = await createManager()
      commands.length = 0

      await manager.showIncompatibilityExtensionPopup()

      expect(commands).toContainEqual(["kilo-code.v2.autocomplete.disable"])
    })
  })

  describe("handleFatalAutocompleteError()", () => {
    it("offers Add Credits for a 402 and opens the credits page on accept", async () => {
      const warnings: unknown[][] = []
      const openExternal = mock()
      ;(vscode.window as unknown as Record<string, unknown>).showWarningMessage = async (...args: unknown[]) => {
        warnings.push(args)
        return t("kilocode:autocomplete.creditsExhausted.addCredits")
      }
      ;(vscode.env as unknown as Record<string, unknown>).openExternal = openExternal
      const manager = await createManager()

      ;(manager as unknown as { handleFatalAutocompleteError: (status: number | null) => void }).handleFatalAutocompleteError(
        402,
      )
      await tick()

      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toHaveLength(2)
      expect(openExternal).toHaveBeenCalledTimes(1)
    })

    it("shows a plain warning for a non-402 fatal error", async () => {
      const warnings: unknown[][] = []
      const openExternal = mock()
      ;(vscode.window as unknown as Record<string, unknown>).showWarningMessage = async (...args: unknown[]) => {
        warnings.push(args)
        return undefined
      }
      ;(vscode.env as unknown as Record<string, unknown>).openExternal = openExternal
      const manager = await createManager()

      ;(manager as unknown as { handleFatalAutocompleteError: (status: number | null) => void }).handleFatalAutocompleteError(
        401,
      )
      await tick()

      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toHaveLength(1)
      expect(openExternal).not.toHaveBeenCalled()
    })
  })
})
