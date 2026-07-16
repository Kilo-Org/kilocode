import * as path from "path"
import * as vscode from "vscode"
import type {
  KiloClient,
  Session,
  SessionStatus,
  Event,
  GlobalEvent,
  TextPartInput,
  FilePartInput,
  Config,
} from "@kilocode/sdk/v2/client"
import { MaxCostNudge, type MaxCostChoice } from "@opencode-ai/core/kilocode/cost/max-cost-nudge"
import { type KiloConnectionService, ServerStartupError } from "./services/cli-backend"
import { previewSound } from "./services/attention"
import type { EditorContext, IndexingStatus } from "./services/cli-backend/types"
import { FileIgnoreController } from "./services/autocomplete/shims/FileIgnoreController"
import { ChatTextAreaAutocomplete } from "./services/autocomplete/chat-autocomplete/ChatTextAreaAutocomplete"
import { notebookUri } from "./services/autocomplete/continuedev/core/autocomplete/notebook"
import { buildWebviewHtml, getWebviewFontSize } from "./utils"
import { saveImage } from "./kilo-provider/save-image"
import { handleEditorAction } from "./kilo-provider/editor-actions"
import { exportTranscript } from "./kilo-provider/export-transcript"
import {
  TelemetryProxy,
  type TelemetryPropertiesProvider,
  pushTelemetryState,
  watchTelemetryState,
} from "./services/telemetry"
import {
  sessionToWebview,
  applySessionPatch,
  sessionPatchToWebview,
  indexProvidersById,
  filterVisibleAgents,
  mapSSEEventToWebviewMessage,
  getErrorMessage,
  getConfigErrorDetails,
  isEventFromForeignProject,
  MessageConfirmation,
  runWithMessageConfirmation,
  loadSessions as loadSessionsUtil,
  flushPendingSessionRefresh as flushPendingSessionRefreshUtil,
  resolveContextDirectory,
  resolveNewSessionDirectory,
  resolveWorkspaceDirectory,
  sameDirectory,
  SessionStreamScheduler,
  buildSettingPath,
  type SessionRefreshContext,
  shouldClearRevertForMessage,
} from "./kilo-provider-utils"
import { GitOps } from "./agent-manager/GitOps"
import { GitStatsPoller, type LocalStats } from "./agent-manager/GitStatsPoller"
import { diffSummary as localDiffSummary } from "./agent-manager/local-diff"
import { getWorkspaceRoot } from "./review-utils"
import { createMarketplaceRemover, removeMcp } from "./kilo-provider/remove-config-item"
import { AgentRequirementsController } from "./kilo-provider/agent-requirements-controller"
import type { RemoteStatusService } from "./services/RemoteStatusService"
import { resolveProjectDirectory } from "./project-directory"
import { seedSessionStatuses } from "./session-status"
import { normalizeEnhancePromptErrorMessage } from "./enhance-prompt-error"
import { retry } from "./services/cli-backend/retry"
import { slimInfo, slimPart, slimParts } from "./kilo-provider/slim-metadata"
import { handleSidebarWorktreeMessage } from "./kilo-provider/sidebar-worktree"
import { parseMessageFiles, type MessageFile } from "./kilo-provider/message-files"
import { renameSession } from "./kilo-provider/rename-session"
import { handleFileSearch } from "./kilo-provider/file-search"
import { watchFontSizeConfig } from "./kilo-provider/font-size"
import { getTerminalContents } from "./services/terminal/context"
import { disposeGitChangesTarget } from "./kilo-provider/git-changes-target"
import { interceptMessage } from "./kilo-provider/git-changes-request"
import { matchFollowup, recordFollowup, type Followup } from "./kilo-provider/followup-session"
import { clearCommandsCache, loadCommands } from "./kilo-provider/commands"
import { fetchMessagePage, MESSAGE_PAGE_LIMIT } from "./kilo-provider/message-page"
import {
  dismissNotification,
  fetchAndSendNotifications as fetchNotifications,
  resetReadNotifications,
  type NotificationsContext,
  type NotificationsMessage,
} from "./kilo-provider/notifications"
import { childID } from "./kilo-provider/task-session"
import { VisibleTaskStreams } from "./kilo-provider/visible-task-streams"
import { handleNetworkEvent, clearNetworkWaits } from "./kilo-provider/network"
import { SessionAbort } from "./kilo-provider/abort"
import {
  buildAutocompleteSettingsMessage,
  validAutocompleteSetting,
  watchAutocompleteConfig,
} from "./services/autocomplete/settings"
import { routeEarlyMessage } from "./kilo-provider/early-message"
import * as ModelState from "./kilo-provider/model-state"
import { handleForkSession } from "./kilo-provider/fork-session"
import { openConfig } from "./kilo-provider/open-config"
import {
  getWorkStylePayload,
  handleWorkStyleMessage,
  isWorkStyleSetting,
  watchWorkStyleConfig,
} from "./kilo-provider/work-style"
import * as McpOAuth from "./kilo-provider/mcp-oauth"
import { retryable, backoff, MAX_RETRIES } from "./util/retry"
import { hasGit } from "./kilo-provider/git-status"
// legacy-migration start
import {
  checkAndShowMigrationWizard,
  handleRequestMigrationData,
  handleStartMigration,
  handleFinalizeLegacyMigration,
  handleSkipLegacyMigration,
  handleClearLegacyData,
  type MigrationContext,
} from "./kilo-provider/handlers/migration"
// legacy-migration end
import {
  handleLogin,
  handleLogout,
  handleSetOrganization,
  handleRefreshProfile,
  type AuthContext,
} from "./kilo-provider/handlers/auth"
import {
  handleRequestCloudSessions,
  handleRequestCloudSessionData,
  handleImportAndSend,
  type CloudSessionContext,
} from "./kilo-provider/handlers/cloud-session"
import {
  handlePermissionResponse,
  fetchAndSendPendingPermissions,
  type PermissionContext,
} from "./kilo-provider/handlers/permission-handler"
import {
  handleQuestionReply,
  handleQuestionReject,
  fetchAndSendPendingQuestions,
} from "./kilo-provider/handlers/question"
import { fetchAndSendPendingSuggestions } from "./kilo-provider/handlers/suggestion"
import { nativeTitle } from "./kilo-provider/native-tab-title"
import { parseReview, reviewMetadata, type ReviewMessageData } from "./shared/review-comments"
import { KiloProviderMemory } from "./kilo-provider/memory"

import {
  buildActionContext,
  computeDefaultSelection,
  fetchProviderData,
  validateRecents,
  validateFavorites,
  connectProvider as connectProviderAction,
  authorizeProviderOAuth as authorizeOAuthAction,
  completeProviderOAuth as completeOAuthAction,
  disconnectProvider as disconnectProviderAction,
  saveCustomProvider as saveCustomProviderAction,
  resolveStoredKey,
} from "./provider-actions"
import type { StoredProviderKey } from "./provider-actions"
import { AnacondaDesktopBridge } from "./anaconda-desktop/bridge"
import { fetchOpenAIModels, FetchModelsError } from "./shared/fetch-models"
import type { Agent } from "@kilocode/sdk/v2/client"
import { configFeatures } from "./features"
import { createAutoApproveBridge } from "./kilo-provider/auto-approve"
import type { KiloProviderOptions } from "./kilo-provider/options"
import { fetchKiloEmbeddingModelCatalog } from "@kilocode/kilo-gateway"
import { stopSessionProcesses } from "./kilo-provider/background-process"
import { sandboxDefault, sandboxSessionMetadata } from "./shared/sandbox-session"
import {
  buildIndexingSettingsMessage,
  validIndexingSetting,
  watchIndexingConfig,
} from "./kilo-provider/indexing-settings"

let maxCost = 0

type MessageLoadMode = "replace" | "prepend" | "focus" | "reconcile"
type ContextMessage = { contextDirectory?: unknown }
type TypedWebviewMessage = {
  type: string
  value?: unknown
}
type SandboxSupportClient = {
  support: (
    parameters: { directory?: string },
    options: { throwOnError: true },
  ) => Promise<{ data: { available: boolean; reason?: string } }>
}

function sandboxClient(client: KiloClient | null) {
  const sandbox = client?.sandbox
  return sandbox as (typeof sandbox & SandboxSupportClient) | undefined
}

// Helper to map agent data to the subset of fields sent to the webview
const mapAgent = (a: Agent) => ({
  name: a.name,
  displayName: a.displayName,
  description: a.description,
  mode: a.mode,
  native: a.native,
  hidden: a.hidden,
  color: a.color,
  deprecated: a.deprecated,
  permission: a.permission,
  model: a.model,
})

// message.part.* events are always session-scoped; drop them when the session is unknown.
const SESSION_SCOPED_PART_EVENTS = new Set(["message.part.updated", "message.part.delta", "message.part.removed"])
const isSessionScopedPartEvent = (type: string) => SESSION_SCOPED_PART_EVENTS.has(type)

type SyncPayload = Extract<GlobalEvent["payload"], { type: "sync" }>
type RawSyncPayload = {
  type: "sync"
  syncEvent: {
    type: SyncPayload["name"]
    id: string
    seq: number
    aggregateID: string
    data: unknown
  }
}
type LegacySyncEvent =
  | {
      id: string
      type: "message.updated"
      properties: Extract<SyncPayload, { name: "message.updated.1" }>["data"]
    }
  | {
      id: string
      type: "message.removed"
      properties: Extract<SyncPayload, { name: "message.removed.1" }>["data"]
    }
  | {
      id: string
      type: "message.part.updated"
      properties: Extract<SyncPayload, { name: "message.part.updated.1" }>["data"]
    }
  | {
      id: string
      type: "message.part.removed"
      properties: Extract<SyncPayload, { name: "message.part.removed.1" }>["data"]
    }
  | {
      id: string
      type: "session.created"
      properties: Extract<SyncPayload, { name: "session.created.1" }>["data"]
    }
  | {
      source: "sync"
      id: string
      seq: number
      type: "session.updated"
      properties: Extract<SyncPayload, { name: "session.updated.1" }>["data"]
    }
  | {
      id: string
      type: "session.deleted"
      properties: Extract<SyncPayload, { name: "session.deleted.1" }>["data"]
    }

type FullSessionUpdatedEvent = {
  id: string
  type: "session.updated"
  properties: { sessionID: string; info: Session }
}

type ProviderEvent = Event | LegacySyncEvent | FullSessionUpdatedEvent

function isLegacySyncEvent(event: ProviderEvent): event is LegacySyncEvent {
  if (event.type === "session.updated") return "source" in event && event.source === "sync"
  return (
    event.type === "message.updated" ||
    event.type === "message.removed" ||
    event.type === "message.part.updated" ||
    event.type === "message.part.removed" ||
    event.type === "session.created" ||
    event.type === "session.deleted"
  )
}

function isFullSessionUpdatedEvent(event: ProviderEvent): event is FullSessionUpdatedEvent {
  return event.type === "session.updated" && !isLegacySyncEvent(event)
}

export function unwrapSyncEvent(event: GlobalEvent["payload"] | RawSyncPayload): ProviderEvent | undefined {
  if (event.type !== "sync") return event
  const payload =
    "syncEvent" in event
      ? ({
          type: "sync",
          name: event.syncEvent.type,
          id: event.syncEvent.id,
          seq: event.syncEvent.seq,
          aggregateID: event.syncEvent.aggregateID,
          data: event.syncEvent.data,
        } as SyncPayload)
      : event

  switch (payload.name) {
    case "message.updated.1":
      return { id: payload.id, type: "message.updated", properties: payload.data }
    case "message.removed.1":
      return { id: payload.id, type: "message.removed", properties: payload.data }
    case "message.part.updated.1":
      return { id: payload.id, type: "message.part.updated", properties: payload.data }
    case "message.part.removed.1":
      return { id: payload.id, type: "message.part.removed", properties: payload.data }
    case "session.created.1":
      return { id: payload.id, type: "session.created", properties: payload.data }
    case "session.updated.1":
      return { source: "sync", id: payload.id, seq: payload.seq, type: "session.updated", properties: payload.data }
    case "session.deleted.1":
      return { id: payload.id, type: "session.deleted", properties: payload.data }
    default:
      return undefined
  }
}

export class KiloProvider implements vscode.WebviewViewProvider, TelemetryPropertiesProvider {
  public static readonly viewType = "kilo-code.SidebarProvider"
  private readonly instanceId = crypto.randomUUID()

  private webview: vscode.Webview | null = null
  private currentSession: Session | null = null
  /** Remembers the last selected session so /new can stay in the same worktree after clearSession. */
  private contextSessionID: string | undefined
  private connectionState: "connecting" | "connected" | "disconnected" | "error" = "connecting"
  private connectionGeneration = 0
  private loginAttempt = 0
  private isWebviewReady = false
  private readonly extensionVersion =
    vscode.extensions.getExtension("kilocode.kilo-code")?.packageJSON?.version ?? "unknown"
  private cachedProvidersMessage: unknown = null
  /**
   * Provider API keys retained extension-side for authenticated model
   * fetches (#10139). Keys are stripped before provider data reaches the
   * webview, so fetch requests for an existing provider carry a providerID
   * and the key is resolved here. Refreshed on every provider fetch.
   */
  private storedProviderKeys: Record<string, StoredProviderKey> = {}
  /** Coalesce provider refreshes — at most one follow-up rerun when a request lands mid-flight. */
  private providersRefresh: Promise<void> | null = null
  private providersQueued = false
  private providersGeneration = 0
  private sandboxRevision = 0
  private cachedAgentsMessage: unknown = null
  /** Cached skillsLoaded payload so requestSkills can be served before client is ready */
  private cachedSkillsMessage: unknown = null
  /** Cached commandsLoaded payload so requestCommands can be served before client is ready */
  private cachedCommandsMessage: unknown = null
  /** Cached configLoaded payload so requestConfig can be served before client is ready */
  private cachedConfigMessage: unknown = null
  private cachedGlobalConfig: Config | null = null
  /** Cached indexingStatusLoaded payload so requestIndexingStatus can be served before client is ready */
  private cachedIndexingStatusMessage: unknown = null
  /** Cached kiloEmbeddingModelsLoaded payload so requestKiloEmbeddingModels is resilient offline. */
  private cachedKiloEmbeddingModelsMessage: unknown = null
  /** Cached mcpStatusLoaded payload so requestMcpStatus can be served before client is ready */
  private cachedMcpStatusMessage: unknown = null
  /** Ref-count of in-flight handleUpdateConfig calls; prevents fetchAndSendConfig from sending stale data */
  private pending = 0
  private configWarningsShown = false
  /** Cached notificationsLoaded payload */
  private cachedNotificationsMessage: NotificationsMessage | null = null
  private pendingKiloModel: { modelID?: string; agent?: string } | null = null
  private pendingReviewComments: { comments: unknown[]; autoSend: boolean }[] = []
  private readyResolvers: (() => void)[] = []
  private promptRecoveryQueued = false
  private promptRecovery: Promise<void> | null = null
  private trackedSessionIds: Set<string> = new Set()
  private modelUsageSessionIds: Set<string> = new Set()
  private syncedChildSessions: Set<string> = new Set()
  private readonly checkpoints = new Map<string, Promise<void>>()
  private readonly sessionCreations = new Map<string, Promise<{ sid: string; dir: string }>>()
  private readonly sandboxTransitions = new Map<string, Promise<void>>()
  private readonly revisions = new Map<string, { id: string; seq: number }>()
  private readonly refreshes = new Map<string, number>()
  private readonly anacondaDesktop = new AnacondaDesktopBridge()
  private sessionStatusMap = new Map<string, SessionStatus["type"]>() // Latest status used for destructive config warnings.
  private sessionDirectories = new Map<string, string>() // Per-session directory overrides, such as Agent Manager worktrees.
  private readonly aborts = new SessionAbort()
  private projectID: string | undefined // Current workspace project ID used to filter sessions.
  private loadMessagesAbort: AbortController | null = null // Current load request cancellation.
  private lastReconciledAt = new Map<string, number>() // Per-session focus-mode reconcile timestamp.
  private pendingSessionRefresh = false // Refresh requested before the client is ready.
  private readonly streams = new SessionStreamScheduler((msg) => this.postMessage(msg))
  private readonly visibleTaskStreams = new VisibleTaskStreams((id, visible) => this.streams.setVisible(id, visible))
  private readonly confirmations = new MessageConfirmation()
  private readonly costs = new MaxCostNudge()
  private readonly activeAlerts = new Map<string, number>() // sid -> limit currently shown in UI
  private readonly memory = new KiloProviderMemory({
    client: () => this.client ?? undefined,
    session: () => this.currentSession ?? undefined,
    // Honor disabled project scope (null in a multi-root panel): no workspace fallback,
    // so memory operations never silently target an arbitrary folder.
    dir: (sessionID) => this.getProjectDirectory(sessionID),
    post: (message) => this.postMessage(message),
  })
  private unsubscribeEvent: (() => void) | null = null
  private unsubscribeState: (() => void) | null = null
  /** Cached migration data so migration doesn't re-read from disk/SecretStorage. */ // legacy-migration
  private migrationCache: MigrationContext["migrationCache"] = new Map()
  /** Guard to prevent checkAndShowMigrationWizard running concurrently. */ // legacy-migration
  private migrationCheckInFlight = false // legacy-migration
  private unsubscribeNotificationDismiss: (() => void) | null = null
  private unsubscribeLanguageChange: (() => void) | null = null
  private unsubscribeProfileChange: (() => void) | null = null
  private unsubscribeFavoritesChange: (() => void) | null = null
  private unsubscribeModelSelectorExpanded: (() => void) | null = null
  private unsubscribeMigrationComplete: (() => void) | null = null // legacy-migration
  private unsubscribeClearPendingPrompts: (() => void) | null = null
  private unsubscribeDirectoryProvider: (() => void) | null = null
  private unsubscribeSandboxPreference: (() => void) | null = null
  private initConnectionPromise: Promise<void> | null = null
  private webviewMessageDisposable: vscode.Disposable | null = null
  private autocompleteConfigDisposable: vscode.Disposable | null = null
  private indexingConfigDisposable: vscode.Disposable | null = null
  private telemetryStateDisposable: vscode.Disposable | null = null
  private viewStateDisposable: vscode.Disposable | null = null
  private visibilityDisposable: vscode.Disposable | null = null
  private autoApproveBridge: ReturnType<typeof createAutoApproveBridge> | null = null
  private readonly marketplaceRemove = createMarketplaceRemover()

  private ignoreController: FileIgnoreController | null = null
  private ignoreControllerDir: string | null = null
  private chatAutocomplete: ChatTextAreaAutocomplete | null = null
  private projectDirectory: string | null | undefined
  private slimEditMetadata = true

  private pendingFollowup: Followup | null = null
  private followupListeners: Array<(session: Session, directory: string) => void> = []
  private statsPoller: GitStatsPoller | null = null
  private statsGitOps: GitOps | null = null
  private cachedStats: unknown = null
  private cachedGitRepo = false

  private onBeforeMessage: ((msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>) | null = null

  private continueInWorktreeHandler:
    | ((sessionId: string, progress: (status: string, detail?: string, error?: string) => void) => Promise<void>)
    | null = null

  private createWorktreeHandler: ((baseBranch?: string, branchName?: string) => Promise<void>) | null = null

  private diffVirtualProvider: import("./DiffVirtualProvider").DiffVirtualProvider | undefined
  private remoteService: RemoteStatusService | null = null
  private unsubscribeRemote: (() => void) | null = null
  private readonly requirements: AgentRequirementsController

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: KiloConnectionService,
    private readonly extensionContext?: vscode.ExtensionContext,
    private readonly opts: KiloProviderOptions = {},
  ) {
    this.projectDirectory = opts.projectDirectory
    this.slimEditMetadata = opts.slimEditMetadata ?? true
    this.unsubscribeSandboxPreference = this.connectionService.sandboxPreference?.onChange(() => {
      if (this.connectionState === "connected") void this.fetchAndSendSandboxDefault()
    })
    this.requirements = new AgentRequirementsController({
      post: (msg) => this.postMessage(msg),
      client: () => this.client,
      connected: () => this.connectionState === "connected",
      generation: () => this.connectionGeneration,
      root: () => this.getRootDirectory(),
      folders: () => vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath),
      project: () => this.projectDirectory,
      sessions: () => this.sessionDirectories,
      worktrees: this.opts.worktreeDirectories,
      extension: (id) => vscode.extensions.getExtension(id),
      subscribe:
        typeof vscode.extensions.onDidChange === "function"
          ? (listener) => vscode.extensions.onDidChange(listener)
          : undefined,
      error: getErrorMessage,
    })

    TelemetryProxy.getInstance().setProvider(this)
  }

  setRemoteService(service: RemoteStatusService): void {
    this.remoteService = service
    this.unsubscribeRemote = service.onChange(() => this.sendRemoteStatus())
  }

  setAutoApproveController(ctrl: Parameters<typeof createAutoApproveBridge>[0]): void {
    this.autoApproveBridge?.dispose()
    this.autoApproveBridge = createAutoApproveBridge(ctrl, (msg) => this.postMessage(msg), this.onBeforeMessage)
    this.onBeforeMessage = (msg) => this.autoApproveBridge!.handle(msg)
  }

  private setCurrentSession(session: Session | null): void {
    const ids = new Set([this.currentSession?.id, session?.id])
    for (const id of ids) {
      if (id) this.refreshes.set(id, (this.refreshes.get(id) ?? 0) + 1)
    }
    this.currentSession = session
    this.opts.tabTitle?.(nativeTitle(session))
  }

  private checkpoint(sid: string, run: () => Promise<void>): void {
    const prior = this.checkpoints.get(sid) ?? Promise.resolve()
    const pending = prior.catch(() => undefined).then(run)
    const cleanup = () => {
      if (this.checkpoints.get(sid) === pending) this.checkpoints.delete(sid)
    }
    this.checkpoints.set(sid, pending)
    void pending.then(cleanup, (error) => {
      console.error("[Kilo New] checkpoint mutation failed:", error)
      cleanup()
    })
  }

  private stopCurrentSessionProcesses(next?: string): void {
    const sid = this.contextSessionID ?? this.currentSession?.id
    if (!sid || sid === next) return
    const session = this.currentSession?.id === sid ? this.currentSession : undefined
    void stopSessionProcesses(this.client, sid, this.getSessionDirectory(sid, session))
  }

  private sendRemoteStatus(): void {
    const s = this.remoteService?.getState()
    if (s) this.postMessage({ type: "remoteStatus", enabled: s.enabled, connected: s.connected })
  }
  private focusSession(id?: string): void {
    this.streams.focus(id)
    if (id) this.connectionService.registerFocused(this.instanceId, id)
    else this.connectionService.unregisterFocused(this.instanceId)
  }

  public setStreamVisibility(active: boolean): void {
    this.visibleTaskStreams.setActive(active)
  }

  public setProjectDirectory(directory: string | null): void {
    if (this.projectDirectory === directory) return
    this.projectDirectory = directory
    this.postMessage({ type: "workspaceDirectoryChanged", directory: directory ?? "" })
    this.requirements.clear()
  }

  public setDiffVirtualProvider(provider: import("./DiffVirtualProvider").DiffVirtualProvider): void {
    this.diffVirtualProvider = provider
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

  private postConnectionState(error = this.connectionService.getConnectionError()): void {
    this.postMessage({
      type: "connectionState",
      state: this.connectionState,
      ...(this.connectionState === "error" && {
        error: getErrorMessage(error) || "Connection to CLI backend lost. Retry to reconnect.",
      }),
    })
  }

  private openMarketplacePanel(directory: unknown): void {
    if (typeof directory === "string" && directory) {
      vscode.commands.executeCommand("kilo-code.new.marketplaceButtonClicked", directory)
      return
    }
    vscode.commands.executeCommand("kilo-code.new.marketplaceButtonClicked", this.projectDirectory)
  }

  // Strip metadata unused by the webview to keep session switches fast.
  // Logic in kilo-provider/slim-metadata.ts.
  private slimInfo<T>(info: T): T {
    if (!this.slimEditMetadata) return info
    return slimInfo(info)
  }

  private slimPart<T>(part: T): T {
    if (!this.slimEditMetadata) return part
    return slimPart(part)
  }

  private slimParts<T>(parts: T[]) {
    if (!this.slimEditMetadata) return parts
    return slimParts(parts)
  }

  private get forkCtx() {
    return {
      connection: this.connectionService,
      post: (msg: { type: "error"; message: string }) => this.postMessage(msg),
      register: (session: Session) => this.registerSession(session),
      forked: (session: Session) => this.postMessage({ type: "sessionForked", sessionID: session.id }),
      status: (sessionID: string) => this.sessionStatusMap.get(sessionID),
      directory: (sessionID: string) => this.getWorkspaceDirectory(sessionID),
    }
  }

  private get removeConfigItemCtx() {
    return {
      connection: this.connectionService,
      project: () => this.getProjectDirectory(this.currentSession?.id),
      directory: () => this.getWorkspaceDirectory(),
      remove: this.marketplaceRemove,
      refresh: async () => {
        this.cachedAgentsMessage = null
        this.cachedConfigMessage = null
        await Promise.all([this.fetchAndSendAgents(), this.fetchAndSendConfig()])
        this.requirements.clear()
      },
      storage: this.extensionContext?.globalStorageUri,
    }
  }

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
    this.postConnectionState()
    pushTelemetryState((m) => this.postMessage(m))

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
      const profileResult = await retry(() => this.client!.kilo.profile())
      const profileData = profileResult.data ?? null
      console.log("[Kilo New] KiloProvider: 👤 syncWebviewState profile:", profileData ? "received" : "null")
      this.postMessage({
        type: "profileData",
        data: profileData,
      })

      if (this.currentSession) {
        this.refreshSessionDetails(this.currentSession.id, this.getWorkspaceDirectory(this.currentSession.id))
      }

      // Re-send cached worktree stats and git status after webview reload.
      if (this.cachedStats) this.postMessage(this.cachedStats)
      this.postMessage({ type: "gitStatus", repo: this.cachedGitRepo })

      // Seed session status map so the Settings panel knows about already-running sessions.
      // Must run after webview is ready (postMessage is a no-op before that).
      // Only reconcile (reset missing busy→idle) when the map is empty, i.e.
      // on the very first seed before any real-time SSE events have arrived.
      // On SSE reconnects or webview recreations the live SSE data is
      // authoritative and reconciliation risks race-resetting busy sessions.
      const reconcile = this.sessionStatusMap.size === 0
      void this.seedSessionStatusMap(reconcile)

      this.sendRemoteStatus()
    }

    // legacy-migration start
    // Show the migration wizard once the CLI connection is established.
    // Three triggers cover all timing scenarios:
    //   "webviewReady" + connected — webview loaded after SSE was already up
    //   "sse-connected"            — SSE connected after webview was ready
    //   "initializeConnection"     — sidebar path where connect() resolves before
    //                                onStateChange is subscribed, so sse-connected never fires
    if (this.connectionState === "connected") {
      void checkAndShowMigrationWizard(this.migrationCtx)
    }
    // legacy-migration end
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this.isWebviewReady = false
    this.webview = webviewView.webview

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview)
    this.setupWebviewMessageHandler(webviewView.webview)

    this.setSidebarVisible(webviewView.visible)
    this.visibilityDisposable?.dispose()
    this.visibilityDisposable = webviewView.onDidChangeVisibility(() => {
      this.setSidebarVisible(webviewView.visible)
      if (this.statsPoller) {
        this.statsPoller.setEnabled(webviewView.visible)
        this.statsPoller.setVisible(webviewView.visible)
      }
      this.focusSession(webviewView.visible ? this.contextSessionID : undefined)
    })
    this.initializeConnection()
  }

  private setSidebarVisible(visible: boolean): void {
    this.setStreamVisibility(visible)
    vscode.commands.executeCommand("setContext", "kilo-code.new.sidebarVisible", visible)
  }

  /** Resolve a WebviewPanel for displaying Kilo in an editor tab. */
  public resolveWebviewPanel(panel: vscode.WebviewPanel): void {
    // WebviewPanel can be restored/reloaded; ensure we don't treat it as ready prematurely.
    this.isWebviewReady = false
    this.webview = panel.webview

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    panel.webview.html = this._getHtmlForWebview(panel.webview)

    this.setupWebviewMessageHandler(panel.webview)
    this.viewStateDisposable?.dispose()
    this.viewStateDisposable = this.visibleTaskStreams.bindPanel(panel, () =>
      this.focusSession(panel.active ? this.currentSession?.id : undefined),
    )
    this.initializeConnection()
  }

  /** Register a session created externally and notify the webview. */
  public registerSession(session: Session): void {
    this.stopCurrentSessionProcesses(session.id)
    this.setCurrentSession(session)
    this.contextSessionID = session.id
    this.trackedSessionIds.add(session.id)
    this.postMessage({
      type: "sessionCreated",
      session: this.sessionToWebview(session),
    })
  }

  /** Add a session ID to the tracked set without changing currentSession. */
  public trackSession(sessionId: string): void {
    this.trackedSessionIds.add(sessionId)
  }

  public loadMessages(sessionID: string): Promise<void> {
    // Sub-agent viewers share the normal paginated transcript and preserve
    // live deltas that arrive while the initial page is loading.
    return this.handleLoadMessages(sessionID, { preserveStream: true })
  }

  /**
   * Register a directory override for a session (e.g., worktree path).
   * When set, all operations for this session use this directory instead of the workspace root.
   */
  public setSessionDirectory(sessionId: string, directory: string): void {
    this.aborts.preserve(sessionId, this.sessionStatusMap.get(sessionId), this.getWorkspaceDirectory(sessionId))
    this.sessionDirectories.set(sessionId, directory)
    this.requirements.clear()
    if (this.connectionState === "connected") void this.fetchAndSendSandboxStatus(sessionId)
  }

  public clearSessionDirectory(sessionId: string): void {
    this.aborts.preserve(sessionId, this.sessionStatusMap.get(sessionId), this.getWorkspaceDirectory(sessionId))
    this.sessionDirectories.delete(sessionId)
    this.requirements.clear()
    if (this.connectionState === "connected") void this.fetchAndSendSandboxStatus(sessionId)
  }

  /** Exposes the session→directory map so callers outside the webview can resolve worktree paths. */
  public getSessionDirectories(): ReadonlyMap<string, string> {
    return this.sessionDirectories
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

  /** Register a listener invoked when a plan follow-up session is adopted. */
  public onFollowupAdopted(cb: (session: Session, directory: string) => void): void {
    this.followupListeners.push(cb)
  }

  /** Recover permission/question prompts after sessions and directories are tracked. */
  public recoverPendingPrompts(): void {
    this.promptRecoveryQueued = true
    if (!this.isWebviewReady) return
    if (!this.client) return
    if (this.promptRecovery) return

    this.promptRecovery = this.flushPendingPrompts().finally(() => {
      this.promptRecovery = null
      if (this.promptRecoveryQueued && this.isWebviewReady && this.client) this.recoverPendingPrompts()
    })
  }

  private async flushPendingPrompts(): Promise<void> {
    while (this.promptRecoveryQueued && this.isWebviewReady) {
      if (!this.client) return
      this.promptRecoveryQueued = false
      await Promise.all([
        fetchAndSendPendingPermissions(this.permissionCtx),
        fetchAndSendPendingQuestions(this.questionCtx),
        fetchAndSendPendingSuggestions(this.questionCtx),
      ])
    }
  }

  public openCloudSession(sessionId: string): void {
    this.postMessage({ type: "openCloudSession", sessionId })
  }

  public selectKiloModel(modelID?: string, agent?: string): void {
    if (!modelID && !agent) return
    this.pendingKiloModel = { ...(modelID && { modelID }), ...(agent && { agent }) }
    this.flushPendingKiloModel()
  }

  public setContinueInWorktreeHandler(
    handler: (sessionId: string, progress: (status: string, detail?: string, error?: string) => void) => Promise<void>,
  ): void {
    this.continueInWorktreeHandler = handler
  }

  public setCreateWorktreeHandler(handler: (baseBranch?: string, branchName?: string) => Promise<void>): void {
    this.createWorktreeHandler = handler
  }

  public attachToWebview(
    webview: vscode.Webview,
    options?: { onBeforeMessage?: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null> },
  ): void {
    this.isWebviewReady = false
    this.webview = webview
    if (!this.autoApproveBridge) this.onBeforeMessage = options?.onBeforeMessage ?? null
    this.setupWebviewMessageHandler(webview)
    this.initializeConnection()
  }

  private setupWebviewMessageHandler(webview: vscode.Webview): void {
    this.webviewMessageDisposable?.dispose()
    this.autocompleteConfigDisposable?.dispose()
    this.autocompleteConfigDisposable = watchAutocompleteConfig((msg) => this.postMessage(msg))
    this.indexingConfigDisposable?.dispose()
    this.indexingConfigDisposable = watchIndexingConfig((msg) => this.postMessage(msg))
    this.telemetryStateDisposable?.dispose()
    this.telemetryStateDisposable = watchTelemetryState((msg) => this.postMessage(msg))
    this.webviewMessageDisposable = webview.onDidReceiveMessage(async (message) => {
      const intercepted = await interceptMessage(message, {
        workspaceDir: (sid) => this.getWorkspaceDirectory(sid ?? this.currentSession?.id),
        post: (m) => this.postMessage(m),
        error: getErrorMessage,
        before: this.onBeforeMessage,
      })
      if (intercepted === null) return
      message = intercepted

      if (
        await routeEarlyMessage(message, {
          question: this.questionCtx,
          client: this.client,
          connection: this.connectionService,
          dir: this.getWorkspaceDirectory(this.currentSession?.id),
          post: (msg) => this.postMessage(msg),
          exportTranscript: (sessionID) => this.handleExportSessionTranscript(sessionID),
        })
      ) {
        return
      }
      if (this.handleEditorOpenMessage(message)) return
      if (
        await handleWorkStyleMessage({
          message,
          connection: this.connectionService,
          directory: this.getWorkspaceDirectory(this.currentSession?.id),
          post: (msg) => this.postMessage(msg),
        })
      )
        return
      if (
        await handleSidebarWorktreeMessage(message, {
          post: (msg) => this.postMessage(msg),
          openAgentManager: () => vscode.commands.executeCommand("kilo-code.new.agentManagerOpen"),
          openAdvancedWorktree: () => vscode.commands.executeCommand("kilo-code.new.agentManager.advancedWorktree"),
          openChanges: (sessionId?: string, turnId?: string) =>
            vscode.commands.executeCommand("kilo-code.new.showChanges", { sessionId, turnId }),
          currentSessionId: this.currentSession?.id,
          createWorktree: async (baseBranch, branchName) => {
            await this.createWorktreeHandler?.(baseBranch, branchName)
          },
          continueInWorktree: this.continueInWorktreeHandler ?? undefined,
        })
      ) {
        return
      }
      if (await this.handleModelSelectorExpandedMessage(message)) return
      this.visibleTaskStreams.handle(message)
      if (await this.handleMemoryMessage(message)) return
      switch (message.type) {
        case "webviewReady":
          console.log("[Kilo New] KiloProvider: ✅ webviewReady received")
          this.isWebviewReady = true
          this.visibleTaskStreams.clear()
          this.flushPendingKiloModel()
          await this.syncWebviewState("webviewReady")
          this.flushPendingReviewComments()
          this.recoverPendingPrompts()
          this.readyResolvers.splice(0).forEach((r) => r())
          break
        case "sendMessage": {
          const msg = message as typeof message & ContextMessage
          await this.handleSendMessage(
            message.text,
            typeof message.messageID === "string" ? message.messageID : undefined,
            message.sessionID,
            typeof message.draftID === "string" ? message.draftID : undefined,
            message.providerID,
            message.modelID,
            message.agent,
            message.variant,
            parseMessageFiles(message.files),
            parseReview(message.review, message.text),
            typeof message.agentManagerContext === "string" ? message.agentManagerContext : undefined,
            typeof msg.contextDirectory === "string" ? msg.contextDirectory : undefined,
          )
          break
        }
        case "sendCommand": {
          const msg = message as typeof message & ContextMessage
          await this.handleSendCommand(
            message.command,
            message.arguments,
            typeof message.messageID === "string" ? message.messageID : undefined,
            message.sessionID,
            typeof message.draftID === "string" ? message.draftID : undefined,
            message.providerID,
            message.modelID,
            message.agent,
            message.variant,
            parseMessageFiles(message.files),
            typeof message.agentManagerContext === "string" ? message.agentManagerContext : undefined,
            typeof msg.contextDirectory === "string" ? msg.contextDirectory : undefined,
          )
          break
        }
        case "abort":
          this.cancelRetry(message.sessionID ?? "")
          await this.handleAbort(message.sessionID)
          break
        case "revertSession":
          this.checkpoint(message.sessionID, () =>
            this.handleRevertSession(message.sessionID, message.messageID, message.partID),
          )
          break
        case "unrevertSession":
          this.checkpoint(message.sessionID, () => this.handleUnrevertSession(message.sessionID))
          break
        case "permissionResponse":
          await handlePermissionResponse(
            this.permissionCtx,
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
          this.stopCurrentSessionProcesses()
          this.contextSessionID = undefined
          this.setCurrentSession(null)
          this.focusSession()
          break
        case "loadMessages":
          // Don't await: allow parallel loads so rapid session switching
          // isn't blocked by slow responses for earlier sessions.
          void this.handleLoadMessages(message.sessionID, {
            mode: message.mode,
            before: message.before,
            limit: message.limit,
          })
          break
        case "syncSession":
          this.handleSyncSession(message.sessionID, message.parentSessionID).catch((e) =>
            console.error("[Kilo New] handleSyncSession failed:", e),
          )
          break
        case "loadSessions":
          this.handleLoadSessions().catch((e) => console.error("[Kilo New] handleLoadSessions failed:", e))
          break
        case "requestSessionModelUsage":
          void this.fetchAndSendSessionModelUsage(message.sessionID, message.requestID)
          break
        case "login": {
          const attempt = ++this.loginAttempt
          await handleLogin(this.authCtx, attempt, () => this.loginAttempt)
          break
        }
        case "cancelLogin":
          this.loginAttempt++
          this.postMessage({ type: "deviceAuthCancelled" })
          break
        case "logout":
          await handleLogout(this.authCtx)
          break
        case "setOrganization":
          if (typeof message.organizationId === "string" || message.organizationId === null) {
            await handleSetOrganization(this.authCtx, message.organizationId)
          }
          break
        case "refreshProfile":
          await handleRefreshProfile(this.authCtx)
          break
        case "openSettingsPanel":
          vscode.commands.executeCommand("kilo-code.new.settingsButtonClicked", message.tab)
          break
        case "openKiloClaw":
          vscode.commands.executeCommand("kilo-code.new.kiloClawOpen")
          break
        case "openVSCodeSettings":
          vscode.commands.executeCommand("workbench.action.openSettings", message.query)
          break
        case "openConfigFile":
          await openConfig(message.scope, message.labels, this.getProjectDirectory(this.currentSession?.id))
          break
        case "openMarketplacePanel":
          this.openMarketplacePanel(message.directory)
          break
        case "forkSession":
          handleForkSession(this.forkCtx, message.sessionId, message.messageId).catch((e) =>
            console.error("[Kilo New] handleForkSession failed:", e),
          )
          break
        case "retryConnection":
          console.log("[Kilo New] KiloProvider: 🔄 Retrying connection...")
          this.initializeConnection().catch((e) =>
            console.error("[Kilo New] KiloProvider: ❌ Retry connection failed:", e),
          )
          break
        case "reload":
          this.handleReload().catch((e) => console.error("[Kilo New] KiloProvider: Reload failed:", e))
          break
        case "openSubAgentViewer":
          vscode.commands.executeCommand("kilo-code.new.openSubAgentViewer", message.sessionID, message.title)
          break
        case "saveImage":
          return saveImage(this.getWorkspaceDirectory(this.currentSession?.id), message)
        case "requestProviders":
          this.fetchAndSendProviders().catch((e) => console.error("[Kilo New] fetchAndSendProviders failed:", e))
          break
        case "connectProvider":
        case "authorizeProviderOAuth":
        case "completeProviderOAuth":
        case "disconnectProvider":
        case "saveCustomProvider":
          await this.handleProviderAction(message)
          break
        case "anacondaDesktopStatus":
        case "anacondaDesktopOpen":
        case "anacondaDesktopSync":
        case "cancelAnacondaDesktopRequest":
          await this.anacondaDesktop.handle(message, {
            client: this.client,
            directory: this.getWorkspaceDirectory(),
            post: (reply) => this.postMessage(reply),
            refresh: () => this.fetchAndSendProviders(),
            error: getErrorMessage,
          })
          break
        case "fetchCustomProviderModels":
          this.handleFetchCustomProviderModels(message).catch((e) =>
            console.error("[Kilo New] fetchCustomProviderModels failed:", e),
          )
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
        case "requestAgentRequirements":
          this.requirements
            .fetch({
              agent: message.agent,
              directory: message.directory,
              sessionID: message.sessionID,
              force: message.force === true,
            })
            .catch((e) => console.error("[Kilo New] fetchAndSendAgentRequirements failed:", e))
          break
        case "requestCommands":
          this.fetchAndSendCommands().catch((e) => console.error("[Kilo New] fetchAndSendCommands failed:", e))
          break
        case "removeSkill":
          this.removeSkillViaCli(message.location).catch((e: unknown) =>
            console.error("[Kilo New] removeSkill failed:", e),
          )
          break
        case "removeAgent":
          this.handleRemoveAgent(message.name).catch((e) => console.error("[Kilo New] handleRemoveAgent failed:", e))
          break
        case "removeMcp":
          this.handleRemoveMcp(message.name).catch((e) => console.error("[Kilo New] handleRemoveMcp failed:", e))
          break
        case "requestMcpStatus":
          this.fetchAndSendMcpStatus().catch((e) => console.error("[Kilo New] fetchAndSendMcpStatus failed:", e))
          break
        case "connectMcp": {
          const c1 = this.client
          if (c1) {
            void McpOAuth.connectMcpServer(c1, message.name, this.getWorkspaceDirectory(), () =>
              this.refreshMcpStatus(),
            ).catch((e) => console.error("[Kilo New] connectMcpServer failed:", e))
          }
          break
        }
        case "disconnectMcp": {
          const c2 = this.client
          if (c2) {
            void McpOAuth.disconnectMcpServer(c2, message.name, this.getWorkspaceDirectory(), () =>
              this.refreshMcpStatus(),
            ).catch((e) => console.error("[Kilo New] disconnectMcpServer failed:", e))
          }
          break
        }
        case "authenticateMcp": {
          const c = this.client
          if (c) {
            void McpOAuth.authenticateMcpServer(c, message.name, this.getWorkspaceDirectory(), () =>
              this.refreshMcpStatus(),
            ).catch((e) => console.error("[Kilo New] authenticateMcpServer failed:", e))
          }
          break
        }

        case "questionReply":
          this.noteFollowup(message.answers, message.sessionID)
          if (!(await handleQuestionReply(this.questionCtx, message.requestID, message.answers, message.sessionID))) {
            this.pendingFollowup = null
          }
          break
        case "questionReject":
          this.pendingFollowup = null
          await handleQuestionReject(this.questionCtx, message.requestID, message.sessionID)
          break
        case "sessionCostAlertResponse":
          await this.handleCostAlertResponse(message.sessionID, message.limit, message.response)
          break
        case "requestSandboxStatus":
          await this.fetchAndSendSandboxStatus(message.sessionID)
          break
        case "requestSandboxDefault":
          await this.fetchAndSendSandboxDefault(message.contextDirectory, message.requestID)
          break
        case "setSandboxDefault":
          await this.handleSetSandboxDefault(message.enabled, message.requestID, message.contextDirectory)
          break
        case "toggleSandbox":
          await this.handleToggleSandbox(message)
          break
        case "requestConfig":
          this.fetchAndSendConfig().catch((e) => console.error("[Kilo New] fetchAndSendConfig failed:", e))
          break
        case "requestGlobalConfig":
          this.fetchAndSendGlobalConfig().catch((e) => console.error("[Kilo New] fetchAndSendGlobalConfig failed:", e))
          break
        case "requestIndexingStatus":
          this.fetchAndSendIndexingStatus().catch((e) =>
            console.error("[Kilo New] fetchAndSendIndexingStatus failed:", e),
          )
          break
        case "requestIndexingSettings":
          this.postMessage(buildIndexingSettingsMessage())
          break
        case "requestKiloEmbeddingModels":
          this.fetchAndSendKiloEmbeddingModels().catch((e) =>
            console.error("[Kilo New] fetchAndSendKiloEmbeddingModels failed:", e),
          )
          break
        case "updateConfig":
          await this.handleUpdateConfig(
            message.config,
            message.projectConfig,
            message.globalUnset,
            message.projectUnset,
          )
          break
        case "openSettingsTab":
          if (message.tab === "indexing") {
            await vscode.commands.executeCommand("kilo-code.new.openIndexingSettings")
          }
          break
        case "setLanguage":
          await vscode.workspace
            .getConfiguration("kilo-code.new")
            .update("language", message.locale || undefined, vscode.ConfigurationTarget.Global)
          this.connectionService.notifyLanguageChanged(message.locale as string)
          break
        case "requestChatCompletion": {
          if (!this.chatAutocomplete) {
            this.chatAutocomplete = new ChatTextAreaAutocomplete(this.connectionService)
          }
          void this.chatAutocomplete.handle(
            { type: "requestChatCompletion", text: message.text, requestId: message.requestId },
            {
              postMessage: (msg: { type: "chatCompletionResult"; text: string; requestId: string }) =>
                this.postMessage(msg),
            },
          )
          break
        }
        case "requestFileSearch":
          await handleFileSearch({
            client: this.client,
            message,
            current: this.currentSession?.id,
            context: this.contextSessionID,
            dir: (id) => this.getWorkspaceDirectory(id),
            open: (dir) => this.getOpenTabPaths(dir),
            post: (msg) => this.postMessage(msg),
          })
          break
        case "requestTerminalContext":
          void this.handleTerminalContext(message.requestId)
          break
        case "chatCompletionAccepted":
          this.chatAutocomplete?.telemetry.captureAcceptSuggestion(message.suggestionLength)
          break
        case "toggleRemote":
        case "setRemoteEnabled":
        case "requestRemoteStatus":
          this.remoteService
            ?.handleMessage(message.type, message.enabled)
            .then((s) => {
              if (s) this.sendRemoteStatus()
            })
            .catch((err) => console.error("[Kilo New] remote message failed:", err))
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
        case "requestClaudeCompatSetting":
          this.sendClaudeCompatSetting()
          break
        case "requestNotificationSettings":
          this.sendNotificationSettings()
          break
        case "testNotification":
          previewSound(message.sound)
          break
        case "requestTimelineSetting":
          this.sendTimelineSetting()
          break
        case "requestNotifications":
          this.fetchAndSendNotifications().catch((e) =>
            console.error("[Kilo New] fetchAndSendNotifications failed:", e),
          )
          break
        case "requestCloudSessions":
          await handleRequestCloudSessions(this.cloudSessionCtx, message)
          break
        case "requestGitRemoteUrl":
          void this.getGitRemoteUrl().then((url) => {
            this.postMessage({ type: "gitRemoteUrlLoaded", gitUrl: url ?? null })
          })
          break
        case "requestCloudSessionData":
          void handleRequestCloudSessionData(this.cloudSessionCtx, message.sessionId)
          break
        case "importAndSend": {
          const files = parseMessageFiles(message.files)
          void handleImportAndSend(
            this.cloudSessionCtx,
            message.cloudSessionId,
            message.text,
            typeof message.messageID === "string" ? message.messageID : undefined,
            message.providerID,
            message.modelID,
            message.agent,
            message.variant,
            files,
            parseReview(message.review, message.text),
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
        case "resetReadNotifications":
          await resetReadNotifications(this.notificationsContext())
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
        case "persistRecents":
          await this.extensionContext?.globalState.update("recentModels", validateRecents(message.recents))
          break
        case "requestRecents": {
          const recents = validateRecents(this.extensionContext?.globalState.get("recentModels"))
          this.postMessage({ type: "recentsLoaded", recents })
          break
        }
        case "toggleFavorite": {
          await this.toggleFavorite(message)
          break
        }
        case "requestFavorites": {
          const favorites = validateFavorites(this.extensionContext?.globalState.get("favoriteModels"))
          this.postMessage({ type: "favoritesLoaded", favorites })
          break
        }
        // legacy-migration start
        case "requestMigrationData":
          void handleRequestMigrationData(this.migrationCtx, message.source, message.operationId)
          break
        case "startMigration":
          void handleStartMigration(this.migrationCtx, message.source, message.operationId, message.selections)
          break
        case "skipLegacyMigration":
          void handleSkipLegacyMigration(this.migrationCtx)
          break
        case "clearLegacyData":
          void handleClearLegacyData(this.migrationCtx)
          break
        case "finalizeLegacyMigration":
          void handleFinalizeLegacyMigration(this.migrationCtx)
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
              const raw = getErrorMessage(err) || "Failed to enhance prompt"
              const msg = normalizeEnhancePromptErrorMessage(raw)
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
      }
    })
    this.webviewMessageDisposable = watchFontSizeConfig((msg) => this.postMessage(msg), this.webviewMessageDisposable)
    this.webviewMessageDisposable = watchWorkStyleConfig((msg) => this.postMessage(msg), this.webviewMessageDisposable)
  }

  private handleEditorOpenMessage(message: Parameters<typeof handleEditorAction>[0]): boolean {
    return handleEditorAction(message, {
      dir: () => this.getWorkspaceDirectory(this.currentSession?.id),
      diff: this.diffVirtualProvider,
      storage: this.extensionContext?.globalStorageUri,
      post: (msg) => this.postMessage(msg),
    })
  }

  private async handleModelSelectorExpandedMessage(message: TypedWebviewMessage): Promise<boolean> {
    if (message.type === "persistModelSelectorExpanded") {
      if (typeof message.value !== "boolean") return true
      await this.extensionContext?.globalState.update("modelSelectorExpanded", message.value)
      this.connectionService.notifyModelSelectorExpandedChanged(message.value)
      return true
    }
    if (message.type === "requestModelSelectorExpanded") {
      const value = this.extensionContext?.globalState.get("modelSelectorExpanded", true) ?? true
      this.postMessage({ type: "modelSelectorExpandedLoaded", value })
      return true
    }
    return false
  }

  private async toggleFavorite(message: {
    action: "add" | "remove"
    providerID: string
    modelID: string
  }): Promise<void> {
    const current = validateFavorites(this.extensionContext?.globalState.get("favoriteModels"))
    const key = `${message.providerID}/${message.modelID}`
    const exists = current.some((f) => `${f.providerID}/${f.modelID}` === key)
    const favorites =
      message.action === "add" && !exists
        ? [...current, { providerID: message.providerID, modelID: message.modelID }]
        : message.action === "remove" && exists
          ? current.filter((f) => `${f.providerID}/${f.modelID}` !== key)
          : current
    await this.extensionContext?.globalState.update("favoriteModels", favorites)
    this.connectionService.notifyFavoritesChanged(favorites)
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
    this.connectionGeneration++
    this.postMessage({ type: "connectionState", state: "connecting" })

    // Clean up any existing subscriptions (e.g., sidebar re-shown)
    this.unsubscribeEvent?.()
    this.unsubscribeState?.()
    this.unsubscribeNotificationDismiss?.()
    this.unsubscribeLanguageChange?.()
    this.unsubscribeProfileChange?.()
    this.unsubscribeFavoritesChange?.()
    this.unsubscribeModelSelectorExpanded?.()
    this.unsubscribeClearPendingPrompts?.()
    this.unsubscribeDirectoryProvider?.()

    try {
      const workspaceDir = this.getWorkspaceDirectory()

      // Connect the shared service (no-op if already connected)
      await this.connectionService.connect(workspaceDir)
      this.flushPendingKiloModel()

      // Subscribe to SSE events for this webview (filtered by tracked sessions)
      this.unsubscribeEvent = this.connectionService.onEventFiltered(
        (payload, directory) => {
          const event = unwrapSyncEvent(payload)
          if (!event) return false

          // Remote status events are global and should always pass through
          if (event.type === "kilo-sessions.remote-status-changed") return true
          if (event.type === "memory.status" || event.type === "memory.updated" || event.type === "memory.error")
            return true
          const sessionId = this.resolveEventSessionId(event)

          // message.part.* events are always session-scoped; drop if session unknown.
          if (!sessionId) return !isSessionScopedPartEvent(event.type)

          if (event.type === "session.created" && this.matchesPendingFollowup(event.properties.info)) {
            return true
          }

          // session.status must always pass through — even for sessions not tracked by this
          // KiloProvider instance. The Settings panel is a separate provider with no tracked
          // sessions, but it needs session.status to populate sessionStatusMap and allStatusMap
          // for the busy-session warning on Save.
          if (event.type === "session.status") return true

          // session.deleted must always pass through so the webview can run its cleanup
          // (messages, parts, stash, todos, permissions, drafts, etc.) — including for
          // sessions that were never explicitly tracked here (e.g. child sessions
          // cascade-deleted with the parent, or external CLI deletions). We deliberately
          // do NOT re-track the deleted id: handleLoadMessages intentionally drops late
          // responses for sessions that have been pruned, and re-tracking would let an
          // in-flight messagesLoaded response resurrect transcript state for a session
          // the webview just cleaned up.
          if (event.type === "session.deleted") return true

          return this.trackedSessionIds.has(sessionId)
        },
        (payload, directory) => {
          const event = unwrapSyncEvent(payload)
          if (event) this.handleEvent(event, directory)
        },
      )

      // Subscribe to connection state changes
      this.unsubscribeState = this.connectionService.onStateChange(async (state, error) => {
        if (this.connectionState !== state) this.connectionGeneration++
        this.connectionState = state
        this.postConnectionState(error)

        if (state === "connected") {
          this.flushPendingKiloModel()
          // Fire config warnings independently so a failure in the
          // sequential await chain doesn't prevent warnings from being shown
          void this.checkConfigWarnings("state")
          try {
            // Profile fetch is best-effort — returns 401 when user isn't logged into gateway.
            const sdkClient = this.client
            if (sdkClient) {
              const profileResult = await sdkClient.kilo.profile()
              this.postMessage({ type: "profileData", data: profileResult.data ?? null })
            }
            await this.syncWebviewState("sse-connected")
            await this.flushPendingSessionRefresh("sse-connected")
            this.recoverPendingPrompts()
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

      // Subscribe to language change broadcast from other KiloProvider instances
      this.unsubscribeLanguageChange = this.connectionService.onLanguageChanged((locale) => {
        this.postMessage({ type: "languageChanged", locale })
      })

      // Subscribe to profile change broadcast from other KiloProvider instances
      this.unsubscribeProfileChange = this.connectionService.onProfileChanged((data) => {
        this.postMessage({ type: "profileData", data })
      })

      // Subscribe to favorites change broadcast from other KiloProvider instances
      this.unsubscribeFavoritesChange = this.connectionService.onFavoritesChanged((favorites) => {
        this.postMessage({ type: "favoritesLoaded", favorites })
      })

      // Subscribe to model-selector expand/collapse broadcast from other KiloProvider instances
      this.unsubscribeModelSelectorExpanded = this.connectionService.onModelSelectorExpandedChanged((value) => {
        this.postMessage({ type: "modelSelectorExpandedLoaded", value })
      })

      // legacy-migration start
      // Subscribe to migration-complete broadcast from any KiloProvider instance
      this.unsubscribeMigrationComplete = this.connectionService.onMigrationComplete(() => {
        this.postMessage({ type: "migrationState", needed: false, source: "legacy" })
      })
      // legacy-migration end

      // Subscribe to clear-pending-prompts broadcast (fired after config save drains prompts)
      this.unsubscribeClearPendingPrompts = this.connectionService.onClearPendingPrompts(() => {
        this.postMessage({ type: "clearPendingPrompts" })
      })

      // Register this provider's directories so drainPendingPrompts() covers all instances
      this.unsubscribeDirectoryProvider = this.connectionService.registerDirectoryProvider(() => {
        return [this.getWorkspaceDirectory(), ...this.sessionDirectories.values()]
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
          fontSize: getWebviewFontSize(),
          workspaceDirectory: this.getProjectDirectory(this.currentSession?.id),
        })
      }
      this.postConnectionState()

      // connect() can resolve after SSE reaches "connected" but before this
      // provider subscribes to onStateChange(). In that case the initial
      // connected callback is missed, so run the warning check here too.
      if (this.connectionState === "connected") {
        void this.checkConfigWarnings("init")
      }

      await this.syncWebviewState("initializeConnection")
      await this.flushPendingSessionRefresh("initializeConnection")
      this.recoverPendingPrompts()

      // Fetch providers, agents, skills, config, notifications, and session statuses in parallel
      await Promise.all([
        this.fetchAndSendProviders(),
        this.fetchAndSendAgents(),
        this.fetchAndSendSkills(),
        this.fetchAndSendCommands(),
        this.fetchAndSendConfig(),
        this.fetchAndSendIndexingStatus(),
        this.fetchAndSendNotifications(),
        this.memory.fetch(),
        this.seedSessionStatusMap(),
      ])
      this.cachedGitRepo = await hasGit(this.client!, this.getWorkspaceDirectory())
      this.postMessage({ type: "gitStatus", repo: this.cachedGitRepo })
      this.sendNotificationSettings()
      this.sendTimelineSetting()
      this.postMessage({ type: "extensionDataReady" })

      if (this.cachedGitRepo) this.startStatsPolling()

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

  private async handleCreateSession(): Promise<void> {
    if (!this.client) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    try {
      const workspaceDir = this.getContextDirectory()
      const metadata = await sandboxSessionMetadata(this.connectionService.sandboxPreference, this.client, workspaceDir)
      const { data: session } = await this.client.session.create(
        { directory: workspaceDir, platform: this.opts.platform, metadata },
        { throwOnError: true },
      )
      this.stopCurrentSessionProcesses(session.id)
      this.setCurrentSession(session)
      this.contextSessionID = session.id
      this.focusSession(session.id)
      this.trackDirectory(session.id, workspaceDir)
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

  /** Non-blocking: refresh session metadata + status for the webview after switching. */
  private refreshSessionDetails(sessionID: string, dir: string, signal?: AbortSignal): void {
    if (!this.client) return
    const revision = this.revisions.get(sessionID)
    const refresh = (this.refreshes.get(sessionID) ?? 0) + 1
    this.refreshes.set(sessionID, refresh)
    this.client.session
      .get({ sessionID, directory: dir })
      .then((r) => {
        if (!r.data || signal?.aborted || this.contextSessionID !== sessionID) return
        if (this.refreshes.get(sessionID) !== refresh) {
          if (this.revisions.get(sessionID) !== revision) this.refreshSessionDetails(sessionID, dir, signal)
          return
        }
        if (this.revisions.get(sessionID) !== revision) {
          this.refreshSessionDetails(sessionID, dir, signal)
          return
        }
        this.setCurrentSession(r.data)
        this.contextSessionID = r.data.id
        this.postMessage({ type: "sessionUpdated", session: this.sessionToWebview(r.data) })
      })
      .catch((e: unknown) => console.warn("[Kilo New] KiloProvider: getSession failed (non-critical):", e))
    this.postMessage({ type: "workspaceDirectoryChanged", directory: this.getWorkspaceDirectory(sessionID) })
    this.requirements.clear()
    this.client.session
      .status({ directory: dir })
      .then((r) => {
        if (!r.data || signal?.aborted) return
        for (const [sid, info] of Object.entries(r.data) as [string, SessionStatus][]) {
          if (!this.trackedSessionIds.has(sid)) continue
          this.postMessage({
            type: "sessionStatus",
            sessionID: sid,
            status: info.type,
            ...(info.type === "retry" ? { attempt: info.attempt, message: info.message, next: info.next } : {}),
          })
        }
      })
      .catch((e: unknown) => console.error("[Kilo New] KiloProvider: Failed to fetch session statuses:", e))
  }

  private fetchAndSendSessionModelUsage(sessionID: string, requestID: string): Promise<void> {
    const directory = this.getWorkspaceDirectory(sessionID)
    return this.connectionService
      .getClientAsync(directory)
      .then((client) => client.kilocode.sessionModelUsage({ sessionID, directory }, { throwOnError: true }))
      .then((response) => {
        this.modelUsageSessionIds = new Set(response.data.sessionIDs)
        this.postMessage({ type: "sessionModelUsageLoaded", sessionID, requestID, data: response.data })
      })
      .catch((error: unknown) => {
        console.warn("[Kilo New] KiloProvider: Failed to load session model usage:", error)
        this.postMessage({ type: "sessionModelUsageLoaded", sessionID, requestID })
      })
  }

  private async handleLoadMessages(
    sessionID: string,
    options: { mode?: MessageLoadMode; before?: string; limit?: number; preserveStream?: boolean } = {},
  ): Promise<void> {
    const mode = options.mode ?? "replace"
    if (mode === "replace" || mode === "focus") {
      this.stopCurrentSessionProcesses(sessionID)
      this.trackedSessionIds.add(sessionID)
      this.focusSession(sessionID)
      this.contextSessionID = sessionID
    }
    if (!this.client) {
      this.postMessage({ type: "error", message: "Not connected to CLI backend", sessionID })
      return
    }
    const dir = this.getWorkspaceDirectory(sessionID)
    if (mode === "focus") {
      this.refreshSessionDetails(sessionID, dir)
      // Reconcile tail so SSE drops self-heal. Throttled to skip rapid tab-switching bursts.
      if (Date.now() - (this.lastReconciledAt.get(sessionID) ?? 0) < 1000) return
      await this.handleLoadMessages(sessionID, { mode: "reconcile", limit: options.limit ?? MESSAGE_PAGE_LIMIT })
      return
    }
    // Replace competes for the spinner and cancels earlier loads; prepend/reconcile run in parallel.
    const abort = mode === "replace" ? new AbortController() : undefined
    if (abort) {
      this.loadMessagesAbort?.abort()
      this.loadMessagesAbort = abort
      this.refreshSessionDetails(sessionID, dir, abort.signal)
    }
    const since = mode === "reconcile" ? Date.now() : undefined
    try {
      const page = await fetchMessagePage(this.client, {
        sessionID,
        workspaceDir: dir,
        limit: options.limit ?? MESSAGE_PAGE_LIMIT,
        before: options.before,
        signal: abort?.signal,
      })
      if (abort?.signal.aborted) return
      // Drop results for a session deleted mid-fetch. Prepend/reconcile have
      // no abort controller, so this guard prevents ghost entries.
      if (!this.trackedSessionIds.has(sessionID)) return
      const messages = page.items.map((m) => ({
        ...this.slimInfo(m.info),
        parts: this.slimParts(m.parts),
        createdAt: new Date(m.info.time.created).toISOString(),
      }))
      for (const message of messages) {
        this.connectionService.recordMessageSessionId(message.id, message.sessionID)
      }
      if (mode === "replace" || mode === "reconcile") this.resetMessageCosts(sessionID, messages)
      // Authoritative snapshots normally supersede buffered deltas. A newly
      // opened sub-agent viewer has no earlier renderer state, so its buffered
      // updates arrived during this fetch and must follow the snapshot.
      if ((mode === "replace" || mode === "reconcile") && !options.preserveStream) this.streams.drop(sessionID)
      if (mode === "reconcile") this.lastReconciledAt.set(sessionID, Date.now())
      this.postMessage({
        type: "messagesLoaded",
        sessionID,
        messages,
        mode,
        cursor: page.cursor,
        hasMore: Boolean(page.cursor),
        since,
      })
      if (options.preserveStream) this.streams.flush(sessionID)
      // Recover any prompts missed while the webview was loading or during an SSE reconnection.
      this.recoverPendingPrompts()
    } catch (error) {
      if (abort?.signal.aborted) return
      console.error("[Kilo New] KiloProvider: Failed to load messages:", error)
      this.postMessage({ type: "error", message: getErrorMessage(error) || "Failed to load messages", sessionID })
    }
  }

  /**
   * Handle syncing a child session (e.g. spawned by the task tool).
   * Tracks the session for SSE events and fetches its messages.
   */
  private async handleSyncSession(sessionID: string, parentSessionID?: string): Promise<void> {
    if (!this.client) return
    if (this.syncedChildSessions.has(sessionID)) return

    this.syncedChildSessions.add(sessionID)
    this.trackedSessionIds.add(sessionID)

    // Inherit the parent's worktree directory so permission responses use
    // the correct backend Instance. Without this, child sessions in Agent
    // Manager worktrees fall back to workspace root and fail to find the
    // pending permission request.
    if (!this.sessionDirectories.has(sessionID) && parentSessionID) {
      const dir = this.sessionDirectories.get(parentSessionID)
      if (dir) {
        this.sessionDirectories.set(sessionID, dir)
      }
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID)
      const { data: messagesData } = await retry(() =>
        this.client!.session.messages({ sessionID, directory: workspaceDir }, { throwOnError: true }),
      )

      const messages = messagesData.map((m) => ({
        ...this.slimInfo(m.info),
        parts: this.slimParts(m.parts),
        createdAt: new Date(m.info.time.created).toISOString(),
      }))

      for (const message of messages) {
        this.connectionService.recordMessageSessionId(message.id, message.sessionID)
      }
      this.resetMessageCosts(sessionID, messages)

      // Snapshot supersedes any queued deltas (see handleLoadMessages for the
      // snapshot-freshness assumption that governs drop() here).
      this.streams.drop(sessionID)
      this.postMessage({
        type: "messagesLoaded",
        sessionID,
        messages,
        mode: "replace",
        hasMore: false,
      })

      // Recover any prompts emitted by the child before we started tracking it.
      this.recoverPendingPrompts()
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
      worktreeDirectories: this.opts.worktreeDirectories,
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

  private async handleTerminalContext(requestId: string): Promise<void> {
    try {
      const output = await getTerminalContents(-1)
      this.postMessage({
        type: "terminalContextResult",
        requestId,
        content: output.content,
        truncated: output.truncated,
      })
    } catch (error) {
      console.error("[Kilo New] Failed to capture terminal context:", error)
      this.postMessage({
        type: "terminalContextError",
        requestId,
        error: getErrorMessage(error) || "Failed to capture terminal output",
      })
    }
  }

  /**
   * Drops every per-session cache entry we hold for the given id. Shared between
   * the user-initiated delete path (handleDeleteSession, after the backend
   * confirms) and the SSE session.deleted path (cascaded child deletes and
   * external CLI/TUI deletes that arrive via the event stream), so both paths
   * leave trackedSessionIds, sessionDirectories, and the related Maps in the
   * same state — including currentSession / contextSessionID / focused-session
   * registration. Without clearing those three, resolveSession() would still
   * see the deleted id via this.currentSession and the next send would target
   * a session the backend has already deleted.
   */
  private pruneDeletedSession(sessionID: string): void {
    this.trackedSessionIds.delete(sessionID)
    this.streams.drop(sessionID)
    this.visibleTaskStreams.delete(sessionID)
    this.syncedChildSessions.delete(sessionID)
    this.sessionDirectories.delete(sessionID)
    this.aborts.delete(sessionID)
    this.lastReconciledAt.delete(sessionID)
    this.checkpoints.delete(sessionID)
    this.revisions.delete(sessionID)
    this.refreshes.delete(sessionID)
    this.sessionStatusMap.delete(sessionID)
    this.costs.onSessionDeleted(sessionID)
    const deletedAlertLimit = this.activeAlerts.get(sessionID)
    if (deletedAlertLimit !== undefined) {
      this.activeAlerts.delete(sessionID)
      this.postMessage({ type: "sessionCostAlertResolved", sessionID: sessionID, limit: deletedAlertLimit })
    }
    this.connectionService.pruneSession(sessionID)
    if (this.currentSession?.id === sessionID) {
      this.contextSessionID = undefined
      this.setCurrentSession(null)
    }
    if (this.streams.focused === sessionID) this.focusSession(undefined)
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
      const workspaceDir = this.getSessionDirectory(
        sessionID,
        this.currentSession?.id === sessionID ? this.currentSession : undefined,
      )
      await stopSessionProcesses(this.client, sessionID, workspaceDir)
      await this.client.session.delete({ sessionID, directory: workspaceDir }, { throwOnError: true })
      this.pruneDeletedSession(sessionID)
      if (this.currentSession?.id === sessionID) {
        this.contextSessionID = undefined
        this.setCurrentSession(null)
        this.focusSession(undefined)
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
    try {
      const updated = await renameSession({
        client: this.client,
        sessionID,
        title,
        directory: this.getWorkspaceDirectory(sessionID),
      })
      if (this.currentSession?.id === sessionID) this.setCurrentSession(updated)
      this.postMessage({ type: "sessionUpdated", session: this.sessionToWebview(updated) })
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to rename session:", error)
      this.postMessage({ type: "error", message: getErrorMessage(error) || "Failed to rename session" })
    }
  }

  /**
   * Export a full session transcript as Markdown.
   */
  private async handleExportSessionTranscript(sessionID: string): Promise<void> {
    if (!this.client) {
      this.postMessage({ type: "error", message: "Not connected to CLI backend" })
      return
    }

    try {
      const saved = await exportTranscript(this.client, {
        sessionID,
        dir: this.getWorkspaceDirectory(sessionID),
      })
      if (saved) void vscode.window.showInformationMessage("Session transcript exported as Markdown.")
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to export session transcript:", error)
      this.postMessage({
        type: "error",
        message: getErrorMessage(error) || "Failed to export session transcript",
      })
    }
  }

  /** Fetch providers and send to webview. Coalesced: at most one in-flight + one queued. */
  private async fetchAndSendProviders(): Promise<void> {
    const next = ++this.providersGeneration
    if (this.providersRefresh) {
      this.providersQueued = true
      await this.providersRefresh
      return
    }
    const task = (async () => {
      let generation = next
      while (true) {
        this.providersQueued = false
        const client = this.client
        if (!client) {
          if (this.cachedProvidersMessage && generation === this.providersGeneration)
            this.postMessage(this.cachedProvidersMessage)
          return
        }
        try {
          const { response, authMethods, authStates, storedKeys } = await fetchProviderData(
            client,
            this.getWorkspaceDirectory(),
          )
          if (generation !== this.providersGeneration || client !== this.client) {
            if (!this.providersQueued) return
            generation = this.providersGeneration
            continue
          }
          this.storedProviderKeys = storedKeys
          const settings = vscode.workspace.getConfiguration("kilo-code.new.model")
          const message = {
            type: "providersLoaded",
            providers: indexProvidersById(response.all),
            connected: response.connected,
            defaults: response.default,
            defaultSelection: computeDefaultSelection(
              this.cachedConfigMessage as { config?: { model?: string } } | null,
              settings.get<string>("providerID", ""),
              settings.get<string>("modelID", ""),
            ),
            authMethods,
            authStates,
          }
          this.cachedProvidersMessage = message
          this.postMessage(message)
        } catch (error) {
          if (generation !== this.providersGeneration) {
            if (!this.providersQueued) return
            generation = this.providersGeneration
            continue
          }
          console.error("[Kilo New] KiloProvider: Failed to fetch providers:", error)
        }
        if (!this.providersQueued) return
        generation = this.providersGeneration
      }
    })()
    const done = task.finally(() => {
      if (this.providersRefresh === done) this.providersRefresh = null
    })
    this.providersRefresh = done
    await done
  }

  private async handleProviderAction(msg: Record<string, unknown>): Promise<void> {
    const rid = typeof msg.requestId === "string" ? msg.requestId : ""
    const pid = typeof msg.providerID === "string" ? msg.providerID : ""
    if (!rid || !pid) return
    if (!this.client) {
      const action =
        msg.type === "disconnectProvider"
          ? "disconnect"
          : msg.type === "authorizeProviderOAuth"
            ? "authorize"
            : "connect"
      this.postMessage({
        type: "providerActionError",
        requestId: rid,
        providerID: pid,
        action,
        message: "Not connected to CLI backend",
      })
      return
    }
    const ctx = buildActionContext(
      this.client,
      (m) => this.postMessage(m),
      getErrorMessage,
      this.getWorkspaceDirectory(),
      () => this.fetchAndSendProviders(),
    )
    const set = (m: unknown) => {
      this.cachedConfigMessage = m
      if (m && typeof m === "object" && "globalConfig" in m)
        this.cachedGlobalConfig = (m as { globalConfig?: Config }).globalConfig ?? null
    }
    const method = typeof msg.method === "number" ? msg.method : 0
    const key = typeof msg.apiKey === "string" ? msg.apiKey : undefined
    const keyChanged = msg.apiKeyChanged === true
    const code = typeof msg.code === "string" ? msg.code : undefined
    const config = msg.config && typeof msg.config === "object" ? (msg.config as Record<string, unknown>) : undefined
    const metadata =
      msg.metadata && typeof msg.metadata === "object" ? (msg.metadata as Record<string, unknown>) : undefined
    if (msg.type === "connectProvider" && key) return connectProviderAction(ctx, rid, pid, key, metadata)
    if (msg.type === "authorizeProviderOAuth") return authorizeOAuthAction(ctx, rid, pid, method)
    if (msg.type === "completeProviderOAuth") return completeOAuthAction(ctx, rid, pid, method, code)
    if (msg.type === "disconnectProvider") return disconnectProviderAction(ctx, rid, pid, this.cachedConfigMessage, set)
    if (msg.type === "saveCustomProvider" && config)
      return saveCustomProviderAction(ctx, rid, pid, config, key, keyChanged, this.cachedConfigMessage, set)
  }

  private async handleFetchCustomProviderModels(msg: Record<string, unknown>): Promise<void> {
    const rid = typeof msg.requestId === "string" ? msg.requestId : ""
    const url = typeof msg.baseURL === "string" ? msg.baseURL : ""
    if (!rid || !url) return
    const key =
      typeof msg.apiKey === "string" ? msg.apiKey : resolveStoredKey(this.storedProviderKeys, msg.providerID, url)
    const headers = msg.headers && typeof msg.headers === "object" ? (msg.headers as Record<string, string>) : undefined
    try {
      const models = await fetchOpenAIModels({ baseURL: url, apiKey: key, headers })
      this.postMessage({ type: "customProviderModelsFetched", requestId: rid, models })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch models"
      const auth = err instanceof FetchModelsError && err.auth
      this.postMessage({ type: "customProviderModelsFetched", requestId: rid, error: message, auth })
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
      const { data: agents } = await retry(() =>
        this.client!.app.agents({ directory: workspaceDir }, { throwOnError: true }),
      )

      const { visible, defaultAgent } = filterVisibleAgents(agents)

      const message = {
        type: "agentsLoaded",
        agents: visible.map(mapAgent),
        allAgents: agents.map(mapAgent),
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
      const { data: skills } = await retry(() =>
        this.client!.app.skills({ directory: workspaceDir }, { throwOnError: true }),
      )

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

  private clearCommandsCache(): void {
    this.cachedCommandsMessage = null
    clearCommandsCache()
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
      const message = await loadCommands(this.client, dir)

      this.cachedCommandsMessage = message
      this.postMessage(message)
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch commands:", error)
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
        this.clearCommandsCache()
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
    this.requirements.clear()
    return true
  }

  /** Remove an agent via the CLI backend, then refresh. */
  private async handleRemoveAgent(name: string): Promise<void> {
    if (!this.client) return
    try {
      const result = await this.client.kilocode.removeAgent({ name, directory: this.getWorkspaceDirectory() })
      if (result.error) {
        console.error("[Kilo New] removeAgent returned error:", result.error)
      }
    } catch (err) {
      console.error("[Kilo New] Failed to remove agent:", err)
    }
    this.cachedAgentsMessage = null
    await this.fetchAndSendAgents()
    this.requirements.clear()
  }

  private async handleRemoveMcp(name: string): Promise<void> {
    const removed = await removeMcp(this.removeConfigItemCtx, name)
    if (!removed) {
      console.error("[Kilo New] KiloProvider: Failed to remove MCP server:", name)
    }
  }

  private async refreshMcpStatus(): Promise<void> {
    await this.fetchAndSendMcpStatus()
    this.requirements.clear()
  }

  private async fetchAndSendMcpStatus(): Promise<void> {
    if (!this.client) {
      if (this.cachedMcpStatusMessage) {
        this.postMessage(this.cachedMcpStatusMessage)
      }
      return
    }

    try {
      const directory = this.getWorkspaceDirectory()
      const { data } = await retry(() => this.client!.mcp.status({ directory }))
      if (data) {
        const message = { type: "mcpStatusLoaded", status: data }
        this.cachedMcpStatusMessage = message
        this.postMessage(message)
      }
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch MCP status:", error)
    }
  }

  private async handleMemoryMessage(message: Record<string, unknown>): Promise<boolean> {
    return this.memory.handle(message)
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
      const [{ data: config }, { data: global }, { data: overlay }] = await Promise.all([
        retry(() => this.client!.config.get({ directory: workspaceDir }, { throwOnError: true })),
        this.client.global.config.get({ throwOnError: true }),
        this.client.config.overlay({ directory: workspaceDir, scope: "project" }, { throwOnError: true }),
      ])
      this.cachedGlobalConfig = global ?? null

      const message = {
        type: "configLoaded",
        config,
        globalConfig: global,
        projectConfig: overlay?.project,
        settings: { maxCost: this.maxCostSetting() },
        features: configFeatures(config),
      }
      this.cachedConfigMessage = message
      this.postMessage(message)
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch config:", error)
    }
  }

  /** Fetch global-only config (no project/managed layers) for settings export. */
  private async fetchAndSendGlobalConfig(): Promise<void> {
    if (!this.client || this.connectionState !== "connected") return
    try {
      const { data: config } = await this.client.global.config.get({ throwOnError: true })
      this.cachedGlobalConfig = config ?? null
      this.postMessage({ type: "globalConfigLoaded", config })
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch global config:", error)
    }
  }

  private async fetchAndSendIndexingStatus(): Promise<void> {
    if (!this.client) {
      if (this.cachedIndexingStatusMessage) {
        this.postMessage(this.cachedIndexingStatusMessage)
      }
      return
    }

    const config = this.connectionService.getServerConfig()
    if (!config) return

    try {
      const dir = this.getWorkspaceDirectory(this.currentSession?.id)
      const auth = Buffer.from(`kilo:${config.password}`).toString("base64")
      const res = await fetch(`${config.baseUrl}/indexing/status`, {
        headers: {
          Authorization: `Basic ${auth}`,
          ...(dir ? { "x-kilo-directory": dir } : {}),
        },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const status = (await res.json()) as IndexingStatus
      const message = {
        type: "indexingStatusLoaded",
        status,
      }
      this.cachedIndexingStatusMessage = message
      this.postMessage(message)
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch indexing status:", error)
    }
  }

  private async fetchAndSendKiloEmbeddingModels(): Promise<void> {
    const catalog = await fetchKiloEmbeddingModelCatalog()
    const message = { type: "kiloEmbeddingModelsLoaded", catalog }
    this.cachedKiloEmbeddingModelsMessage = message
    this.postMessage(message)
  }

  /**
   * Seed sessionStatusMap with current session statuses on connect.
   * Without this, the Settings panel (which has no tracked sessions) would see
   * busyCount() = 0 for sessions that were already running before it opened.
   *
   * @param reconcile When true, reset locally-busy sessions absent from the
   *   server response to idle (crash recovery). Set to false on SSE reconnects
   *   to avoid a race where a brief HTTP fetch gap causes the spinner to vanish.
   */
  private async seedSessionStatusMap(reconcile = true): Promise<void> {
    if (!this.client || this.connectionState !== "connected") return
    const dir = this.getWorkspaceDirectory()
    await seedSessionStatuses(this.client, dir, this.sessionStatusMap, (msg) => this.postMessage(msg), reconcile)
  }

  /**
   * Fetch the latest merged config and push it as configUpdated.
   * Called when global.config.updated SSE fires (config changed without a full dispose).
   */
  private async fetchAndSendConfigUpdated(): Promise<void> {
    if (!this.client || this.connectionState !== "connected") return
    try {
      const dir = this.getWorkspaceDirectory()
      const [{ data: config }, { data: global }, { data: overlay }] = await Promise.all([
        retry(() => this.client!.config.get({ directory: dir }, { throwOnError: true })),
        this.client.global.config.get({ throwOnError: true }),
        this.client.config.overlay({ directory: dir, scope: "project" }, { throwOnError: true }),
      ])
      this.cachedGlobalConfig = global ?? null
      this.cachedConfigMessage = {
        type: "configLoaded",
        config,
        globalConfig: global,
        projectConfig: overlay?.project,
        settings: { maxCost: this.maxCostSetting() },
        features: configFeatures(config),
      }
      this.postMessage({
        type: "configUpdated",
        config,
        globalConfig: global,
        projectConfig: overlay?.project,
        settings: { maxCost: this.maxCostSetting() },
        features: configFeatures(config),
      })
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch config after update:", error)
    }
  }

  /**
   * Fetch config warnings from the server and display a single consolidated
   * VS Code warning with a "Show Details" action button.
   * Only shown once per provider lifecycle (flag resets on dispose/re-create, not on SSE reconnect).
   */
  private async checkConfigWarnings(from: string): Promise<void> {
    if (this.configWarningsShown) {
      console.log("[Kilo New] KiloProvider: config warnings already shown", { from })
      return
    }
    if (!this.client) {
      console.log("[Kilo New] KiloProvider: config warnings skipped (no client)", { from })
      return
    }
    try {
      const dir = this.getWorkspaceDirectory()
      console.log("[Kilo New] KiloProvider: checking config warnings", { from, dir })
      const result = await this.client.config.warnings({ directory: dir })
      const list = result?.data ?? []
      console.log("[Kilo New] KiloProvider: config warnings fetched", { from, count: list.length })
      if (list.length === 0) return
      this.configWarningsShown = true

      const first = list[0]!
      const summary = list.length === 1 ? first.message : `${first.message} (and ${list.length - 1} more)`
      console.warn("[Kilo New] KiloProvider: showing config warnings", { from, count: list.length, path: first.path })

      const action = await vscode.window.showWarningMessage(`Config: ${summary}`, "Show Details")
      if (action === "Show Details") {
        const lines = list.map((w) => {
          const base = `${w.path}\n  ${w.message}`
          return w.detail ? `${base}\n  ${w.detail}` : base
        })
        const channel = vscode.window.createOutputChannel("Kilo Config Warnings")
        channel.clear()
        channel.appendLine(lines.join("\n\n"))
        channel.show()
      }
    } catch (err) {
      console.warn("[Kilo New] KiloProvider: checkConfigWarnings failed:", { from, err })
    }
  }

  private notificationsContext(): NotificationsContext {
    return {
      context: this.extensionContext,
      client: this.client,
      cached: () => this.cachedNotificationsMessage,
      set: (message) => {
        this.cachedNotificationsMessage = message
      },
      post: (message) => this.postMessage(message),
      notify: (id) => this.connectionService.notifyNotificationDismissed(id),
    }
  }

  private async fetchAndSendNotifications(): Promise<void> {
    await fetchNotifications(this.notificationsContext())
  }

  // Cloud session methods extracted to kilo-provider/handlers/cloud-session.ts

  private async handleDismissNotification(notificationId: string): Promise<void> {
    await dismissNotification(this.notificationsContext(), notificationId)
  }

  /** Read attention settings from VS Code config and push to webview. */
  private sendNotificationSettings(): void {
    const attention = vscode.workspace.getConfiguration("kilo-code.new.attention")
    this.postMessage({
      type: "notificationSettingsLoaded",
      settings: {
        attentionEnabled: attention.get<boolean>("enabled", false),
        attentionSound: attention.get<string>("sound", "default"),
      },
    })
  }

  private sendTimelineSetting(): void {
    const config = vscode.workspace.getConfiguration("kilo-code.new")
    this.postMessage({
      type: "timelineSettingLoaded",
      visible: config.get<boolean>("showTaskTimeline", true),
    })
  }

  private sendWorkStyle(): void {
    this.postMessage(getWorkStylePayload())
  }

  private async fetchAndSendSandboxDefault(directory = this.getContextDirectory(), requestID?: string): Promise<void> {
    const revision = ++this.sandboxRevision
    const generation = this.connectionGeneration
    const client = this.client
    const sandbox = sandboxClient(client)
    if (!client || !sandbox || this.connectionState !== "connected") return
    try {
      const [desired, result] = await Promise.all([
        sandboxDefault(this.connectionService.sandboxPreference, client, directory),
        sandbox.support({ directory }, { throwOnError: true }),
      ])
      if (this.connectionState !== "connected" || this.connectionGeneration !== generation || this.client !== client)
        return
      this.postMessage({
        type: "sandboxDefaultStatus",
        desired,
        enabled: desired && result.data.available,
        available: result.data.available,
        reason: result.data.reason,
        revision,
        requestID,
      })
    } catch (error) {
      if (this.connectionState !== "connected" || this.connectionGeneration !== generation || this.client !== client)
        return
      this.postMessage({
        type: "sandboxDefaultStatus",
        desired: false,
        enabled: false,
        available: false,
        reason: getErrorMessage(error) || "Failed to load sandbox default",
        revision,
        requestID,
      })
    }
  }

  private async handleSetSandboxDefault(
    enabled: boolean,
    requestID: string,
    directory = this.getContextDirectory(),
  ): Promise<void> {
    const client = this.client
    const sandbox = sandboxClient(client)
    if (!client || !sandbox || this.connectionState !== "connected") {
      await this.fetchAndSendSandboxDefault(directory, requestID)
      return
    }
    try {
      await this.connectionService.sandboxPreference.set(enabled, async () => {
        const { data } = await sandbox.support({ directory }, { throwOnError: true })
        if (!data.available) throw new Error(data.reason ?? "Sandbox backend is unavailable")
      })
      await this.fetchAndSendSandboxDefault(directory, requestID)
      vscode.window.showInformationMessage(
        enabled ? "Sandbox enabled for new sessions" : "Sandbox disabled for new sessions",
      )
    } catch (error) {
      this.postMessage({
        type: "sandboxDefaultStatus",
        desired: this.connectionService.sandboxPreference.resolve(false),
        enabled: false,
        available: false,
        reason: getErrorMessage(error) || "Failed to update sandbox default",
        revision: ++this.sandboxRevision,
        requestID,
      })
    }
  }

  private postSandboxError(sessionID: string, error: unknown, revision: number, requestID?: string): void {
    this.postMessage({
      type: "sandboxStatusError",
      sessionID,
      directory: this.getWorkspaceDirectory(sessionID),
      message: getErrorMessage(error) || "Failed to update sandbox",
      requestID,
      revision,
    })
  }

  private async fetchAndSendSandboxStatus(sessionID: string, requestID?: string): Promise<void> {
    const revision = ++this.sandboxRevision
    const generation = this.connectionGeneration
    const client = this.client
    const sandbox = client?.sandbox
    if (!sandbox?.status) return
    if (this.connectionState !== "connected") {
      this.postSandboxError(sessionID, "Not connected to CLI backend", revision, requestID)
      return
    }
    try {
      const directory = this.getWorkspaceDirectory(sessionID)
      const { data } = await sandbox.status({ sessionID, directory }, { throwOnError: true })
      if (this.connectionState !== "connected" || this.connectionGeneration !== generation || this.client !== client)
        return
      if (!sameDirectory(data.directory, this.getWorkspaceDirectory(sessionID))) {
        if (requestID) void this.fetchAndSendSandboxStatus(sessionID, requestID)
        return
      }
      this.postMessage({ type: "sandboxStatus", sessionID, revision, ...data, requestID })
    } catch (error) {
      if (this.connectionState !== "connected" || this.connectionGeneration !== generation || this.client !== client)
        return
      this.postSandboxError(sessionID, error, revision, requestID)
    }
  }

  private sandboxKey(input: {
    sessionID?: string
    draftID?: string
    agentManagerContext?: string
    contextDirectory?: string
  }): string {
    if (input.sessionID) return `session:${input.sessionID}`
    if (input.draftID) return `draft:${input.draftID}`
    return `context:${input.agentManagerContext ?? ""}:${input.contextDirectory ?? this.getRootDirectory()}`
  }

  private handleToggleSandbox(input: {
    sessionID?: string
    draftID?: string
    requestID: string
    agentManagerContext?: string
    contextDirectory?: string
  }): Promise<void> {
    const key = this.sandboxKey(input)
    const pending = this.sandboxTransitions.get(key)
    if (pending) return pending.catch(() => undefined)
    const operation = this.runToggleSandbox(input, key)
    this.sandboxTransitions.set(key, operation)
    return operation
      .catch(() => undefined)
      .finally(() => {
        for (const [id, active] of this.sandboxTransitions) {
          if (active === operation) this.sandboxTransitions.delete(id)
        }
      })
  }

  private async runToggleSandbox(
    input: {
      sessionID?: string
      draftID?: string
      requestID: string
      agentManagerContext?: string
      contextDirectory?: string
    },
    key: string,
  ): Promise<void> {
    const revision = ++this.sandboxRevision
    if (!input.sessionID) {
      const error = new Error("Sandbox session is required")
      this.postSandboxError("", error, revision, input.requestID)
      throw error
    }
    const generation = this.connectionGeneration
    const client = this.client
    const sandbox = client?.sandbox
    if (!sandbox?.toggle || this.connectionState !== "connected") {
      const error = new Error("Not connected to CLI backend")
      this.postSandboxError(input.sessionID ?? "", error, revision, input.requestID)
      throw error
    }
    const resolved = await this.resolveSession(
      input.sessionID,
      input.draftID,
      input.agentManagerContext,
      input.contextDirectory,
    ).catch((error) => {
      this.postSandboxError(input.sessionID ?? "", error, revision, input.requestID)
      throw error
    })
    if (!resolved) {
      const error = new Error("Failed to resolve sandbox session")
      this.postSandboxError(input.sessionID ?? "", error, revision, input.requestID)
      throw error
    }
    const operation = this.sandboxTransitions.get(key)
    if (operation) this.sandboxTransitions.set(`session:${resolved.sid}`, operation)
    if (this.connectionGeneration !== generation || this.client !== client) {
      throw new Error("Sandbox connection changed")
    }
    try {
      const { data } = await sandbox.toggle(
        { sessionID: resolved.sid, directory: resolved.dir },
        { throwOnError: true },
      )
      if (this.connectionState !== "connected" || this.connectionGeneration !== generation || this.client !== client) {
        throw new Error("Sandbox connection changed")
      }
      if (!data.available) throw new Error(data.reason ?? "Sandbox backend is unavailable")
      if (!sameDirectory(data.directory, this.getWorkspaceDirectory(resolved.sid))) {
        throw new Error("Session directory changed during sandbox toggle")
      }
      const remembered = await this.connectionService.sandboxPreference
        .set(data.enabled)
        .then(() => true)
        .catch((error) => {
          console.error("[Kilo New] Failed to persist sandbox default:", error)
          return false
        })
      this.postMessage({
        type: "sandboxStatus",
        sessionID: resolved.sid,
        revision,
        ...data,
        requestID: input.requestID,
      })
      if (!remembered) {
        vscode.window.showWarningMessage(
          `Sandbox ${data.enabled ? "enabled" : "disabled"} for this session, but the new-session default could not be saved`,
        )
        return
      }
      vscode.window.showInformationMessage(data.enabled ? "Sandbox enabled" : "Sandbox disabled")
    } catch (error) {
      if (this.connectionState === "connected" && this.connectionGeneration === generation && this.client === client) {
        this.postSandboxError(resolved.sid, error, revision, input.requestID)
        void this.fetchAndSendSandboxStatus(resolved.sid)
      }
      throw error
    }
  }

  private async handleUpdateConfig(
    partial: Partial<Config>,
    project: Partial<Config> = {},
    globalUnset: string[][] = [],
    projectUnset: string[][] = [],
  ): Promise<void> {
    if (!this.client || this.connectionState !== "connected") {
      this.postMessage({ type: "configUpdateFailed", message: "Not connected to CLI backend" })
      return
    }

    const refreshProviders =
      partial.provider !== undefined ||
      partial.disabled_providers !== undefined ||
      partial.enabled_providers !== undefined ||
      partial.hide_prompt_training_models !== undefined
    const refreshAgents =
      partial.default_agent !== undefined ||
      partial.agent !== undefined ||
      project.default_agent !== undefined ||
      project.agent !== undefined
    const hasGlobal = Object.keys(partial).length > 0 || globalUnset.length > 0
    const hasProject = Object.keys(project).length > 0 || projectUnset.length > 0

    this.pending++
    const dir = this.getWorkspaceDirectory()

    try {
      await this.connectionService.drainPendingPrompts()
      if (hasGlobal) {
        await this.client.config.overlayUpdate(
          { scope: "global", set: partial, unset: globalUnset, directory: dir },
          { throwOnError: true },
        )
      }
      if (hasProject) {
        await this.client.config.overlayUpdate(
          { scope: "project", set: project, unset: projectUnset, directory: dir },
          { throwOnError: true },
        )
      }
    } catch (error) {
      this.postConfigFailure(error)
      this.pending--
      return
    }

    try {
      const [{ data: merged }, { data: global }, { data: overlay }] = await Promise.all([
        retry(() => this.client!.config.get({ directory: dir }, { throwOnError: true })),
        this.client.global.config.get({ throwOnError: true }),
        this.client.config.overlay({ directory: dir, scope: "project" }, { throwOnError: true }),
      ])
      this.cachedGlobalConfig = global ?? null
      this.cachedConfigMessage = {
        type: "configLoaded",
        config: merged,
        globalConfig: global,
        projectConfig: overlay?.project,
        settings: { maxCost: this.maxCostSetting() },
        features: configFeatures(merged),
      }
      this.postMessage({
        type: "configUpdated",
        config: merged,
        globalConfig: global,
        projectConfig: overlay?.project,
        settings: { maxCost: this.maxCostSetting() },
        features: configFeatures(merged),
      })
      this.requirements.clear()
      await Promise.all([
        refreshProviders ? this.fetchAndSendProviders() : Promise.resolve(),
        refreshAgents ? this.fetchAndSendAgents() : Promise.resolve(),
      ])
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Config write succeeded but post-write refresh failed:", error)
      const patch =
        partial.indexing === undefined && project.indexing === undefined
          ? { ...partial, ...project }
          : { ...partial, ...project, indexing: { ...(partial.indexing ?? {}), ...(project.indexing ?? {}) } }
      const cached = (this.cachedConfigMessage as { config?: unknown } | null)?.config
      const features = (this.cachedConfigMessage as { features?: unknown } | null)?.features
      const optimistic =
        cached && typeof cached === "object" ? { ...(cached as Record<string, unknown>), ...patch } : patch
      this.postMessage({
        type: "configUpdated",
        config: optimistic,
        globalConfig: this.cachedGlobalConfig ?? undefined,
        settings: { maxCost: this.maxCostSetting() },
        features: features ?? configFeatures(optimistic as Config),
      })
      this.requirements.clear()
    } finally {
      this.pending--
    }
  }
  private postConfigFailure(error: unknown): void {
    console.error("[Kilo New] KiloProvider: Failed to update config:", error)
    this.postMessage({
      type: "configUpdateFailed",
      message: getErrorMessage(error) || "Failed to update config",
      details: getConfigErrorDetails(error),
    })
  }
  private async resolveSession(sessionID?: string, draftID?: string, context?: string, contextDirectory?: string) {
    if (!this.client) return undefined

    const dir = resolveNewSessionDirectory({
      sessionID,
      currentSessionID: this.currentSession?.id,
      contextSessionID: this.contextSessionID,
      agentManagerContext: context,
      contextDirectory,
      sessionDirectories: this.sessionDirectories,
      workspaceDirectory: this.getRootDirectory(),
    })

    if (!sessionID && !this.currentSession) {
      const key = `${draftID ?? context ?? "new"}\0${dir}`
      const pending = this.sessionCreations.get(key)
      if (pending) return pending
      const creation = (async () => {
        const metadata = await sandboxSessionMetadata(this.connectionService.sandboxPreference, this.client!, dir)
        const { data: session } = await this.client!.session.create(
          { directory: dir, platform: this.opts.platform, metadata },
          { throwOnError: true },
        )
        this.stopCurrentSessionProcesses(session.id)
        this.setCurrentSession(session)
        this.contextSessionID = session.id
        this.focusSession(session.id)
        this.trackDirectory(session.id, dir)
        this.trackedSessionIds.add(session.id)
        this.postMessage({
          type: "sessionCreated",
          session: this.sessionToWebview(session),
          draftID,
        })
        return { sid: session.id, dir }
      })().finally(() => this.sessionCreations.delete(key))
      this.sessionCreations.set(key, creation)
      return creation
    }

    const sid = sessionID || this.currentSession?.id
    if (!sid) throw new Error("No session available")
    this.trackedSessionIds.add(sid)
    return { sid, dir }
  }

  /** Abort controllers for active retry loops, keyed by session ID */
  private retryAbortControllers = new Map<string, AbortController>()

  /** Execute an SDK call with visible exponential backoff for retryable HTTP errors. */
  private async withRetry(
    fn: () => Promise<{ error?: unknown; response?: Response }>,
    sid: string,
    messageID?: string,
  ): Promise<void> {
    const abortController = new AbortController()
    this.retryAbortControllers.set(sid, abortController)

    try {
      for (let attempt = 1; ; attempt++) {
        if (abortController.signal.aborted) {
          // User cancelled — return normally without triggering sendMessageFailed
          return
        }

        const result = await fn()
        if (!result.error) return
        if (this.confirmations.has(messageID)) return

        const status = result.response?.status ?? 0

        // Non-retryable status codes fail immediately without retry
        if (!retryable(status)) {
          this.postMessage({ type: "sessionStatus", sessionID: sid, status: "idle" })
          throw result.error
        }

        // Stop retrying after MAX_RETRIES attempts
        if (attempt >= MAX_RETRIES) {
          this.postMessage({ type: "sessionStatus", sessionID: sid, status: "idle" })
          throw result.error
        }

        const delay = backoff(attempt, result.response?.headers)
        console.log(`[Kilo New] KiloProvider: Retry on ${status}, attempt ${attempt}/${MAX_RETRIES}, delay ${delay}ms`)

        this.postMessage({
          type: "sessionStatus",
          sessionID: sid,
          status: "retry",
          attempt,
          message: `Error (${status}). Retrying...`,
          next: Date.now() + delay,
        })

        // Wait for delay or until aborted
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer)
            abortController.signal.removeEventListener("abort", done)
            resolve()
          }
          const timer = setTimeout(done, delay)
          abortController.signal.addEventListener("abort", done, { once: true })
        })
        if (this.confirmations.has(messageID)) return
      }
    } finally {
      this.retryAbortControllers.delete(sid)
    }
  }

  /** Cancel an active retry loop for a session */
  private cancelRetry(sid: string): void {
    const controller = this.retryAbortControllers.get(sid)
    if (controller) {
      controller.abort()
      this.postMessage({ type: "sessionStatus", sessionID: sid, status: "idle" })
    }
  }

  private maxCostSetting(): number {
    return this.setMaxCost(vscode.workspace.getConfiguration("kilo-code.new").get<number>("maxCost", 0))
  }

  private setMaxCost(value: unknown): number {
    maxCost = MaxCostNudge.normalizeLimit(typeof value === "number" ? value : Number(value)) ?? 0
    this.costs.setLimit(maxCost)
    return maxCost
  }

  private costLimit(): number | undefined {
    const limit = maxCost
    this.costs.setLimit(limit)
    return this.costs.limit
  }

  private requestCostAlert(sid: string, cost: number): void {
    const limit = this.costLimit()
    if (limit === undefined || !Number.isFinite(cost) || cost < limit) return

    this.costs.setSessionCost(sid, cost)
    const alert = this.costs.check(sid)
    if (!alert) return
    this.activeAlerts.set(sid, alert.limit)
    this.postMessage({
      type: "sessionCostAlert",
      sessionID: sid,
      limit: alert.limit,
      cost: MaxCostNudge.formatCost(alert.cost),
    })
  }

  private async handleCostAlertResponse(sid: string, limit: number, response: MaxCostChoice): Promise<void> {
    this.activeAlerts.delete(sid)
    this.costs.resolve(sid, response, limit)
    if (response !== "continue") await this.handleAbort(sid)
    this.postMessage({ type: "sessionCostAlertResolved", sessionID: sid, limit })
  }

  private resetMessageCosts(
    sid: string,
    messages: Array<{ id: string; sessionID: string; role?: string; cost?: number }>,
  ) {
    const total = this.costs.resetMessageCosts(sid, messages)
    this.requestCostAlert(sid, total)
  }

  private updateMessageCost(
    sid: string,
    id: string,
    role: string | undefined,
    cost: number | undefined,
  ): number | undefined {
    if (role !== "assistant" || !Number.isFinite(cost)) return undefined
    return this.costs.updateMessageCost(sid, id, role, cost)
  }

  private removeMessageCost(id: string): void {
    this.costs.removeMessageCost(id)
  }

  private async handleSendMessage(
    text: string,
    messageID?: string,
    sessionID?: string,
    draftID?: string,
    providerID?: string,
    modelID?: string,
    agent?: string,
    variant?: string,
    files?: MessageFile[],
    review?: ReviewMessageData,
    context?: string,
    contextDirectory?: string,
  ): Promise<void> {
    if (!this.client) {
      this.postMessage({
        type: "sendMessageFailed",
        error: "Not connected to CLI backend",
        text,
        sessionID,
        draftID,
        messageID,
        files,
        review,
      })
      return
    }

    let resolved: { sid: string; dir: string } | undefined
    try {
      const sandbox = this.sandboxTransitions.get(
        this.sandboxKey({ sessionID, draftID, agentManagerContext: context, contextDirectory }),
      )
      resolved = await this.resolveSession(sessionID, draftID, context, contextDirectory)
      if (!resolved) throw new Error("Failed to resolve session")
      if (sandbox) await sandbox
      const sid = resolved.sid
      const dir = resolved.dir

      const parts: Array<TextPartInput | FilePartInput> = []
      if (files) {
        for (const f of files) {
          parts.push({ type: "file", mime: f.mime, url: f.url, filename: f.filename, source: f.source })
        }
      }
      parts.push({ type: "text", text, metadata: review ? reviewMetadata(review) : undefined })

      await this.requirements.assertAgentRequirements(agent, dir)
      const editorContext = await this.gatherEditorContext(dir)

      if (messageID) {
        this.connectionService.recordMessageSessionId(messageID, sid)
      }

      await this.checkpoints.get(sid)
      await runWithMessageConfirmation(this.confirmations, messageID, "KiloProvider: Message request", () =>
        this.withRetry(
          () =>
            this.client!.session.promptAsync({
              sessionID: sid,
              directory: dir,
              messageID,
              parts,
              model: providerID && modelID ? { providerID, modelID } : undefined,
              agent,
              variant,
              editorContext,
              snapshotInitialization: this.opts.snapshotInitialization,
            }),
          sid,
          messageID,
        ),
      )
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to send message:", error)
      this.postMessage({
        type: "sendMessageFailed",
        error: getErrorMessage(error) || "Failed to send message",
        text,
        sessionID: resolved?.sid ?? sessionID,
        draftID,
        messageID,
        files,
        review,
      })
    }
  }

  private async handleSendCommand(
    command: string,
    args: string,
    messageID?: string,
    sessionID?: string,
    draftID?: string,
    providerID?: string,
    modelID?: string,
    agent?: string,
    variant?: string,
    files?: MessageFile[],
    context?: string,
    contextDirectory?: string,
  ): Promise<void> {
    if (!this.client) {
      this.postMessage({
        type: "sendMessageFailed",
        error: "Not connected to CLI backend",
        text: `/${command} ${args}`.trim(),
        sessionID,
        draftID,
        messageID,
        files,
      })
      return
    }

    let resolved: { sid: string; dir: string } | undefined
    try {
      const sandbox = this.sandboxTransitions.get(
        this.sandboxKey({ sessionID, draftID, agentManagerContext: context, contextDirectory }),
      )
      resolved = await this.resolveSession(sessionID, draftID, context, contextDirectory)
      if (!resolved) throw new Error("Failed to resolve session")
      if (sandbox) await sandbox
      const sid = resolved.sid
      const dir = resolved.dir

      if (messageID) {
        this.connectionService.recordMessageSessionId(messageID, sid)
      }

      const parts = files?.map((f) => ({
        type: "file" as const,
        mime: f.mime,
        url: f.url,
        filename: f.filename,
        source: f.source,
      }))

      await this.requirements.assertAgentRequirements(agent, dir)
      await this.checkpoints.get(sid)
      await runWithMessageConfirmation(this.confirmations, messageID, "KiloProvider: Command request", () =>
        this.withRetry(
          () =>
            this.client!.session.command({
              sessionID: sid,
              directory: dir,
              command,
              arguments: args,
              messageID,
              model: providerID && modelID ? `${providerID}/${modelID}` : undefined,
              agent,
              variant,
              parts,
              snapshotInitialization: this.opts.snapshotInitialization,
            }),
          sid,
          messageID,
        ),
      )
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to send command:", error)
      this.postMessage({
        type: "sendMessageFailed",
        error: getErrorMessage(error) || "Failed to send command",
        text: `/${command} ${args}`.trim(),
        sessionID: resolved?.sid ?? sessionID,
        draftID,
        messageID,
        files,
      })
    }
  }

  private async handleAbort(sessionID?: string): Promise<void> {
    const sid = sessionID || this.currentSession?.id
    if (!this.client || !sid || !(await this.aborts.stop(this.client, sid, this.getWorkspaceDirectory(sid)))) return
    this.sessionStatusMap.set(sid, "idle")
    this.streams.flush(sid)
    this.postMessage({ type: "sessionTurnClosed", sessionID: sid, reason: "interrupted" })
    this.postMessage({ type: "sessionStatus", sessionID: sid, status: "idle" })
  }

  private async handleRevertSession(sessionID: string, messageID: string, partID?: string): Promise<void> {
    if (!this.client) return
    const dir = this.getWorkspaceDirectory(sessionID)
    const { data, error } = await this.client.session.revert({ sessionID, messageID, partID, directory: dir })
    if (error) {
      console.error("[Kilo New] KiloProvider: Failed to revert session:", error)
      this.postMessage({ type: "error", message: "Failed to revert session", sessionID })
      throw error
    }
    if (!data) throw new Error("Revert returned no session")
    this.refreshes.set(sessionID, (this.refreshes.get(sessionID) ?? 0) + 1)
    if (this.currentSession?.id === sessionID) this.setCurrentSession(data)
    this.postMessage({ type: "sessionUpdated", session: sessionToWebview(data) })
  }

  private async handleUnrevertSession(sessionID: string): Promise<void> {
    if (!this.client) return
    const dir = this.getWorkspaceDirectory(sessionID)
    const { data, error } = await this.client.session.unrevert({ sessionID, directory: dir })
    if (error) {
      console.error("[Kilo New] KiloProvider: Failed to unrevert session:", error)
      this.postMessage({ type: "error", message: "Failed to redo session", sessionID })
      throw error
    }
    if (!data) throw new Error("Redo returned no session")
    this.refreshes.set(sessionID, (this.refreshes.get(sessionID) ?? 0) + 1)
    if (this.currentSession?.id === sessionID) this.setCurrentSession(data)
    this.postMessage({ type: "sessionUpdated", session: sessionToWebview(data) })
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

  // Permission + question handlers extracted to kilo-provider/handlers/permission.ts and question.ts

  private get permissionCtx(): PermissionContext {
    return {
      client: this.client,
      currentSessionId: this.currentSession?.id,
      trackedSessionIds: this.trackedSessionIds,
      sessionDirectories: this.sessionDirectories,
      extraDirectories: this.opts.worktreeDirectories,
      postMessage: (msg) => this.postMessage(msg),
      getWorkspaceDirectory: (sid) => this.getWorkspaceDirectory(sid),
      recordPermissionDirectory: (id, dir) => this.connectionService.recordPermissionDirectory(id, dir),
      getPermissionDirectory: (id) => this.connectionService.getPermissionDirectory(id),
      clearPermissionDirectory: (id) => this.connectionService.clearPermissionDirectory(id),
      prunePermissionDirectories: (active, dirs) => this.connectionService.prunePermissionDirectories(active, dirs),
    }
  }

  private get questionCtx() {
    return {
      client: this.client,
      currentSessionId: this.currentSession?.id,
      trackedSessionIds: this.trackedSessionIds,
      sessionDirectories: this.sessionDirectories,
      extraDirectories: this.opts.worktreeDirectories,
      postMessage: (msg: unknown) => this.postMessage(msg),
      getWorkspaceDirectory: (sid?: string) => this.getWorkspaceDirectory(sid),
      recordQuestionDirectory: (id: string, dir: string) => this.connectionService.recordQuestionDirectory(id, dir),
      getQuestionDirectory: (id: string) => this.connectionService.getQuestionDirectory(id),
      clearQuestionDirectory: (id: string) => this.connectionService.clearQuestionDirectory(id),
      getQuestionRevision: () => this.connectionService.getQuestionRevision(),
      pruneQuestionDirectories: (active: Set<string>, dirs: Set<string>) =>
        this.connectionService.pruneQuestionDirectories(active, dirs),
    }
  }

  // Cloud session handlers extracted to kilo-provider/handlers/cloud-session.ts

  private get cloudSessionCtx(): CloudSessionContext {
    const self = this
    return {
      client: this.client,
      get currentSession() {
        return self.currentSession
      },
      set currentSession(session) {
        self.stopCurrentSessionProcesses(session?.id)
        self.setCurrentSession(session)
        if (session) self.contextSessionID = session.id
      },
      trackedSessionIds: this.trackedSessionIds,
      connectionService: this.connectionService,
      postMessage: (msg) => this.postMessage(msg),
      getWorkspaceDirectory: (sid) => this.getWorkspaceDirectory(sid),
      gatherEditorContext: () => this.gatherEditorContext(),
      runWithMessageConfirmation: (id, label, run) => runWithMessageConfirmation(this.confirmations, id, label, run),
    }
  }

  // Auth handlers extracted to kilo-provider/handlers/auth.ts

  private get authCtx(): AuthContext {
    return {
      client: this.client,
      postMessage: (msg) => this.postMessage(msg),
      getWorkspaceDirectory: () => this.getWorkspaceDirectory(),
      disposeGlobal: () => this.disposeGlobal(),
      fetchAndSendProviders: () => this.fetchAndSendProviders(),
      fetchAndSendAgents: () => this.fetchAndSendAgents(),
    }
  }

  private async disposeGlobal(): Promise<void> {
    if (!this.client) return

    await this.client.global
      .dispose()
      .catch((e: unknown) => console.warn("[Kilo New] KiloProvider: global.dispose() after org switch failed:", e))

    // Org switch succeeded — refresh profile and providers independently (best-effort)
    try {
      const profileResult = await this.client!.kilo.profile()
      // Broadcast to all webviews (sidebar, profile tab, agent manager, etc.)
      this.connectionService.notifyProfileChanged(profileResult.data ?? null)
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to refresh profile after org switch:", error)
    }
    try {
      await this.fetchAndSendProviders()
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to refresh providers after org switch:", error)
    }
  }

  /**
   * Handle a generic setting update from the webview.
   * The key uses dot notation relative to `kilo-code.new` (e.g. "browserAutomation.enabled").
   */
  private async handleUpdateSetting(key: string, value: unknown): Promise<void> {
    if (key === "maxCost") {
      const normalized = this.setMaxCost(value)
      await vscode.workspace
        .getConfiguration("kilo-code.new")
        .update("maxCost", normalized, vscode.ConfigurationTarget.Global)
      for (const sid of this.trackedSessionIds) {
        const oldLimit = this.activeAlerts.get(sid)
        if (oldLimit !== undefined) {
          this.activeAlerts.delete(sid)
          this.postMessage({ type: "sessionCostAlertResolved", sessionID: sid, limit: oldLimit })
        }
        this.costs.rearm(sid)
        this.requestCostAlert(sid, this.costs.sessionCost(sid))
      }
      return
    }
    const { section, leaf } = buildSettingPath(key)
    if (section === "autocomplete" && !validAutocompleteSetting(leaf, value)) return
    if (section === "indexing" && !validIndexingSetting(leaf, value)) return
    const config = vscode.workspace.getConfiguration(`kilo-code.new${section ? `.${section}` : ""}`)
    // Normalize a webview-side clear to `undefined` so VS Code removes the
    // key from settings.json rather than persisting a literal `null`. This
    // lets the runtime fall back to the resolved default.
    const next = value === null ? undefined : value
    await config.update(leaf, next, vscode.ConfigurationTarget.Global)
    if (isWorkStyleSetting(key)) this.sendWorkStyle()
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
      const leaf = parts[parts.length - 1]!
      const config = vscode.workspace.getConfiguration(section)
      await config.update(leaf, undefined, vscode.ConfigurationTarget.Global)
    }

    // Clear globalState items that are not part of the configuration
    await this.extensionContext?.globalState.update("variantSelections", undefined)
    await this.extensionContext?.globalState.update("recentModels", undefined)
    await this.extensionContext?.globalState.update("kilo.dismissedNotificationIds", undefined)
    await this.extensionContext?.globalState.update("kilo.agentMigrationBannerDismissed", undefined)
    await this.extensionContext?.globalState.update("kilo.marketplace.dismissedSuggestions", undefined)

    // Re-send all settings to the webview so the UI reflects the reset
    this.postMessage(buildAutocompleteSettingsMessage())
    this.postMessage(buildIndexingSettingsMessage())
    this.sendBrowserSettings()
    this.sendNotificationSettings()
    this.sendTimelineSetting()
    this.sendWorkStyle()
    await ModelState.reset(this.client, (msg) => this.postMessage(msg))

    // Re-send globalState items to the webview
    this.postMessage({ type: "variantsLoaded", variants: {} })
    this.postMessage({ type: "recentsLoaded", recents: [] })

    // Re-fetch notifications to reflect cleared dismissed IDs
    await this.fetchAndSendNotifications()

    vscode.window.showInformationMessage("Kilo Code settings have been reset to defaults.")
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
   * Read the current Claude Code compatibility setting and push it to the webview.
   */
  private sendClaudeCompatSetting(): void {
    const enabled = vscode.workspace.getConfiguration("kilo-code.new").get<boolean>("claudeCodeCompat", false)
    this.postMessage({
      type: "claudeCompatSettingLoaded",
      enabled: enabled ?? false,
    })
  }

  /** Re-fetch all server-side state after an auth change. */
  private async reloadAfterAuthChange(): Promise<void> {
    this.requirements.clear()
    await this.fetchAndSendConfig()
    await Promise.all([
      this.fetchAndSendProviders(),
      this.fetchAndSendAgents(),
      this.fetchAndSendSkills(),
      this.fetchAndSendCommands(),
      this.fetchAndSendIndexingStatus(),
      this.fetchAndSendNotifications(),
    ])
  }

  /** Reload config, skills, agents, and commands from disk by rebooting the instance. */
  private async handleReload(): Promise<void> {
    if (!this.client) {
      console.warn("[Kilo New] handleReload: no client connection")
      return
    }
    const dir = this.getWorkspaceDirectory(this.currentSession?.id)
    try {
      await this.client.instance.reload({ directory: dir }, { throwOnError: true })
    } catch (err) {
      const status =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { status?: number } }).response?.status
          : undefined
      if (status === 409) {
        vscode.window.showWarningMessage(
          "Cannot reload while a session is running. Wait for it to finish or abort it first.",
        )
      } else {
        console.error("[Kilo New] handleReload: reload endpoint failed:", err)
        vscode.window.showErrorMessage("Reload failed. See extension logs for details.")
      }
      return
    }
    this.clearCommandsCache()
    if (!sameDirectory(dir, this.getWorkspaceDirectory())) {
      await this.reloadAfterAuthChange()
    }
  }

  /** Public reload entry point for VS Code commands. */
  async reload(): Promise<void> {
    return this.handleReload()
  }

  private mapSyncEventToWebviewMessage(event: LegacySyncEvent) {
    switch (event.type) {
      case "message.updated": {
        const info = event.properties.info
        return {
          type: "messageCreated" as const,
          message: {
            ...info,
            createdAt: new Date(info.time.created).toISOString(),
          },
        }
      }
      case "message.removed":
        return {
          type: "messageRemoved" as const,
          sessionID: event.properties.sessionID,
          messageID: event.properties.messageID,
        }
      case "message.part.updated":
        return {
          type: "partUpdated" as const,
          sessionID: event.properties.sessionID,
          messageID: event.properties.part.messageID,
          part: event.properties.part,
        }
      case "message.part.removed":
        return {
          type: "partRemoved" as const,
          sessionID: event.properties.sessionID,
          messageID: event.properties.messageID,
          partID: event.properties.partID,
        }
      case "session.created":
        return {
          type: "sessionCreated" as const,
          session: this.sessionToWebview(event.properties.info),
        }
      case "session.updated":
        return {
          type: "sessionUpdated" as const,
          session:
            this.currentSession?.id === event.properties.sessionID
              ? this.sessionToWebview(this.currentSession)
              : sessionPatchToWebview(event.properties.sessionID, event.properties.info),
        }
      case "session.deleted":
        return {
          type: "sessionDeleted" as const,
          sessionID: event.properties.sessionID,
        }
    }
  }

  private resolveEventSessionId(event: ProviderEvent): string | undefined {
    switch (event.type) {
      case "session.created":
      case "session.updated":
      case "session.deleted":
        return event.properties.sessionID
      case "message.updated":
        this.connectionService.recordMessageSessionId(event.properties.info.id, event.properties.sessionID)
        return event.properties.sessionID
      case "message.removed":
      case "message.part.updated":
      case "message.part.removed":
        return event.properties.sessionID
      default:
        return this.connectionService.resolveEventSessionId(event)
    }
  }

  private postModelUsageChanged(event: ProviderEvent, sessionID: string | undefined): boolean {
    if (!sessionID || this.trackedSessionIds.has(sessionID)) return false
    if (event.type === "session.created") {
      const parent = event.properties.info.parentID
      if (!parent || !this.modelUsageSessionIds.has(parent)) return false
      this.modelUsageSessionIds.add(sessionID)
      this.postMessage({ type: "sessionModelUsageChanged", sessionID })
      return true
    }
    if (!this.modelUsageSessionIds.has(sessionID)) return false
    if (event.type === "message.part.updated") {
      const part = event.properties.part as {
        type?: string
        tool?: string
        metadata?: { sessionId?: string }
        state?: { metadata?: { sessionId?: string } }
      }
      const child = childID(part)
      if (child && !this.modelUsageSessionIds.has(child)) {
        this.modelUsageSessionIds.add(child)
        this.postMessage({ type: "sessionModelUsageChanged", sessionID: child })
        return true
      }
    }
    const changed =
      event.type === "message.removed" ||
      event.type === "message.part.removed" ||
      event.type === "session.deleted" ||
      (event.type === "message.part.updated" && event.properties.part.type === "step-finish")
    if (!changed) return false
    if (event.type === "session.deleted") this.modelUsageSessionIds.delete(sessionID)
    this.postMessage({ type: "sessionModelUsageChanged", sessionID })
    return true
  }

  /**
   * Handle SSE events from the CLI backend.
   * Filters events by project ID and tracked session IDs so each webview only sees its own sessions.
   */
  private handleEvent(event: ProviderEvent, directory?: string): void {
    if (event.type === "kilo-sessions.remote-status-changed") {
      this.remoteService?.updateFromEvent({ enabled: event.properties.enabled, connected: event.properties.connected })
      return
    }

    if (event.type === "memory.status" || event.type === "memory.updated" || event.type === "memory.error") {
      const props = event.properties as { sessionID?: unknown; detail?: unknown; reason?: unknown }
      const eventSessionID = typeof props.sessionID === "string" ? props.sessionID : undefined
      const active = this.currentSession?.id
      const local =
        !directory || sameDirectory(directory, this.getProjectDirectory(active) ?? this.getWorkspaceDirectory(active))
      const trackedById = Boolean(eventSessionID && this.trackedSessionIds.has(eventSessionID))
      // Directory-scoped events (enable/disable/rebuild/configure/purge) carry no
      // sessionID, so also match any tracked session sharing the event directory —
      // e.g. a non-active Agent Manager tab on the same worktree.
      const trackedByDir = directory
        ? [...this.sessionDirectories.entries()]
            .filter(([sid, dir]) => this.trackedSessionIds.has(sid) && sameDirectory(directory, dir))
            .map(([sid]) => sid)
        : []
      const tracked = trackedById || trackedByDir.length > 0
      if (!local && !tracked) return
      if (trackedById && eventSessionID && directory) this.trackDirectory(eventSessionID, directory)
      const targets = new Set<string | undefined>()
      if (trackedById && eventSessionID) targets.add(eventSessionID)
      for (const sid of trackedByDir) targets.add(sid)
      if (local && active) targets.add(active)
      if (targets.size === 0 && local) targets.add(undefined)
      const detail =
        props.detail && typeof props.detail === "object"
          ? props.detail
          : event.type === "memory.error" && typeof props.reason === "string"
            ? { type: "error", message: props.reason, reason: props.reason }
            : undefined
      for (const sessionID of targets) {
        if (detail) {
          this.postMessage({
            type: "memoryEvent",
            sessionID,
            detail,
          })
        }
        void this.memory.fetch(sessionID, false)
      }
      return
    }

    // Drop session events from other projects before any tracking logic.
    // This must come first: the trackedSessionIds guard below would otherwise
    // let a foreign session through if it was accidentally tracked.
    if (
      !isLegacySyncEvent(event) &&
      !isFullSessionUpdatedEvent(event) &&
      isEventFromForeignProject(event, this.projectID)
    )
      return
    if (
      this.projectID &&
      (event.type === "session.created" || event.type === "session.updated") &&
      event.properties.info.projectID !== undefined &&
      event.properties.info.projectID !== null &&
      event.properties.info.projectID !== this.projectID
    ) {
      return
    }

    if (event.type === "mcp.browser.open.failed") {
      McpOAuth.openMcpOAuthUrlOnce(event.properties.url)
      return
    }

    if (event.type === "message.updated") {
      this.confirmations.confirm(event.properties.info.id)
    }

    // session.status events pass the onEventFiltered pre-filter for all providers (see line 842),
    // so this runs on every KiloProvider instance — including the Settings panel which has no
    // tracked sessions. Update sessionStatusMap and forward to webview before the
    // trackedSessionIds guard so the Settings panel's allStatusMap stays current for the
    // busy-session warning on Save.
    if (event.type === "session.status") {
      const sid = event.properties.sessionID
      const prev = this.sessionStatusMap.get(sid)
      if ((prev === undefined || prev === "idle") && event.properties.status.type !== "idle") {
        this.costs.rearm(sid)
      }
      this.sessionStatusMap.set(sid, event.properties.status.type)
      this.aborts.observe(sid, event.properties.status.type, directory)
      const msg = mapSSEEventToWebviewMessage(event, sid)
      if (msg) {
        this.streams.flush(sid)
        this.postMessage(msg)
      }
      return
    }

    // Extract sessionID from the event
    if (event.type === "session.created" && this.adoptPendingFollowup(event.properties.info)) {
      return
    }

    const sessionID = this.resolveEventSessionId(event)

    // Events without sessionID (server.connected, server.heartbeat, indexing.status) → always forward
    // Events with sessionID → only forward if this webview tracks that session
    // message.part.* events are always session-scoped; drop if session unknown.
    if (!sessionID && isSessionScopedPartEvent(event.type)) return
    if (this.postModelUsageChanged(event, sessionID)) return
    if (
      event.type !== "indexing.status" &&
      event.type !== "session.deleted" &&
      sessionID &&
      !this.trackedSessionIds.has(sessionID)
    )
      return

    if (event.type === "session.updated" && typeof event.properties.info.cost === "number") {
      const cost = this.costs.setSessionCost(event.properties.sessionID, event.properties.info.cost)
      this.requestCostAlert(event.properties.sessionID, cost)
    }

    if (event.type === "session.updated") {
      // Full bus snapshots duplicate sync patches with the same event ID but no sequence metadata.
      if (isFullSessionUpdatedEvent(event)) return
      const sid = event.properties.sessionID
      const revision = this.revisions.get(sid)
      const versioned = event.seq > 0 || (revision?.seq ?? 0) > 0
      if (revision && (versioned ? event.seq <= revision.seq : event.id <= revision.id)) return
      this.revisions.set(sid, { id: event.id, seq: event.seq })
    }

    // Refresh provider and agent lists when the server signals a state disposal
    if (event.type === "global.disposed") {
      void this.reloadAfterAuthChange()
      return
    }

    if (event.type === "server.instance.disposed") {
      const props = event.properties as Record<string, unknown> | null
      const dir = typeof props?.directory === "string" ? props.directory : undefined
      if (dir) for (const sid of this.aborts.dispose(dir)) this.sessionStatusMap.set(sid, "idle")
      if (dir && !sameDirectory(dir, this.getWorkspaceDirectory())) return
      void this.reloadAfterAuthChange()
      return
    }

    // Config was updated without a full dispose (e.g. permission-only save).
    // Fetch and push the updated config + refresh agents and providers so the
    // Settings panel and mode/model pickers reflect the change.
    if (event.type === "global.config.updated") {
      this.requirements.clear()
      void Promise.all([this.fetchAndSendConfigUpdated(), this.fetchAndSendAgents(), this.fetchAndSendProviders()])
      return
    }

    // Forward relevant events to webview
    // Side effects that must happen before the webview message is sent
    if (event.type === "message.updated") {
      const info = event.properties.info
      const value = info.role === "assistant" ? info.cost : undefined
      const cost = this.updateMessageCost(event.properties.sessionID, info.id, info.role, value)
      if (cost !== undefined) this.requestCostAlert(event.properties.sessionID, cost)
    }
    // Resubmit clears revert on the backend, but that never reaches the webview,
    // so the stale revert marker keeps hiding the new message. Clear it here.
    if (this.currentSession && event.type === "message.updated" && shouldClearRevertForMessage(sessionID, this.currentSession)) {
      this.setCurrentSession({ ...this.currentSession, revert: undefined })
      this.postMessage({ type: "sessionUpdated", session: { id: sessionID, revert: null } })
    }
    if (event.type === "message.removed") {
      this.removeMessageCost(event.properties.messageID)
    }
    if (event.type === "session.created" && !this.currentSession) {
      this.setCurrentSession(event.properties.info)
      this.contextSessionID = event.properties.info.id
      this.trackedSessionIds.add(event.properties.info.id)
    }
    if (event.type === "session.updated" && this.currentSession?.id === event.properties.sessionID) {
      this.setCurrentSession(applySessionPatch(this.currentSession, event.properties.info))
      this.contextSessionID = event.properties.sessionID
    }
    if (event.type === "session.deleted") {
      const sid = event.properties.sessionID
      this.trackedSessionIds.delete(sid)
      this.modelUsageSessionIds.delete(sid)
      this.sessionDirectories.delete(sid)
      this.connectionService.pruneSession(sid)
      this.costs.onSessionDeleted(sid)
    }

    // Auto-adopt child sessions as soon as the task tool part reveals their ID.
    // This means the child's permission/question events are tracked immediately —
    // before the webview renderer has a chance to call syncSession — eliminating
    // the race where the child blocks on a prompt that the UI never sees.
    if (event.type === "message.part.updated") {
      const part = event.properties.part as {
        type?: string
        tool?: string
        metadata?: { sessionId?: string }
        state?: { metadata?: { sessionId?: string } }
        sessionID?: string
      }
      const childId = childID(part)
      if (childId && !this.trackedSessionIds.has(childId)) {
        console.log("[Kilo New] KiloProvider: 🔗 Auto-adopting child session from task tool", { childId })
        void this.handleSyncSession(childId, part.sessionID ?? sessionID)
      }
    }

    // Drop the per-session caches for deleted sessions so a late
    // handleLoadMessages response (or any other guarded read) can't resurrect
    // transcript state for a session the webview just cleaned up. The
    // prefilter lets session.deleted through without re-tracking, and the
    // handleEvent guard does the same — this is the matching prune.
    if (event.type === "session.deleted" && sessionID) {
      this.pruneDeletedSession(sessionID)
    }

    if (!isLegacySyncEvent(event)) {
      const props = event.properties
      handleNetworkEvent(
        event.type,
        {
          id: "id" in props && typeof props.id === "string" ? props.id : undefined,
          sessionID: "sessionID" in props && typeof props.sessionID === "string" ? props.sessionID : undefined,
          requestID: "requestID" in props && typeof props.requestID === "string" ? props.requestID : undefined,
        },
        this.client,
        (s) => this.getWorkspaceDirectory(s),
      )
    }

    if (event.type === "indexing.status" && directory) {
      if (!sameDirectory(directory, this.getWorkspaceDirectory(this.currentSession?.id))) return
    }

    const msg = isLegacySyncEvent(event)
      ? this.mapSyncEventToWebviewMessage(event)
      : mapSSEEventToWebviewMessage(event, sessionID)
    if (!msg) return
    if (msg.type === "partUpdated") {
      this.streams.push({ ...msg, part: this.slimPart(msg.part) })
      return
    }
    const next = msg.type === "messageCreated" ? { ...msg, message: this.slimInfo(msg.message) } : msg
    if (next.type === "sandboxStatus") {
      if (!sameDirectory(next.directory, this.getWorkspaceDirectory(next.sessionID))) return
      this.postMessage({ ...next, revision: ++this.sandboxRevision })
      return
    }
    if (next.type === "indexingStatusLoaded") {
      this.cachedIndexingStatusMessage = next
    }
    this.streams.flush(sessionID)
    this.postMessage(next)
  }

  /** Wait until the webview has sent "webviewReady". Resolves immediately when already ready. */
  public waitForReady(): Promise<void> {
    return this.isWebviewReady && this.webview ? Promise.resolve() : new Promise((r) => this.readyResolvers.push(r))
  }
  /** Post a message to the webview. Public so toolbar button commands can send messages. */
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

  private flushPendingKiloModel(): void {
    if (!this.webview || !this.isWebviewReady || !this.client || !this.pendingKiloModel) return

    const pending = this.pendingKiloModel
    this.pendingKiloModel = null
    this.postMessage({ type: "selectKiloModel", ...pending })
  }

  public async appendReviewComments(comments: unknown[], autoSend = false): Promise<void> {
    this.pendingReviewComments.push({ comments, autoSend })

    if (!this.webview) {
      await vscode.commands.executeCommand(`${KiloProvider.viewType}.focus`)
    }

    this.flushPendingReviewComments()
  }

  public async showMemory(sessionID?: string): Promise<void> {
    await this.memory.show(sessionID ?? this.currentSession?.id)
  }

  public async toggleMemory(sessionID?: string): Promise<void> {
    try {
      const operation = await this.memory.toggle(sessionID ?? this.currentSession?.id)
      if (operation) {
        void vscode.window.showInformationMessage(`Project memory ${operation === "enable" ? "enabled" : "disabled"}.`)
      }
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to toggle memory:", error)
      void vscode.window.showErrorMessage(getErrorMessage(error) || "Failed to toggle memory")
    }
  }

  private flushPendingReviewComments(): void {
    if (!this.webview || !this.isWebviewReady || this.pendingReviewComments.length === 0) return

    const pending = this.pendingReviewComments
    this.pendingReviewComments = []

    for (const entry of pending) {
      this.postMessage({ type: "appendReviewComments", comments: entry.comments, autoSend: entry.autoSend })
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
        const uri =
          tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputNotebook
            ? tab.input.uri
            : undefined
        if (uri?.scheme !== "file") continue

        const rel = path.relative(dir, uri.fsPath)
        if (!rel.startsWith("..") && !path.isAbsolute(rel) && controller.validateAccess(uri.fsPath)) {
          result.add(rel.replaceAll("\\", "/"))
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

  private async gatherEditorContext(dir?: string): Promise<EditorContext> {
    const workspaceDir = dir ?? this.getWorkspaceDirectory()
    const controller = await this.getIgnoreController(workspaceDir)

    const toRelative = (fsPath: string): string | undefined => {
      if (!workspaceDir) {
        return undefined
      }
      const relative = path.relative(workspaceDir, fsPath)
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return undefined
      }
      return relative
    }

    // Visible files (capped to avoid bloating context, filtered through .kilocodeignore)
    const visibleFiles = [
      ...new Set(
        [
          ...vscode.window.visibleTextEditors.map((editor) => notebookUri(editor.document.uri)),
          ...vscode.window.visibleNotebookEditors.map((editor) => editor.notebook.uri),
        ]
          .filter((uri): uri is vscode.Uri => uri?.scheme === "file")
          .map((uri) => toRelative(uri.fsPath))
          .filter(
            (file): file is string => file !== undefined && controller.validateAccess(path.resolve(workspaceDir, file)),
          ),
      ),
    ].slice(0, 200)

    // Open tabs — text and notebook files only; exclude diffs and custom editors
    const openTabs = [...(await this.getOpenTabPaths(workspaceDir))].slice(0, 20)

    // Active file (also filtered through .kilocodeignore)
    const activeEditor = vscode.window.activeTextEditor
    const activeUri = activeEditor
      ? notebookUri(activeEditor.document.uri)
      : vscode.window.activeNotebookEditor?.notebook.uri
    const activeRel = activeUri ? toRelative(activeUri.fsPath) : undefined
    const activeFile = activeRel && activeUri && controller.validateAccess(activeUri.fsPath) ? activeRel : undefined

    // Shell
    const shell = vscode.env.shell || undefined

    return {
      ...(visibleFiles.length > 0 ? { visibleFiles } : {}),
      ...(openTabs.length > 0 ? { openTabs } : {}),
      ...(activeFile ? { activeFile } : {}),
      ...(shell ? { shell } : {}),
    }
  }

  private getWorkspaceDirectory(sessionId?: string): string {
    return resolveWorkspaceDirectory({
      sessionID: sessionId,
      sessionDirectories: this.sessionDirectories,
      workspaceDirectory: this.getRootDirectory(),
    })
  }

  private getSessionDirectory(sessionId: string, session?: Session): string {
    return this.sessionDirectories.get(sessionId) ?? session?.directory ?? this.getRootDirectory()
  }

  private getContextDirectory(): string {
    return resolveContextDirectory({
      currentSessionID: this.currentSession?.id,
      contextSessionID: this.contextSessionID,
      sessionDirectories: this.sessionDirectories,
      workspaceDirectory: this.getRootDirectory(),
    })
  }

  private getRootDirectory(): string {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (workspaceFolders && workspaceFolders.length > 0) {
      return workspaceFolders[0]!.uri.fsPath
    }
    return process.cwd()
  }

  private trackDirectory(sessionId: string, dir: string) {
    if (path.resolve(dir) === path.resolve(this.getRootDirectory())) {
      this.sessionDirectories.delete(sessionId)
      return
    }
    this.sessionDirectories.set(sessionId, dir)
  }

  private noteFollowup(answers: string[][], sessionID?: string) {
    const dir = this.getWorkspaceDirectory(sessionID)
    this.pendingFollowup = recordFollowup({ answers, dir, now: Date.now() }) ?? null
  }

  private matchesPendingFollowup(session: Session) {
    return matchFollowup({ pending: this.pendingFollowup, dir: session.directory, now: Date.now() })
  }

  private adoptPendingFollowup(session: Session) {
    const now = Date.now()
    const match = this.matchesPendingFollowup(session)
    if (!match) {
      if (
        this.pendingFollowup &&
        !matchFollowup({ pending: this.pendingFollowup, dir: this.pendingFollowup.dir, now })
      ) {
        this.pendingFollowup = null
      }
      return false
    }

    this.pendingFollowup = null
    this.trackDirectory(session.id, session.directory)
    for (const cb of this.followupListeners) cb(session, session.directory)
    this.registerSession(session)
    void this.handleLoadMessages(session.id)
    return true
  }

  private getProjectDirectory(sessionId?: string): string | undefined {
    return resolveProjectDirectory(this.projectDirectory, () => this.getWorkspaceDirectory(sessionId))
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, {
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js")),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.css")),
      iconsBaseUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      workerUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "shiki-worker.js")),
      title: "Kilo Code",
      port: this.connectionService.getServerInfo()?.port,
      extraStyles: `.container { height: 100%; display: flex; flex-direction: column; height: 100vh; border-right: 1px solid var(--border-weak-base); }`,
    })
  }

  // legacy-migration start -------------------------------------------------------
  // Migration handlers extracted to kilo-provider/handlers/migration.ts

  private get migrationCtx(): MigrationContext {
    const self = this
    return {
      client: this.client,
      extensionContext: this.extensionContext,
      postMessage: (msg) => this.postMessage(msg),
      migrationCache: self.migrationCache,
      get migrationCheckInFlight() {
        return self.migrationCheckInFlight
      },
      set migrationCheckInFlight(val) {
        self.migrationCheckInFlight = val
      },
      refreshSessions: () => this.refreshSessions(),
      disposeGlobal: () => this.disposeGlobal(),
      broadcastComplete: () => this.connectionService.notifyMigrationComplete(),
    }
  }

  // legacy-migration end ---------------------------------------------------------

  // ── Worktree stats polling (sidebar diff badge) ──────────────────
  private startStatsPolling(): void {
    this.statsPoller?.stop()
    this.statsGitOps?.dispose()
    const git = new GitOps({ log: () => {} })
    this.statsGitOps = git
    this.statsPoller = new GitStatsPoller({
      getWorktrees: () => [],
      getWorkspaceRoot: () => getWorkspaceRoot(),
      localDiff: (dir, base) => localDiffSummary(git, dir, base),
      git,
      onStats: () => {},
      onLocalStats: (stats: LocalStats) => {
        const msg = {
          type: "worktreeStatsLoaded" as const,
          files: stats.files,
          additions: stats.additions,
          deletions: stats.deletions,
        }
        this.cachedStats = msg
        this.postMessage(msg)
      },
      log: () => {},
      hiddenIntervalMs: 60000,
    })
    this.statsPoller.setEnabled(true)
    this.statsPoller.setVisible(true)
  }

  /**
   * Dispose of the provider and clean up subscriptions.
   * Does NOT kill the server — that's the connection service's job.
   */
  dispose(): void {
    this.unsubscribeRemote?.()
    this.focusSession()
    this.statsPoller?.stop()
    this.statsGitOps?.dispose()
    this.unsubscribeEvent?.()
    this.unsubscribeState?.()
    this.unsubscribeNotificationDismiss?.()
    this.unsubscribeLanguageChange?.()
    this.unsubscribeProfileChange?.()
    this.unsubscribeFavoritesChange?.()
    this.unsubscribeModelSelectorExpanded?.()
    this.unsubscribeMigrationComplete?.()
    this.unsubscribeClearPendingPrompts?.()
    this.unsubscribeDirectoryProvider?.()
    this.unsubscribeSandboxPreference?.()
    this.viewStateDisposable?.dispose()
    this.visibilityDisposable?.dispose()
    this.webviewMessageDisposable?.dispose()
    this.autocompleteConfigDisposable?.dispose()
    this.indexingConfigDisposable?.dispose()
    this.telemetryStateDisposable?.dispose()
    this.autoApproveBridge?.dispose()
    this.visibleTaskStreams.clear()
    this.streams.dispose()
    this.isWebviewReady = false
    // Release any waitForReady() awaiters so their callers don't hang after disposal.
    this.readyResolvers.splice(0).forEach((r) => r())
    this.promptRecoveryQueued = false
    clearNetworkWaits(this.trackedSessionIds)
    this.trackedSessionIds.clear()
    this.syncedChildSessions.clear()
    this.sessionDirectories.clear()
    this.anacondaDesktop.dispose()
    this.aborts.clear()
    this.sessionStatusMap.clear()
    this.requirements.dispose()
    this.ignoreController?.dispose()
    this.chatAutocomplete?.dispose()
    disposeGitChangesTarget()
  }
}
