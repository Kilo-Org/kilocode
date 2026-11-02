import crypto from "crypto"
import * as vscode from "vscode"
import { t } from "../i18n"
import { AutocompleteStatusBar } from "./AutocompleteStatusBar"
import { AutocompleteCodeActionProvider } from "./AutocompleteCodeActionProvider"
import { AutocompleteInlineCompletionProvider } from "./classic-auto-complete/AutocompleteInlineCompletionProvider"
import {
  AutocompleteTelemetry,
  AutocompleteTelemetryEvent,
  captureAutocompleteTelemetry,
} from "./classic-auto-complete/AutocompleteTelemetry"
import type { Connection } from "./connection"
import { hasValidCredentials, fimModel as notebookModel } from "./fim"
import { AUTOCOMPLETE_SECTION, readAutocompleteSettings } from "./settings"
import { DEFAULT_AUTOCOMPLETE_MODEL, getAutocompleteModel } from "../../shared/autocomplete-models"

export function selector(kind: "classic" | "next-edit"): vscode.DocumentSelector {
  return kind === "classic" ? [{ scheme: "file" }, { scheme: "vscode-notebook-cell" }] : [{ scheme: "file" }]
}

export { notebookModel }

export interface AutocompleteServiceSettings {
  enableAutoTrigger?: boolean
  enableSmartInlineTaskKeybinding?: boolean
  enableChatAutocomplete?: boolean
  provider?: string
  model?: string
}

function readSettings(): AutocompleteServiceSettings {
  const stored = readAutocompleteSettings()
  const info = getAutocompleteModel(stored.provider ?? undefined, stored.model ?? undefined)
  return {
    enableAutoTrigger: stored.enableAutoTrigger,
    enableSmartInlineTaskKeybinding: stored.enableSmartInlineTaskKeybinding,
    enableChatAutocomplete: stored.enableChatAutocomplete,
    provider: info.providerID,
    model: info.modelID,
  }
}

async function writeSettings(patch: Partial<AutocompleteServiceSettings>): Promise<void> {
  const config = vscode.workspace.getConfiguration(AUTOCOMPLETE_SECTION)
  for (const [key, value] of Object.entries(patch)) {
    await config.update(key, value, vscode.ConfigurationTarget.Global)
  }
}

export class AutocompleteServiceManager {
  private static _instance: AutocompleteServiceManager | null = null

  private readonly connection: Connection
  private readonly context: vscode.ExtensionContext
  private settings: AutocompleteServiceSettings | null = null

  private taskId: string | null = null

  private statusBar: AutocompleteStatusBar | null = null
  private sessionCost: number = 0
  private completionCount: number = 0
  private sessionStartTime: number = Date.now()

  public readonly codeActionProvider: AutocompleteCodeActionProvider
  public readonly inlineCompletionProvider: AutocompleteInlineCompletionProvider
  private inlineCompletionProviderDisposable: vscode.Disposable | null = null
  private inlineCompletionProviderKind: "classic" | "next-edit" | null = null
  private unsubscribeState: (() => void) | null = null
  /** The last time autocomplete asked for the server, so a stop does not trigger a start loop. */
  private lastBackendAttempt = 0
  private unsubscribeAuth: (() => void) | null = null
  private readonly config: vscode.Disposable

  constructor(context: vscode.ExtensionContext, connection: Connection) {
    if (AutocompleteServiceManager._instance) {
      throw new Error(
        "AutocompleteServiceManager is a singleton. Use AutocompleteServiceManager.getInstance() instead.",
      )
    }

    this.context = context
    this.connection = connection
    AutocompleteServiceManager._instance = this

    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ""

    this.codeActionProvider = new AutocompleteCodeActionProvider()
    this.inlineCompletionProvider = new AutocompleteInlineCompletionProvider(
      this.context,
      DEFAULT_AUTOCOMPLETE_MODEL.id,
      connection,
      this.updateCostTracking.bind(this),
      () => this.settings,
      workspacePath,
      new AutocompleteTelemetry(),
      (status) => this.handleFatalAutocompleteError(status),
    )

    // A server start or stop changes whether requests can run. A new server may also carry a new login, so give
    // autocomplete a fresh chance after a failure.
    this.unsubscribeState = connection.onStateChange(() => {
      this.inlineCompletionProvider.resetBackoff()
      void this.load()
    })

    // A login, logout, provider key or team change can lift an authentication or credit failure.
    this.unsubscribeAuth = connection.onAuthChange(() => this.inlineCompletionProvider.resetBackoff())

    this.config = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("kilo-code.v2.language")) {
        this.updateStatusBar()
      }
    })

    void this.load()
  }

  public static getInstance(): AutocompleteServiceManager | null {
    return AutocompleteServiceManager._instance
  }

  public async load() {
    const previous = this.settings
    this.settings = readSettings()
    // Another provider or model uses other credentials, so an earlier authentication or credit failure no longer
    // applies.
    if (previous && (previous.provider !== this.settings.provider || previous.model !== this.settings.model)) {
      this.inlineCompletionProvider.resetBackoff()
    }

    this.inlineCompletionProvider.setModel(notebookModel(this.settings.provider, this.settings.model).id)

    if (this.settings?.enableAutoTrigger && !this.connection.connected()) this.restartBackend()

    await this.updateGlobalContext()
    this.updateStatusBar()
    await this.ensureInlineCompletionProviderRegistration()
  }

  /** Ask for the server again after it stopped, at most once every five seconds so a crash cannot loop. */
  private restartBackend() {
    if (Date.now() - this.lastBackendAttempt < 5_000) return
    this.lastBackendAttempt = Date.now()
    this.connection.start()
  }

  /**
   * Keep the inline completion provider registration in line with the settings. It only disposes and registers
   * again when the desired state changes, because churn during startup can break VS Code's provider tracking.
   */
  private async ensureInlineCompletionProviderRegistration() {
    const shouldBeRegistered = this.settings?.enableAutoTrigger ?? false
    const isRegistered = this.inlineCompletionProviderDisposable !== null
    if (shouldBeRegistered === isRegistered) return

    if (!shouldBeRegistered) {
      this.inlineCompletionProviderDisposable?.dispose()
      this.inlineCompletionProviderDisposable = null
      this.inlineCompletionProviderKind = null
      return
    }

    this.inlineCompletionProviderDisposable = vscode.languages.registerInlineCompletionItemProvider(
      selector("classic"),
      this.inlineCompletionProvider,
    )
    this.inlineCompletionProviderKind = "classic"
  }

  /** Which provider is currently registered (`null` if none). */
  public get currentMode(): "classic" | "next-edit" | null {
    return this.inlineCompletionProviderKind
  }

  public async disable() {
    await writeSettings({
      enableAutoTrigger: false,
      enableSmartInlineTaskKeybinding: false,
    })

    captureAutocompleteTelemetry(AutocompleteTelemetryEvent.GHOST_SERVICE_DISABLED)

    await this.load()
  }

  public async codeSuggestion() {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      return
    }

    this.taskId = crypto.randomUUID()
    captureAutocompleteTelemetry(AutocompleteTelemetryEvent.INLINE_ASSIST_AUTO_TASK, {
      taskId: this.taskId,
    })

    const document = editor.document

    // Call the inline completion provider directly with a manual trigger context.
    const position = editor.selection.active
    const context: vscode.InlineCompletionContext = {
      triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
      selectedCompletionInfo: undefined,
    }
    const tokenSource = new vscode.CancellationTokenSource()

    const completions = await this.inlineCompletionProvider.provideInlineCompletionItems_Internal(
      document,
      position,
      context,
      tokenSource.token,
    )
    tokenSource.dispose()

    // Insert the first completion directly.
    const items = Array.isArray(completions) ? completions : completions.items
    const insertText = items[0]?.insertText
    if (!insertText) return
    await editor.edit((editBuilder) => {
      editBuilder.insert(position, typeof insertText === "string" ? insertText : insertText.value)
    })
  }

  private async updateGlobalContext() {
    await vscode.commands.executeCommand(
      "setContext",
      "kilo-code.v2.autocomplete.enableSmartInlineTaskKeybinding",
      this.settings?.enableSmartInlineTaskKeybinding || false,
    )
  }

  private initializeStatusBar() {
    this.statusBar = new AutocompleteStatusBar({
      enabled: false,
      model: "loading...",
      provider: "loading...",
      totalSessionCost: 0,
      completionCount: 0,
      sessionStartTime: this.sessionStartTime,
    })
  }

  private getCurrentModelName(): string {
    return getAutocompleteModel(this.settings?.provider, this.settings?.model).label
  }

  private getCurrentProviderName(): string {
    return getAutocompleteModel(this.settings?.provider, this.settings?.model).provider
  }

  private hasNoUsableProvider(): boolean {
    return !hasValidCredentials(this.connection)
  }

  /**
   * Handle a fatal (non-retriable) autocomplete error such as 402 Payment Required.
   * Shows a one-time notification so the user knows autocomplete is paused.
   */
  private handleFatalAutocompleteError(status: number | null): void {
    const msg =
      status === 402
        ? t("kilocode:autocomplete.creditsExhausted.message")
        : t("kilocode:autocomplete.authError.message")

    if (status !== 402) {
      void vscode.window.showWarningMessage(msg)
      return
    }
    const addCredits = t("kilocode:autocomplete.creditsExhausted.addCredits")
    void vscode.window.showWarningMessage(msg, addCredits).then((choice) => {
      if (choice === addCredits) void vscode.env.openExternal(vscode.Uri.parse("https://app.kilo.ai/credits"))
    })
  }

  private updateCostTracking(cost: number, _inputTokens: number, _outputTokens: number): void {
    this.completionCount++
    this.sessionCost += cost
    this.updateStatusBar()
  }

  private updateStatusBar() {
    if (!this.statusBar) {
      this.initializeStatusBar()
    }

    this.statusBar?.update({
      enabled: this.settings?.enableAutoTrigger,
      model: this.getCurrentModelName(),
      provider: this.getCurrentProviderName(),
      hasNoUsableProvider: this.hasNoUsableProvider(),
      totalSessionCost: this.sessionCost,
      completionCount: this.completionCount,
      sessionStartTime: this.sessionStartTime,
    })
  }

  public async showIncompatibilityExtensionPopup() {
    const message = t("kilocode:autocomplete.incompatibilityExtensionPopup.message")
    const disableCopilot = t("kilocode:autocomplete.incompatibilityExtensionPopup.disableCopilot")
    const disableInlineAssist = t("kilocode:autocomplete.incompatibilityExtensionPopup.disableInlineAssist")
    const response = await vscode.window.showErrorMessage(message, disableCopilot, disableInlineAssist)

    if (response === disableCopilot) {
      await vscode.commands.executeCommand("github.copilot.completions.disable")
    } else if (response === disableInlineAssist) {
      await vscode.commands.executeCommand("kilo-code.v2.autocomplete.disable")
    }
  }

  public dispose(): void {
    this.statusBar?.dispose()

    this.unsubscribeState?.()
    this.unsubscribeState = null
    this.unsubscribeAuth?.()
    this.unsubscribeAuth = null
    this.config.dispose()

    if (this.inlineCompletionProviderDisposable) {
      this.inlineCompletionProviderDisposable.dispose()
      this.inlineCompletionProviderDisposable = null
      this.inlineCompletionProviderKind = null
    }

    this.inlineCompletionProvider.dispose()

    AutocompleteServiceManager._instance = null
  }

  /**
   * Reset the singleton instance (for testing purposes only)
   * @internal
   */
  public static _resetInstance(): void {
    AutocompleteServiceManager._instance = null
  }
}
