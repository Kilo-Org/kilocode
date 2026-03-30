import crypto from "crypto"
import * as vscode from "vscode"
import { t } from "./shims/i18n"
import { TelemetryProxy, TelemetryEventName } from "../telemetry"
import { AutocompleteModel } from "./AutocompleteModel"
import { AutocompleteStatusBar } from "./AutocompleteStatusBar"
import { AutocompleteCodeActionProvider } from "./AutocompleteCodeActionProvider"
import { AutocompleteInlineCompletionProvider } from "./classic-auto-complete/AutocompleteInlineCompletionProvider"
import { AutocompleteTelemetry } from "./classic-auto-complete/AutocompleteTelemetry"
import type { KiloConnectionService } from "../cli-backend"

const CONFIG_SECTION = "kilo-code.new.autocomplete"

export interface AutocompleteServiceSettings {
  enableAutoTrigger?: boolean
  enableSmartInlineTaskKeybinding?: boolean
  enableChatAutocomplete?: boolean
  provider?: string
  model?: string
  snoozeUntil?: number
}

function readSettings(): AutocompleteServiceSettings {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION)
  return {
    enableAutoTrigger: config.get<boolean>("enableAutoTrigger") ?? true,
    enableSmartInlineTaskKeybinding: config.get<boolean>("enableSmartInlineTaskKeybinding") ?? true,
    enableChatAutocomplete: config.get<boolean>("enableChatAutocomplete") ?? true,
    snoozeUntil: config.get<number>("snoozeUntil"),
  }
}

async function writeSettings(patch: Partial<AutocompleteServiceSettings>): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION)
  for (const [key, value] of Object.entries(patch)) {
    await config.update(key, value, vscode.ConfigurationTarget.Global)
  }
}

export class AutocompleteServiceManager {
  private static _instance: AutocompleteServiceManager | null = null

  private readonly model: AutocompleteModel
  private readonly context: vscode.ExtensionContext
  private settings: AutocompleteServiceSettings | null = null

  private taskId: string | null = null

  // Status bar integration
  private statusBar: AutocompleteStatusBar | null = null
  private sessionCost: number = 0
  private completionCount: number = 0
  private sessionStartTime: number = Date.now()

  private snoozeTimer: NodeJS.Timeout | null = null

  // VSCode Providers
  public readonly codeActionProvider: AutocompleteCodeActionProvider
  public readonly inlineCompletionProvider: AutocompleteInlineCompletionProvider
  private inlineCompletionProviderDisposable: vscode.Disposable | null = null
  private unsubscribeState: (() => void) | null = null
  private unsubscribeEvent: (() => void) | null = null

  constructor(context: vscode.ExtensionContext, connectionService: KiloConnectionService) {
    if (AutocompleteServiceManager._instance) {
      throw new Error(
        "AutocompleteServiceManager is a singleton. Use AutocompleteServiceManager.getInstance() instead.",
      )
    }

    this.context = context
    AutocompleteServiceManager._instance = this

    // Register Internal Components
    this.model = new AutocompleteModel(connectionService)

    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ""

    // Register the providers
    this.codeActionProvider = new AutocompleteCodeActionProvider()
    this.inlineCompletionProvider = new AutocompleteInlineCompletionProvider(
      this.context,
      this.model,
      this.updateCostTracking.bind(this),
      () => this.settings,
      workspacePath,
      new AutocompleteTelemetry(),
      (status) => this.handleFatalAutocompleteError(status),
    )

    // Reload when CLI backend connection state changes so autocomplete
    // picks up the connected state even if it wasn't ready at startup.
    // Also reset error backoff — a reconnect may mean the user re-authenticated
    // or added credits, so we should give autocomplete a fresh chance.
    this.unsubscribeState = connectionService.onStateChange(() => {
      this.inlineCompletionProvider.resetBackoff()
      void this.load()
    })

    // Reset error backoff when auth state changes (login, logout, org switch).
    // The CLI emits global.disposed after these actions, which is the most
    // reliable signal that credentials may have changed.
    this.unsubscribeEvent = connectionService.onEventFiltered(
      (event) => event.type === "global.disposed",
      () => this.inlineCompletionProvider.resetBackoff(),
    )

    void this.load()
  }

  /**
   * Get the singleton instance of AutocompleteServiceManager
   */
  public static getInstance(): AutocompleteServiceManager | null {
    return AutocompleteServiceManager._instance
  }

  public async load() {
    this.settings = readSettings()

    await this.updateGlobalContext()
    this.updateStatusBar()
    await this.ensureInlineCompletionProviderRegistration()
    this.setupSnoozeTimerIfNeeded()
  }

  /**
   * Ensure the inline completion provider registration matches the current settings.
   * Only disposes/re-registers when the desired state actually changes, avoiding
   * unnecessary churn that can break VS Code's provider tracking during startup races.
   */
  private async ensureInlineCompletionProviderRegistration() {
    const shouldBeRegistered = (this.settings?.enableAutoTrigger ?? false) && !this.isSnoozed()
    const isRegistered = this.inlineCompletionProviderDisposable !== null

    // Already in the correct state — nothing to do
    if (shouldBeRegistered === isRegistered) {
      return
    }

    if (!shouldBeRegistered) {
      this.inlineCompletionProviderDisposable!.dispose()
      this.inlineCompletionProviderDisposable = null
      return
    }

    // Register classic provider (tracked via this.inlineCompletionProviderDisposable,
    // not context.subscriptions, so re-registration on reconnect doesn't leak)
    this.inlineCompletionProviderDisposable = vscode.languages.registerInlineCompletionItemProvider(
      { scheme: "file" },
      this.inlineCompletionProvider,
    )
  }

  public async disable() {
    await writeSettings({
      enableAutoTrigger: false,
      enableSmartInlineTaskKeybinding: false,
    })

    TelemetryProxy.capture(TelemetryEventName.GHOST_SERVICE_DISABLED)

    await this.load()
  }

  /**
   * Check if autocomplete is currently snoozed
   */
  public isSnoozed(): boolean {
    const snoozeUntil = this.settings?.snoozeUntil
    if (!snoozeUntil) {
      return false
    }
    return Date.now() < snoozeUntil
  }

  /**
   * Get remaining snooze time in seconds
   */
  public getSnoozeRemainingSeconds(): number {
    const snoozeUntil = this.settings?.snoozeUntil
    if (!snoozeUntil) {
      return 0
    }
    const remaining = Math.max(0, Math.ceil((snoozeUntil - Date.now()) / 1000))
    return remaining
  }

  /**
   * Snooze autocomplete for a specified number of seconds
   */
  public async snooze(seconds: number): Promise<void> {
    if (this.snoozeTimer) {
      clearTimeout(this.snoozeTimer)
      this.snoozeTimer = null
    }

    const snoozeUntil = Date.now() + seconds * 1000
    await writeSettings({ snoozeUntil })

    this.snoozeTimer = setTimeout(() => {
      void this.unsnooze()
    }, seconds * 1000)

    await this.load()
  }

  /**
   * Cancel snooze and re-enable autocomplete
   */
  public async unsnooze(): Promise<void> {
    if (this.snoozeTimer) {
      clearTimeout(this.snoozeTimer)
      this.snoozeTimer = null
    }

    await writeSettings({ snoozeUntil: undefined })

    await this.load()
  }

  /**
   * Set up a timer to auto-unsnooze if we're currently in a snoozed state.
   */
  private setupSnoozeTimerIfNeeded(): void {
    if (this.snoozeTimer) {
      clearTimeout(this.snoozeTimer)
      this.snoozeTimer = null
    }

    const remainingMs = this.getSnoozeRemainingMs()
    if (remainingMs <= 0) {
      return
    }

    this.snoozeTimer = setTimeout(() => {
      void this.unsnooze()
    }, remainingMs)
  }

  /**
   * Get remaining snooze time in milliseconds
   */
  private getSnoozeRemainingMs(): number {
    const snoozeUntil = this.settings?.snoozeUntil
    if (!snoozeUntil) {
      return 0
    }
    return Math.max(0, snoozeUntil - Date.now())
  }

  public async codeSuggestion() {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      return
    }

    this.taskId = crypto.randomUUID()
    TelemetryProxy.capture(TelemetryEventName.INLINE_ASSIST_AUTO_TASK, {
      taskId: this.taskId,
    })

    const document = editor.document

    // Call the inline completion provider directly with manual trigger context
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

    // If we got completions, directly insert the first one
    if (completions && (Array.isArray(completions) ? completions.length > 0 : completions.items.length > 0)) {
      const items = Array.isArray(completions) ? completions : completions.items
      const firstCompletion = items[0]

      if (firstCompletion?.insertText) {
        const insertText =
          typeof firstCompletion.insertText === "string" ? firstCompletion.insertText : firstCompletion.insertText.value

        await editor.edit((editBuilder) => {
          editBuilder.insert(position, insertText)
        })
      }
    }
  }

  private async updateGlobalContext() {
    await vscode.commands.executeCommand(
      "setContext",
      "kilocode.autocomplete.enableSmartInlineTaskKeybinding",
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
    return this.model.getModelName()
  }

  private getCurrentProviderName(): string {
    return this.model.getProviderDisplayName()
  }

  private hasNoUsableProvider(): boolean {
    return !this.model.hasValidCredentials()
  }

  /**
   * Handle a fatal (non-retriable) autocomplete error such as 402 Payment Required.
   * Shows a one-time notification to the user so they know autocomplete is paused.
   */
  private handleFatalAutocompleteError(status: number | null): void {
    const msg =
      status === 402
        ? t("kilocode:autocomplete.creditsExhausted.message")
        : t("kilocode:autocomplete.authError.message")

    if (status === 402) {
      vscode.window.showWarningMessage(msg, t("kilocode:autocomplete.creditsExhausted.addCredits")).then((choice) => {
        if (choice === t("kilocode:autocomplete.creditsExhausted.addCredits")) {
          vscode.env.openExternal(vscode.Uri.parse("https://app.kilo.ai/credits"))
        }
      })
    } else {
      vscode.window.showWarningMessage(msg)
    }
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
      snoozed: this.isSnoozed(),
      model: this.getCurrentModelName(),
      provider: this.getCurrentProviderName(),
      profileName: this.model.profileName,
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
      await vscode.commands.executeCommand("kilo-code.new.autocomplete.disable")
    }
  }

  /**
   * Dispose of all resources used by the AutocompleteServiceManager
   */
  public dispose(): void {
    this.statusBar?.dispose()

    if (this.snoozeTimer) {
      clearTimeout(this.snoozeTimer)
      this.snoozeTimer = null
    }

    // Unsubscribe from connection state changes and SSE events
    this.unsubscribeState?.()
    this.unsubscribeState = null
    this.unsubscribeEvent?.()
    this.unsubscribeEvent = null

    // Dispose inline completion provider registration
    if (this.inlineCompletionProviderDisposable) {
      this.inlineCompletionProviderDisposable.dispose()
      this.inlineCompletionProviderDisposable = null
    }

    // Dispose inline completion provider resources
    this.inlineCompletionProvider.dispose()

    // Clear singleton instance
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
