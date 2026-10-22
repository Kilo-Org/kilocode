import * as path from "path"
import * as vscode from "vscode"
import type {
  KiloClient,
  Session,
  SessionStatus,
  Event,
  TextPartInput,
  FilePartInput,
  Config,
} from "@kilocode/sdk-v1/v2/client"
import { type KiloConnectionService, ServerStartupError } from "./services/cli-backend"
import type { EditorContext } from "./services/cli-backend/types"
import { buildWebviewHtml, getWebviewFontSize, isCursorHost } from "./utils"
import { saveImage } from "./kilo-provider/save-image"
import { FileIgnoreController } from "./kilo-provider/file-ignore"
import { handleEditorAction } from "./kilo-provider/editor-actions"
import { exportTranscript } from "./kilo-provider/export-transcript"
import {
  sessionToWebview,
  indexProvidersById,
  filterVisibleAgents,
  mapSSEEventToWebviewMessage,
  getErrorMessage,
  isEventFromForeignProject,
  MessageConfirmation,
  runWithMessageConfirmation,
  loadSessions as loadSessionsUtil,
  loadMoreSessions as loadMoreSessionsUtil,
  flushPendingSessionRefresh as flushPendingSessionRefreshUtil,
  resolveContextDirectory,
  resolveNewSessionDirectory,
  resolveWorkspaceDirectory,
  sameDirectory,
  SessionStreamScheduler,
  buildSettingPath,
  type SessionRefreshContext,
} from "./kilo-provider-utils"
import { resolveProjectDirectory } from "./project-directory"
import { seedSessionStatuses, clientSessionStatus } from "./session-status"
import { retry } from "./services/cli-backend/retry"
import { normalize, type SSEPayload, type SyncPayload, type WirePayload } from "./services/cli-backend/sdk-sse-adapter"
import { slimInfo, slimPart, slimParts } from "./kilo-provider/slim-metadata"
import { ToolInputStream } from "./kilo-provider/tool-input-stream"
import { parseMessageFiles, type MessageFile } from "./kilo-provider/message-files"
import { renameSession } from "./kilo-provider/rename-session"
import { handleFileSearch, type SearchRoot } from "./kilo-provider/file-search"
import { handleSessionSearch } from "./kilo-provider/session-search"
import { handleFilePicker } from "./kilo-provider/file-picker"
import { watchFontSizeConfig } from "./kilo-provider/font-size"
import { clearCommandsCache, loadCommands } from "./kilo-provider/commands"
import { fetchMessagePage, MESSAGE_PAGE_LIMIT } from "./kilo-provider/message-page"
import { createSessionPageState, fetchSessionPage } from "./kilo-provider/session-page"
import { editPaths } from "./kilo-provider/session-edits"
import {
  dismissNotification,
  fetchAndSendNotifications as fetchNotifications,
  resetReadNotifications,
  type NotificationsContext,
  type NotificationsMessage,
} from "./kilo-provider/notifications"
import { childID } from "./kilo-provider/task-session"
import { VisibleTaskStreams } from "./kilo-provider/visible-task-streams"
import { SessionAbort } from "./kilo-provider/abort"
import { routeEarlyMessage } from "./kilo-provider/early-message"
import { handleForkSession } from "./kilo-provider/fork-session"
import { openConfig } from "./kilo-provider/open-config"
import { retryable, backoff, MAX_RETRIES } from "./util/retry"
import { gitRoot, hasGit } from "./kilo-provider/git-status"
import { handleRefreshProfile, type AuthContext } from "./kilo-provider/handlers/auth"
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
import { nativeTitle } from "./kilo-provider/native-tab-title"
import { isActivity, type Activity } from "../webview-ui/src/utils/session-activity"
import { mergeInjected } from "./shared/injected-prompt"
import { completesWithoutStatus, goalControl } from "./kilo-provider/command-completion"
import { computeDefaultSelection, fetchProviderData, validateRecents, validateFavorites } from "./provider-data"
import { createCatalogRetry } from "./kilo-provider/catalog-retry"
import type { Agent } from "@kilocode/sdk-v1/v2/client"
import { fetchSnapshot } from "./kilo-provider/config-snapshot"
import type { KiloProviderOptions } from "./kilo-provider/options"
import { watchRestore } from "./kilo-provider/prompt-focus"
import { buildTimelineSettingMessage, validChatSetting, watchChatConfig } from "./kilo-provider/chat-settings"
import { buildThroughputSettingMessage, watchThroughputConfig } from "./kilo-provider/throughput-settings"
import {
  buildAutoApprovalReasonSettingMessage,
  watchAutoApprovalReasonConfig,
} from "./kilo-provider/auto-approval-reason-settings"
import { pushFixes, watchPushFixesConfig } from "./kilo-provider/push-fixes-settings"
import {
  shortcutHints,
  watchShortcutHintsConfig,
} from "./kilo-provider/shortcut-hints-settings"
import { buildShortcutContextMessage, watchShortcutContext } from "./kilo-provider/shortcut-context"

type MessageLoadMode = "replace" | "prepend" | "focus" | "reconcile"
type ContextMessage = { contextDirectory?: unknown }
type TypedWebviewMessage = {
  type: string
  value?: unknown
}

type SendWebviewMessage = {
  type: "sendMessage"
  text: string
  messageID?: unknown
  sessionID?: string
  draftID?: unknown
  providerID?: string
  modelID?: string
  agent?: string
  variant?: string
  files?: unknown
  agentManagerContext?: unknown
  contextDirectory?: unknown
  injectedTitle?: unknown
}

// Helper to map agent data to the subset of fields sent to the webview
const mapAgent = (a: Agent) => ({
  name: a.name,
  displayName: a.displayName,
  source: a.source,
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
// Events that change the activity state of a sidebar row: status, outcome, input requests, and wakeups.
const ACTIVITY_EVENTS = new Set<string>([
  "session.status",
  "session.deleted",
  "session.wakeup",
  "session.turn.close",
  "session.error",
  "permission.asked",
  "permission.replied",
  "question.asked",
  "question.replied",
  "question.rejected",
  "suggestion.shown",
  "suggestion.accepted",
  "suggestion.dismissed",
])

type RawSyncPayload = Extract<WirePayload, { type: "sync" }>
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

type ProviderEvent = Event | LegacySyncEvent

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

export function unwrapSyncEvent(event: SSEPayload | RawSyncPayload): ProviderEvent | undefined {
  if (event.type !== "sync") return event
  const payload = "syncEvent" in event ? normalize(event) : event

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

type ContextRequestMessage =
  | { type: "requestFileSearch"; query: string; requestId: string; sessionID?: string }
  | { type: "requestSessionSearch"; requestId: string; sessionID?: string }
  | { type: "requestFilePicker"; requestId: string }
  | { type: "requestTerminalContext"; requestId: string; sessionID?: string; agentManagerContext?: string }

export class KiloProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "kilo-code.SidebarProvider"
  private readonly instanceId = crypto.randomUUID()

  private webview: vscode.Webview | null = null
  private currentSession: Session | null = null
  /** Remembers the last selected session so /new can stay in the same worktree after clearSession. */
  private contextSessionID: string | undefined
  private connectionState: "connecting" | "connected" | "disconnected" | "error" = "connecting"
  private connectionGeneration = 0
  private isWebviewReady = false
  private readonly extensionVersion =
    vscode.extensions.getExtension("kilocode.kilo-code")?.packageJSON?.version ?? "unknown"
  private cachedProvidersMessage: unknown = null
  /** Directory the cached provider payload was loaded for, so recovery is keyed to the active project. */
  private cachedProvidersDirectory: string | null = null
  /** Coalesce provider refreshes — at most one follow-up rerun when a request lands mid-flight. */
  private providersRefresh: Promise<void> | null = null
  private providersQueued = false
  private providersRetry = false
  private providersGeneration = 0
  /** Re-fetch providers while an organization's Kilo catalog is unavailable. */
  private readonly catalogRetry = createCatalogRetry({ refresh: () => void this.fetchAndSendProviders() })
  private cachedAgentsMessage: unknown = null
  /** Cached skillsLoaded payload so requestSkills can be served before client is ready */
  private cachedSkillsMessage: unknown = null
  /** Cached commandsLoaded payload so requestCommands can be served before client is ready */
  private cachedCommandsMessage: unknown = null
  /** Cached configLoaded payload so requestConfig can be served before client is ready */
  private cachedConfigMessage: unknown = null
  /** Directory the cached config payload was loaded for, so recovery is keyed to the active project. */
  private cachedConfigDirectory: string | null = null
  /** Ref-count of in-flight handleUpdateConfig calls; prevents fetchAndSendConfig from sending stale data */
  private pending = 0
  /** Cached notificationsLoaded payload */
  private cachedNotificationsMessage: NotificationsMessage | null = null
  private pendingKiloModel: { modelID?: string; agent?: string } | null = null
  private readyResolvers: (() => void)[] = []
  private promptRecoveryQueued = false
  private promptRecovery: Promise<void> | null = null
  private trackedSessionIds: Set<string> = new Set()
  private readonly removedSessionIds = new Set<string>()
  private readonly openSessionIds = new Set<string>()
  private syncedChildSessions: Set<string> = new Set()
  private readonly inspectorSessionIds = new Set<string>()
  private readonly sessionCreations = new Map<string, Promise<{ sid: string; dir: string } | undefined>>()
  private readonly draftSessions = new Map<string, { sid: string; dir: string; expires: number }>()
  private readonly revisions = new Map<string, { id: string; seq: number }>()
  private readonly refreshes = new Map<string, number>()
  private sessionStatusMap = new Map<string, SessionStatus["type"]>() // Latest status used for destructive config warnings.
  private activity: Activity = "idle"
  private active = false
  private caption: string | undefined
  private readonly epochs = new Map<string, Map<string, number>>()
  private readonly requests = new Map<string, number>()
  private epoch = 0
  private sessionDirectories = new Map<string, string>() // Per-session directory overrides, such as Agent Manager worktrees.
  private readonly owners = new Map<string, { dir: string; project: string }>()
  private sessionGitDirectories = new Map<string, string>() // Stable Git root resolved for each session.
  private sessionGitRecoveries = new Set<string>() // Sessions whose older history was scanned for a Git root.
  private readonly aborts = new SessionAbort()
  private projectID: string | undefined // Current workspace project ID used to filter sessions.
  private loadMessagesAbort: AbortController | null = null // Current load request cancellation.
  private lastReconciledAt = new Map<string, number>() // Per-session focus-mode reconcile timestamp.
  private pendingSessionRefresh = false // Refresh requested before the client is ready.
  private readonly streams = new SessionStreamScheduler((msg) => this.postMessage(msg))
  private readonly inputs = new ToolInputStream((msg) => this.streams.push(msg))
  private readonly visibleTaskStreams = new VisibleTaskStreams((id, visible) => this.streams.setVisible(id, visible))
  private readonly confirmations = new MessageConfirmation()
  private unsubscribeEvent: (() => void) | null = null
  private unsubscribeState: (() => void) | null = null
  private unsubscribeNotificationDismiss: (() => void) | null = null
  private unsubscribeAcknowledged: (() => void) | null = null
  private unsubscribeLanguageChange: (() => void) | null = null
  private unsubscribeProfileChange: (() => void) | null = null
  private unsubscribeFavoritesChange: (() => void) | null = null
  private unsubscribeModelSelectorExpanded: (() => void) | null = null
  private unsubscribeClearPendingPrompts: (() => void) | null = null
  private unsubscribeDirectoryProvider: (() => void) | null = null
  private initConnectionPromise: Promise<void> | null = null
  private webviewMessageDisposable: vscode.Disposable | null = null
  private chatConfigDisposable: vscode.Disposable | null = null
  private throughputConfigDisposable: vscode.Disposable | null = null
  private autoApprovalReasonConfigDisposable: vscode.Disposable | null = null
  private pushFixesConfigDisposable: vscode.Disposable | null = null
  private shortcutHintsConfigDisposable: vscode.Disposable | null = null
  private workspaceFoldersDisposable: vscode.Disposable | null = null
  private shortcutContextDisposable: vscode.Disposable | null = null
  private viewStateDisposable: vscode.Disposable | null = null
  private visibilityDisposable: vscode.Disposable | null = null
  private view: vscode.WebviewView | undefined
  private panel: vscode.WebviewPanel | undefined
  private latch: ReturnType<typeof watchRestore> | undefined

  /** Workspace folders plus any session directories recently asked about. */
  private static readonly IGNORE_CONTROLLER_LIMIT = 16
  private readonly ignoreControllers = new Map<string, Promise<FileIgnoreController>>()
  private projectDirectory: string | null | undefined
  private slimEditMetadata = true

  private cachedGitRepo = false
  private gitStatusRevision = 0
  private sessionRefreshRevision = 0
  private sessionPages = createSessionPageState()

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: KiloConnectionService,
    private readonly extensionContext?: vscode.ExtensionContext,
    private readonly opts: KiloProviderOptions = {},
  ) {
    this.projectDirectory = opts.projectDirectory
    this.slimEditMetadata = opts.slimEditMetadata ?? true
    this.latch = watchRestore({
      focused: () => vscode.window.state.focused,
      onChange: (listener) => vscode.window.onDidChangeWindowState(listener),
      enabled: () => !this.opts.hideTopBar,
      restore: (live) => {
        if (!live) this.revealHost()
        this.postMessage({ type: "action", action: "restoreInput" })
      },
    })
  }

  private setCurrentSession(session: Session | null): void {
    const ids = new Set([this.currentSession?.id, session?.id])
    for (const id of ids) {
      if (id) this.refreshes.set(id, (this.refreshes.get(id) ?? 0) + 1)
    }
    this.currentSession = session
    this.updateTitle()
  }

  private updateTitle(): void {
    if (!this.opts.tabTitle) return
    const title = nativeTitle(this.currentSession, this.activity, this.opts.tabLabel)
    if (this.caption === title) return
    this.caption = title
    this.opts.tabTitle(title)
  }

  private sendWorkspaceScope(): void {
    const folders = vscode.workspace.workspaceFolders
    const first = folders?.at(0)
    // Explicit project hosts (including Agent Manager) do not use the sidebar fallback.
    const scoped = this.projectDirectory != null || this.opts.rootDirectory != null
    this.postMessage({
      type: "workspaceScope",
      folder:
        !scoped && folders && folders.length > 1 && first ? { name: first.name, path: first.uri.fsPath } : undefined,
    })
  }
  private focusSession(id?: string): void {
    this.streams.focus(id)
    this.registerPresence()
  }

  /**
   * Report presence for this provider: the focused session is visible, and
   * open local tab sessions (plus the focused one) stay attached even while
   * the view is hidden.
   */
  private registerPresence(): void {
    if (this.opts.disableViewedRegistration) return
    const focused = this.streams.focused
    this.connectionService.registerVisible(this.instanceId, focused ? [focused] : [])
    const attached = new Set(this.openSessionIds)
    if (focused) attached.add(focused)
    this.connectionService.registerAttached(this.instanceId, [...attached])
  }

  public setStreamVisibility(active: boolean): void {
    this.visibleTaskStreams.setActive(active)
    this.active = active
    if (!this.isWebviewReady) return
    this.postMessage({ type: "webviewActiveChanged", active })
  }

  public setProjectDirectory(directory: string | null): void {
    if (this.projectDirectory === directory) return
    this.projectDirectory = directory
    this.cachedConfigMessage = null
    this.postMessage({ type: "workspaceDirectoryChanged", directory: directory ?? "" })
    this.postMessage({ type: "configBindingExpired", reason: "project-changed" })
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

      // Re-send cached git status after webview reload.
      this.postMessage({ type: "gitStatus", repo: this.cachedGitRepo })

      void this.seedSessionStatusMap()
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this.isWebviewReady = false
    this.view = webviewView
    this.panel = undefined
    this.webview = webviewView.webview

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview, true)
    this.setupWebviewMessageHandler(webviewView.webview)

    this.setSidebarVisible(webviewView.visible)
    this.visibilityDisposable?.dispose()
    this.visibilityDisposable = webviewView.onDidChangeVisibility(() => {
      this.setSidebarVisible(webviewView.visible)
      this.focusSession(webviewView.visible ? this.contextSessionID : undefined)
    })
    this.initializeConnection()
  }

  private setSidebarVisible(visible: boolean): void {
    this.setStreamVisibility(visible)
    vscode.commands.executeCommand("setContext", "kilo-code.new.sidebarVisible", visible)
    if (!visible) this.opts.onHidden?.()
    if (!visible && this.opts.focusContext) {
      void vscode.commands.executeCommand("setContext", this.opts.focusContext, false)
    }
  }

  /** Resolve a WebviewPanel for displaying Kilo in an editor tab. */
  public resolveWebviewPanel(panel: vscode.WebviewPanel): void {
    // WebviewPanel can be restored/reloaded; ensure we don't treat it as ready prematurely.
    this.isWebviewReady = false
    this.panel = panel
    this.view = undefined
    this.webview = panel.webview

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    panel.webview.html = this._getHtmlForWebview(panel.webview)

    this.setupWebviewMessageHandler(panel.webview)
    this.viewStateDisposable?.dispose()
    this.viewStateDisposable = this.visibleTaskStreams.bindPanel(panel, () => {
      this.setStreamVisibility(panel.active && panel.visible)
      if (this.opts.disableViewedRegistration) return
      const id = this.contextSessionID
      this.streams.focus(panel.visible ? id : undefined)
      this.connectionService.registerVisible(this.instanceId, panel.visible && id ? [id] : [])
    })
    this.setStreamVisibility(panel.active && panel.visible)
    this.initializeConnection()
  }

  /** Register a session created externally and notify the webview. */
  public registerSession(
    session: Session,
    activate = false,
    project = this.opts.projectQualifier?.()?.projectId,
  ): void {
    this.removedSessionIds.delete(session.id)
    if (project === this.opts.projectQualifier?.()?.projectId) {
      this.setCurrentSession(session)
      this.contextSessionID = session.id
    }
    this.trackedSessionIds.add(session.id)
    this.trackDirectory(session.id, session.directory)
    this.postMessage({
      type: "sessionCreated",
      projectId: project,
      session: this.sessionToWebview(session),
      ...(activate ? { activate: true } : {}),
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
    const current = this.sessionDirectories.get(sessionId) ?? this.getRootDirectory()
    this.aborts.preserve(sessionId, this.sessionStatusMap.get(sessionId), current)
    this.sessionDirectories.set(sessionId, directory)
  }

  public clearSessionDirectory(sessionId: string): void {
    const current = this.sessionDirectories.get(sessionId) ?? this.getRootDirectory()
    this.aborts.preserve(sessionId, this.sessionStatusMap.get(sessionId), current)
    this.sessionDirectories.delete(sessionId)
    this.owners.delete(sessionId)
  }

  /** Exposes the session→directory map so callers outside the webview can resolve worktree paths. */
  public getSessionDirectories(): ReadonlyMap<string, string> {
    return this.sessionDirectories
  }

  public async getSessionInfo(sessionId: string): Promise<Session | undefined> {
    await this.initializeConnection()
    const client = this.client
    if (!client) return
    const directory = this.getWorkspaceDirectory(sessionId)
    return retry(() => client.session.get({ sessionID: sessionId, directory }, { throwOnError: true }))
      .then((result) => result.data)
      .catch((error: unknown) => {
        console.warn("[Kilo New] KiloProvider: Failed to resolve managed session:", error)
        return undefined
      })
  }

  /** Return the currently active session ID, if any. */
  public getCurrentSessionId(): string | undefined {
    return this.currentSession?.id ?? undefined
  }

  /** Return the Git root used by the Changes panel for a session. */
  public getSessionGitDirectory(sessionId: string): string | undefined {
    return this.sessionGitDirectories.get(sessionId)
  }

  /**
   * Re-fetch and send the full session list to the webview.
   * Called by AgentManagerProvider after worktree recovery completes.
   */
  public refreshSessions(): void {
    void this.handleLoadSessions()
  }

  /** Retry failed workspace initialization against the newly selected project. */
  public async retryInitialization(): Promise<void> {
    const dir = this.settingsDirectory()
    if (
      this.cachedProvidersMessage &&
      this.cachedConfigMessage &&
      this.cachedProvidersDirectory === dir &&
      this.cachedConfigDirectory === dir
    )
      return
    await this.fetchAndSendConfig()
    await Promise.all([
      this.fetchAndSendProviders(),
      this.fetchAndSendAgents(),
      this.fetchAndSendSkills(),
      this.fetchAndSendCommands(),
    ])
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

  private trackOpenSessions(ids: string[]): void {
    const next = new Set(ids)
    for (const id of this.openSessionIds) {
      if (!next.has(id)) this.trackedSessionIds.delete(id)
    }
    this.openSessionIds.clear()
    for (const id of next) {
      this.openSessionIds.add(id)
      this.trackedSessionIds.add(id)
    }
    const now = Date.now()
    for (const [key, session] of this.draftSessions) {
      if (next.has(session.sid) || session.expires <= now) this.draftSessions.delete(key)
    }
    this.registerPresence()
    this.recoverPendingPrompts()
  }

  private async flushPendingPrompts(): Promise<void> {
    while (this.promptRecoveryQueued && this.isWebviewReady) {
      if (!this.client) return
      this.promptRecoveryQueued = false
      await Promise.all([
        fetchAndSendPendingPermissions(this.permissionCtx),
        fetchAndSendPendingQuestions(this.questionCtx),
      ])
    }
  }

  public rememberSession(sessionID: string, directory?: string): void {
    if (directory) this.sessionDirectories.set(sessionID, directory)
  }

  public async openSession(sessionID: string, directory?: string): Promise<void> {
    this.rememberSession(sessionID, directory)
    await this.waitForReady()
    this.postMessage({ type: "openSession", sessionID })
  }

  public selectKiloModel(modelID?: string, agent?: string): void {
    if (!modelID && !agent) return
    this.pendingKiloModel = { ...(modelID && { modelID }), ...(agent && { agent }) }
    this.flushPendingKiloModel()
  }

  public attachToWebview(webview: vscode.Webview): void {
    this.isWebviewReady = false
    this.webview = webview
    this.setupWebviewMessageHandler(webview)
    this.initializeConnection()
  }

  private acknowledge(message: Record<string, unknown>): boolean {
    if (message.type !== "acknowledgeSession") return false
    if (typeof message.sessionID === "string" && typeof message.eventID === "string") {
      this.connectionService.notifySessionAcknowledged(message.sessionID, message.eventID)
    }
    return true
  }

  private setupWebviewMessageHandler(webview: vscode.Webview): void {
    this.webviewMessageDisposable?.dispose()
    this.unsubscribeAcknowledged?.()
    this.unsubscribeAcknowledged = this.connectionService.onSessionAcknowledged((sessionID, eventID) => {
      this.postMessage({ type: "sessionAcknowledged", sessionID, eventID })
    })
    this.setFocusTarget("other")
    this.chatConfigDisposable?.dispose()
    this.chatConfigDisposable = watchChatConfig((msg) => this.postMessage(msg))
    this.throughputConfigDisposable?.dispose()
    this.throughputConfigDisposable = watchThroughputConfig((msg) => this.postMessage(msg))
    this.autoApprovalReasonConfigDisposable?.dispose()
    this.autoApprovalReasonConfigDisposable = watchAutoApprovalReasonConfig((msg) => this.postMessage(msg))
    this.pushFixesConfigDisposable?.dispose()
    this.pushFixesConfigDisposable = watchPushFixesConfig((msg) => this.postMessage(msg))
    this.shortcutHintsConfigDisposable?.dispose()
    this.shortcutHintsConfigDisposable = watchShortcutHintsConfig((msg) => this.postMessage(msg))
    this.workspaceFoldersDisposable?.dispose()
    this.workspaceFoldersDisposable = vscode.workspace.onDidChangeWorkspaceFolders(() => this.sendWorkspaceScope())
    this.shortcutContextDisposable?.dispose()
    this.shortcutContextDisposable = watchShortcutContext(this.extensionContext, (msg) => this.postMessage(msg))
    this.webviewMessageDisposable = webview.onDidReceiveMessage(async (message) => {
      if (this.acknowledge(message)) return

      if (
        await routeEarlyMessage(message, {
          post: (msg) => this.postMessage(msg),
          exportTranscript: (sessionID) => this.handleExportSessionTranscript(sessionID),
          copy: (text) => vscode.env.clipboard.writeText(text),
          openSessions: (ids) => this.trackOpenSessions(ids),
          activity: (state) => {
            if (!isActivity(state)) return
            this.activity = state
            this.updateTitle()
          },
        })
      ) {
        return
      }
      if (this.handleEditorOpenMessage(message)) return
      if (await this.handleModelSelectorExpandedMessage(message)) return
      this.handleWebviewFocusMessage(message)
      this.visibleTaskStreams.handle(message)
      this.handleStreamVisibilityMessage(message)
      if (this.handleChildSyncMessage(message)) return
      if (await this.handleProfileDataMessage(message)) return
      switch (message.type) {
        case "requestWorkspaceScope":
          this.sendWorkspaceScope()
          break
        case "webviewReady":
          console.log("[Kilo New] KiloProvider: ✅ webviewReady received")
          this.isWebviewReady = true
          for (const event of this.connectionService.getPendingCompletions()) {
            this.postMessage(mapSSEEventToWebviewMessage(event, event.properties.sessionID))
          }
          this.postMessage({ type: "webviewActiveChanged", active: this.active })
          this.visibleTaskStreams.clear()
          this.flushPendingKiloModel()
          await this.syncWebviewState("webviewReady")
          this.recoverPendingPrompts()
          this.readyResolvers.splice(0).forEach((r) => r())
          break
        case "sendMessage": {
          await this.sendWebviewMessage(message as SendWebviewMessage)
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
          await this.handleAbort(message.sessionID, message.scope)
          break
        case "permissionResponse":
          await handlePermissionResponse(
            this.permissionCtx,
            message.permissionId,
            message.sessionID,
            message.response,
            message.approvedAlways,
            message.deniedAlways,
            message.feedback,
          )
          break
        case "createSession":
          await this.handleCreateSession()
          break
        case "clearSession":
          this.loadMessagesAbort?.abort()
          this.contextSessionID = undefined
          this.setCurrentSession(null)
          this.focusSession()
          break
        case "loadMessages":
          // Don't await: allow parallel loads so rapid session switching
          // isn't blocked by slow responses for earlier sessions.
          void this.handleLoadMessages(message.sessionID, {
            mode: message.mode,
            focus: message.focus,
            before: message.before,
            limit: message.limit,
          })
          break
        case "loadSessions":
          this.handleLoadSessions(message.more === true).catch((e) =>
            console.error("[Kilo New] handleLoadSessions failed:", e),
          )
          break
        case "openVSCodeSettings":
          vscode.commands.executeCommand("workbench.action.openSettings", message.query)
          break
        case "openConfigFile":
          await openConfig(message.scope, message.labels, this.getProjectDirectory(this.currentSession?.id))
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
        case "saveImage":
          return saveImage(this.getWorkspaceDirectory(this.currentSession?.id), message)
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
        case "questionReply":
          await handleQuestionReply(this.questionCtx, message.requestID, message.answers, message.sessionID)
          break
        case "questionReject":
          await handleQuestionReject(this.questionCtx, message.requestID, message.sessionID)
          break
        case "requestConfig":
          this.fetchAndSendConfig().catch((e) => console.error("[Kilo New] fetchAndSendConfig failed:", e))
          break
        case "requestGlobalConfig":
          this.fetchAndSendGlobalConfig().catch((e) => console.error("[Kilo New] fetchAndSendGlobalConfig failed:", e))
          break
        case "setLanguage":
          await vscode.workspace
            .getConfiguration("kilo-code.new")
            .update("language", message.locale || undefined, vscode.ConfigurationTarget.Global)
          this.connectionService.notifyLanguageChanged(message.locale as string)
          break
        case "requestFileSearch":
        case "requestSessionSearch":
        case "requestFilePicker":
          await this.handleContextRequest(message)
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
        case "requestTimelineSetting":
          this.sendTimelineSetting()
          break
        case "requestNotifications":
          this.fetchAndSendNotifications().catch((e) =>
            console.error("[Kilo New] fetchAndSendNotifications failed:", e),
          )
          break
        case "dismissNotification":
          await this.handleDismissNotification(message.notificationId)
          break
        case "resetReadNotifications":
          await resetReadNotifications(this.notificationsContext())
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
      }
    })
    this.webviewMessageDisposable = watchFontSizeConfig((msg) => this.postMessage(msg), this.webviewMessageDisposable)
  }

  private async sendWebviewMessage(message: SendWebviewMessage): Promise<void> {
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
      typeof message.agentManagerContext === "string" ? message.agentManagerContext : undefined,
      typeof message.contextDirectory === "string" ? message.contextDirectory : undefined,
      typeof message.injectedTitle === "string" ? message.injectedTitle : undefined,
    )
  }

  private async handleProfileDataMessage(message: TypedWebviewMessage): Promise<boolean> {
    if (message.type === "refreshProfile") {
      await handleRefreshProfile(this.authCtx)
      return true
    }
    return false
  }

  private handleWebviewFocusMessage(message: TypedWebviewMessage & { focused?: unknown; target?: unknown }): void {
    if (message.type === "webviewFocusChanged") this.latch?.note(message.focused === true)
    if (message.type === "webviewFocusChanged" && message.focused === true) this.opts.onFocused?.()
    if (message.type === "webviewFocusChanged" && this.opts.focusContext) {
      void vscode.commands.executeCommand("setContext", this.opts.focusContext, message.focused === true)
    }
    if (message.type === "webviewFocusChanged" && message.focused === true) {
      if (this.opts.focusTargetContext) this.postMessage({ type: "agentManager.focusContextRequested" })
      return
    }
    if (message.type === "webviewFocusChanged" && message.focused !== true) {
      this.setFocusTarget("other")
      return
    }
    if (message.type !== "agentManagerFocusChanged") return
    const target =
      message.target === "prompt" || message.target === "mainTerminal" || message.target === "sideTerminal"
        ? message.target
        : "other"
    this.latch?.mark(target)
    this.setFocusTarget(target)
  }

  private revealHost(): void {
    if (this.view?.visible) {
      this.view.show()
      return
    }
    if (this.panel?.visible) this.panel.reveal(this.panel.viewColumn)
  }

  private setFocusTarget(target: "prompt" | "mainTerminal" | "sideTerminal" | "other"): void {
    const contexts = this.opts.focusTargetContext
    if (!contexts) return
    void vscode.commands.executeCommand("setContext", contexts.prompt, target === "prompt")
    void vscode.commands.executeCommand("setContext", contexts.mainTerminal, target === "mainTerminal")
    void vscode.commands.executeCommand("setContext", contexts.sideTerminal, target === "sideTerminal")
  }

  private handleChildSyncMessage(
    message: TypedWebviewMessage & { sessionID?: unknown; parentSessionID?: unknown; scope?: unknown },
  ): boolean {
    if (message.type !== "syncSession" && message.type !== "unsyncSession") return false
    if (typeof message.sessionID !== "string") return true
    if (message.type === "syncSession") {
      if (message.scope === "inspector") this.inspectorSessionIds.add(message.sessionID)
      const parent = typeof message.parentSessionID === "string" ? message.parentSessionID : undefined
      this.handleSyncSession(message.sessionID, parent).catch((e) =>
        console.error("[Kilo New] handleSyncSession failed:", e),
      )
      return true
    }
    if (message.scope === "inspector") this.inspectorSessionIds.delete(message.sessionID)
    this.releaseChildSession(message.sessionID)
    return true
  }

  private handleStreamVisibilityMessage(
    message: TypedWebviewMessage & { sessionID?: unknown; visible?: unknown },
  ): void {
    if (message.type !== "streamSessionVisible" || message.visible !== false || typeof message.sessionID !== "string") {
      return
    }
    this.releaseChildSession(message.sessionID)
  }

  private handleEditorOpenMessage(message: Parameters<typeof handleEditorAction>[0]): boolean {
    return handleEditorAction(message, {
      // An explicit sessionID (e.g. from validateFiles) takes precedence over
      // the live currentSession — see editor-actions.ts's validateFiles case.
      dir: (sessionID) => this.getWorkspaceDirectory(sessionID ?? this.currentSession?.id),
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
      const workspaceDir = this.settingsDirectory()

      // Connect the shared service (no-op if already connected)
      await this.connectionService.connect(workspaceDir)
      this.flushPendingKiloModel()

      // Subscribe to SSE events for this webview (filtered by tracked sessions)
      this.unsubscribeEvent = this.connectionService.onEventFiltered(
        (payload, directory) => {
          const event = unwrapSyncEvent(payload)
          if (!event) return false
          if (
            directory &&
            directory !== "global" &&
            !this.isCurrentProjectDirectory(directory) &&
            !this.routed(event, directory)
          )
            return false
          if (!directory && isEventFromForeignProject(payload, this.projectID)) return false

          const sessionId = this.resolveEventSessionId(event)

          // message.part.* events are always session-scoped; drop if session unknown.
          if (!sessionId) return !isSessionScopedPartEvent(event.type)
          if (!directory && !this.isCurrentProjectSession(sessionId)) return false

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
        if (this.connectionState !== state) {
          this.connectionGeneration++
        }
        this.connectionState = state
        this.postConnectionState(error)

        if (state === "connected") {
          this.flushPendingKiloModel()
          // A fetch that ran without a usable client set this flag. Fetch again
          // so the model picker does not stay on "No providers".
          if (this.providersRetry) void this.fetchAndSendProviders()
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
        this.fetchAndSendNotifications(),
        this.seedSessionStatusMap(),
      ])
      await this.refreshGitStatus(this.getWorkspaceDirectory())
      this.sendTimelineSetting()
      this.postMessage(buildThroughputSettingMessage())
      this.postMessage(buildAutoApprovalReasonSettingMessage())
      this.postMessage(buildShortcutContextMessage(this.extensionContext))
      this.postMessage({ type: "extensionDataReady" })

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

  private get forkCtx() {
    return {
      connection: this.connectionService,
      post: (msg: { type: "error"; message: string }) => this.postMessage(msg),
      register: (session: Session) => this.registerSession(session),
      forked: (session: Session, sourceID: string) =>
        this.postMessage({ type: "sessionForked", sessionID: session.id, forkedFromID: sourceID }),
      status: (sessionID: string) => this.sessionStatusMap.get(sessionID),
      directory: (sessionID: string) => this.getWorkspaceDirectory(sessionID),
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
      const project = this.opts.projectQualifier?.()?.projectId
      const { data: session } = await this.client.session.create(
        { directory: workspaceDir, platform: this.opts.platform },
        { throwOnError: true },
      )
      if (project === this.opts.projectQualifier?.()?.projectId) {
        this.setCurrentSession(session)
        this.contextSessionID = session.id
        this.focusSession(session.id)
      }
      this.trackDirectory(session.id, workspaceDir)
      this.trackedSessionIds.add(session.id)

      // Notify webview of the new session
      this.postMessage({
        type: "sessionCreated",
        projectId: project,
        session: this.sessionToWebview(session),
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
  private async refreshSessionDetails(
    sessionID: string,
    dir: string,
    signal?: AbortSignal,
  ): Promise<Session | undefined> {
    if (!this.client) return
    void this.refreshGitStatus(this.sessionGitDirectories.get(sessionID) ?? dir, sessionID)
    const revision = this.revisions.get(sessionID)
    const refresh = (this.refreshes.get(sessionID) ?? 0) + 1
    this.refreshes.set(sessionID, refresh)
    const details = this.client.session
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
        return r.data
      })
      .catch((e: unknown) => {
        console.warn("[Kilo New] KiloProvider: getSession failed (non-critical):", e)
        return undefined
      })
    this.postMessage({ type: "workspaceDirectoryChanged", directory: this.getWorkspaceDirectory(sessionID) })
    this.sync(sessionID, dir, signal, refresh)
    return details
  }

  private sync(sessionID: string, dir: string, signal?: AbortSignal, refresh?: number): void {
    const client = this.client
    if (!client) return
    const epoch = this.epoch
    const request = this.begin(dir)
    void client.session
      .status({ directory: dir })
      .then((result) => {
        if (!result.data || signal?.aborted || !this.latest(dir, request)) return
        if (refresh !== undefined && this.refreshes.get(sessionID) !== refresh) return
        for (const [sid, status] of Object.entries(result.data) as [string, SessionStatus][]) {
          if ((!this.trackedSessionIds.has(sid) && !this.owned(sid, dir)) || !this.accept(sid, status, dir, epoch))
            continue
          this.publish(sid, status)
        }
        for (const [sid, current] of this.sessionStatusMap) {
          if (result.data[sid] || current === "idle" || (!this.trackedSessionIds.has(sid) && !this.owned(sid, dir)))
            continue
          const status = { type: "idle" as const }
          if (this.accept(sid, status, dir, epoch)) this.publish(sid, status)
        }
      })
      .catch((error: unknown) => console.error("[Kilo New] KiloProvider: Failed to fetch session statuses:", error))
  }

  private async handleLoadMessages(
    sessionID: string,
    options: {
      mode?: MessageLoadMode
      focus?: boolean
      before?: string
      limit?: number
      preserveStream?: boolean
    } = {},
  ): Promise<void> {
    const mode = options.mode ?? "replace"
    if (mode === "replace" || mode === "focus") {
      this.trackedSessionIds.add(sessionID)
      if (options.focus !== false) {
        this.loadMessagesAbort?.abort()
        this.focusSession(sessionID)
        this.contextSessionID = sessionID
      }
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
    const abort = mode === "replace" && options.focus !== false ? new AbortController() : undefined
    if (abort) {
      this.loadMessagesAbort = abort
    }
    const revision = this.revisions.get(sessionID)
    const details = abort ? this.refreshSessionDetails(sessionID, dir, abort.signal) : undefined
    const since = mode === "reconcile" ? Date.now() : undefined
    try {
      const page = await fetchMessagePage(this.client, {
        sessionID,
        workspaceDir: dir,
        limit: options.limit ?? MESSAGE_PAGE_LIMIT,
        before: options.before,
        signal: abort?.signal,
        tail:
          details &&
          (async () => {
            const session = await details
            return !!session && !session.revert && this.revisions.get(sessionID) === revision
          }),
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
      if (mode === "replace" || mode === "reconcile") {
        void this.recoverSessionGitStatus(
          page.items.flatMap((message) => message.parts),
          sessionID,
          page.cursor,
        )
      }
      for (const message of messages) {
        this.connectionService.recordMessageSessionId(message.id, message.sessionID)
      }
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
      const git = this.sessionGitDirectories.get(parentSessionID)
      if (git) this.sessionGitDirectories.set(sessionID, git)
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory(sessionID)
      const [info, history] = await Promise.all([
        retry(() => this.client!.session.get({ sessionID, directory: workspaceDir }, { throwOnError: true })),
        retry(() => this.client!.session.messages({ sessionID, directory: workspaceDir }, { throwOnError: true })),
      ])
      this.postMessage({ type: "sessionUpdated", session: this.sessionToWebview(info.data) })

      const messages = history.data.map((m) => ({
        ...this.slimInfo(m.info),
        parts: this.slimParts(m.parts),
        createdAt: new Date(m.info.time.created).toISOString(),
      }))

      for (const message of messages) {
        this.connectionService.recordMessageSessionId(message.id, message.sessionID)
      }

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

  private releaseChildSession(sessionID: string): void {
    if (
      this.inspectorSessionIds.has(sessionID) ||
      this.visibleTaskStreams.has(sessionID) ||
      this.currentSession?.id === sessionID ||
      this.openSessionIds.has(sessionID)
    ) {
      return
    }
    if (!this.syncedChildSessions.delete(sessionID)) return
    const status = this.sessionStatusMap.get(sessionID)
    // Offline is not the end of a turn: the session reconnects and continues. Keep the owner so a
    // later status can clear the offline state on the row.
    if (!status || status === "idle") this.owners.delete(sessionID)
    this.trackedSessionIds.delete(sessionID)
    this.streams.drop(sessionID)
    this.visibleTaskStreams.delete(sessionID)
    this.sessionDirectories.delete(sessionID)
    this.sessionGitDirectories.delete(sessionID)
    this.sessionGitRecoveries.delete(sessionID)
    this.connectionService.pruneSession(sessionID)
  }

  /**
   * Build the context object used by the extracted session-refresh helpers.
   */
  private getSessionRefreshContext(revision: number): SessionRefreshContext {
    const client = this.client
    const project = this.opts.projectQualifier?.()
    return {
      pendingSessionRefresh: this.pendingSessionRefresh,
      connectionState: this.connectionState,
      listSessions: client
        ? (dir: string) =>
            client.session.list({ directory: dir, roots: true }, { throwOnError: true }).then(({ data }) => data)
        : null,
      listSessionPage: client ? (dir: string, cursor?: number) => fetchSessionPage(client, { dir, cursor }) : null,
      page: this.sessionPages,
      sessionDirectories: this.sessionDirectories,
      worktreeDirectories: this.opts.worktreeDirectories,
      workspaceDirectory: this.getWorkspaceDirectory(),
      isCurrent: () => revision === this.sessionRefreshRevision,
      postMessage: (msg: unknown) =>
        this.postMessage(project && typeof msg === "object" && msg !== null ? { ...msg, ...project } : msg),
    }
  }

  /**
   * Retry a deferred sessions refresh once the client is ready.
   */
  private async flushPendingSessionRefresh(reason: string): Promise<void> {
    if (!this.pendingSessionRefresh) return
    console.log("[Kilo New] KiloProvider: 🔄 Flushing deferred sessions refresh", { reason })
    const revision = ++this.sessionRefreshRevision
    const scope = this.opts.projectQualifier?.()?.projectId
    if (scope !== undefined) this.projectID = undefined
    const ctx = this.getSessionRefreshContext(revision)
    try {
      const resolved = await flushPendingSessionRefreshUtil(ctx)
      if (resolved && scope === this.opts.projectQualifier?.()?.projectId) this.projectID = resolved
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to flush session refresh:", error)
    }
    this.pendingSessionRefresh = ctx.pendingSessionRefresh
  }

  /**
   * Handle loading all sessions.
   */
  private async handleLoadSessions(more = false): Promise<void> {
    const revision = ++this.sessionRefreshRevision
    const scope = this.opts.projectQualifier?.()?.projectId
    if (!more && scope !== undefined) this.projectID = undefined
    const ctx = this.getSessionRefreshContext(revision)
    try {
      if (more) {
        await loadMoreSessionsUtil(ctx)
      } else {
        const resolved = await loadSessionsUtil(ctx)
        if (resolved && scope === this.opts.projectQualifier?.()?.projectId) this.projectID = resolved
      }
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to load sessions:", error)
      if (!more) {
        this.postMessage({
          type: "error",
          message: getErrorMessage(error) || "Failed to load sessions",
        })
      }
    }
    this.pendingSessionRefresh = ctx.pendingSessionRefresh
  }

  private async handleContextRequest(message: ContextRequestMessage): Promise<void> {
    if (message.type === "requestFileSearch") {
      await handleFileSearch({
        client: this.client,
        message,
        current: this.currentSession?.id,
        context: this.contextSessionID,
        dir: (id) => this.getWorkspaceDirectory(id),
        open: (dir) => this.getOpenTabPaths(dir),
        roots: () => this.getWorkspaceRoots(),
        allowed: (dir, files) => this.filterIgnored(dir, files),
        post: (msg) => this.postMessage(msg),
      })
      return
    }
    if (message.type === "requestSessionSearch") {
      await handleSessionSearch({
        client: this.client,
        message,
        current: this.currentSession?.id,
        context: this.contextSessionID,
        dir: (id) => this.getWorkspaceDirectory(id),
        exclude: this.currentSession?.id,
        post: (msg) => this.postMessage(msg),
      })
      return
    }
    if (message.type === "requestFilePicker") {
      await handleFilePicker({ requestId: message.requestId, post: (msg) => this.postMessage(msg) })
      return
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
    this.removedSessionIds.add(sessionID)
    this.trackedSessionIds.delete(sessionID)
    this.openSessionIds.delete(sessionID)
    for (const [key, session] of this.draftSessions) {
      if (session.sid === sessionID) this.draftSessions.delete(key)
    }
    this.streams.drop(sessionID)
    this.visibleTaskStreams.delete(sessionID)
    this.syncedChildSessions.delete(sessionID)
    this.inspectorSessionIds.delete(sessionID)
    this.sessionDirectories.delete(sessionID)
    this.owners.delete(sessionID)
    this.sessionGitDirectories.delete(sessionID)
    this.sessionGitRecoveries.delete(sessionID)
    this.aborts.delete(sessionID)
    this.lastReconciledAt.delete(sessionID)
    this.revisions.delete(sessionID)
    this.refreshes.delete(sessionID)
    this.epochs.delete(sessionID)
    this.sessionStatusMap.delete(sessionID)
    this.connectionService.clearPermissionSession(sessionID)
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

  private invalidateProviders(): void {
    this.providersGeneration++
    this.cachedProvidersMessage = null
    this.postMessage({ type: "providersLoading" })
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
          // Nothing was loaded, so remember to fetch once a client is available.
          // The webview retries may already be spent by then.
          if (!this.cachedProvidersMessage) this.providersRetry = true
          if (this.cachedProvidersMessage && generation === this.providersGeneration)
            this.postMessage(this.cachedProvidersMessage)
          return
        }
        try {
          const { response, authMethods, authStates, organizationId, ready, unavailable } =
            await fetchProviderData(client, this.getWorkspaceDirectory())
          if (generation !== this.providersGeneration || client !== this.client) {
            if (!this.providersQueued) return
            generation = this.providersGeneration
            continue
          }
          const settings = vscode.workspace.getConfiguration("kilo-code.new.model")
          const message = {
            type: "providersLoaded",
            providers: indexProvidersById(response.all),
            connected: response.connected,
            defaults: response.default,
            organizationId,
            ready,
            defaultSelection: computeDefaultSelection(
              this.cachedConfigMessage as { config?: { model?: string } } | null,
              settings.get<string>("providerID", ""),
              settings.get<string>("modelID", ""),
            ),
            authMethods,
            authStates,
            kiloUnavailable: unavailable,
            failures: response.failures,
          }
          this.cachedProvidersMessage = message
          this.cachedProvidersDirectory = this.settingsDirectory()
          this.providersRetry = false
          this.postMessage(message)
          this.catalogRetry.update(unavailable)
        } catch (error) {
          if (generation !== this.providersGeneration) {
            if (!this.providersQueued) return
            generation = this.providersGeneration
            continue
          }
          // A rejected fetch leaves nothing cached, so retry on the next connect.
          if (!this.cachedProvidersMessage) this.providersRetry = true
          // Keep backing off while the last loaded Kilo catalog was unavailable.
          const last = this.cachedProvidersMessage as { kiloUnavailable?: boolean } | null
          this.catalogRetry.update(last?.kiloUnavailable === true)
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
      await this.refreshConfig("configLoaded")
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch config:", error)
    }
  }

  /** Fetch global-only config (no project/managed layers) for settings export. */
  private async fetchAndSendGlobalConfig(): Promise<void> {
    if (!this.client || this.connectionState !== "connected") return
    try {
      const { data: config } = await this.client.global.config.get({ throwOnError: true })
      this.postMessage({ type: "globalConfigLoaded", config })
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch global config:", error)
    }
  }

  private begin(dir: string): number {
    const key = [...this.requests.keys()].find((entry) => sameDirectory(entry, dir)) ?? dir
    const request = (this.requests.get(key) ?? 0) + 1
    this.requests.set(key, request)
    return request
  }

  private latest(dir: string, request: number): boolean {
    return [...this.requests].some(([entry, value]) => value === request && sameDirectory(entry, dir))
  }

  private mark(sessionID: string, dir?: string): void {
    const entries = this.epochs.get(sessionID) ?? new Map<string, number>()
    const key = dir ? ([...entries.keys()].find((entry) => entry && sameDirectory(entry, dir)) ?? dir) : ""
    entries.set(key, ++this.epoch)
    this.epochs.set(sessionID, entries)
  }

  private stale(sessionID: string, dir: string, epoch: number): boolean {
    const entries = this.epochs.get(sessionID)
    if (!entries) return false
    return [...entries].some(([entry, value]) => value > epoch && (!entry || sameDirectory(entry, dir)))
  }

  private accept(sessionID: string, status: SessionStatus, dir: string, epoch: number): boolean {
    if (this.stale(sessionID, dir, epoch)) return false
    const owner = this.owners.get(sessionID)?.dir ?? this.getWorkspaceDirectory(sessionID)
    if (status.type === "idle" && !sameDirectory(owner, dir)) return false
    this.mark(sessionID, dir)
    this.aborts.observe(sessionID, status.type, dir)
    return true
  }

  private publish(sessionID: string, raw: SessionStatus): void {
    // A session asleep on a pending wakeup is not a running turn; the webview
    // would otherwise render `scheduled` as permanently working.
    const status = clientSessionStatus(raw)
    this.sessionStatusMap.set(sessionID, status.type)
    // Offline sessions reconnect and continue, so keep the owner until the session is idle.
    if (status.type === "idle" && !this.syncedChildSessions.has(sessionID)) {
      this.owners.delete(sessionID)
    }
    this.streams.flush(sessionID)
    this.postMessage({
      type: "sessionStatus",
      sessionID,
      status: status.type,
      ...(status.type === "retry" ? { attempt: status.attempt, message: status.message, next: status.next } : {}),
      ...(status.type === "offline" ? { message: status.message } : {}),
    })
  }

  private async seedSessionStatusMap(reconcile = true): Promise<void> {
    if (!this.client || this.connectionState !== "connected") return
    const client = this.client
    // Status snapshots are directory-scoped, including sessions in inactive projects.
    const dirs = new Set([
      this.getWorkspaceDirectory(),
      ...(this.opts.worktreeDirectories?.() ?? []),
      ...this.sessionDirectories.values(),
      ...[...this.owners.values()].map((owner) => owner.dir),
      ...[...this.trackedSessionIds].map((id) => this.getWorkspaceDirectory(id)),
    ])
    await Promise.all(
      [...dirs].map(async (dir) => {
        const epoch = this.epoch
        const request = this.begin(dir)
        await seedSessionStatuses(
          client,
          dir,
          this.sessionStatusMap,
          (message) => this.postMessage(message),
          reconcile,
          (sessionID, status) =>
            (this.isCurrentProjectDirectory(dir) || this.owned(sessionID, dir)) &&
            this.latest(dir, request) &&
            this.accept(sessionID, status, dir, epoch),
        )
      }),
    )
  }

  /**
   * Fetch the latest merged config and push it as configUpdated.
   * Called when global.config.updated SSE fires (config changed without a full dispose).
   */
  private async fetchAndSendConfigUpdated(): Promise<void> {
    if (!this.client || this.connectionState !== "connected") return
    try {
      await this.refreshConfig("configUpdated")
    } catch (error) {
      console.error("[Kilo New] KiloProvider: Failed to fetch config after update:", error)
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

  private sendTimelineSetting(): void {
    this.postMessage(buildTimelineSettingMessage())
  }

  private async refreshConfig(type: "configLoaded" | "configUpdated", dir = this.settingsDirectory()) {
    const snapshot = await fetchSnapshot(this.client!, dir, () => this.configSettings())
    if (dir !== this.settingsDirectory()) return
    const bindings = this.bindingsFor()
    const globalConfig = (snapshot.targets?.global.raw ?? snapshot.globalConfig) as Config
    const projectConfig = bindings.project ? (snapshot.targets?.project.raw as Config) : undefined
    this.cachedConfigMessage = {
      type: "configLoaded",
      config: snapshot.config,
      globalConfig,
      projectConfig,
      bindings,
      collections: snapshot.collections,
      settings: snapshot.settings,
      features: snapshot.features,
    }
    this.cachedConfigDirectory = dir
    this.postMessage({
      type,
      config: snapshot.config,
      globalConfig,
      projectConfig,
      bindings,
      collections: snapshot.collections,
      settings: snapshot.settings,
      features: snapshot.features,
    })
  }

  private async resolveSession(sessionID?: string, draftID?: string, context?: string, contextDirectory?: string) {
    if (!this.client) return undefined
    const project = this.opts.projectQualifier?.()?.projectId

    const dir = resolveNewSessionDirectory({
        sessionID,
        currentSessionID: this.currentSession?.id,
        contextSessionID: this.contextSessionID,
        agentManagerContext: context,
        contextDirectory,
        sessionDirectories: this.sessionDirectories,
        workspaceDirectory: this.getRootDirectory(),
      })

    const key = `${draftID ?? context ?? "new"}\0${dir}`
    const now = Date.now()
    for (const [draft, session] of this.draftSessions) {
      if (session.expires <= now) this.draftSessions.delete(draft)
    }
    if (!sessionID && draftID) {
      const resolved = this.draftSessions.get(key)
      if (resolved) {
        this.trackedSessionIds.add(resolved.sid)
        return { sid: resolved.sid, dir: resolved.dir }
      }
    }

    if (!sessionID && (draftID || !this.currentSession)) {
      const pending = this.sessionCreations.get(key)
      if (pending) return pending
      if (draftID) this.creatingDrafts.add(draftID)
      const creation = (async () => {
        const { data: session } = await this.client!.session.create(
          { directory: dir, platform: this.opts.platform },
          { throwOnError: true },
        )
        if (draftID && this.closedDrafts.delete(draftID)) {
          await this.client!.session.delete({ sessionID: session.id, directory: dir }, { throwOnError: true })
          return undefined
        }
        if (project === this.opts.projectQualifier?.()?.projectId) {
          this.setCurrentSession(session)
          this.contextSessionID = session.id
          this.focusSession(session.id)
        }
        this.trackDirectory(session.id, dir)
        this.trackedSessionIds.add(session.id)
        this.postMessage({
          type: "sessionCreated",
          projectId: project,
          session: this.sessionToWebview(session),
          draftID,
        })
        const resolved = { sid: session.id, dir }
        if (draftID) this.draftSessions.set(key, { ...resolved, expires: Date.now() + 60_000 })
        return resolved
      })().finally(() => {
        this.sessionCreations.delete(key)
        if (draftID) this.creatingDrafts.delete(draftID)
      })
      this.sessionCreations.set(key, creation)
      return creation
    }

    const sid = sessionID || this.currentSession?.id
    if (!sid) throw new Error("No session available")
    this.trackedSessionIds.add(sid)
    return { sid, dir }
  }

  /** Drafts closed while their backend session is being created or submitted. */
  private closedDrafts = new Set<string>()
  private creatingDrafts = new Set<string>()

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

  private conversationPromptHistorySetting(): boolean {
    return vscode.workspace
      .getConfiguration("kilo-code.new.experimental")
      .get<boolean>("conversationPromptHistory", false)
  }

  private configSettings() {
    return {
      conversationPromptHistory: this.conversationPromptHistorySetting(),
      "agentManager.pushFixes": pushFixes(),
      showShortcutHints: shortcutHints(),
    }
  }

  private settingsDirectory(): string {
    return this.projectDirectory ?? this.getRootDirectory()
  }

  // Settings are read-only on the Kilo v2 line, so a config payload never carries write bindings.
  private bindingsFor(): Record<string, never> {
    return {}
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
    context?: string,
    contextDirectory?: string,
    injectedTitle?: string,
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
      })
      return
    }

    let resolved: { sid: string; dir: string } | undefined
    try {
      resolved = await this.resolveSession(sessionID, draftID, context, contextDirectory)
      if (!resolved) return
      const sid = resolved.sid
      const dir = resolved.dir

      const parts: Array<TextPartInput | FilePartInput> = []
      if (files) {
        for (const f of files) {
          parts.push({ type: "file", mime: f.mime, url: f.url, filename: f.filename, source: f.source })
        }
      }
      parts.push({
        type: "text",
        text,
        metadata: mergeInjected(undefined, injectedTitle),
      })

      const editorContext = await this.gatherEditorContext(dir)
      if (draftID && this.closedDrafts.delete(draftID)) {
        for (const [k, v] of this.draftSessions) if (v.sid === sid) this.draftSessions.delete(k)
        return
      }

      if (messageID) {
        this.connectionService.recordMessageSessionId(messageID, sid)
      }

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
      resolved = await this.resolveSession(sessionID, draftID, context, contextDirectory)
      if (!resolved) return
      const control = goalControl(command, args)
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

      const send = () =>
        this.client!.session.command({
          sessionID: sid,
          directory: dir,
          command,
          arguments: args,
          messageID,
          model: !control && providerID && modelID ? `${providerID}/${modelID}` : undefined,
          agent: control ? undefined : agent,
          variant: control ? undefined : variant,
          parts,
          snapshotInitialization: this.opts.snapshotInitialization,
        })
      await runWithMessageConfirmation(this.confirmations, messageID, "KiloProvider: Command request", async () => {
        if (command !== "goal") return this.withRetry(send, sid, messageID)
        const result = await send()
        if (result.error) throw result.error
        if (args.trim()) return
        const message = result.data?.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
        if (message) void vscode.window.showInformationMessage(message)
      })
      if (messageID && completesWithoutStatus(command)) {
        this.postMessage({ type: "sessionCommandCompleted", messageID })
      }
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

  public acknowledgeDraft(draftID: string, sessionID: string): void {
    for (const [k, v] of this.draftSessions) {
      if (v.sid === sessionID) {
        this.draftSessions.delete(k)
        break
      }
    }
    this.closedDrafts.delete(draftID)
  }

  public async abortSessions(ids: readonly string[]): Promise<void> {
    const sessions = [...new Set(ids)]
    const targets = new Set(sessions.filter((sid) => !sid.startsWith("pending:")))
    for (const draft of sessions.filter((sid) => sid.startsWith("pending:"))) {
      let sid: string | undefined
      for (const [k, v] of this.draftSessions) {
        if (k.startsWith(`${draft}\0`)) {
          sid = v.sid
          break
        }
      }
      if (!sid && !this.creatingDrafts.has(draft)) continue
      this.closedDrafts.add(draft)
      if (sid) targets.add(sid)
    }
    await Promise.all([...targets].map((sid) => this.stopSession(sid)))
  }

  private stopSession(sid: string, scope?: "session" | "tree"): Promise<boolean> {
    this.cancelRetry(sid)
    const client = this.client
    if (!client) return Promise.resolve(false)
    const dir = this.getWorkspaceDirectory(sid)
    this.aborts.preserve(sid, this.sessionStatusMap.get(sid), dir)
    return this.aborts.stop(
      client,
      sid,
      dir,
      (dir, action) => this.connectionService.runExplicitAbort(sid, dir, action),
      scope,
    )
  }

  private async handleAbort(sessionID?: string, scope?: "session" | "tree"): Promise<void> {
    const sid = sessionID || this.currentSession?.id
    if (!sid || !(await this.stopSession(sid, scope))) return
    this.mark(sid)
    this.publish(sid, { type: "idle" })
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
      recordPermissionDirectory: (id, dir, sid) => this.connectionService.recordPermissionDirectory(id, dir, sid),
      getPermissionDirectory: (id) => this.connectionService.getPermissionDirectory(id),
      getPermissionSession: (id) => this.connectionService.getPermissionSession(id),
      clearPermissionDirectory: (id) => this.connectionService.clearPermissionDirectory(id),
      getPermissionRevision: () => this.connectionService.getPermissionRevision(),
      prunePermissionDirectories: (active, dirs) => this.connectionService.prunePermissionDirectories(active, dirs),
      runPermissionResponse: (id, sid, action) => this.connectionService.runPermissionResponse(id, sid, action),
      isPermissionResponseClaimed: (id) => this.connectionService.isPermissionResponseClaimed(id),
      clearPermissionResponse: (id) => this.connectionService.clearPermissionResponse(id),
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

  // Auth handlers extracted to kilo-provider/handlers/auth.ts

  private get authCtx(): AuthContext {
    return {
      client: this.client,
      postMessage: (msg) => this.postMessage(msg),
    }
  }

  /**
   * Handle a generic setting update from the webview.
   */
  private async handleUpdateSetting(key: string, value: unknown): Promise<void> {
    const { section, leaf } = buildSettingPath(key)
    // Only chat settings are on with the Kilo v2 server (features.ts).
    if (section === "autocomplete" || section === "indexing") return
    if (section === "chat" && !validChatSetting(leaf, value)) return
    const config = vscode.workspace.getConfiguration(`kilo-code.new${section ? `.${section}` : ""}`)
    // Normalize a webview-side clear to `undefined` so VS Code removes the
    // key from settings.json rather than persisting a literal `null`. This
    // lets the runtime fall back to the resolved default.
    const next = value === null ? undefined : value
    await config.update(leaf, next, vscode.ConfigurationTarget.Global)
  }

  /** Re-fetch all server-side state after an auth change. */
  private async reloadAfterAuthChange(): Promise<void> {
    this.invalidateProviders()
    await Promise.all([
      this.fetchAndSendProviders(),
      this.fetchAndSendConfig().then(() =>
        Promise.all([
          this.fetchAndSendAgents(),
          this.fetchAndSendSkills(),
          this.fetchAndSendCommands(),
          this.fetchAndSendNotifications(),
        ]),
      ),
    ])
  }

  /** Reload config, skills, agents, and commands from disk by rebooting the project's instances. */
  private async handleReload(): Promise<void> {
    if (!this.client) {
      console.warn("[Kilo New] handleReload: no client connection")
      return
    }
    const dir = this.getWorkspaceDirectory(this.currentSession?.id)
    try {
      await this.client.instance.reload({ directory: dir }, { throwOnError: true })
    } catch (err) {
      // wrapClientError exposes the HTTP status via `cause`, not `response`.
      const cause = err instanceof Error ? err.cause : undefined
      const status =
        cause && typeof cause === "object" && "status" in cause ? (cause as { status?: number }).status : undefined
      if (status === 409) {
        vscode.window.showWarningMessage(
          "Cannot reload while a session is running in this project. Wait for it to finish or abort it first.",
        )
        return
      }
      console.error("[Kilo New] handleReload: reload endpoint failed:", err)
      const detail = err instanceof Error && err.message ? err.message : "See extension logs for details."
      vscode.window.showErrorMessage(`Reload failed. ${detail}`)
      return
    }
    this.clearCommandsCache()
    if (!sameDirectory(dir, this.getWorkspaceDirectory())) {
      await this.reloadAfterAuthChange()
      return
    }
    await Promise.all([
      this.fetchAndSendConfig(),
      this.fetchAndSendAgents(),
      this.fetchAndSendSkills(),
      this.fetchAndSendCommands(),
    ])
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
          session: this.sessionToWebview(event.properties.info),
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

  /**
   * Handle SSE events from the CLI backend.
   * Filters events by project ID and tracked session IDs so each webview only sees its own sessions.
   */
  private handleEvent(event: ProviderEvent, directory?: string): void {
    // Drop session events from other projects before any tracking logic.
    // This must come first: the trackedSessionIds guard below would otherwise
    // let a foreign session through if it was accidentally tracked.
    if (
      directory &&
      directory !== "global" &&
      !this.isCurrentProjectDirectory(directory) &&
      !this.routed(event, directory)
    )
      return
    if (
      this.projectID &&
      (!this.opts.projectQualifier || !directory) &&
      (event.type === "session.created" || event.type === "session.updated") &&
      event.properties.info.projectID !== undefined &&
      event.properties.info.projectID !== null &&
      event.properties.info.projectID !== this.projectID
    ) {
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
      if (this.removedSessionIds.has(sid)) return
      const status = event.properties.status
      this.mark(sid, directory)
      this.aborts.observe(sid, status.type, directory)
      this.publish(sid, status)
      return
    }

    const sessionID = this.resolveEventSessionId(event)

    // Events without sessionID (server.connected, server.heartbeat, indexing.status) → always forward
    // Events with sessionID → only forward if this webview tracks that session
    // message.part.* events are always session-scoped; drop if session unknown.
    if (!sessionID && isSessionScopedPartEvent(event.type)) return
    if (event.type !== "session.deleted" && sessionID && !this.trackedSessionIds.has(sessionID)) return

    // Streamed tool input becomes pending part updates, so a tool row shows its
    // arguments while the model still generates them.
    if (event.type === "session.next.tool.input.delta") {
      if (sessionID) this.inputs.delta(event.properties)
      return
    }

    if (event.type === "message.part.updated") this.refreshGitStatusFromPart(event, sessionID)

    if (event.type === "session.updated") {
      // Full bus snapshots duplicate sync patches with the same event ID but no sequence metadata.
      if (!isLegacySyncEvent(event)) return
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
      void this.reloadAfterAuthChange().finally(() => this.postMessage({ type: "agentBehaviourInvalidated" }))
      return
    }

    // Config was updated without a full dispose (e.g. permission-only save).
    // Fetch and push the updated config + refresh agents and providers so the
    // Settings panel and mode/model pickers reflect the change.
    if (event.type === "global.config.updated") {
      void Promise.all([
        this.fetchAndSendConfigUpdated(),
        this.fetchAndSendAgents(),
        this.fetchAndSendProviders(),
      ]).finally(() => this.postMessage({ type: "agentBehaviourInvalidated" }))
      return
    }

    // The model catalog was refreshed, so the picker's providers may be stale.
    if (event.type === "models-dev.refreshed") {
      void this.fetchAndSendProviders()
      return
    }

    // Forward relevant events to webview
    // Side effects that must happen before the webview message is sent
    if (event.type === "session.created" && !this.currentSession) {
      this.setCurrentSession(event.properties.info)
      this.contextSessionID = event.properties.info.id
      this.trackedSessionIds.add(event.properties.info.id)
    }
    if (event.type === "session.updated" && this.currentSession?.id === event.properties.sessionID) {
      this.setCurrentSession(event.properties.info)
      this.contextSessionID = event.properties.sessionID
    }
    if (event.type === "session.deleted") {
      const sid = event.properties.sessionID
      this.trackedSessionIds.delete(sid)
      this.sessionDirectories.delete(sid)
      this.connectionService.pruneSession(sid)
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

    const msg = isLegacySyncEvent(event)
      ? this.mapSyncEventToWebviewMessage(event)
      : mapSSEEventToWebviewMessage(event, sessionID)
    if (!msg) return
    if (msg.type === "partUpdated") {
      this.streams.push({ ...msg, part: this.inputs.track(this.slimPart(msg.part)) })
      return
    }
    const next = msg.type === "messageCreated" ? { ...msg, message: this.slimInfo(msg.message) } : msg
    this.streams.flush(sessionID)
    this.postMessage(next)
    const sid = event.type === "session.turn.close" ? event.properties.sessionID : sessionID
    if (!sid) return
    const status = this.sessionStatusMap.get(sid)
    if (!status || status === "idle") return
    if (
      event.type === "session.turn.close" ||
      (event.type === "message.updated" &&
        event.properties.info.role === "assistant" &&
        event.properties.info.finish === "stop" &&
        event.properties.info.time.completed !== undefined)
    ) {
      this.sync(sid, directory ?? this.getWorkspaceDirectory(sid))
    }
  }

  /** Wait until the webview has sent "webviewReady". Resolves immediately when already ready. */
  public waitForReady(): Promise<void> {
    if (this.isWebviewReady && this.webview) return Promise.resolve()
    const deferred = Promise.withResolvers<void>()
    this.readyResolvers.push(deferred.resolve)
    return deferred.promise
  }
  /** Post a message to the webview. Public so toolbar button commands can send messages. */
  public postMessage(message: unknown): void {
    const payload = message
    if (!this.webview) {
      const type =
        typeof payload === "object" &&
        payload !== null &&
        "type" in payload &&
        typeof (payload as { type?: unknown }).type === "string"
          ? (payload as { type: string }).type
          : "<unknown>"
      console.warn("[Kilo New] KiloProvider: ⚠️ postMessage dropped (no webview)", { type })
      return
    }

    void this.webview.postMessage(payload).then(undefined, (error) => {
      console.error("[Kilo New] KiloProvider: ❌ postMessage failed", error)
    })
  }

  private flushPendingKiloModel(): void {
    if (!this.webview || !this.isWebviewReady || !this.client || !this.pendingKiloModel) return

    const pending = this.pendingKiloModel
    this.pendingKiloModel = null
    this.postMessage({ type: "selectKiloModel", ...pending })
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
   * Every folder in the editor workspace, as candidate file-mention sources.
   *
   * File search fans out across these so files in folders added via "Add Folder
   * to Workspace..." are mentionable. Fan-out is declined downstream unless the
   * session's own directory is one of them.
   */
  private getWorkspaceRoots(): SearchRoot[] {
    return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
      path: folder.uri.fsPath,
      name: folder.name,
    }))
  }

  /**
   * Narrow a directory's files to those its own ignore rules permit.
   *
   * File search applies editor exclusions separately; this adds .kilocodeignore.
   * A controller that cannot be built lets the files through rather than
   * hiding everything, since this is a relevance filter and not a permission
   * boundary.
   */
  private async filterIgnored(dir: string, files: string[]): Promise<string[]> {
    if (!dir || !files.length) return files
    const controller = await this.getIgnoreController(dir).catch((err) => {
      console.warn("[Kilo New] Failed to read ignore rules for", dir, err)
      return undefined
    })
    if (!controller) return files
    return files.filter((file) => controller.validateAccess(file))
  }

  /**
   * Get or create a FileIgnoreController for a workspace directory.
   *
   * Keyed by directory rather than holding a single controller: multi-root file
   * search asks about several roots per keystroke, and a one-entry cache would
   * re-read .kilocodeignore from disk on every alternating lookup. Bounded by
   * insertion order because session directories, not just workspace folders,
   * reach this cache.
   *
   * A failed init is evicted rather than cached. `initialize()` lets permission
   * errors from reading .kilocodeignore propagate, and caching that rejection
   * would keep failing every later lookup for the same directory.
   */
  private async getIgnoreController(workspaceDir: string): Promise<FileIgnoreController> {
    const cached = this.ignoreControllers.get(workspaceDir)
    if (cached) return cached
    const pending = (async () => {
      const controller = new FileIgnoreController(workspaceDir)
      await controller.initialize()
      return controller
    })()
    void pending.catch(() => {
      if (this.ignoreControllers.get(workspaceDir) === pending) this.ignoreControllers.delete(workspaceDir)
    })
    this.ignoreControllers.set(workspaceDir, pending)
    while (this.ignoreControllers.size > KiloProvider.IGNORE_CONTROLLER_LIMIT) {
      const oldest = this.ignoreControllers.keys().next().value
      if (oldest === undefined || oldest === workspaceDir) break
      this.ignoreControllers.delete(oldest)
    }
    return pending
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
          ...vscode.window.visibleTextEditors.map((editor) => notebookFile(editor.document.uri)),
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
      ? notebookFile(activeEditor.document.uri)
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

  private isCurrentProjectDirectory(directory: string): boolean {
    if (!this.opts.projectQualifier?.()) return true
    const dirs = [this.getRootDirectory(), ...(this.opts.worktreeDirectories?.() ?? [])]
    return dirs.some((dir) => sameDirectory(dir, directory))
  }

  private owned(sessionID: string, directory?: string): boolean {
    if (!directory || directory === "global") return false
    const owner =
      this.owners.get(sessionID)?.dir ??
      (this.trackedSessionIds.has(sessionID) ? this.sessionDirectories.get(sessionID) : undefined)
    return owner !== undefined && sameDirectory(owner, directory)
  }

  // Activity events pass the directory gate for sessions this panel owns, so an inactive project's
  // sidebar row keeps a current state. The tracked-session check still applies to these events.
  private routed(event: ProviderEvent, directory?: string): boolean {
    if (!ACTIVITY_EVENTS.has(event.type)) return false
    const props = event.properties
    const sid = "sessionID" in props && typeof props.sessionID === "string" ? props.sessionID : undefined
    return sid !== undefined && this.owned(sid, directory)
  }

  // Project routing across several projects belongs to the Agent Manager, which is off on the Kilo v2 line.
  private isCurrentProjectSession(_sessionID: string): boolean {
    return true
  }

  private refreshGitStatusFromPart(
    event: Extract<ProviderEvent, { type: "message.part.updated" }>,
    sessionID?: string,
  ) {
    void this.refreshGitStatusFromParts([event.properties.part], sessionID)
  }

  private async refreshGitStatusFromParts(parts: unknown[], sessionID?: string, recover = false): Promise<boolean> {
    const base = this.getWorkspaceDirectory(sessionID)
    const edits = editPaths(parts, base)
    if (!recover && edits.length === 0) return false

    const cached = sessionID ? this.sessionGitDirectories.get(sessionID) : undefined
    if (cached) {
      await this.refreshGitStatus(cached, sessionID)
      return true
    }

    const root = await this.resolveGitRoot(base)
    if (root) {
      await this.refreshGitStatus(root, sessionID)
      return true
    }

    const file = edits.find((item) => this.isCurrentProjectGitDirectory(item, sessionID))
    if (!file) return false
    await this.refreshGitStatus(path.dirname(file), sessionID)
    return sessionID ? this.sessionGitDirectories.has(sessionID) : true
  }

  private async recoverSessionGitStatus(parts: unknown[], sessionID: string, cursor?: string): Promise<void> {
    if (await this.refreshGitStatusFromParts(parts, sessionID, true)) return
    if (!cursor || !this.client || !this.trackedSessionIds.has(sessionID)) return
    if (this.sessionGitRecoveries.has(sessionID)) return
    this.sessionGitRecoveries.add(sessionID)

    const directory = this.getWorkspaceDirectory(sessionID)
    const history = await retry(() =>
      this.client!.session.messages({ sessionID, directory, limit: 0 }, { throwOnError: true }),
    ).catch((error: unknown) => {
      console.warn("[Kilo New] KiloProvider: Failed to recover session Git directory:", error)
      return undefined
    })
    if (!history) {
      this.sessionGitRecoveries.delete(sessionID)
      return
    }
    if (!this.trackedSessionIds.has(sessionID)) return
    await this.refreshGitStatusFromParts(
      history.data.flatMap((message) => message.parts),
      sessionID,
    )
  }

  private isCurrentProjectGitDirectory(directory: string, sessionID?: string): boolean {
    const roots = this.opts.projectQualifier?.()
      ? [this.getRootDirectory(), ...(this.opts.worktreeDirectories?.() ?? [])]
      : [this.getWorkspaceDirectory(sessionID)]
    return roots.some((root) => {
      const rel = path.relative(path.resolve(root), path.resolve(directory))
      return rel === "" || (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`))
    })
  }

  public async refreshGitStatus(directory = this.getWorkspaceDirectory(), sessionID?: string): Promise<void> {
    const client = this.client
    if (!client) return
    const active = !sessionID || sessionID === this.contextSessionID
    const revision = active ? ++this.gitStatusRevision : undefined
    const repo = await hasGit(client, directory)
    const root = await this.resolveGitRoot(directory)
    const found = repo || root !== undefined
    const target = root ?? directory
    if (found && sessionID && !this.sessionGitDirectories.has(sessionID)) {
      this.sessionGitDirectories.set(sessionID, target)
    }
    if (sessionID && sessionID !== this.contextSessionID) return
    if (revision === undefined || revision !== this.gitStatusRevision) return
    this.cachedGitRepo = found
    this.postMessage({ type: "gitStatus", repo: found })
  }

  private async resolveGitRoot(directory: string): Promise<string | undefined> {
    return gitRoot(directory)
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
    const override = this.opts.rootDirectory?.()
    if (override) return override
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (workspaceFolders && workspaceFolders.length > 0) {
      return workspaceFolders[0]!.uri.fsPath
    }
    return process.cwd()
  }

  private trackDirectory(sessionId: string, dir: string) {
    // Agent Manager Local sessions must retain their explicit project root.
    // Removing same-root entries would silently retarget them after switching
    // the panel's active project.
    this.sessionDirectories.set(sessionId, dir)
  }

  private getProjectDirectory(sessionId?: string): string | undefined {
    return resolveProjectDirectory(this.projectDirectory, () => this.getWorkspaceDirectory(sessionId))
  }

  private _getHtmlForWebview(webview: vscode.Webview, sidebar = false): string {
    const bundle = "webview"
    return buildWebviewHtml(webview, {
      // The rail follows the physical workbench edge. RTL text direction must not move it between chat and code.
      sidebar: sidebar
        ? vscode.workspace.getConfiguration("workbench").get("sideBar.location") === "right"
          ? "right"
          : "left"
        : undefined,
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", `${bundle}.js`)),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", `${bundle}.css`)),
      iconsBaseUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      workerUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "shiki-worker.js")),
      title: "Kilo Code",
      port: port(this.connectionService.getServerInfo()?.url),
      extraStyles: `.container { height: 100vh; }`,
      // Dedicated single-purpose panels (Settings, Profile, Sub-Agent Viewer)
      // never show the bar. Sidebar and "Open in Tab" only need it in Cursor —
      // VS Code's native toolbar (restored in package.json) works everywhere.
      topBar: this.opts.hideTopBar !== true && isCursorHost(),
      topBarSurface: this.opts.topBarSurface === "tab" ? "tab_title" : "sidebar_title",
    })
  }

  /**
   * Dispose of the provider and clean up subscriptions.
   * Does NOT kill the server — that's the connection service's job.
   */
  dispose(): void {
    this.opts.onHidden?.()
    if (this.opts.focusContext) {
      void vscode.commands.executeCommand("setContext", this.opts.focusContext, false)
    }
    this.setFocusTarget("other")
    this.latch?.dispose()
    this.latch = undefined
    this.catalogRetry.dispose()
    this.streams.focus(undefined)
    this.connectionService.unregisterVisible(this.instanceId)
    this.connectionService.unregisterAttached(this.instanceId)
    this.unsubscribeEvent?.()
    this.unsubscribeState?.()
    this.unsubscribeNotificationDismiss?.()
    this.unsubscribeLanguageChange?.()
    this.unsubscribeProfileChange?.()
    this.unsubscribeFavoritesChange?.()
    this.unsubscribeModelSelectorExpanded?.()
    this.unsubscribeClearPendingPrompts?.()
    this.unsubscribeDirectoryProvider?.()
    this.unsubscribeAcknowledged?.()
    this.viewStateDisposable?.dispose()
    this.visibilityDisposable?.dispose()
    this.webviewMessageDisposable?.dispose()
    this.chatConfigDisposable?.dispose()
    this.throughputConfigDisposable?.dispose()
    this.autoApprovalReasonConfigDisposable?.dispose()
    this.pushFixesConfigDisposable?.dispose()
    this.shortcutHintsConfigDisposable?.dispose()
    this.workspaceFoldersDisposable?.dispose()
    this.shortcutContextDisposable?.dispose()
    this.visibleTaskStreams.clear()
    this.inputs.dispose()
    this.streams.dispose()
    this.isWebviewReady = false
    this.webview = null
    // Release any waitForReady() awaiters so their callers don't hang after disposal.
    this.readyResolvers.splice(0).forEach((r) => r())
    this.promptRecoveryQueued = false
    this.trackedSessionIds.clear()
    this.removedSessionIds.clear()
    this.openSessionIds.clear()
    this.syncedChildSessions.clear()
    this.inspectorSessionIds.clear()
    this.draftSessions.clear()
    this.sessionDirectories.clear()
    this.owners.clear()
    this.aborts.clear()
    this.requests.clear()
    this.epochs.clear()
    this.sessionStatusMap.clear()
    for (const pending of this.ignoreControllers.values()) {
      void pending.then(
        (controller) => controller.dispose(),
        (err) => console.warn("[Kilo New] Failed to dispose ignore controller:", err),
      )
    }
    this.ignoreControllers.clear()
  }
}

/** The file of a text editor document; a notebook cell maps to its notebook file. */
function notebookFile(uri: vscode.Uri): vscode.Uri | undefined {
  if (uri.scheme === "file") return uri
  if (uri.scheme !== "vscode-notebook-cell") return undefined
  const id = uri.toString()
  return vscode.workspace.notebookDocuments.find((notebook) =>
    notebook.getCells().some((cell) => cell.document.uri.toString() === id),
  )?.uri
}

function port(url: string | undefined): number | undefined {
  if (!url || !URL.canParse(url)) return undefined
  const value = Number(new URL(url).port)
  return value || undefined
}
