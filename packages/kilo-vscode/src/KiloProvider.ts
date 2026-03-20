import * as path from "path"
import * as vscode from "vscode"
import { z } from "zod"
import { buildPreviewPath, getPreviewCommand, getPreviewDir, parseImage, trimEntries } from "./image-preview"
import { isAbsolutePath } from "./path-utils"
import type {
  KiloClient,
  Session,
  SessionStatus,
  Event,
  TextPartInput,
  FilePartInput,
  Config,
} from "@kilocode/sdk/v2/client"
import { type KiloConnectionService, type KilocodeNotification, ServerStartupError } from "./services/cli-backend"
import type { EditorContext, CloudSessionData } from "./services/cli-backend/types"
import { FileIgnoreController } from "./services/autocomplete/shims/FileIgnoreController"
import { handleChatCompletionRequest } from "./services/autocomplete/chat-autocomplete/handleChatCompletionRequest"
import { handleChatCompletionAccepted } from "./services/autocomplete/chat-autocomplete/handleChatCompletionAccepted"
import { buildWebviewHtml } from "./utils"
import { TelemetryProxy, type TelemetryPropertiesProvider } from "./services/telemetry"
// legacy-migration start
import * as MigrationService from "./legacy-migration/migration-service"
// legacy-migration end
import {
  sessionToWebview,
  indexProvidersById,
  filterVisibleAgents,
  buildSettingPath,
  mapSSEEventToWebviewMessage,
  getErrorMessage,
  isEventFromForeignProject,
  mapCloudSessionMessageToWebviewMessage,
  loadSessions as loadSessionsUtil,
  flushPendingSessionRefresh as flushPendingSessionRefreshUtil,
  type SessionRefreshContext,
} from "./kilo-provider-utils"
import { MarketplaceService } from "./services/marketplace"
import { resolveProjectDirectory } from "./project-directory"
import { getBusySessionCount, seedSessionStatuses } from "./session-status"

type KiloProviderOptions = {
  projectDirectory?: string | null
  slimEditMetadata?: boolean
}

export class KiloProvider implements vscode.WebviewViewProvider, TelemetryPropertiesProvider {
  public static readonly viewType = "kilo-code.SidebarProvider"

  private webview: vscode.Webview | null = null
  private currentSession: Session | null = null
  private connectionState: "connecting" | "connected" | "disconnected" | "error" = "connecting"
  private loginAttempt = 0
  private isWebviewReady = false
  private readonly extensionVersion =
    vscode.extensions.getExtension("kilocode.kilo-code")?.packageJSON?.version ?? "unknown"
  /** Cached providersLoaded payload so requestProviders can be served before client is ready */
  private cachedProvidersMessage: unknown = null
  /** Cached agentsLoaded payload so requestAgents can be served before client is ready */
  private cachedAgentsMessage: unknown = null
  /** Cached skillsLoaded payload so requestSkills can be served before client is ready */
  private cachedSkillsMessage: unknown = null
  /** Cached commandsLoaded payload so requestCommands can be served before client is ready */
  private cachedCommandsMessage: unknown = null
  /** Cached configLoaded payload so requestConfig can be served before client is ready */
  private cachedConfigMessage: unknown = null
  /** Ref-count of in-flight handleUpdateConfig calls; prevents fetchAndSendConfig from sending stale data */
  private pending = 0
  /** Cached notificationsLoaded payload */
  private cachedNotificationsMessage: unknown = null
  private pendingReviewComments: unknown[][] = []

  private trackedSessionIds: Set<string> = new Set()
  private syncedChildSessions: Set<string> = new Set()
  /** Tracks the latest status for each session, used to warn before destructive config operations. */
  private sessionStatusMap = new Map<string, SessionStatus["type"]>()
  /** Per-session directory overrides (e.g., worktree paths registered by AgentManagerProvider). */
  private sessionDirectories = new Map<string, string>()
  /** Project ID for the current workspace, used to filter out sessions from other repositories. */
  private projectID: string | undefined
  /** Abort controller for the current loadMessages request; aborted when a new session is selected. */
  private loadMessagesAbort: AbortController | null = null
  /** Set when refreshSessions() is called before the client is ready.
   *  Cleared and retried once the connection transitions to "connected". */
  private pendingSessionRefresh = false
  private unsubscribeEvent: (() => void) | null = null
  private unsubscribeState: (() => void) | null = null
  /** Cached legacy migration data so migrate() doesn't re-read from disk/SecretStorage. */ // legacy-migration
  private cachedLegacyData: import("./legacy-migration/legacy-types").LegacyMigrationData | null = null // legacy-migration
  /** Guard to prevent checkAndShowMigrationWizard running concurrently. */ // legacy-migration
  private migrationCheckInFlight = false // legacy-migration
  private unsubscribeNotificationDismiss: (() => void) | null = null
  private initConnectionPromise: Promise<void> | null = null
  private webviewMessageDisposable: vscode.Disposable | null = null

  /** Lazily initialized ignore controller for .kilocodeignore filtering */
  private ignoreController: FileIgnoreController | null = null
  private ignoreControllerDir: string | null = null
  private marketplace: MarketplaceService | null = null
  private projectDirectory: string | null | undefined
  private slimEditMetadata = true

  /** Optional interceptor called before the standard message handler.
   *  Return null to consume the message, or return a (possibly transformed) message. */
  private onBeforeMessage: ((msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>) | null = null

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: KiloConnectionService,
    private readonly extensionContext?: vscode.ExtensionContext,
    options?: KiloProviderOptions,
  ) {
    this.projectDirectory = options?.projectDirectory
    this.slimEditMetadata = options?.slimEditMetadata ?? true
    TelemetryProxy.getInstance().setProvider(this)
  }

  public setProjectDirectory(directory: string | null): void {
    if (this.projectDirectory === directory) return
    this.projectDirectory = directory
    this.postMessage({ type: "workspaceDirectoryChanged", directory: directory ?? "" })
  }

  getTelemetryProperties(): Record<string, unknown> {
    return {
      appName: "kilo-code",
      appVersion: this.extensionVersion,
      platform: "vscode",
      editorName: vscode.env.appName,
      vscodeVersion: vscode.version,
      machineId: vscode.env.machineId,
      vscodeIsTelemetryEnabled: vscode.env.isTelemetryEnabled,
    }
  }

  /**
   * Convenience getter that returns the shared SDK KiloClient or null if not yet connected.
   * Preserves the existing null-check pattern used throughout handler methods.
   */
  private get client(): KiloClient | null {
    try {
      return this.connectionService.getClient()
    } catch {
      return null
    }
  }

  // Edit tool parts carry full file contents in metadata.filediff.before/after.
  // A session with many edits can produce multi-MB payloads serialized through
  // postMessage on every session switch. Stripping those strings down to just
  // file path + addition/deletion counts eliminates the dominant cost.

  private slimMeta(meta: unknown) {
    if (!this.slimEditMetadata) return meta
    if (!meta || typeof meta !== "object") return undefined

    const obj = meta as Record<string, unknown>
    const filediff = obj.filediff
    if (!filediff || typeof filediff !== "object") return undefined

    const diff = filediff as Record<string, unknown>
    const file = typeof diff.file === "string" ? diff.file : undefined
    const additions = typeof diff.additions === "number" ? diff.additions : 0
    const deletions = typeof diff.deletions === "number" ? diff.deletions : 0

    const result: Record<string, unknown> = {
      filediff: {
        ...(file ? { file } : {}),
        additions,
        deletions,
      },
    }
    // Preserve diagnostics so post-edit LSP errors still render
    if (obj.diagnostics) result.diagnostics = obj.diagnostics
    return result
  }

  /** Strip heavy metadata from a single edit tool part; pass-through for all other part types. */
  private slimPart<T>(part: T): T {
    if (!this.slimEditMetadata) return part
    if (!part || typeof part !== "object") return part

    const obj = part as Record<string, unknown>
    if (obj.type !== "tool" || obj.tool !== "edit") return part

    const state = obj.state
    if (!state || typeof state !== "object") return part

    const next = { ...(state as Record<string, unknown>) }
    const meta = this.slimMeta(next.metadata)
    if (meta) next.metadata = meta
    else delete next.metadata

    return {
      ...obj,
      state: next,
    } as T
  }

  private slimParts<T>(parts: T[]) {
    if (!this.slimEditMetadata) return parts
    return parts.map((part) => this.slimPart(part))
  }

  /**
   * Synchronize current extension-side state to the webview.
   * This is primarily used after a webview refresh where early postMessage calls
   * may have been dropped before the webview registered its message listeners.
   */
  private async syncWebviewState(reason: string): Promise<void> {
    const serverInfo = this.connectionService.getServerInfo()
    console.log("[Kilo New] KiloProvider: 🔄 syncWebviewState()", {
      reason,
      isWebviewReady: this.isWebviewReady,
      connectionState: this.connectionState,
      hasClient: !!this.client,
      hasServerInfo: !!serverInfo,
    })

    if (!this.isWebviewReady) {
      console.log("[Kilo New] KiloProvider: ⏭️ syncWebviewState skipped (webview not ready)")
      return
    }

    // Always push connection state first so the UI can render appropriately.
    this.postMessage({
      type: "connectionState",
      state: this.connectionState,
    })

    // Re-send ready so the webview can recover after refresh.
    if (serverInfo) {
      const langConfig = vscode.workspace.getConfiguration("kilo-code.new")
      this.postMessage({
        type: "ready",
        serverInfo,
        extensionVersion: this.extensionVersion,
        vscodeLanguage: vscode.env.language,
        languageOverride: langConfig.get<string>("language"),
        workspaceDirectory: this.getProjectDirectory(this.currentSession?.id),
      })
    }

    // Always attempt to fetch+push profile when connected.
    // Profile returns 401 when user isn't logged into Kilo Gateway — that's expected.
    // Use fire-and-forget (no throwOnError) to match old getProfile() which returned null on error.
    if (this.connectionState === "connected" && this.client) {
      console.log("[Kilo New] KiloProvider: 👤 syncWebviewState fetching profile...")
      const profileResult = await this.client.kilo.profile()
      const profileData = profileResult.data ?? null
      console.log("[Kilo New] KiloProvider: 👤 syncWebviewState profile:", profileData ? "received" : "null")
      this.postMessage({
        type: "profileData",
        data: profileData,
      })

      // Seed session status map so the Settings panel knows about already-running sessions.
      // Must run after webview is ready (postMessage is a no-op before that).
      void this.seedSessionStatusMap()
    }

    // legacy-migration start
    // Only show the migration wizard once the CLI connection is established so the
    // webview has finished loading providers/agents before we navigate to the wizard.
    if (reason === "webviewReady" && this.connectionState === "connected") {
      void this.checkAndShowMigrationWizard()
    } else if (reason === "sse-connected") {
      void this.checkAndShowMigrationWizard()
    }
    // legacy-migration end
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    // Store the webview references
    this.isWebviewReady = false
    this.webview = webviewView.webview

    // Set up webview options
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    // Set HTML content
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview)

    // Handle messages from webview (shared handler)
    this.setupWebviewMessageHandler(webviewView.webview)

    // Initialize connection to CLI backend
    this.initializeConnection()
  }

  /**
   * Resolve a WebviewPanel for displaying the Kilo webview in an editor tab.
   */
  public resolveWebviewPanel(panel: vscode.WebviewPanel): void {
    // WebviewPanel can be restored/reloaded; ensure we don't treat it as ready prematurely.
    this.isWebviewReady = false
    this.webview = panel.webview

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    panel.webview.html = this._getHtmlForWebview(panel.webview)

    // Handle messages from webview (shared handler)
    this.setupWebviewMessageHandler(panel.webview)

    this.initializeConnection()
  }

  /**
   * Register a session created externally (e.g., worktree sessions from AgentManagerProvider).
   * Sets currentSession, adds to trackedSessionIds, and notifies the webview.
   */
  public registerSession(session: Session): void {
    this.currentSession = session
    this.trackedSessionIds.add(session.id)
    this.postMessage({
      type: "sessionCreated",
      session: this.sessionToWebview(session),
    })
  }

  /**
   * Add a session ID to the tracked set without changing currentSession.
   * Used to re-register worktree sessions after clearSession wipes the set.
   */
  public trackSession(sessionId: string): void {
    this.trackedSessionIds.add(sessionId)
  }

  /**
   * Register a directory override for a session (e.g., worktree path).
   * When set, all operations for this session use this directory instead of the workspace root.
   */
  public setSessionDirectory(sessionId: string, directory: string): void {
    this.sessionDirectories.set(sessionId, directory)
  }

  public clearSessionDirectory(sessionId: string): void {
    this.sessionDirectories.delete(sessionId)
  }

  /** Return the currently active session ID, if any. */
  public getCurrentSessionId(): string | undefined {
    return this.currentSession?.id ?? undefined
  }

  /**
   * Re-fetch and send the full session list to the webview.
   * Called by AgentManagerProvider after worktree recovery completes.
   */
  public refreshSessions(): void {
    void this.handleLoadSessions()
  }

  public openCloudSession(sessionId: string): void {
    this.postMessage({ type: "openCloudSession", sessionId })
  }

  /**
   * Attach to a webview that already has its own HTML set.
   * Sets up message handling and connection without overriding HTML content.
   *
   * @param options.onBeforeMessage - Optional interceptor called before the standard handler.
   *   Return null to consume the message (stop propagation), or return the message
   *   (possibly transformed) to continue with standard handling.
   */
  public attachToWebview(
    webview: vscode.Webview,
    options?: { onBeforeMessage?: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null> },
  ): void {
    this.isWebviewReady = false
    this.webview = webview
    this.onBeforeMessage = options?.onBeforeMessage ?? null
    this.setupWebviewMessageHandler(webview)
    this.initializeConnection()
  }

  /**
   * Set up the shared message handler for both sidebar and tab webviews.
   * Handles ALL message types so tabs have full functionality.
   */
  private setupWebviewMessageHandler(webview: vscode.Webview): void {
    this.webviewMessageDisposable?.dispose()
    this.webviewMessageDisposable = webview.onDidReceiveMessage(async (message) => {
      // Run interceptor if attached (e.g., AgentManagerProvider worktree logic)
      if (this.onBeforeMessage) {
        try {
          const result = await this.onBeforeMessage(message)
          if (result === null) return // consumed by interceptor
          message = result
        } catch (error) {
          console.error("[Kilo New] KiloProvider: interceptor error:", error)
          return
        }
      }

      switch (message.type) {
        case "webviewReady":
          console.log("[Kilo New] KiloProvider: ✅ webviewReady received")
          this.isWebviewReady = true
          await this.syncWebviewState("webviewReady")
          this.flushPendingReviewComments()
          break
        case "sendMessage": {
          const files = z
            .array(
              z.object({
                mime: z.string(),
                url: z.string().refine((u) => u.startsWith("file://") || u.startsWith("data:")),
              }),
            )
            .optional()
            .catch(undefined)
            .parse(message.files)
          await this.handleSendMessage(
            message.text,
            typeof message.messageID === "string" ? message.messageID : undefined,
            message.sessionID,
            message.providerID,
            message.modelID,
            message.agent,
            message.variant,
            files,
          )
          break
        }
        case "sendCommand": {
          const files = z
            .array(
              z.object({
                mime: z.string(),
                url: z.string().refine((u) => u.startsWith("file://") || u.startsWith("data:")),
              }),
            )
            .optional()
            .catch(undefined)
            .parse(message.files)
          await this.handleSendCommand(
            message.command,
            message.arguments,
            typeof message.messageID === "string" ? message.messageID : undefined,
            message.sessionID,
            message.providerID,
            message.modelID,
            message.agent,
            message.variant,
            files,
          )
          break
        }
        case "abort":
          await this.handleAbort(message.sessionID)
          break
        case "revertSession":
          this.handleRevertSession(message.sessionID, message.messageID).catch((e) =>
            console.error("[Kilo New] handleRevertSession failed:", e),
          )
          break
        case "unrevertSession":
          this.handleUnrevertSession(message.sessionID).catch((e) =>
            console.error("[Kilo New] handleUnrevertSession failed:", e),
          )
          break
        case "permissionResponse":
          await this.handlePermissionResponse(
            message.permissionId,
            message.sessionID,
            message.response,
            message.approvedAlways,
            message.deniedAlways,
          )
          break
        case "createSession":
          await this.handleCreateSession()
          break
        case "clearSession":
          this.currentSession = null
          break
        case "loadMessages":
          // Don't await: allow parallel loads so rapid session switching
          // isn't blocked by slow responses for earlier sessions.
          void this.handleLoadMessages(message.sessionID)
          break
        case "syncSession":
          this.handleSyncSession(message.sessionID).catch((e) =>
            console.error("[Kilo New] handleSyncSession failed:", e),
          )
          break
        case "loadSessions":
          this.handleLoadSessions().catch((e) => console.error("[Kilo New] handleLoadSessions failed:", e))
          break
        case "login":
          await this.handleLogin()
          break
        case "cancelLogin":
          this.loginAttempt++
          this.postMessage({ type: "deviceAuthCancelled" })
          break
        case "logout":
          await this.handleLogout()
          break
        case "setOrganization":
          if (typeof message.organizationId === "string" || message.organizationId === null) {
            await this.handleSetOrganization(message.organizationId)
          }
          break
        case "refreshProfile":
          await this.handleRefreshProfile()
          break
        case "openExternal":
          if (message.url) {
            vscode.env.openExternal(vscode.Uri.parse(message.url))
          }
          break
        case "openSettingsPanel":
          vscode.commands.executeCommand("kilo-code.new.settingsButtonClicked", message.tab)
          break
        case "openChanges":
          vscode.commands.executeCommand("kilo-code.new.showChanges")
          break
        case "retryConnection":
          console.log("[Kilo New] KiloProvider: 🔄 Retrying connection...")
          this.initializeConnection().catch((e) =>
            console.error("[Kilo New] KiloProvider: ❌ Retry connection failed:", e),
          )
          break
        case "openSubAgentViewer":
          vscode.commands.executeCommand("kilo-code.new.openSubAgentViewer", message.sessionID, message.title)
          break
        case "previewImage":
          this.handlePreviewImage(message.dataUrl, message.filename)
          break
        case "openFile":
          if (message.filePath) {
            this.handleOpenFile(message.filePath, message.line, message.column)
          }
          break
        case "requestProviders":
          this.fetchAndSendProviders().catch((e) => console.error("[Kilo New] fetchAndSendProviders failed:", e))
          break
        case "compact":
          await this.handleCompact(message.sessionID, message.providerID, message.modelID)
          break
        case "requestAgents":
          this.fetchAndSendAgents().catch((e) => console.error("[Kilo New] fetchAndSendAgents failed:", e))
          break
        case "requestSkills":
          this.fetchAndSendSkills().catch((e) => console.error("[Kilo New] fetchAndSendSkills failed:", e))
          break
        case "requestCommands":
          this.fetchAndSendCommands().catch((e) => console.error("[Kilo New] fetchAndSendCommands failed:", e))
          break
        case "removeSkill":
          this.removeSkillViaCli(message.location).catch((e: unknown) =>
            console.error("[Kilo New] removeSkill failed:", e),
          )
          break
        case "removeMode":
          this.handleRemoveMode(message.name).catch((e) => console.error("[Kilo New] handleRemoveMode failed:", e))
          break
        case "removeMcp":
          this.handleRemoveMcp(message.name).catch((e) => console.error("[Kilo New] handleRemoveMcp failed:", e))
          break
        case "questionReply":
          await this.handleQuestionReply(message.requestID, message.answers)
          break
        case "questionReject":
          await this.handleQuestionReject(message.requestID)
          break
        case "requestConfig":
          this.fetchAndSendConfig().catch((e) => console.error("[Kilo New] fetchAndSendConfig failed:", e))
          break
        case "updateConfig":
          await this.handleUpdateConfig(message.config)
          break
        case "setLanguage":
          await vscode.workspace
            .getConfiguration("kilo-code.new")
            .update("language", message.locale || undefined, vscode.ConfigurationTarget.Global)
          break
        case "requestAutocompleteSettings":
          this.sendAutocompleteSettings()
          break
        case "updateAutocompleteSetting": {
          const allowedKeys = new Set([
            "enableAutoTrigger",
            "enableSmartInlineTaskKeybinding",
            "enableChatAutocomplete",
          ])
          if (allowedKeys.has(message.key)) {
            await vscode.workspace
              .getConfiguration("kilo-code.new.autocomplete")
              .update(message.key, message.value, vscode.ConfigurationTarget.Global)
            this.sendAutocompleteSettings()
          }
          break
        }
        case "requestChatCompletion":
          void handleChatCompletionRequest(
            { type: "requestChatCompletion", text: message.text, requestId: message.requestId },
            { postMessage: (msg) => this.postMessage(msg) },
            this.connectionService,
          )
          break
        case "requestFileSearch": {
          const sdkClient = this.client
          if (sdkClient) {
            const dir = this.getWorkspaceDirectory(this.currentSession?.id)
            const openPaths = dir ? await this.getOpenTabPaths(dir) : new Set<string>()
            void sdkClient.find
              .files({ query: message.query, directory: dir }, { throwOnError: true })
              .then(({ data: paths }) => {
                // Prioritize open files: open tabs first, then the rest
                const open = paths.filter((p) => openPaths.has(p))
                const rest = paths.filter((p) => !openPaths.has(p))
                this.postMessage({
                  type: "fileSearchResult",
                  paths: [...open, ...rest],
                  dir,
                  requestId: message.requestId,
                })
              })
              .catch((error: unknown) => {
                console.error("[Kilo New] File search failed:", error)
                this.postMessage({ type: "fileSearchResult", paths: [], dir, requestId: message.requestId })
              })
          } else {
            this.postMessage({ type: "fileSearchResult", paths: [], dir: "", requestId: message.requestId })
          }
          break
        }
        case "chatCompletionAccepted":
          handleChatCompletionAccepted({ type: "chatCompletionAccepted", suggestionLength: message.suggestionLength })
          break
        case "deleteSession":
          await this.handleDeleteSession(message.sessionID)
          break
        case "renameSession":
          await this.handleRenameSession(message.sessionID, message.title)
          break
        case "updateSetting":
          await this.handleUpdateSetting(message.key, message.value)
          break
        case "requestBrowserSettings":
          this.sendBrowserSettings()
          break
        case "requestNotificationSettings":
          this.sendNotificationSettings()
          break
        case "requestNotifications":
          this.fetchAndSendNotifications().catch((e) =>
            console.error("[Kilo New] fetchAndSendNotifications failed:", e),
          )
          break
        case "requestCloudSessions":
          await this.handleRequestCloudSessions(message)
          break
        case "requestGitRemoteUrl":
          void this.getGitRemoteUrl().then((url) => {
            this.postMessage({ type: "gitRemoteUrlLoaded", gitUrl: url ?? null })
          })
          break
        case "requestCloudSessionData":
          void this.handleRequestCloudSessionData(message.sessionId)
          break
        case "importAndSend": {
          const files = z
            .array(
              z.object({
                mime: z.string(),
                url: z.string().refine((u) => u.startsWith("file://") || u.startsWith("data:")),
              }),
            )
            .optional()
            .catch(undefined)
            .parse(message.files)
          void this.handleImportAndSend(
            message.cloudSessionId,
            message.text,
            typeof message.messageID === "string" ? message.messageID : undefined,
            message.providerID,
            message.modelID,
            message.agent,
            message.variant,
            files,
            typeof message.command === "string" ? message.command : undefined,
            typeof message.commandArgs === "string" ? message.commandArgs : undefined,
          )
          break
        }
        case "dismissNotification":
          await this.handleDismissNotification(message.notificationId)
          break
        case "resetAllSettings":
          await this.handleResetAllSettings()
          break
        case "telemetry":
          TelemetryProxy.capture(message.event, message.properties)
          break
        case "persistVariant": {
          const stored = this.extensionContext?.globalState.get<Record<string, string>>("variantSelections") ?? {}
          stored[message.key] = message.value
          await this.extensionContext?.globalState.update("variantSelections", stored)
          break
        }
        case "requestVariants": {
          const variants = this.extensionContext?.globalState.get<Record<string, string>>("variantSelections") ?? {}
          this.postMessage({ type: "variantsLoaded", variants })
          break
        }
        // legacy-migration start
        case "requestLegacyMigrationData":
          void this.handleRequestLegacyMigrationData()
          break
        case "startLegacyMigration":
          void this.handleStartLegacyMigration(message.selections)
          break
        case "skipLegacyMigration":
          void this.handleSkipLegacyMigration()
          break
        case "clearLegacyData":
          void this.handleClearLegacyData()
          break
        // legacy-migration end
        case "enhancePrompt": {
          const sdkClient = this.client
          if (!sdkClient) {
            this.postMessage({
              type: "enhancePromptError",
              error: "Not connected to CLI backend",
              requestId: message.requestId,
            })
            break
          }
          void sdkClient.enhancePrompt
            .enhance({ text: message.text }, { throwOnError: true })
            .then(({ data }) => {
              this.postMessage({ type: "enhancePromptResult", text: data.text, requestId: message.requestId })
            })
            .catch((err: unknown) => {
              const msg = getErrorMessage(err) || "Failed to enhance prompt"
              console.error("[Kilo New] KiloProvider: Failed to enhance prompt:", err)
              vscode.window.showErrorMessage(`Enhance prompt failed: ${msg}`)
              this.postMessage({
                type: "enhancePromptError",
                error: msg,
                requestId: message.requestId,
              })
            })
          break
        }
        case "fetchMarketplaceData": {
          const workspace = this.getProjectDirectory(this.currentSession?.id)
          const mp = this.getMarketplace()
          // Fetch skills from CLI backend (authoritative source) so the
          // marketplace doesn't need to duplicate the CLI's skill scanning.
          const skills = await this.fetchCliSkills()
          const data = await mp.fetchData(workspace, skills)
          this.postMessage({ type: "marketplaceData", ...data })
          break
        }
        case "filterMarketplaceItems": {
          // Client-side filtering — no server action needed
          break
        }
        case "installMarketplaceItem": {
          const workspace = this.getProjectDirectory(this.currentSession?.id)
          const scope = message.mpInstallOptions?.target ?? "project"
          const result = await this.getMarketplace().install(message.mpItem, message.mpInstallOptions, workspace)
          if (result.success) {
            await this.invalidateAfterMarketplaceChange(scope)
          }
          this.postMessage({
            type: "marketplaceInstallResult",
            success: result.success,
            slug: result.slug,
            error: result.error,
          })
          break
        }
        case "removeInstalledMarketplaceItem": {
          const workspace = this.getProjectDirectory(this.currentSession?.id)
          const scope = message.mpInstallOptions?.target ?? "project"
          const result = await this.getMarketplace().remove(message.mpItem, scope, workspace)
          if (result.success) {
            await this.invalidateAfterMarketplaceChange(scope)
          }
          this.postMessage({
            type: "marketplaceRemoveResult",
            success: result.success,
            slug: result.slug,
            error: result.error,
          })
          break
        }
      }
    })
  }

  /**
   * Initialize connection to the CLI backend server.
   * Subscribes to the shared KiloConnectionService.
   */
  private initializeConnection(): Promise<void> {
    if (this.initConnectionPromise) {
      return this.initConnectionPromise
    }
    this.initConnectionPromise = this.doInitializeConnection().finally(() => {
      this.initConnectionPromise = null
    })
    return this.initConnectionPromise
  }

  private async doInitializeConnection(): Promise<void> {
    console.log("[Kilo New] KiloProvider: 🔧 Starting initializeConnection...")

    this.connectionState = "connecting"
    this.postMessage({ type: "connectionState", state: "connecting" })

    // Clean up any existing subscriptions (e.g., sidebar re-shown)
    this.unsubscribeEvent?.()
    this.unsubscribeState?.()
    this.unsubscribeNotificationDismiss?.()

    try {
      const workspaceDir = this.getWorkspaceDirectory()

      // Connect the shared service (no-op if already connected)
      await this.connectionService.connect(workspaceDir)

      // Subscribe to SSE events for this webview (filtered by tracked sessions)
      this.unsubscribeEvent = this.connectionService.onEventFiltered(
        (event) => {
          const sessionId = this.connectionService.resolveEventSessionId(event)

          // message.part.updated and message.part.delta are always session-scoped; drop if session unknown.
          if (!sessionId) {
            return event.type !== "message.part.updated" && event.type !== "message.part.delta"
          }

          // session.status must always pass through — even for sessions not tracked by this
          // KiloProvider instance. The Settings panel is a separate provider with no tracked
          // sessions, but it needs session.status to populate sessionStatusMap and allStatusMap
          // for the busy-session warning on Save.
          if (event.type === "session.status") return true

          return this.trackedSessionIds.has(sessionId)
        },
        (event) => {
          this.handleEvent(event)
        },
      )

      // Subscribe to connection state changes
      this.unsubscribeState = this.connectionService.onStateChange(async (state) => {
        this.connectionState = state
        this.postMessage({ type: "connectionState", state })

        if (state === "connected") {
          try {
            // Profile fetch is best-effort — returns 401 when user isn't logged into gateway.
            const sdkClient = this.client
            if (sdkClient) {
              const profileResult = await sdkClient.kilo.profile()
              this.postMessage({ type: "profileData", data: profileResult.data ?? null })
            }
            await this.syncWebviewState("sse-connected")
            await this.flushPendingSessionRefresh("sse-connected")
            await this.fetchAndSendPendingPermissions()
          } catch (error) {
            console.error("[Kilo New] KiloProvider: ❌ Failed during connected state handling:", error)
            this.postMessage({
              type: "error",
              message: getErrorMessage(error) || "Failed to sync after connecting",
            })
          }
        }
      })

      // Subscribe to notification dismiss broadcast from other KiloProvider instances
      this.unsubscribeNotificationDismiss = this.connectionService.onNotificationDismissed(() => {
        this.fetchAndSendNotifications()
      })

      // Get current state and push to webview
      const serverInfo = this.connectionService.getServerInfo()
      this.connectionState = this.connectionService.getConnectionState()

      if (serverInfo) {
        const langConfig = vscode.workspace.getConfiguration("kilo-code.new")
        this.postMessage({
          type: "ready",
          serverInfo,
          extensionVersion: this.extensionVersion,
          vscodeLanguage: vscode.env.language,
          languageOverride: langConfig.get<string>("language"),
          workspaceDirectory: this.getProjectDirectory(this.currentSession?.id),
        })
      }

      this.postMessage({ type: "connectionState", state: this.connectionState })
      await this.syncWebviewState("initializeConnection")
      await this.flushPendingSessionRefresh("initializeConnection")

      // Fetch providers, agents, skills, config, notifications, and session statuses in parallel
      await Promise.all([
        this.fetchAndSendProviders(),
        this.fetchAndSendAgents(),
        this.fetchAndSendSkills(),
        this.fetchAndSendCommands(),
        this.fetchAndSendConfig(),
        this.fetchAndSendNotifications(),
        this.seedSessionStatusMap(),
      ])
      this.sendNotificationSettings()

      console.log("[Kilo New] KiloProvider: ✅ initializeConnection completed successfully")
    } catch (error) {
      console.error("[Kilo New] KiloProvider: ❌ Failed to initialize connection:", error)
      this.connectionState = "error"
      this.postMessage({
        type: "connectionState",
        state: "error",
        error: getErrorMessage(error) || "Failed to connect to CLI backend",
        ...(error instanceof ServerStartupError && {
          userMessage: error.userMessage,
          userDetails: error.userDetails,
        }),
      })
    }
  }

  private sessionToWebview(session: Session) {
    return sessionToWebview(session)
  }

  /**
   * Handle creating a new session.
   */
  private async handleCreateSession(): Promise<void> {
    if (!this.client) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const { data: session } = await this.client.session.create({ directory: workspaceDir }, { throwOnError: true })
      this.currentSession = session
      this.trackedSessionIds.add(session.id)

      // Notify webview of the new session
      this.postMessage({
        type: "sessionCreated",
        session: this.sessionToWebview(this.currentSession!),
      })
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to create session:", error)
      this.postMessage({
        type: "error",
        message: getErrorMessage(error) || "Failed to create session",
      })
    }
  }

  /**
   * Handle loading messages for a session.
   */
  private async handleLoadMessages(sessionID: string): Promise<void> {
    // Track the session so we receive its SSE events
    this.trackedSessionIds.add(sessionID)

    if (!this.client) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
        sessionID,
      })
      return
    }

    // Abort any previous in-flight loadMessages request so the backend
    // isn't overwhelmed when the user switches sessions rapidly.
    this.loadMessagesAbort?.abort()
    const abort = new AbortController()
    this.loadMessagesAbort = abort

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID)
      const { data: messagesData } = await this.client.session.messages(
        { sessionID, directory: workspaceDir },
        { throwOnError: true, signal: abort.signal },
      )

      // If this request was aborted while awaiting, skip posting stale results
      if (abort.signal.aborted) return

      // Update currentSession so fallback logic in handleSendMessage/handleAbort
      // references the correct session after switching.  loadMessages is the
      // canonical "user switched to this session" signal, so always update —
      // the old guard `this.currentSession.id === sessionID` prevented updates
      // when switching between different sessions.
      // Non-blocking: don't let a failure here prevent messages from loading.
      // 404s are expected for cross-worktree sessions — use silent to suppress HTTP error logs.
      this.client.session
        .get({ sessionID, directory: workspaceDir })
        .then((result) => {
          if (result.data && !abort.signal.aborted) {
            this.currentSession = result.data
          }
        })
        .catch((err: unknown) => console.warn("[Kilo New] KiloProvider: getSession failed (non-critical):", err))

      this.postMessage({
        type: "workspaceDirectoryChanged",
        directory: this.getWorkspaceDirectory(sessionID),
      })

      // Fetch current session status so the webview has the correct busy/idle
      // state after switching tabs (SSE events may have been missed).
      this.client.session
        .status({ directory: workspaceDir })
        .then((result) => {
          if (!result.data) return
          for (const [sid, info] of Object.entries(result.data) as [string, SessionStatus][]) {
            if (!this.trackedSessionIds.has(sid)) continue
            this.postMessage({
              type: "sessionStatus",
              sessionID: sid,
              status: info.type,
              ...(info.type === "retry" ? { attempt: info.attempt, message: info.message, next: info.next } : {}),
            })
          }
        })
        .catch((err: unknown) => console.error("[Kilo New] KiloProvider: Failed to fetch session statuses:", err))

      const messages = messagesData.map((m) => ({
        ...m.info,
        parts: this.slimParts(m.parts),
        createdAt: new Date(m.info.time.created).toISOString(),
      }))

      for (const message of messages) {
        this.connectionService.recordMessageSessionId(message.id, message.sessionID)
      }

      this.postMessage({
        type: "messagesLoaded",
        sessionID,
        messages,
      })

      // Recover any permission.asked events that were missed while the webview
      // was loading or during an SSE reconnection (fire-and-forget).
      void this.fetchAndSendPendingPermissions()
    } catch (error) {
      // Silently ignore aborted requests — the user switched to a different session
      if (abort.signal.aborted) return
      console.error("[Kilo New] KiloProvider: Failed to load messages:", error)
      this.postMessage({
        type: "error",
        message: getErrorMessage(error) || "Failed to load messages",
        sessionID,
      })
    }
  }

  /**
   * Handle syncing a child session (e.g. spawned by the task tool).
   * Tracks the session for SSE events and fetches its messages.
   */
  private async handleSyncSession(sessionID: string): Promise<void> {
    if (!this.client) return
    if (this.syncedChildSessions.has(sessionID)) return

    this.syncedChildSessions.add(sessionID)
    this.trackedSessionIds.add(sessionID)

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID)
      const { data: messagesData } = await this.client.session.messages(
        { sessionID, directory: workspaceDir },
        { throwOnError: true },
      )

      const messages = messagesData.map((m) => ({
        ...m.info,
        parts: this.slimParts(m.parts),
        createdAt: new Date(m.info.time.created).toISOString(),
      }))

      for (const message of messages) {
        this.connectionService.recordMessageSessionId(message.id, message.sessionID)
      }

      this.postMessage({
        type: "messagesLoaded",
        sessionID,
        messages,
      })
    } catch (err) {
      this.syncedChildSessions.delete(sessionID)
      console.error("[Kilo New] KiloProvider: Failed to sync child session:", err)
    }
  }

  /**
   * Build the context object used by the extracted session-refresh helpers.
   */
  private get sessionRefreshContext(): SessionRefreshContext {
    const client = this.client
    return {
      pendingSessionRefresh: this.pendingSessionRefresh,
      connectionState: this.connectionState,
      listSessions: client
        ? (dir: string) =>
            client.session.list({ directory: dir, roots: true }, { throwOnError: true }).then(({ data }) => data)
        : null,
      sessionDirectories: this.sessionDirectories,
      workspaceDirectory: this.getWorkspaceDirectory(),
      postMessage: (msg: unknown) => this.postMessage(msg),
    }
  }

  /**
   * Retry a deferred sessions refresh once the client is ready.
   */
  private async flushPendingSessionRefresh(reason: string): Promise<void> {
    if (!this.pendingSessionRefresh) return
    console.log("[Kilo New] KiloProvider: 🔄 Flushing deferred sessions refresh", { reason })
    const ctx = this.sessionRefreshContext
    try {
      const resolved = await flushPendingSessionRefreshUtil(ctx)
      if (resolved) this.projectID = resolved
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to flush session refresh:", error)
    }
    this.pendingSessionRefresh = ctx.pendingSessionRefresh
  }

  /**
   * Handle loading all sessions.
   */
  private async handleLoadSessions(): Promise<void> {
    const ctx = this.sessionRefreshContext
    try {
      const resolved = await loadSessionsUtil(ctx)
      if (resolved) this.projectID = resolved
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to load sessions:", error)
      this.postMessage({
        type: "error",
        message: getErrorMessage(error) || "Failed to load sessions",
      })
    }
    this.pendingSessionRefresh = ctx.pendingSessionRefresh
  }

  /**
   * Handle deleting a session.
   */
  private async handleDeleteSession(sessionID: string): Promise<void> {
    if (!this.client) {
      this.postMessage({ type: "error", message: "Not connected to CLI backend" })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID)
      await this.client.session.delete({ sessionID, directory: workspaceDir }, { throwOnError: true })
      this.trackedSessionIds.delete(sessionID)
      this.syncedChildSessions.delete(sessionID)
      this.sessionDirectories.delete(sessionID)
      if (this.currentSession?.id === sessionID) {
        this.currentSession = null
      }
      this.postMessage({ type: "sessionDeleted", sessionID })
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to delete session:", error)
      this.postMessage({
        type: "error",
        message: getErrorMessage(error) || "Failed to delete session",
      })
    }
  }

  /**
   * Handle renaming a session.
   */
  private async handleRenameSession(sessionID: string, title: string): Promise<void> {
    if (!this.client) {
      this.postMessage({ type: "error", message: "Not connected to CLI backend" })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID)
      const { data: updated } = await this.client.session.update(
        { sessionID, directory: workspaceDir, title },
        { throwOnError: true },
      )
      if (this.currentSession?.id === sessionID) {
        this.currentSession = updated
      }
      this.postMessage({ type: "sessionUpdated", session: this.sessionToWebview(updated) })
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to rename session:", error)
      this.postMessage({
        type: "error",
        message: getErrorMessage(error) || "Failed to rename session",
      })
    }
  }

  /**
   * Fetch providers from the backend and send to webview.
   *
   * The backend `/provider` endpoint returns `all` as an array-like object with
   * numeric keys ("0", "1", …). The webview and sendMessage both need providers
   * keyed by their real `provider.id` (e.g. "anthropic", "openai"). We re-key
   * the map here so the rest of the code can use provider.id everywhere.
   */
  private async fetchAndSendProviders(): Promise<void> {
    if (!this.client) {
      // client not ready — serve from cache if available
      if (this.cachedProvidersMessage) {
        this.postMessage(this.cachedProvidersMessage)
      }
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const { data: response } = await this.client.provider.list({ directory: workspaceDir }, { throwOnError: true })

      const normalized = indexProvidersById(response.all)

      const config = vscode.workspace.getConfiguration("kilo-code.new.model")
      const providerID = config.get<string>("providerID", "kilo")
      const modelID = config.get<string>("modelID", "kilo-auto/free")

      const message = {
        type: "providersLoaded",
        providers: normalized,
        connected: response.connected,
        defaults: response.default,
        defaultSelection: { providerID, modelID },
      }
      this.cachedProvidersMessage = message
      this.postMessage(message)
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch providers:", error)
    }
  }

  /**
   * Fetch agents (modes) from the backend and send to webview.
   */
  private async fetchAndSendAgents(): Promise<void> {
    if (!this.client) {
      if (this.cachedAgentsMessage) {
        this.postMessage(this.cachedAgentsMessage)
      }
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const { data: agents } = await this.client.app.agents({ directory: workspaceDir }, { throwOnError: true })

      const { visible, defaultAgent } = filterVisibleAgents(agents)

      const message = {
        type: "agentsLoaded",
        agents: visible.map((a) => ({
          name: a.name,
          description: a.description,
          mode: a.mode,
          native: a.native,
          color: a.color,
        })),
        defaultAgent,
      }
      this.cachedAgentsMessage = message
      this.postMessage(message)
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch agents:", error)
    }
  }

  private async fetchAndSendSkills(): Promise<void> {
    if (!this.client) {
      if (this.cachedSkillsMessage) {
        this.postMessage(this.cachedSkillsMessage)
      }
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const { data: skills } = await this.client.app.skills({ directory: workspaceDir }, { throwOnError: true })

      const message = {
        type: "skillsLoaded",
        skills,
      }
      this.cachedSkillsMessage = message
      this.postMessage(message)
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch skills:", error)
    }
  }

  private async fetchAndSendCommands(): Promise<void> {
    if (!this.client) {
      if (this.cachedCommandsMessage) {
        this.postMessage(this.cachedCommandsMessage)
      }
      return
    }

    try {
      const dir = this.getWorkspaceDirectory()
      const { data: commands } = await this.client.command.list({ directory: dir }, { throwOnError: true })

      const message = {
        type: "commandsLoaded",
        commands: commands.map((c) => ({
          name: c.name,
          description: c.description,
          source: c.source,
          hints: c.hints,
        })),
      }
      this.cachedCommandsMessage = message
      this.postMessage(message)
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch commands:", error)
    }
  }

  private async fetchCliSkills(): Promise<Array<{ name: string; location: string }> | undefined> {
    if (!this.client) return undefined
    try {
      const dir = this.getWorkspaceDirectory()
      const { data } = await this.client.app.skills({ directory: dir }, { throwOnError: true })
      return data
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch CLI skills for marketplace:", error)
      return undefined
    }
  }

  /**
   * Remove a skill via the CLI backend (deletes from disk + clears cache), then refresh.
   * Returns true on success, false on failure.
   * On failure, re-fetches skills so the webview reverts to the authoritative state.
   */
  private async removeSkillViaCli(location: string): Promise<boolean> {
    if (!this.client) return false
    try {
      const dir = this.getWorkspaceDirectory()
      const result = await this.client.kilocode.removeSkill({ location, directory: dir })
      if (result.error) {
        console.error("[Kilo New] removeSkill returned error:", result.error)
        this.cachedSkillsMessage = null
        this.cachedCommandsMessage = null
        await Promise.all([this.fetchAndSendSkills(), this.fetchAndSendCommands()])
        return false
      }
    } catch (error) {
      console.error("[Kilo New] Failed to remove skill:", error)
      this.cachedSkillsMessage = null
      this.cachedCommandsMessage = null
      await Promise.all([this.fetchAndSendSkills(), this.fetchAndSendCommands()])
      return false
    }
    this.cachedSkillsMessage = null
    this.cachedCommandsMessage = null
    await Promise.all([this.fetchAndSendSkills(), this.fetchAndSendCommands()])
    return true
  }

  /**
   * Remove a custom mode via the CLI backend (deletes from disk + refreshes state).
   * The webview optimistically removes the mode from its list before this runs.
   * On failure, re-fetches agents so the webview reverts to the authoritative state.
   */
  private async handleRemoveMode(name: string): Promise<void> {
    if (!this.client) return
    let removed = false

    // 1. Try CLI removal (handles .md files and legacy .kilocodemodes)
    try {
      const dir = this.getWorkspaceDirectory()
      const result = await this.client.kilocode.removeAgent({ name, directory: dir })
      if (!result.error) removed = true
    } catch {
      // CLI removal failed — agent may be in kilo.json instead
    }

    // 2. Try removing from kilo.json (handles marketplace-installed modes)
    if (!removed) {
      const workspace = this.getProjectDirectory(this.currentSession?.id)
      const mp = this.getMarketplace()
      const stub = { id: name, type: "mode" as const, name, description: "", content: "" }
      const project = await mp.remove(stub, "project", workspace)
      const global = await mp.remove(stub, "global", workspace)
      if (project.success || global.success) {
        await this.disposeCliInstance("global")
        removed = true
      }
    }

    if (!removed) {
      console.error("[Kilo New] KiloProvider: Failed to remove mode:", name)
    }

    this.cachedAgentsMessage = null
    await this.fetchAndSendAgents()
  }

  private async handleRemoveMcp(name: string): Promise<void> {
    const workspace = this.getProjectDirectory(this.currentSession?.id)
    const mp = this.getMarketplace()
    const stub = { id: name, type: "mcp" as const, name, description: "", url: "", content: "" }

    // Remove from both scopes — an MCP could exist in project, global, or both
    const project = await mp.remove(stub, "project", workspace)
    const global = await mp.remove(stub, "global", workspace)

    if (project.success || global.success) {
      // Use global scope when removed from global (or both) so the global
      // config cache is also invalidated; project scope is a subset.
      const scope = global.success ? "global" : "project"
      await this.disposeCliInstance(scope)
      this.cachedConfigMessage = null
      await this.fetchAndSendConfig()
    } else {
      console.error("[Kilo New] KiloProvider: Failed to remove MCP server:", name)
    }
  }

  /**
   * Dispose the CLI backend instance so it re-reads config from disk.
   * Call after any marketplace install/remove that writes config files directly.
   * Global-scope changes need global.dispose() to also reset the global config cache.
   */
  private async disposeCliInstance(scope: "project" | "global"): Promise<void> {
    if (!this.client) return
    if (scope === "global") {
      await this.client.global.dispose().catch((e: unknown) => {
        console.warn("[Kilo New] global.dispose() after marketplace change failed:", e)
      })
    }
    // Always dispose the per-project instance so it rebuilds state from
    // the (possibly updated) global + project config on the next request.
    const dir = this.getWorkspaceDirectory()
    await this.client.instance.dispose({ directory: dir }).catch((e: unknown) => {
      console.warn("[Kilo New] instance.dispose() after marketplace change failed:", e)
    })
  }

  /**
   * Invalidate CLI caches and refresh the webview after a marketplace install/remove.
   *
   * For global scope: uses global.config.update with the freshly-written config file
   * contents rather than global.dispose. This goes through Config.updateGlobal() which
   * calls Config.global.reset() to invalidate the lazy-cached global config, ensuring
   * the newly installed/removed MCP entry is visible on the next config.get call.
   * (global.dispose alone is not sufficient on older CLI versions that lack the
   * Config.global.reset() call in the dispose handler.)
   *
   * For project scope: instance.dispose is sufficient because the per-instance
   * Config.state is cleared and re-reads all files (including global) on next access.
   */
  private async invalidateAfterMarketplaceChange(scope: "project" | "global"): Promise<void> {
    if (!this.client) return
    if (scope === "global") {
      // Use global.config.update with an empty config to trigger Config.updateGlobal()
      // which calls Config.global.reset(). This invalidates the lazy-cached global
      // config in the CLI process so it re-reads kilo.json from disk.
      // An empty object merge is a no-op for the file content but resets the cache.
      // (global.dispose alone is insufficient on older CLI versions that lack
      // the Config.global.reset() call in the dispose handler.)
      await this.client.global.config.update({ config: {} }).catch((e: unknown) => {
        console.warn("[Kilo New] global.config.update after marketplace change failed:", e)
      })
    }
    // Always dispose the per-project instance so it rebuilds state from
    // the (possibly updated) global + project config on the next request.
    const dir = this.getWorkspaceDirectory()
    await this.client.instance.dispose({ directory: dir }).catch((e: unknown) => {
      console.warn("[Kilo New] instance.dispose() after marketplace change failed:", e)
    })
    this.cachedAgentsMessage = null
    this.cachedConfigMessage = null
    await Promise.all([this.fetchAndSendAgents(), this.fetchAndSendConfig()])
  }

  /**
   * Fetch backend config and send to webview.
   */
  private async fetchAndSendConfig(): Promise<void> {
    if (!this.client || this.connectionState !== "connected") {
      if (this.cachedConfigMessage) {
        this.postMessage(this.cachedConfigMessage)
      }
      return
    }

    // Skip if handleUpdateConfig is in flight — sending a configLoaded now
    // would race with the write and potentially overwrite optimistic webview state.
    if (this.pending > 0) {
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const { data: config } = await this.client.config.get({ directory: workspaceDir }, { throwOnError: true })

      const message = {
        type: "configLoaded",
        config,
      }
      this.cachedConfigMessage = message
      this.postMessage(message)
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch config:", error)
    }
  }

  /**
   * Seed sessionStatusMap with current session statuses on connect.
   * Without this, the Settings panel (which has no tracked sessions) would see
   * busyCount() = 0 for sessions that were already running before it opened.
   */
  private async seedSessionStatusMap(): Promise<void> {
    if (!this.client || this.connectionState !== "connected") return
    const dir = this.getWorkspaceDirectory()
    await seedSessionStatuses(this.client, dir, this.sessionStatusMap, (msg) => this.postMessage(msg))
  }

  /**
   * Fetch the latest merged config and push it as configUpdated.
   * Called when global.config.updated SSE fires (config changed without a full dispose).
   */
  private async fetchAndSendConfigUpdated(): Promise<void> {
    if (!this.client || this.connectionState !== "connected") return
    try {
      const dir = this.getWorkspaceDirectory()
      const { data: config } = await this.client.config.get({ directory: dir }, { throwOnError: true })
      this.cachedConfigMessage = { type: "configLoaded", config }
      this.postMessage({ type: "configUpdated", config })
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch config after update:", error)
    }
  }

  /**
   * Fetch Kilo news/notifications and send to webview.
   * Uses the cached message pattern so the webview gets data immediately on refresh.
   */
  private async fetchAndSendNotifications(): Promise<void> {
    if (!this.client) {
      if (this.cachedNotificationsMessage) {
        // Merge the latest dismissed IDs from globalState into the cached
        // message so that dismissals persisted while offline are honoured.
        const persisted = this.extensionContext?.globalState.get<string[]>("kilo.dismissedNotificationIds", []) ?? []
        if (persisted.length > 0) {
          const cached = this.cachedNotificationsMessage as {
            type: string
            notifications: unknown[]
            dismissedIds: string[]
          }
          const merged = Array.from(new Set([...cached.dismissedIds, ...persisted]))
          this.cachedNotificationsMessage = { ...cached, dismissedIds: merged }
        }
        this.postMessage(this.cachedNotificationsMessage)
      }
      return
    }

    try {
      const { data: all } = await this.client.kilo.notifications(undefined, { throwOnError: true })
      const notifications = all.filter((n) => !n.showIn || n.showIn.includes("extension"))
      const existing = this.extensionContext?.globalState.get<string[]>("kilo.dismissedNotificationIds", []) ?? []
      const active = new Set(notifications.map((n) => n.id))
      // Only prune stale dismissed IDs when we have a non-empty notification
      // list. An empty list may mean the API returned nothing due to being
      // unauthenticated (e.g. right after logout), not that all notifications
      // are gone — pruning in that case would wipe the persisted dismissals.
      const dismissedIds = notifications.length > 0 ? existing.filter((id) => active.has(id)) : existing
      if (dismissedIds.length !== existing.length) {
        await this.extensionContext?.globalState.update("kilo.dismissedNotificationIds", dismissedIds)
      }
      const message = { type: "notificationsLoaded", notifications, dismissedIds }
      this.cachedNotificationsMessage = message
      this.postMessage(message)
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch notifications:", error)
    }
  }

  /**
   * Handle cloud sessions request from webview.
   * Fetches sessions from the Kilo cloud API and sends them back.
   */
  private async handleRequestCloudSessions(message: {
    cursor?: string
    limit?: number
    gitUrl?: string
  }): Promise<void> {
    if (!this.client) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    try {
      const result = await this.client.kilo.cloudSessions({
        cursor: message.cursor,
        limit: message.limit,
        gitUrl: message.gitUrl,
      })

      this.postMessage({
        type: "cloudSessionsLoaded",
        sessions: result.data?.cliSessions ?? [],
        nextCursor: result.data?.nextCursor ?? null,
      })
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch cloud sessions:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to fetch cloud sessions",
      })
    }
  }

  /**
   * Fetch full cloud session data for read-only preview.
   * Transforms the export data into webview message format and sends it back.
   */
  private async handleRequestCloudSessionData(sessionId: string): Promise<void> {
    if (!this.client) {
      this.postMessage({
        type: "cloudSessionImportFailed",
        cloudSessionId: sessionId,
        error: "Not connected to CLI backend",
      })
      return
    }

    try {
      const result = await this.client.kilo.cloud.session.get({ id: sessionId })
      const data = result.data as CloudSessionData | undefined
      if (!data) {
        this.postMessage({
          type: "cloudSessionImportFailed",
          cloudSessionId: sessionId,
          error: "Failed to fetch cloud session",
        })
        return
      }

      const messages = (data.messages ?? []).filter((m) => m.info).map(mapCloudSessionMessageToWebviewMessage)

      this.postMessage({
        type: "cloudSessionDataLoaded",
        cloudSessionId: sessionId,
        title: data.info.title ?? "Untitled",
        messages,
      })
    } catch (err) {
      console.error("[Kilo New] Failed to load cloud session data:", err)
      this.postMessage({
        type: "cloudSessionImportFailed",
        cloudSessionId: sessionId,
        error: err instanceof Error ? err.message : "Failed to load cloud session",
      })
    }
  }

  /**
   * Import a cloud session to local storage, then send a new message on it.
   * This is the "clone on first message" flow — the cloud session becomes a
   * local session only when the user decides to continue it.
   */
  private async handleImportAndSend(
    cloudSessionId: string,
    text: string,
    messageID?: string,
    providerID?: string,
    modelID?: string,
    agent?: string,
    variant?: string,
    files?: Array<{ mime: string; url: string }>,
    command?: string,
    commandArgs?: string,
  ): Promise<void> {
    if (!this.client) {
      this.postMessage({
        type: "cloudSessionImportFailed",
        cloudSessionId,
        error: "Not connected to CLI backend",
      })
      return
    }

    const workspaceDir = this.getWorkspaceDirectory()

    // Step 1: Import the cloud session with fresh IDs
    let session: Session | undefined
    try {
      const importResult = await this.client.kilo.cloud.session.import({
        sessionId: cloudSessionId,
        directory: workspaceDir,
      })
      session = importResult.data as Session | undefined
    } catch (error) {
      console.error("[Kilo New] KiloProvider: ❌ Cloud session import failed:", error)
      this.postMessage({
        type: "cloudSessionImportFailed",
        cloudSessionId,
        error: getErrorMessage(error) || "Failed to import session from cloud",
      })
      return
    }
    if (!session) {
      this.postMessage({
        type: "cloudSessionImportFailed",
        cloudSessionId,
        error: "Failed to import session from cloud",
      })
      return
    }

    // Track the new local session
    this.currentSession = session
    this.trackedSessionIds.add(session.id)

    // Notify webview of the import success
    this.postMessage({
      type: "cloudSessionImported",
      cloudSessionId,
      session: this.sessionToWebview(session),
    })

    // Step 2: Send the user's message/command on the new local session
    try {
      if (messageID) {
        this.connectionService.recordMessageSessionId(messageID, session.id)
      }

      if (command) {
        const fileParts = files?.map((f) => ({ type: "file" as const, mime: f.mime, url: f.url }))
        await this.client.session.command(
          {
            sessionID: session.id,
            directory: workspaceDir,
            command,
            arguments: commandArgs ?? "",
            messageID,
            model: providerID && modelID ? `${providerID}/${modelID}` : undefined,
            agent,
            variant,
            parts: fileParts,
          },
          { throwOnError: true },
        )
      } else {
        const parts: Array<TextPartInput | FilePartInput> = []
        if (files) {
          for (const f of files) {
            parts.push({ type: "file", mime: f.mime, url: f.url })
          }
        }
        parts.push({ type: "text", text })

        const editorContext = await this.gatherEditorContext()
        await this.client.session.promptAsync(
          {
            sessionID: session.id,
            directory: workspaceDir,
            messageID,
            parts,
            model: providerID && modelID ? { providerID, modelID } : undefined,
            agent,
            variant,
            editorContext,
          },
          { throwOnError: true },
        )
      }
    } catch (err) {
      console.error("[Kilo New] Failed to send message after cloud import:", err)
      this.postMessage({
        type: "sendMessageFailed",
        error: err instanceof Error ? err.message : "Failed to send message after import",
        text,
        sessionID: session.id,
        messageID,
        files,
      })
    }
  }

  /**
   * Persist a dismissed notification ID in globalState and push updated lists to webview.
   */
  private async handleDismissNotification(notificationId: string): Promise<void> {
    if (!this.extensionContext) return
    const existing = this.extensionContext.globalState.get<string[]>("kilo.dismissedNotificationIds", [])
    if (!existing.includes(notificationId)) {
      await this.extensionContext.globalState.update("kilo.dismissedNotificationIds", [...existing, notificationId])
    }
    // Update the cached message so the dismiss persists even if
    // fetchAndSendNotifications() fails (e.g. no client / API error).
    if (this.cachedNotificationsMessage) {
      const cached = this.cachedNotificationsMessage as {
        type: string
        notifications: unknown[]
        dismissedIds: string[]
      }
      if (!cached.dismissedIds.includes(notificationId)) {
        this.cachedNotificationsMessage = {
          ...cached,
          dismissedIds: [...cached.dismissedIds, notificationId],
        }
      }
    }
    await this.fetchAndSendNotifications()
    this.connectionService.notifyNotificationDismissed(notificationId)
  }

  /**
   * Read notification/sound settings from VS Code config and push to webview.
   */
  private sendNotificationSettings(): void {
    const notifications = vscode.workspace.getConfiguration("kilo-code.new.notifications")
    const sounds = vscode.workspace.getConfiguration("kilo-code.new.sounds")
    this.postMessage({
      type: "notificationSettingsLoaded",
      settings: {
        notifyAgent: notifications.get<boolean>("agent", true),
        notifyPermissions: notifications.get<boolean>("permissions", true),
        notifyErrors: notifications.get<boolean>("errors", true),
        soundAgent: sounds.get<string>("agent", "default"),
        soundPermissions: sounds.get<string>("permissions", "default"),
        soundErrors: sounds.get<string>("errors", "default"),
      },
    })
  }

  /** Returns the number of sessions currently in "busy" state. */
  private getBusySessionCount(): number {
    return getBusySessionCount(this.sessionStatusMap)
  }

  /**
   * Handle config update request from the webview.
   * Applies a partial config update via the global config endpoint, then pushes
   * the full merged config back to the webview.
   */
  private async handleUpdateConfig(partial: Partial<Config>): Promise<void> {
    if (!this.client || this.connectionState !== "connected") {
      this.postMessage({ type: "error", message: "Not connected to CLI backend" })
      return
    }

    // Belt-and-suspenders guard: prevent fetchAndSendConfig from sending a
    // stale configLoaded while this write is in flight (the SSE-triggered reload
    // races with the async config.update() write on the CLI backend).
    this.pending++
    try {
      await this.client.global.config.update({ config: partial }, { throwOnError: true })

      // Re-fetch the full merged config (global + project + all layers) so the
      // webview receives the complete resolved config, not just global-only data.
      // Config.state is reset by updateGlobal (via Instance.resetStateEntry) so
      // config.get() returns fresh data without a full dispose cycle.
      const dir = this.getWorkspaceDirectory()
      const { data: merged } = await this.client.config.get({ directory: dir }, { throwOnError: true })

      this.cachedConfigMessage = { type: "configLoaded", config: merged }
      this.postMessage({ type: "configUpdated", config: merged })
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to update config:", error)
      this.postMessage({
        type: "error",
        message: getErrorMessage(error) || "Failed to update config",
      })
    } finally {
      this.pending--
    }
  }

  /**
   * Handle sending a message from the webview.
   * Uses promptAsync (fire-and-forget) — the server queues concurrent prompts
   * internally, so the client doesn't need to block on busy sessions.
   */
  /**
   * Ensure a session exists, creating one if needed. Returns the resolved
   * session ID and workspace directory, or undefined when the client is
   * disconnected.
   */
  private async resolveSession(sessionID?: string): Promise<{ sid: string; dir: string } | undefined> {
    if (!this.client) return undefined

    const dir = this.getWorkspaceDirectory(sessionID || this.currentSession?.id)

    if (!sessionID && !this.currentSession) {
      const { data: session } = await this.client.session.create({ directory: dir }, { throwOnError: true })
      this.currentSession = session
      this.trackedSessionIds.add(session.id)
      this.postMessage({
        type: "sessionCreated",
        session: this.sessionToWebview(session),
      })
    }

    const sid = sessionID || this.currentSession?.id
    if (!sid) throw new Error("No session available")
    this.trackedSessionIds.add(sid)
    return { sid, dir }
  }

  private async handleSendMessage(
    text: string,
    messageID?: string,
    sessionID?: string,
    providerID?: string,
    modelID?: string,
    agent?: string,
    variant?: string,
    files?: Array<{ mime: string; url: string }>,
  ): Promise<void> {
    if (!this.client) {
      this.postMessage({
        type: "sendMessageFailed",
        error: "Not connected to CLI backend",
        text,
        sessionID,
        messageID,
        files,
      })
      return
    }

    let resolved: { sid: string; dir: string } | undefined
    try {
      resolved = await this.resolveSession(sessionID)

      const parts: Array<TextPartInput | FilePartInput> = []
      if (files) {
        for (const f of files) {
          parts.push({ type: "file", mime: f.mime, url: f.url })
        }
      }
      parts.push({ type: "text", text })

      const editorContext = await this.gatherEditorContext()

      if (messageID) {
        this.connectionService.recordMessageSessionId(messageID, resolved!.sid)
      }

      await this.client.session.promptAsync(
        {
          sessionID: resolved!.sid,
          directory: resolved!.dir,
          messageID,
          parts,
          model: providerID && modelID ? { providerID, modelID } : undefined,
          agent,
          variant,
          editorContext,
        },
        { throwOnError: true },
      )
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to send message:", error)
      this.postMessage({
        type: "sendMessageFailed",
        error: getErrorMessage(error) || "Failed to send message",
        text,
        sessionID: resolved?.sid ?? sessionID,
        messageID,
        files,
      })
    }
  }

  private async handleSendCommand(
    command: string,
    args: string,
    messageID?: string,
    sessionID?: string,
    providerID?: string,
    modelID?: string,
    agent?: string,
    variant?: string,
    files?: Array<{ mime: string; url: string }>,
  ): Promise<void> {
    if (!this.client) {
      this.postMessage({
        type: "sendMessageFailed",
        error: "Not connected to CLI backend",
        text: `/${command} ${args}`.trim(),
        sessionID,
        messageID,
        files,
      })
      return
    }

    let resolved: { sid: string; dir: string } | undefined
    try {
      resolved = await this.resolveSession(sessionID)

      if (messageID) {
        this.connectionService.recordMessageSessionId(messageID, resolved!.sid)
      }

      const parts = files?.map((f) => ({ type: "file" as const, mime: f.mime, url: f.url }))

      await this.client.session.command(
        {
          sessionID: resolved!.sid,
          directory: resolved!.dir,
          command,
          arguments: args,
          messageID,
          model: providerID && modelID ? `${providerID}/${modelID}` : undefined,
          agent,
          variant,
          parts,
        },
        { throwOnError: true },
      )
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to send command:", error)
      this.postMessage({
        type: "sendMessageFailed",
        error: getErrorMessage(error) || "Failed to send command",
        text: `/${command} ${args}`.trim(),
        sessionID: resolved?.sid ?? sessionID,
        messageID,
        files,
      })
    }
  }

  /**
   * Handle abort request from the webview.
   */
  private async handleAbort(sessionID?: string): Promise<void> {
    if (!this.client) {
      return
    }

    const targetSessionID = sessionID || this.currentSession?.id
    if (!targetSessionID) {
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(targetSessionID)
      await this.client.session.abort({ sessionID: targetSessionID, directory: workspaceDir }, { throwOnError: true })
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to abort session:", error)
    }
  }

  private async handleRevertSession(sessionID: string, messageID: string): Promise<void> {
    if (!this.client) return
    const dir = this.getWorkspaceDirectory(sessionID)
    const { data, error } = await this.client.session.revert({ sessionID, messageID, directory: dir })
    if (error) {
      console.error("[Kilo New] KiloProvider: Failed to revert session:", error)
      this.postMessage({ type: "error", message: "Failed to revert session", sessionID })
      return
    }
    if (data) this.postMessage({ type: "sessionUpdated", session: sessionToWebview(data) })
  }

  private async handleUnrevertSession(sessionID: string): Promise<void> {
    if (!this.client) return
    const dir = this.getWorkspaceDirectory(sessionID)
    const { data, error } = await this.client.session.unrevert({ sessionID, directory: dir })
    if (error) {
      console.error("[Kilo New] KiloProvider: Failed to unrevert session:", error)
      this.postMessage({ type: "error", message: "Failed to redo session", sessionID })
      return
    }
    if (data) this.postMessage({ type: "sessionUpdated", session: sessionToWebview(data) })
  }

  /**
   * Handle compact (context summarization) request from the webview.
   */
  private async handleCompact(sessionID?: string, providerID?: string, modelID?: string): Promise<void> {
    if (!this.client) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    const target = sessionID || this.currentSession?.id
    if (!target) {
      console.error("[Kilo New] KiloProvider: No sessionID for compact")
      return
    }

    if (!providerID || !modelID) {
      console.error("[Kilo New] KiloProvider: No model selected for compact")
      this.postMessage({
        type: "error",
        message: "No model selected. Connect a provider to compact this session.",
      })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(target)
      await this.client.session.summarize(
        { sessionID: target, directory: workspaceDir, providerID, modelID },
        { throwOnError: true },
      )
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to compact session:", error)
      this.postMessage({
        type: "error",
        message: getErrorMessage(error) || "Failed to compact session",
      })
    }
  }

  /**
   * Handle permission response from the webview.
   * Calls saveAlwaysRules first (if any), then reply — sequentially to avoid races.
   */
  private async handlePermissionResponse(
    permissionId: string,
    sessionID: string,
    response: "once" | "always" | "reject",
    approvedAlways: string[],
    deniedAlways: string[],
  ): Promise<void> {
    if (!this.client) {
      this.postMessage({ type: "permissionError", permissionID: permissionId })
      return
    }

    const targetSessionID = sessionID || this.currentSession?.id
    if (!targetSessionID) {
      console.error("[Kilo New] KiloProvider: No sessionID for permission response")
      this.postMessage({ type: "permissionError", permissionID: permissionId })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(targetSessionID)

      // Save per-pattern rules before replying (reply deletes the pending request)
      if (approvedAlways.length > 0 || deniedAlways.length > 0) {
        await this.client.permission.saveAlwaysRules(
          {
            requestID: permissionId,
            directory: workspaceDir,
            approvedAlways,
            deniedAlways,
          },
          { throwOnError: true },
        )
      }

      await this.client.permission.reply(
        { requestID: permissionId, reply: response, directory: workspaceDir },
        { throwOnError: true },
      )
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to respond to permission:", error)
      this.postMessage({ type: "permissionError", permissionID: permissionId })
    }
  }

  /**
   * Fetch all pending permissions from the backend and forward any that belong
   * to tracked sessions to the webview. Called after SSE reconnects and after
   * loading messages for a session so that missed permission.asked events are
   * recovered instead of leaving the server blocked indefinitely.
   */
  private async fetchAndSendPendingPermissions(): Promise<void> {
    if (!this.client) return
    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const { data } = await this.client.permission.list({ directory: workspaceDir })
      if (!data) return
      for (const perm of data) {
        if (!this.trackedSessionIds.has(perm.sessionID)) continue
        this.postMessage({
          type: "permissionRequest",
          permission: {
            id: perm.id,
            sessionID: perm.sessionID,
            toolName: perm.permission,
            patterns: perm.patterns,
            always: perm.always,
            args: perm.metadata,
            message: `Permission required: ${perm.permission}`,
            tool: perm.tool,
          },
        })
      }
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch pending permissions:", error)
    }
  }

  /**
   * Handle question reply from the webview.
   */
  private async handleQuestionReply(requestID: string, answers: string[][]): Promise<void> {
    if (!this.client) {
      this.postMessage({ type: "questionError", requestID })
      return
    }

    try {
      await this.client.question.reply(
        { requestID, answers, directory: this.getWorkspaceDirectory(this.currentSession?.id) },
        { throwOnError: true },
      )
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to reply to question:", error)
      this.postMessage({ type: "questionError", requestID })
    }
  }

  /**
   * Handle question reject (dismiss) from the webview.
   */
  private async handleQuestionReject(requestID: string): Promise<void> {
    if (!this.client) {
      this.postMessage({ type: "questionError", requestID })
      return
    }

    try {
      await this.client.question.reject(
        { requestID, directory: this.getWorkspaceDirectory(this.currentSession?.id) },
        { throwOnError: true },
      )
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to reject question:", error)
      this.postMessage({ type: "questionError", requestID })
    }
  }

  /**
   * Handle login request from the webview.
   * Uses the provider OAuth flow: authorize → open browser → callback (polls until complete).
   * Sends device auth messages so the webview can display a QR code, verification code, and timer.
   */
  private async handleLogin(): Promise<void> {
    if (!this.client) {
      return
    }

    const attempt = ++this.loginAttempt

    console.log("[Kilo New] KiloProvider: 🔐 Starting login flow...")

    try {
      const workspaceDir = this.getWorkspaceDirectory()

      // Step 1: Initiate OAuth authorization
      const { data: auth } = await this.client.provider.oauth.authorize(
        { providerID: "kilo", method: 0, directory: workspaceDir },
        { throwOnError: true },
      )
      console.log("[Kilo New] KiloProvider: 🔐 Got auth URL:", auth.url)

      // Parse code from instructions (format: "Open URL and enter code: ABCD-1234")
      const codeMatch = auth.instructions?.match(/code:\s*(\S+)/i)
      const code = codeMatch ? codeMatch[1] : undefined

      // The backend already opens the browser via the `open` npm package during
      // authorize(). Calling vscode.env.openExternal() here would show a VS Code
      // trust dialog that persists after the user completes authentication in the
      // browser, and would open a second browser tab. The DeviceAuthCard webview
      // provides an "Open Browser" button as a user-initiated fallback.

      // Send device auth details to webview
      this.postMessage({
        type: "deviceAuthStarted",
        code,
        verificationUrl: auth.url,
        expiresIn: 900, // 15 minutes default
      })

      // Step 3: Wait for callback (blocks until polling completes)
      await this.client.provider.oauth.callback(
        { providerID: "kilo", method: 0, directory: workspaceDir },
        { throwOnError: true },
      )

      // Check if this attempt was cancelled
      if (attempt !== this.loginAttempt) {
        return
      }

      console.log("[Kilo New] KiloProvider: 🔐 Login successful")

      await this.client.global
        .dispose()
        .catch((e: unknown) => console.warn("[Kilo New] KiloProvider: global.dispose() after login failed:", e))

      // Step 4: Fetch profile and push to webview
      const { data: profileData } = await this.client.kilo.profile(undefined, { throwOnError: true })
      this.postMessage({ type: "profileData", data: profileData })
      this.postMessage({ type: "deviceAuthComplete" })

      // Step 5: If user has organizations, navigate to profile view so they can pick one
      if (profileData?.profile?.organizations && profileData.profile.organizations.length > 0) {
        this.postMessage({ type: "navigate", view: "profile" })
      }
    } catch (error) {
      if (attempt !== this.loginAttempt) {
        return
      }
      this.postMessage({
        type: "deviceAuthFailed",
        error: getErrorMessage(error) || "Login failed",
      })
    }
  }

  /**
   * Handle organization switch request from the webview.
   * Persists the selection and refreshes profile + providers since both change with org context.
   */
  private async handleSetOrganization(organizationId: string | null): Promise<void> {
    const sdkClient = this.client
    if (!sdkClient) {
      return
    }

    console.log("[Kilo New] KiloProvider: Switching organization:", organizationId ?? "personal")
    try {
      await sdkClient.kilo.organization.set({ organizationId }, { throwOnError: true })
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to switch organization:", error)
      // Re-fetch current profile to reset webview state (clears switching indicator) — best-effort
      try {
        const profileResult = await sdkClient.kilo.profile()
        this.postMessage({ type: "profileData", data: profileResult.data ?? null })
      } catch (profileError) {
        console.error("[Kilo New] KiloProvider: Failed to refresh profile after org switch error:", profileError)
      }
      return
    }

    await this.client.global
      .dispose()
      .catch((e: unknown) => console.warn("[Kilo New] KiloProvider: global.dispose() after org switch failed:", e))

    // Org switch succeeded — refresh profile and providers independently (best-effort)
    try {
      const profileResult = await sdkClient.kilo.profile()
      this.postMessage({ type: "profileData", data: profileResult.data ?? null })
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to refresh profile after org switch:", error)
    }
    try {
      await this.fetchAndSendProviders()
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to refresh providers after org switch:", error)
    }
  }

  private handlePreviewImage(dataUrl: string, filename: string): void {
    const dir = this.extensionContext?.globalStorageUri
    if (!dir) return

    const img = parseImage(dataUrl, filename)
    if (!img) return

    const root = vscode.Uri.joinPath(dir, getPreviewDir())
    const uri = vscode.Uri.joinPath(dir, buildPreviewPath(img.name, Date.now()))
    const clean = () =>
      vscode.workspace.fs.readDirectory(root).then(
        (items) => {
          const stale = trimEntries(items.map(([name]) => ({ path: name })))
          return Promise.all(
            stale.map((name) =>
              Promise.resolve(vscode.workspace.fs.delete(vscode.Uri.joinPath(root, name), { recursive: true })).then(
                undefined,
                (err: unknown) => {
                  console.warn("[Kilo New] KiloProvider: Failed to delete stale preview:", err)
                },
              ),
            ),
          )
        },
        () => [],
      )
    const open = () =>
      vscode.commands
        .executeCommand(...getPreviewCommand(uri))
        .then(undefined, () => vscode.commands.executeCommand("vscode.open", uri))

    void vscode.workspace.fs
      .createDirectory(root)
      .then(() => vscode.workspace.fs.writeFile(uri, img.data))
      .then(() => clean())
      .then(open, (err) => console.error("[Kilo New] KiloProvider: Failed to preview image:", err))
  }

  /**
   * Handle openFile request from the webview — open a file in the VS Code editor.
   * Resolves relative paths against the current session's directory (which may be
   * a worktree path registered via setSessionDirectory), falling back to workspace root.
   * Absolute paths (Unix `/…` or Windows `C:\…`) are used as-is.
   */
  private handleOpenFile(filePath: string, line?: number, column?: number): void {
    const uri = isAbsolutePath(filePath)
      ? vscode.Uri.file(filePath)
      : vscode.Uri.joinPath(vscode.Uri.file(this.getWorkspaceDirectory(this.currentSession?.id)), filePath)
    vscode.workspace.openTextDocument(uri).then(
      (doc) => {
        const options: vscode.TextDocumentShowOptions = { preview: true }
        if (line !== undefined && line > 0) {
          const col = column !== undefined && column > 0 ? column - 1 : 0
          const pos = new vscode.Position(line - 1, col)
          options.selection = new vscode.Range(pos, pos)
        }
        vscode.window.showTextDocument(doc, options)
      },
      (err) => console.error("[Kilo New] KiloProvider: Failed to open file:", uri.fsPath, err),
    )
  }

  /**
   * Handle logout request from the webview.
   */
  private async handleLogout(): Promise<void> {
    if (!this.client) {
      return
    }

    try {
      console.log("[Kilo New] KiloProvider: 🚪 Logging out...")
      await this.client.auth.remove({ providerID: "kilo" }, { throwOnError: true })
      console.log("[Kilo New] KiloProvider: 🚪 Logged out successfully")
      this.postMessage({
        type: "profileData",
        data: null,
      })

      await this.client.global
        .dispose()
        .catch((e: unknown) => console.warn("[Kilo New] KiloProvider: global.dispose() after logout failed:", e))
    } catch (error) {
      console.error("[Kilo New] KiloProvider: ❌ Logout failed:", error)
      this.postMessage({
        type: "error",
        message: getErrorMessage(error) || "Failed to logout",
      })
    }
  }

  /**
   * Handle profile refresh request from the webview.
   */
  private async handleRefreshProfile(): Promise<void> {
    if (!this.client) {
      return
    }

    console.log("[Kilo New] KiloProvider: 🔄 Refreshing profile...")
    const profileResult = await this.client.kilo.profile().catch(() => ({ data: null }))
    this.postMessage({
      type: "profileData",
      data: profileResult.data ?? null,
    })
  }

  /**
   * Handle a generic setting update from the webview.
   * The key uses dot notation relative to `kilo-code.new` (e.g. "browserAutomation.enabled").
   */
  private async handleUpdateSetting(key: string, value: unknown): Promise<void> {
    const { section, leaf } = buildSettingPath(key)
    const config = vscode.workspace.getConfiguration(`kilo-code.new${section ? `.${section}` : ""}`)
    await config.update(leaf, value, vscode.ConfigurationTarget.Global)
  }

  /**
   * Reset all "kilo-code.new.*" extension settings to their defaults by reading
   * contributes.configuration from the extension's package.json at runtime.
   * Only resets settings under the "kilo-code.new." namespace to avoid touching
   * settings from the previous version of the extension which shares the same
   * extension ID and "kilo-code.*" namespace.
   */
  private async handleResetAllSettings(): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
      "Reset all Kilo Code extension settings to defaults?",
      { modal: true },
      "Reset",
    )
    if (confirmed !== "Reset") return

    const prefix = "kilo-code.new."
    const ext = vscode.extensions.getExtension("kilocode.kilo-code")
    const properties = ext?.packageJSON?.contributes?.configuration?.properties as Record<string, unknown> | undefined
    if (!properties) return

    for (const key of Object.keys(properties)) {
      if (!key.startsWith(prefix)) continue
      const parts = key.split(".")
      const section = parts.slice(0, -1).join(".")
      const leaf = parts[parts.length - 1]
      const config = vscode.workspace.getConfiguration(section)
      await config.update(leaf, undefined, vscode.ConfigurationTarget.Global)
    }

    // Re-send all settings to the webview so the UI reflects the reset
    this.sendAutocompleteSettings()
    this.sendBrowserSettings()
    this.sendNotificationSettings()
  }

  /**
   * Read the current browser automation settings and push them to the webview.
   */
  private sendBrowserSettings(): void {
    const config = vscode.workspace.getConfiguration("kilo-code.new.browserAutomation")
    this.postMessage({
      type: "browserSettingsLoaded",
      settings: {
        enabled: config.get<boolean>("enabled", false),
        useSystemChrome: config.get<boolean>("useSystemChrome", true),
        headless: config.get<boolean>("headless", false),
      },
    })
  }

  /**
   * Extract sessionID from an SSE event, if applicable.
   * Returns undefined for global events (server.connected, server.heartbeat).
   */
  private extractSessionID(event: Event): string | undefined {
    return this.connectionService.resolveEventSessionId(event)
  }

  /**
   * Re-fetch all server-side state after an auth change (login/logout/org switch).
   * After instance.dispose() clears the server cache, the next request to each
   * endpoint will re-initialize with the current auth state.
   * This mirrors the TUI's sync.bootstrap() pattern.
   */
  private async reloadAfterAuthChange(): Promise<void> {
    await Promise.all([
      this.fetchAndSendProviders(),
      this.fetchAndSendAgents(),
      this.fetchAndSendSkills(),
      this.fetchAndSendCommands(),
      this.fetchAndSendConfig(),
      this.fetchAndSendNotifications(),
    ])
  }

  /**
   * Handle SSE events from the CLI backend.
   * Filters events by project ID and tracked session IDs so each webview only sees its own sessions.
   */
  private handleEvent(event: Event): void {
    // Drop session events from other projects before any tracking logic.
    // This must come first: the trackedSessionIds guard below would otherwise
    // let a foreign session through if it was accidentally tracked.
    if (isEventFromForeignProject(event, this.projectID)) return

    // session.status events pass the onEventFiltered pre-filter for all providers (see line 842),
    // so this runs on every KiloProvider instance — including the Settings panel which has no
    // tracked sessions. Update sessionStatusMap and forward to webview before the
    // trackedSessionIds guard so the Settings panel's allStatusMap stays current for the
    // busy-session warning on Save.
    if (event.type === "session.status") {
      const sid = event.properties.sessionID
      this.sessionStatusMap.set(sid, event.properties.status.type)
      const msg = mapSSEEventToWebviewMessage(event, sid)
      if (msg) this.postMessage(msg)
      return
    }

    // Extract sessionID from the event
    const sessionID = this.extractSessionID(event)

    // Events without sessionID (server.connected, server.heartbeat) → always forward
    // Events with sessionID → only forward if this webview tracks that session
    // message.part.updated and message.part.delta are always session-scoped; drop if session unknown.
    if (!sessionID && (event.type === "message.part.updated" || event.type === "message.part.delta")) {
      return
    }
    if (sessionID && !this.trackedSessionIds.has(sessionID)) {
      return
    }

    // Refresh provider and agent lists when the server signals a state disposal
    if (event.type === "server.instance.disposed" || event.type === "global.disposed") {
      void this.reloadAfterAuthChange()
      return
    }

    // Config was updated without a full dispose (e.g. permission-only save).
    // Fetch and push the updated config so the Settings panel reflects the change.
    if (event.type === "global.config.updated") {
      void this.fetchAndSendConfigUpdated()
      return
    }

    // Forward relevant events to webview
    // Side effects that must happen before the webview message is sent
    if (event.type === "session.created" && !this.currentSession) {
      this.currentSession = event.properties.info
      this.trackedSessionIds.add(event.properties.info.id)
    }
    if (event.type === "session.updated" && this.currentSession?.id === event.properties.info.id) {
      this.currentSession = event.properties.info
    }

    const msg = mapSSEEventToWebviewMessage(event, sessionID)
    if (msg) {
      if (msg.type === "partUpdated") {
        this.postMessage({
          ...msg,
          part: this.slimPart(msg.part),
        })
        return
      }
      this.postMessage(msg)
    }
  }

  /**
   * Read autocomplete settings from VS Code configuration and push to the webview.
   */
  private sendAutocompleteSettings(): void {
    const config = vscode.workspace.getConfiguration("kilo-code.new.autocomplete")
    this.postMessage({
      type: "autocompleteSettingsLoaded",
      settings: {
        enableAutoTrigger: config.get<boolean>("enableAutoTrigger", true),
        enableSmartInlineTaskKeybinding: config.get<boolean>("enableSmartInlineTaskKeybinding", false),
        enableChatAutocomplete: config.get<boolean>("enableChatAutocomplete", false),
      },
    })
  }

  /**
   * Post a message to the webview.
   * Public so toolbar button commands can send messages.
   */
  public postMessage(message: unknown): void {
    if (!this.webview) {
      const type =
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        typeof (message as { type?: unknown }).type === "string"
          ? (message as { type: string }).type
          : "<unknown>"
      console.warn("[Kilo New] KiloProvider: ⚠️ postMessage dropped (no webview)", { type })
      return
    }

    void this.webview.postMessage(message).then(undefined, (error) => {
      console.error("[Kilo New] KiloProvider: ❌ postMessage failed", error)
    })
  }

  public async appendReviewComments(comments: unknown[]): Promise<void> {
    this.pendingReviewComments.push(comments)

    if (!this.webview) {
      await vscode.commands.executeCommand(`${KiloProvider.viewType}.focus`)
    }

    this.flushPendingReviewComments()
  }

  private flushPendingReviewComments(): void {
    if (!this.webview || !this.isWebviewReady || this.pendingReviewComments.length === 0) return

    const pending = this.pendingReviewComments
    this.pendingReviewComments = []

    for (const comments of pending) {
      this.postMessage({ type: "appendReviewComments", comments })
    }
  }

  /**
   * Get the git remote URL for the current workspace using VS Code's built-in Git API.
   * Returns undefined if not in a git repo or no remotes are configured.
   */
  private async getGitRemoteUrl(): Promise<string | undefined> {
    try {
      const extension = vscode.extensions.getExtension("vscode.git")
      if (!extension) return undefined
      const api = extension.isActive ? extension.exports?.getAPI(1) : (await extension.activate())?.getAPI(1)
      if (!api) return undefined
      const repo = api.repositories?.[0]
      if (!repo) return undefined
      const remote = repo.state?.remotes?.find((r: { name: string }) => r.name === "origin")
      return remote?.fetchUrl ?? remote?.pushUrl
    } catch (error) {
      console.warn("[Kilo New] KiloProvider: Failed to get git remote URL:", error)
      return undefined
    }
  }

  /**
   * Gather VS Code editor context to send alongside messages to the CLI backend.
   */
  /**
   * Return the set of relative paths for all open text-editor tabs within the
   * given directory, filtered through .kilocodeignore.
   */
  private async getOpenTabPaths(dir: string): Promise<Set<string>> {
    const controller = await this.getIgnoreController(dir)
    const result = new Set<string>()
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputText) {
          const uri = tab.input.uri
          if (uri.scheme === "file") {
            const rel = path.relative(dir, uri.fsPath)
            if (!rel.startsWith("..") && controller.validateAccess(uri.fsPath)) {
              result.add(rel.replaceAll("\\", "/"))
            }
          }
        }
      }
    }
    return result
  }

  /**
   * Get or create a FileIgnoreController for the current workspace directory.
   * Reinitializes if the workspace directory has changed.
   */
  private async getIgnoreController(workspaceDir: string): Promise<FileIgnoreController> {
    if (this.ignoreController && this.ignoreControllerDir === workspaceDir) {
      return this.ignoreController
    }
    const controller = new FileIgnoreController(workspaceDir)
    await controller.initialize()
    this.ignoreController = controller
    this.ignoreControllerDir = workspaceDir
    return controller
  }

  private async gatherEditorContext(): Promise<EditorContext> {
    const workspaceDir = this.getWorkspaceDirectory()
    const controller = await this.getIgnoreController(workspaceDir)

    const toRelative = (fsPath: string): string | undefined => {
      if (!workspaceDir) {
        return undefined
      }
      const relative = path.relative(workspaceDir, fsPath)
      if (relative.startsWith("..")) {
        return undefined
      }
      return relative
    }

    // Visible files (capped to avoid bloating context, filtered through .kilocodeignore)
    const visibleFiles = vscode.window.visibleTextEditors
      .map((e) => e.document.uri)
      .filter((uri) => uri.scheme === "file")
      .map((uri) => toRelative(uri.fsPath))
      .filter((p): p is string => p !== undefined && controller.validateAccess(path.resolve(workspaceDir, p)))
      .slice(0, 200)

    // Open tabs — use instanceof TabInputText to exclude notebooks, diffs, custom editors
    const openTabs = [...(await this.getOpenTabPaths(workspaceDir))].slice(0, 20)

    // Active file (also filtered through .kilocodeignore)
    const activeEditor = vscode.window.activeTextEditor
    const activeRel =
      activeEditor?.document.uri.scheme === "file" ? toRelative(activeEditor.document.uri.fsPath) : undefined
    const activeFile = activeRel && controller.validateAccess(activeEditor!.document.uri.fsPath) ? activeRel : undefined

    // Shell
    const shell = vscode.env.shell || undefined

    return {
      ...(visibleFiles.length > 0 ? { visibleFiles } : {}),
      ...(openTabs.length > 0 ? { openTabs } : {}),
      ...(activeFile ? { activeFile } : {}),
      ...(shell ? { shell } : {}),
    }
  }

  /**
   * Get the workspace directory for a session.
   * Checks session directory overrides first (e.g., worktree paths), then falls back to workspace root.
   */
  private getWorkspaceDirectory(sessionId?: string): string {
    if (sessionId) {
      const dir = this.sessionDirectories.get(sessionId)
      if (dir) return dir
    }
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (workspaceFolders && workspaceFolders.length > 0) {
      return workspaceFolders[0].uri.fsPath
    }
    return process.cwd()
  }

  private getProjectDirectory(sessionId?: string): string | undefined {
    return resolveProjectDirectory(this.projectDirectory, () => this.getWorkspaceDirectory(sessionId))
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, {
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js")),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.css")),
      iconsBaseUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      title: "Kilo Code",
      port: this.connectionService.getServerInfo()?.port,
      extraStyles: `.container { height: 100%; display: flex; flex-direction: column; height: 100vh; border-right: 1px solid var(--border-weak-base); }`,
    })
  }

  // legacy-migration start -------------------------------------------------------

  /**
   * Checks for legacy data on first run and auto-navigates to the migration wizard
   * if the user has not yet been prompted.
   */
  private async checkAndShowMigrationWizard(): Promise<void> {
    if (!this.extensionContext) return
    if (this.migrationCheckInFlight) return
    const status = MigrationService.getMigrationStatus(this.extensionContext)
    if (status) return // already prompted (skipped or completed)

    this.migrationCheckInFlight = true
    const data = await MigrationService.detectLegacyData(this.extensionContext)
    this.migrationCheckInFlight = false

    if (!data.hasData) return

    // Cache so migrate() doesn't re-read from SecretStorage/disk
    this.cachedLegacyData = data

    console.log("[Kilo New] KiloProvider: 🔄 Legacy data detected, showing migration wizard")
    this.postMessage({ type: "navigate", view: "migration" })
    this.postMessage({
      type: "legacyMigrationData",
      data: {
        providers: data.providers,
        mcpServers: data.mcpServers,
        customModes: data.customModes,
        defaultModel: data.defaultModel,
        settings: data.settings,
      },
    })
  }

  /** Sends the detected legacy data to the webview on explicit request. */
  private async handleRequestLegacyMigrationData(): Promise<void> {
    if (!this.extensionContext) return
    const data = await MigrationService.detectLegacyData(this.extensionContext)
    // Cache so migrate() doesn't re-read from SecretStorage/disk
    this.cachedLegacyData = data
    this.postMessage({
      type: "legacyMigrationData",
      data: {
        providers: data.providers,
        mcpServers: data.mcpServers,
        customModes: data.customModes,
        defaultModel: data.defaultModel,
        settings: data.settings,
      },
    })
  }

  /** Runs the migration for the selected items. */
  private async handleStartLegacyMigration(
    selections: import("./legacy-migration/legacy-types").MigrationSelections,
  ): Promise<void> {
    if (!this.extensionContext || !this.client) return
    try {
      const results = await MigrationService.migrate(
        this.extensionContext,
        this.client,
        selections,
        (item, status, message) => {
          this.postMessage({ type: "legacyMigrationProgress", item, status, message })
        },
        this.cachedLegacyData?.settings,
      )

      // Dispose all instances after migration
      // Reloading the data will be handled once the server replies with a global.disposed event
      await this.client.global
        .dispose()
        .catch((e: unknown) => console.warn("[Kilo New] KiloProvider: global.dispose() after migration failed:", e))

      // Only mark as completed if at least one item succeeded — if everything failed
      // the user can still re-run migration via Settings → About.
      const anySuccess = results.some((r) => r.status === "success")

      if (anySuccess) {
        await MigrationService.setMigrationStatus(this.extensionContext, "completed")
      }

      this.postMessage({ type: "legacyMigrationComplete", results })
    } catch (error) {
      console.error("[Kilo New] KiloProvider: ❌ Migration failed", error)
      this.postMessage({
        type: "legacyMigrationComplete",
        results: [
          {
            item: "Migration",
            category: "settings",
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      })
    }
  }

  /** Records that the user skipped migration. */
  private async handleSkipLegacyMigration(): Promise<void> {
    if (!this.extensionContext) return
    await MigrationService.setMigrationStatus(this.extensionContext, "skipped")
  }

  /** Clears legacy data from SecretStorage and globalState after user opts in. */
  private async handleClearLegacyData(): Promise<void> {
    if (!this.extensionContext) return
    await MigrationService.clearLegacyData(this.extensionContext)
  }

  // legacy-migration end ---------------------------------------------------------

  private getMarketplace(): MarketplaceService {
    if (this.marketplace) return this.marketplace
    this.marketplace = new MarketplaceService()
    return this.marketplace
  }

  /**
   * Dispose of the provider and clean up subscriptions.
   * Does NOT kill the server — that's the connection service's job.
   */
  dispose(): void {
    this.unsubscribeEvent?.()
    this.unsubscribeState?.()
    this.unsubscribeNotificationDismiss?.()
    this.webviewMessageDisposable?.dispose()
    this.trackedSessionIds.clear()
    this.syncedChildSessions.clear()
    this.sessionDirectories.clear()
    this.sessionStatusMap.clear()
    this.ignoreController?.dispose()
    this.marketplace?.dispose()
  }
}
