import * as fs from "fs"
import * as path from "path"
import type { KiloClient, Session } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../services/cli-backend"
import { getErrorMessage, sessionToWebview } from "../kilo-provider-utils"
import { samePath } from "./project/paths"
import { resolveLocalDiffTarget } from "../diff/shared/target"
import { DiffSourceCatalog } from "../diff/sources/catalog"
import { getDiffMarkdownRender, setDiffMarkdownRender } from "../review-settings"
import { isAbsolutePath } from "../path-utils"
import { WorktreeManager, type CreateWorktreeResult } from "./WorktreeManager"
import { remoteRef, WorktreeStateManager, type Worktree } from "./WorktreeStateManager"
import { composeDiffId, normalizeScope } from "./diff-scope"
import { handleSection } from "./section-handler"
import { STATE_GATED } from "./project/state-gate"
import {
  addSessionToLifecycleWorktree,
  closeLifecycleSession,
  createLifecycleWorktree,
  deleteLifecycleWorktree,
  promoteLifecycleSession,
  removeStaleLifecycleWorktree,
  type LifecycleHost,
} from "./provider-lifecycle"
import { normalizeBaseBranch } from "./base-branch"
import { GitStatsPoller, type LocalStats, type WorktreePresenceResult, type WorktreeStats } from "./GitStatsPoller"
import { PRStatusBridge } from "./pr-status-bridge"
import { createPollers, type ProjectPollers } from "./project/pollers"
import { GitOps } from "./GitOps"
import { versionedName } from "./branch-name"
import { BranchNamingController } from "./branch-naming"
import { SetupScriptService } from "./SetupScriptService"
import { copyEnvFiles } from "./env-copy"
import { SessionTerminalManager } from "./SessionTerminalManager"
import { createTerminalHost } from "./terminal-host"
import { TerminalRouter } from "./terminal-routing"
import { executeVscodeTask } from "./task-runner"
import { runWorktreeSetupScript } from "./setup-script-task"
import { RunController } from "./run/controller"
import { handleRunMessage } from "./run/message"
import { createRunController, createScriptTerminalRuntime, clearScriptTerminals } from "./script-terminal-runtime"
import { forkSession } from "./fork-session"
import { AgentManagerVisiblePresence } from "./am-visible-presence"
import { continueInWorktree } from "./continue-in-worktree"
import { WorktreeDiffController } from "./worktree-diff-controller"
import { WorktreeImporter } from "./worktree-importer"
import {
  createWorktreeOnDisk,
  type CreateWorktreeOnDiskOptions,
  type CreateWorktreeOnDiskResult,
} from "./worktree-create"
import { initContextState, pushProjectSessions, reactivateProject, registerProjectSessions } from "./project/init"
import { createLocalDiff } from "./local-diff"
import { parseToolRequest, startFromTool, type ToolRequest } from "./tool-start"
import { sandboxSessionMetadata } from "../shared/sandbox-session"
import { AgentManagerOrchestrationBridge } from "./orchestration-bridge"
import { pruneSubagents } from "./prune-subagents"
import { startSession } from "./mcp-warmup"
import { readTerminalFont, watchTerminalFont } from "./terminal-font"
import { DestinationState, handleDestination, watchTerminalDestination } from "./terminal-destination"
import { buildKeybindingMap } from "./format-keybinding"
import { resolveVersionModels, buildInitialMessages, type CreatedVersion } from "./multi-version"
import { ensureSandbox } from "./sandbox-bootstrap"
import { Semaphore } from "./semaphore"
import { PLATFORM } from "./constants"
import { ProjectRegistry } from "./project/registry"
import type { ProjectContext } from "./project/context"
import { ProjectContexts } from "./project/contexts"
import { createMultiVersion, type MultiVersionHost } from "./provider-multi-version"
import { handleProjectMessage, type ProjectMessageDeps } from "./project/messages"
import { createProjectWiring } from "./project/wiring"
import { ProjectScope } from "./project/scope"
import type { AgentManagerOutMessage, AgentManagerInMessage } from "./types"
import type { Host, PanelContext, OutputHandle, Disposable } from "./host"

export class AgentManagerProvider implements Disposable {
  public static readonly viewType = "kilo-code.new.AgentManagerPanel"
  private panel: PanelContext | undefined
  private outputChannel: OutputHandle
  private readonly registry: ProjectRegistry
  private readonly contexts: ProjectContexts
  private readonly projects: ProjectMessageDeps
  private readonly projectScope = new ProjectScope()
  private importer: WorktreeImporter
  private terminalManager: SessionTerminalManager
  private terminalRouter: TerminalRouter
  private scripts: ReturnType<typeof createScriptTerminalRuntime>
  private run: RunController
  private stateReady: Promise<void> | undefined
  private statsPoller: GitStatsPoller
  private readonly projectPollers: ProjectPollers
  private prBridge!: PRStatusBridge
  private orchestration: AgentManagerOrchestrationBridge
  private gitOps: GitOps
  private diffs: WorktreeDiffController
  private diffCatalog: DiffSourceCatalog
  private naming: BranchNamingController
  private toolRequests = new Set<string>()
  private cachedWorktreeStats: { type: "agentManager.worktreeStats"; stats: WorktreeStats[] } | undefined
  private cachedLocalStats: { type: "agentManager.localStats"; stats: LocalStats } | undefined
  private unsubTool: (() => void) | undefined
  private unsubStatus: (() => void) | undefined
  private unsubSessions: (() => void) | undefined
  private unsubFont: (() => void) | undefined
  private unsubProjects: (() => void) | undefined
  /** Scratch set returned when no active context exists; mutations are discarded. */
  private readonly staleScratch = new Set<string>()
  private unsubDestination: (() => void) | undefined
  private destination = new DestinationState()
  private closing: Promise<void> | undefined
  private onVisibilityChange: ((visible: boolean) => void) | undefined
  // Tracks sessions owned by this panel until they are explicitly closed.
  private panelSessions = new Set<string>()

  /** Session ID most recently loaded via `loadMessages`; updated synchronously. */
  private activeSessionId: string | undefined
  private visiblePresence = new AgentManagerVisiblePresence(
    (ids) => this.connectionService.registerVisible("agent-manager", ids),
    () => this.panel?.visible ?? false,
    (ids) => this.connectionService.registerAttached("agent-manager", ids),
  )
  constructor(
    private readonly host: Host,
    private readonly connectionService: KiloConnectionService,
  ) {
    this.outputChannel = host.createOutput("Kilo Agent Manager")
    this.terminalManager = new SessionTerminalManager(
      (msg) => this.outputChannel.appendLine(`[SessionTerminal] ${msg}`),
      createTerminalHost(),
    )
    this.terminalRouter = new TerminalRouter({
      getClient: () => this.connectionService.getClient(),
      getClientAsync: () => this.connectionService.getClientAsync(this.getRoot()),
      getServerConfig: () => this.connectionService.getServerConfig() ?? undefined,
      getRoot: () => this.getRoot(),
      getWorktreePath: (id) => this.getStateManager()?.getWorktree(id)?.path,
      getProjectId: () => this.projectScope.current()?.id ?? this.contexts.active()?.id,
      log: (...args) => this.log("[XTerm]", ...args),
      post: (msg) => this.postToWebview(msg),
      getTerminalFont: () => readTerminalFont(),
    })
    this.scripts = createScriptTerminalRuntime({
      connection: this.connectionService,
      output: this.outputChannel,
      post: (message) => this.postToWebview(message),
    })
    this.unsubFont = watchTerminalFont((font) => {
      this.postToWebview({ type: "agentManager.terminal.fontChanged", font })
      this.scripts.manager.snapshot()
    })
    this.unsubDestination = watchTerminalDestination((destination) => {
      this.destination.sync(destination)
      this.postToWebview({ type: "agentManager.terminal.destinationChanged", destination })
    })
    this.run = createRunController({
      manager: this.scripts.manager,
      root: () => this.getRoot(),
      state: () => this.getStateManager(),
      project: (id) => this.projectForScript(id),
      open: (file) => this.host.openDocument(file),
      trusted: () => this.host.isTrusted(),
      post: (message) => this.postRunMessage(message),
      log: (msg) => this.outputChannel.appendLine(`[RunScript] ${msg}`),
      refresh: () => this.pushState(),
    })
    this.importer = new WorktreeImporter({
      manager: () => this.getWorktreeManager(),
      state: () => this.getStateManager(),
      post: (msg) => this.postToWebview(msg),
      push: () => this.pushState(),
      setup: (dir, branch, id) => this.runSetupScriptForWorktree(dir, branch, id),
      session: (dir, branch, id) => this.createSessionInWorktree(dir, branch, id),
      register: (sid, dir) => this.registerWorktreeSession(sid, dir),
      ready: (sid, result, id) => this.notifyWorktreeReady(sid, result, id),
      log: (...args) => this.log(...args),
    })
    const semaphore = new Semaphore(3)
    this.gitOps = new GitOps({ log: (...args) => this.log(...args), semaphore })
    const wiring = createProjectWiring({
      host: this.host,
      git: this.gitOps,
      log: (...args) => this.log(...args),
      output: (msg) => this.outputChannel.appendLine(msg),
      activate: (ctx) => this.activateProject(ctx),
      expand: (ctx) => this.initExpanded(ctx),
      ready: (ctx) => initContextState(ctx, (...args) => this.log(...args)),
      push: () => this.pushProjects(),
      changed: () => this.onWorkspaceChanged(),
      refresh: () => this.pushState(),
      selected: (target) => this.postToWebview({ type: "agentManager.selectionActivated", target }),
    })
    this.registry = wiring.registry
    this.contexts = wiring.contexts
    this.projects = wiring.messages
    this.unsubProjects = () => wiring.dispose()
    this.naming = new BranchNamingController({
      state: () => this.getStateManager(),
      manager: () => this.getWorktreeManager(),
      client: (dir) => this.connectionService.getClientAsync(dir),
      settings: () => this.host.autoBranchNaming(),
      push: () => this.pushState(),
      log: (msg) => this.log(msg),
    })
    const local = createLocalDiff(this.gitOps, (...args) => this.log(...args))
    this.diffCatalog = new DiffSourceCatalog(this.connectionService)
    this.diffs = new WorktreeDiffController({
      getState: () => this.getStateManager(),
      getRoot: () => this.getRoot(),
      getStateReady: () => this.stateReady,
      catalog: this.diffCatalog,
      git: this.gitOps,
      localDiffFile: local.file,
      post: (msg) => this.postToWebview(msg),
      log: (...args) => this.log(...args),
    })
    const pollers = createPollers({
      git: this.gitOps,
      semaphore,
      state: () => this.state,
      root: () => this.getRoot(),
      activeId: () => this.contexts.active()?.id,
      visible: () => this.panel?.visible ?? false,
      post: (msg) => this.postToWebview(msg),
      cache: (msg) => {
        if (msg.type === "agentManager.worktreeStats") this.cachedWorktreeStats = msg
        if (msg.type === "agentManager.localStats") this.cachedLocalStats = msg
      },
      presence: (presence) => this.onWorktreePresence(presence),
      openExternal: (u) => this.host.openExternal(u),
      log: (...args) => this.log(...args),
    })
    this.statsPoller = pollers.stats
    this.prBridge = pollers.pr
    this.projectPollers = pollers.projects
    this.orchestration = new AgentManagerOrchestrationBridge(this.connectionService, {
      root: () => this.getRoot(),
      state: () => this.state,
      ready: async () => {
        this.stateReady ??= this.initializeState()
        await this.stateReady
        return this.state
      },
      stats: (refresh) => this.statsPoller.snapshot(refresh),
      prs: () => this.prBridge.snapshot(),
      push: () => this.pushState(),
      managed: (id) => this.panelSessions.has(id) || !!this.state?.getSession(id),
      close: async (id) => {
        await this.onCloseSession(id)
        this.postToWebview({ type: "agentManager.sessionClosed", sessionId: id })
      },
      log: (...args) => this.log(...args),
    })
    this.unsubTool = this.connectionService.onEventFiltered(
      (event) => (event as { type?: string }).type === "kilocode.agent_manager.start",
      (event, directory) => this.onToolEvent(event, directory),
    )
    this.unsubStatus = this.connectionService.onEventFiltered(
      (event) => (event as { type?: string }).type === "session.status",
      (event) => this.onSessionStatus(event),
    )
    this.unsubSessions = this.connectionService.onEventFiltered(
      (event) => {
        const type = (event as { type?: string }).type
        return type === "session.created" || type === "session.updated" || type === "session.deleted"
      },
      (event) => this.onSessionLifecycle(event),
    )
  }

  /**
   * Keep each project's cached sidebar session list in sync with backend
   * session lifecycle events, so sessions created outside this panel (another
   * window, the CLI, the API) appear without waiting for a full re-list.
   */
  private onSessionLifecycle(event: unknown): void {
    const ev = event as { type?: string; properties?: { info?: Session; sessionID?: string } }
    if (ev.type === "session.deleted") {
      const id = ev.properties?.sessionID
      if (!id) return
      const ctx = this.contexts.byLiveSession(id)
      if (!ctx) return
      ctx.removeLiveSession(id)
      this.postToWebview({ type: "agentManager.projectSessions", projectId: ctx.id, sessions: [...ctx.sessions()] })
      return
    }
    const info = ev.properties?.info
    const dir = info?.directory
    // Session events from sync or older backends can lack time/directory; a
    // throw here would escape into the SSE dispatch loop and starve the other
    // listeners (there is no per-listener error isolation).
    if (!info?.time || !dir) return
    const ctx = this.contexts.byDirectory(dir)
    if (!ctx || ctx.lifecycle !== "ready") return
    const state = ctx.peekState()
    const managed = state?.getSession(info.id)
    const worktreeId =
      managed?.worktreeId ?? state?.getWorktrees().find((wt) => wt.path && samePath(wt.path, dir))?.id ?? null
    ctx.upsertSession({ ...sessionToWebview(info), worktreeId })
    // The next regular push re-lists from the backend to reconcile the
    // optimistic entry (position, subtrees, deletions elsewhere).
    ctx.invalidateSessions()
    this.postToWebview({ type: "agentManager.projectSessions", projectId: ctx.id, sessions: [...ctx.sessions()] })
  }

  private onSessionStatus(event: unknown): void {
    const props = (event as { properties?: { sessionID?: string; status?: { type?: string } } }).properties
    const sid = props?.sessionID
    const type = props?.status?.type
    if (!sid || !type) return
    if (type === "idle") this.naming.idle(sid)
    else this.naming.busy(sid)
  }

  private log(...args: unknown[]) {
    const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")
    this.outputChannel.appendLine(`${new Date().toISOString()} ${msg}`)
  }

  public openPanel(preserveFocus?: boolean): void {
    if (this.panel) {
      this.log("Panel already open, revealing")
      this.panel.reveal(preserveFocus)
      if (!preserveFocus) this.postToWebview({ type: "action", action: "focusInput" })
      return
    }
    this.log("Opening Agent Manager panel")
    this.host.capture("Agent Manager Opened", { source: PLATFORM })

    this.attachPanel(
      this.host.openPanel({
        onBeforeMessage: (msg) => this.onMessage(msg),
        worktreeDirectories: () => this.getWorktreeDirectories(),
        workspaceRoot: () => this.getRoot(),
        projectId: () => this.contexts.active()?.id,
      }),
    )
  }

  public onPanelVisibilityChange(cb: (visible: boolean) => void): void {
    this.onVisibilityChange = cb
  }

  /** Restore the Agent Manager panel from a previously serialized state.
   *  The caller (extension.ts / vscode-host.ts) wraps the raw panel before passing it. */
  public deserializePanel(ctx: PanelContext): void {
    if (this.panel) {
      this.log("Panel already exists during deserialization, disposing duplicate")
      ctx.dispose()
      return
    }
    this.log("Deserializing Agent Manager panel")
    this.attachPanel(ctx)
  }

  /** Message interceptor — exposed for the deserialization path in extension.ts. */
  public handleMessage(msg: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    return this.onMessage(msg)
  }

  /** Wire up a panel context (shared by openPanel and deserializePanel). */
  private attachPanel(ctx: PanelContext): void {
    if (this.panel) {
      this.log("Disposing previous panel before attaching new one")
      const panel = this.panel
      this.panel = undefined
      panel.dispose()
    }
    this.panel = ctx

    this.statsPoller.setVisible(ctx.visible)
    this.projectPollers.setVisible(ctx.visible)
    this.onVisibilityChange?.(ctx.visible)
    ctx.onDidChangeVisibility((visible) => {
      this.statsPoller.setVisible(visible)
      this.projectPollers.setVisible(visible)
      this.visiblePresence.flush()
    })

    ctx.sessions.onFollowupAdopted((session, directory) => {
      this.adoptFollowupInWorktree(session, directory)
    })

    this.stateReady = this.initializeState()
    this.pushProjects()
    void this.sendRepoInfo()
    this.sendKeybindings()
    this.prBridge.attachPanel(ctx)
    ctx.onDidDispose(() => {
      // Only clear if this is still the active panel — a newer panel may
      // have already replaced us via attachPanel.
      if (this.panel === ctx) {
        this.log("Panel disposed")
        const ids = [...this.panelSessions]
        if (this.activeSessionId) ids.push(this.activeSessionId)
        this.panelSessions.clear()
        void ctx.sessions.abortSessions(ids).catch((err) => this.log("Failed to abort sessions on panel close:", err))
        this.statsPoller.stop()
        this.projectPollers.dispose()
        this.prBridge.poller.stop()
        this.diffs.stop()
        this.activeSessionId = undefined
        this.visiblePresence.clear()
        this.panel = undefined
        void this.terminalRouter.dispose()
        this.onVisibilityChange?.(false)
      }
      ctx.sessions.dispose()
    })
  }

  private async initializeState(): Promise<void> {
    const ctx = this.contexts.active()
    if (!ctx) {
      this.pushEmptyState()
      return
    }
    const state = ctx.stateManager()
    const init = await initContextState(ctx, (...args) => this.log(...args))

    if (!init.ok) {
      this.postToWebview({ type: "error", message: "Agent Manager state could not be recovered." })
      this.pushState()
      return
    }

    // When the .kilocode → .kilo migration rewrote git worktree refs, nudge
    // VS Code's git extension to re-discover them. Without this, worktrees
    // won't appear in Source Control until the next VS Code restart.
    if (init.refsFixed > 0) {
      this.log(`Migration fixed ${init.refsFixed} git worktree ref(s), refreshing git`)
      this.host.refreshGit()
    }

    registerProjectSessions(ctx, this.panel?.sessions)
    await pruneSubagents(state, this.panel?.sessions, (message) => this.log(message))
    for (const s of state.getSessions()) this.panel?.sessions.trackSession(s.id)
    this.pushState()

    // Always list sessions, even when the state tracks none: the backend may
    // still hold sessions for this project, and without the listing the
    // sessionsLoaded message never reaches the webview, leaving the sidebar
    // on skeletons forever.
    this.panel?.sessions.refreshSessions()

    // Recover any pending permission/question prompts that were missed during
    // panel recreation or SSE reconnection. Must run after all worktree sessions
    // are registered with their directory overrides so the recovery queries the
    // correct CLI backend Instances.
    this.panel?.sessions.recoverPendingPrompts()
  }

  /** Initialize an expanded background project and push its state (no panel wiring). */
  private initExpanded(ctx: ProjectContext): void {
    void initContextState(ctx, (...args) => this.log(...args))
      .then((result) => {
        if (!result.current) return
        registerProjectSessions(ctx, this.panel?.sessions)
        this.pushState(ctx)
        this.projectPollers.sync(this.contexts)
      })
      .catch((err) => this.log("Failed to initialize expanded project:", err))
  }

  // Message interceptor

  private async onMessage(msg: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    if (this.prBridge.handleMessage(msg)) return null
    if (msg.type === "requestFileSearch" && typeof msg.sessionID !== "string" && this.activeSessionId) {
      return { ...msg, sessionID: this.activeSessionId }
    }
    msg = await this.contextMessage(msg)
    const m = msg as unknown as AgentManagerInMessage
    if (await handleProjectMessage(m, this.projects)) return null
    const ctx = this.messageProject(m)
    if (!ctx) {
      this.log(`dropping ${m.type}: message targets an unknown project`)
      return null
    }
    return this.projectScope.run(ctx, () => this.dispatchMessage(m, msg, ctx))
  }

  private async dispatchMessage(
    m: AgentManagerInMessage,
    msg: Record<string, unknown>,
    ctx: ProjectContext,
  ): Promise<Record<string, unknown> | null> {
    if (this.shouldWaitForState(m)) {
      const result = await initContextState(ctx, (...args) => this.log(...args))
      if (!result.current || !result.ok) {
        this.log(`dropping ${m.type}: project ${ctx.id} not ready (current=${result.current}, ok=${result.ok})`)
        return null
      }
    }
    this.onBranchPrompt(m)

    const worktree = await this.onWorktreeMessage(m)
    if (worktree !== undefined) return worktree
    const session = this.onSessionMessage(m, msg)
    if (session !== undefined) return session
    const ui = this.onUiMessage(m, msg)
    if (ui !== undefined) return ui
    const state = this.onStateMessage(m)
    if (state !== undefined) return state
    const imports = this.onImportMessage(m)
    if (imports !== undefined) return imports
    const diff = this.onDiffMessage(m)
    if (diff !== undefined) return diff
    const bridge = this.onBridgeMessage(m)
    if (bridge !== undefined) return bridge
    if (this.scripts.manager.intercept(m)) return null
    if (this.terminalRouter.handle(m)) return null

    return msg
  }

  private onBranchPrompt(m: AgentManagerInMessage): void {
    if (m.type !== "sendMessage" && m.type !== "sendCommand") return
    const sessionID = m.sessionID ?? m.draftID ?? this.activeSessionId
    if (!sessionID) return
    const text = m.type === "sendMessage" ? m.text.trim() : `/${m.command} ${m.arguments}`.trim()
    if (!text) return
    this.naming.prompt({ sessionID, text, providerID: m.providerID, modelID: m.modelID })
  }

  private async contextMessage(msg: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (msg.type !== "requestGitChangesContext") return msg
    const ctx = typeof msg.agentManagerContext === "string" ? msg.agentManagerContext : undefined
    const target = ctx ? await this.contextTarget(ctx) : undefined
    const sid = typeof msg.sessionID === "string" ? msg.sessionID : this.activeSessionId
    const next = sid && typeof msg.sessionID !== "string" ? { ...msg, sessionID: sid } : msg
    if (target) return { ...next, ...target }
    if (!sid) return next

    const state = this.getStateManager()
    const session = state?.getSession(sid)
    const worktree = session?.worktreeId ? state?.getWorktree(session.worktreeId) : undefined
    if (!worktree) return next
    return { ...next, contextDirectory: worktree.path, gitChangesBase: remoteRef(worktree) }
  }

  private async contextTarget(ctx: string): Promise<Record<string, unknown> | undefined> {
    if (ctx === "local") {
      const root = this.getRoot()
      if (!root) return undefined
      const target = await resolveLocalDiffTarget(this.gitOps, (...args) => this.log(...args), root)
      if (!target) return { contextDirectory: root }
      return { contextDirectory: target.directory, gitChangesBase: target.baseBranch }
    }

    const worktree = this.getStateManager()?.getWorktree(ctx)
    if (!worktree) return undefined
    return { contextDirectory: worktree.path, gitChangesBase: remoteRef(worktree) }
  }

  private async onWorktreeMessage(m: AgentManagerInMessage): Promise<Record<string, unknown> | null | undefined> {
    if (m.type === "agentManager.createWorktree") return this.onCreateWorktree(m.baseBranch, m.branchName)
    if (m.type === "agentManager.deleteWorktree") return this.onDeleteWorktree(m.worktreeId)
    if (m.type === "agentManager.removeStaleWorktree") return this.onRemoveStaleWorktree(m.worktreeId)
    if (m.type === "agentManager.promoteSession") return this.onPromoteSession(m.sessionId)
    if (m.type === "agentManager.addSessionToWorktree") return this.onAddSessionToWorktree(m.worktreeId, m.sessionId)
    if (m.type === "agentManager.forkSession") return this.onForkSession(m.sessionId, m.worktreeId, m.messageId)
    if (m.type === "agentManager.closeSession") return this.onCloseSession(m.sessionId)
  }

  private onSessionMessage(
    m: AgentManagerInMessage,
    msg: Record<string, unknown>,
  ): Record<string, unknown> | null | undefined {
    if (m.type === "agentManager.openLocally") {
      this.panel?.sessions.clearSessionDirectory(m.sessionId)
      const state = this.getStateManager()
      if (state?.getSession(m.sessionId)) {
        state.moveSession(m.sessionId, null)
        this.pushState()
      }
      return null
    }

    if (m.type === "continueInWorktree") {
      void this.continueFromSidebar(m.sessionId, (status, detail, error) => {
        this.panel?.postMessage({ type: "continueInWorktreeProgress", status, detail, error })
      })
      return null
    }

    if (m.type === "agentManager.persistSession" || m.type === "agentManager.forgetSession") {
      const persist = m.type === "agentManager.persistSession"
      if (persist && m.draftID) {
        this.panel?.sessions.acknowledgeDraft(m.draftID, m.sessionId)
        this.panelSessions.delete(m.draftID)
        this.panelSessions.add(m.sessionId)
      }
      void this.stateReady?.then(() => {
        const state = this.getStateManager()
        if (!state) return
        if (persist) {
          if (!state.getSession(m.sessionId)) state.addSession(m.sessionId, null)
          return
        }
        state.removeSession(m.sessionId)
      })
      return null
    }

    if (
      m.type === "requestSandboxDefault" ||
      m.type === "setSandboxDefault" ||
      ((m.type === "sendMessage" || m.type === "sendCommand" || m.type === "toggleSandbox") && !m.sessionID)
    ) {
      if (m.type === "sendMessage" || m.type === "sendCommand") {
        if (m.draftID) this.panelSessions.add(m.draftID)
      }
      const ctx = typeof m.agentManagerContext === "string" ? m.agentManagerContext : undefined
      const worktree = ctx && ctx !== "local" ? this.getStateManager()?.getWorktree(ctx) : undefined
      if (worktree) {
        if ("draftID" in m && m.draftID) this.activeSessionId = m.draftID
        return { ...msg, contextDirectory: worktree.path }
      }
    }

    if (
      (m.type === "sendMessage" || m.type === "sendCommand" || m.type === "toggleSandbox") &&
      m.draftID &&
      !m.sessionID
    ) {
      this.activeSessionId = m.draftID
      return msg
    }

    if (m.type === "requestTerminalContext") {
      if (!m.sessionID || this.terminalManager.prepareContext(m.sessionID)) return msg
      this.panel?.postMessage({
        type: "terminalContextError",
        requestId: m.requestId,
        error: "No terminal is associated with this session",
      })
      return null
    }

    if (m.type === "loadMessages") {
      this.activeSessionId = m.sessionID
      this.terminalManager.syncOnSessionSwitch(m.sessionID)
      this.prBridge.poller.setActiveWorktreeId(this.state?.getSession(m.sessionID)?.worktreeId ?? undefined)
      return msg
    }

    if (m.type === "clearSession") {
      this.activeSessionId = undefined
      this.visiblePresence.setDisplayed(null)
      void Promise.resolve().then(() => {
        if (!this.panel || !this.state) return
        for (const id of this.state.worktreeSessionIds()) {
          this.panel.sessions.trackSession(id)
        }
      })
      return msg
    }

    if (m.type === "abort") {
      this.host.capture("Agent Manager Session Stopped", {
        source: PLATFORM,
        sessionId: m.sessionID,
      })
      return msg
    }

    if (m.type === "agentManager.openSessions") {
      for (const id of m.sessionIDs) this.panelSessions.add(id)
    }
    if (m.type === "agentManager.openSessions" || m.type === "agentManager.visibleSession") {
      this.visiblePresence.handle(m)
      return null
    }
  }

  private onUiMessage(
    m: AgentManagerInMessage,
    msg: Record<string, unknown>,
  ): Record<string, unknown> | null | undefined {
    if (m.type === "agentManager.configureSetupScript") {
      void this.configureSetupScript()
      return null
    }
    if (handleDestination(this.destination, m, (msg) => this.log("[XTerm]", msg))) return null
    if (handleRunMessage(this.run, m, (id) => this.runKey(id))) return null
    if (m.type === "agentManager.showTerminal") {
      this.terminalManager.showTerminal(m.sessionId, this.state)
      return null
    }
    if (m.type === "agentManager.showLocalTerminal") {
      this.terminalManager.showLocalTerminal()
      return null
    }
    if (m.type === "agentManager.showWorktreeTerminal") {
      this.terminalManager.showWorktreeTerminal(m.worktreeId, this.state)
      return null
    }
    if (m.type === "agentManager.openWorktree") {
      this.openWorktreeDirectory(m.worktreeId)
      return null
    }
    if (m.type === "agentManager.copyToClipboard") {
      this.host.copyToClipboard(m.text)
      return null
    }
    if (m.type === "previewImage") return msg
    if (m.type === "saveImage") return msg
    if (m.type === "agentManager.showExistingLocalTerminal") {
      this.terminalManager.syncLocalOnSessionSwitch()
      return null
    }
    if (m.type === "agentManager.requestRepoInfo") {
      void this.sendRepoInfo()
      return null
    }
    if (m.type === "agentManager.createMultiVersion") {
      void this.onCreateMultiVersion(m)
      return null
    }
    if (m.type === "agentManager.renameWorktree") {
      const state = this.getStateManager()
      if (state) {
        state.updateWorktreeLabel(m.worktreeId, m.label)
        this.pushState()
      }
      return null
    }
  }

  private onStateMessage(m: AgentManagerInMessage): Record<string, unknown> | null | undefined {
    if (m.type === "agentManager.requestState") {
      this.onRequestState()
      return null
    }
    if (m.type === "agentManager.setTabOrder") {
      this.state?.setTabOrder(m.key, m.order)
      return null
    }
    if (m.type === "agentManager.setWorktreeOrder") {
      const state = this.getStateManager()
      if (state) {
        state.setWorktreeOrder(m.order)
        this.pushState()
      }
      return null
    }
    if (m.type === "agentManager.setSessionsCollapsed") {
      this.state?.setSessionsCollapsed(m.collapsed)
      // Multi-project bodies render collapsed purely from pushed state, so the
      // mutation must round-trip; legacy mode is covered by its optimistic
      // signal and the push is a no-op update.
      this.pushState()
      return null
    }
    if (m.type === "agentManager.setSidebarCollapsed") {
      this.state?.setSidebarCollapsed(m.collapsed)
      return null
    }
    if (this.handleSection(m)) return null
    if (m.type === "agentManager.setReviewDiffStyle") {
      this.state?.setReviewDiffStyle(m.style)
      return null
    }
    if (m.type === "agentManager.setReviewMarkdownRender") {
      void setDiffMarkdownRender(m.render).then(() => this.pushState())
      return null
    }
    if (m.type === "agentManager.setDefaultBaseBranch") {
      this.state?.setDefaultBaseBranch(normalizeBaseBranch(m.branch))
      this.pushState()
      return null
    }
  }

  private onImportMessage(m: AgentManagerInMessage): Record<string, unknown> | null | undefined {
    if (m.type === "agentManager.requestBranches") {
      void this.importer.branches()
      return null
    }
    if (m.type === "agentManager.importFromBranch") {
      void this.importer.branch(m.branch)
      return null
    }
    if (m.type === "agentManager.importFromPR") {
      void this.importer.pr(m.url)
      return null
    }
  }

  private onDiffMessage(m: AgentManagerInMessage): Record<string, unknown> | null | undefined {
    if (m.type === "agentManager.requestWorktreeDiff") {
      void this.diffs.request(composeDiffId(m.sessionId, normalizeScope(m.scope)))
      return null
    }
    if (m.type === "agentManager.requestWorktreeDiffFile") {
      void this.diffs.requestFile(composeDiffId(m.sessionId, normalizeScope(m.scope), m.diffSessionId), m.file)
      return null
    }
    if (m.type === "agentManager.applyWorktreeDiff") {
      void this.diffs.apply(m.worktreeId, m.selectedFiles)
      return null
    }
    if (m.type === "agentManager.revertWorktreeFile") {
      void this.diffs.revert(composeDiffId(m.sessionId, normalizeScope(m.scope)), m.file)
      return null
    }
    if (m.type === "agentManager.startDiffWatch") {
      this.diffs.start(composeDiffId(m.sessionId, normalizeScope(m.scope), m.diffSessionId))
      return null
    }
    if (m.type === "agentManager.stopDiffWatch") {
      this.diffs.stop()
      return null
    }
    if (m.type === "agentManager.requestDiffBranches") {
      void this.sendDiffBranches(m.sessionId, m.scope)
      return null
    }
    if (m.type === "agentManager.setDiffBaseBranch") {
      void this.diffs
        .setBase(composeDiffId(m.sessionId, normalizeScope(m.scope)), m.branch)
        .catch((err) => this.log("Failed to set diff base:", err instanceof Error ? err.message : String(err)))
        .then(() => void this.sendDiffBranches(m.sessionId, m.scope))
      return null
    }
    if (m.type === "agentManager.openFile") {
      this.openWorktreeFile(m.sessionId, m.filePath, m.line, m.column)
      return null
    }
  }

  private async sendDiffBranches(sessionId: string, scope?: string): Promise<void> {
    const id = composeDiffId(sessionId, normalizeScope(scope))
    const result = await this.diffs.branches(id).catch((err) => {
      this.log("Failed to list diff branches:", err instanceof Error ? err.message : String(err))
      return undefined
    })
    if (!result) return
    this.postToWebview({
      type: "agentManager.diffBranches",
      sessionId: id,
      branches: result.branches,
      defaultBranch: result.defaultBranch,
      autoBase: result.autoBase,
      currentBase: result.currentBase,
      isAuto: result.isAuto,
      currentBranch: result.currentBranch,
    })
  }

  private onBridgeMessage(m: AgentManagerInMessage): Record<string, unknown> | null | undefined {
    if (m.type !== "openFile") return undefined

    const sessionId = this.activeSessionId
    const state = this.getStateManager()
    if (sessionId && state?.directoryFor(sessionId)) {
      this.openWorktreeFile(sessionId, m.filePath, m.line, m.column)
      return null
    }
  }

  private onRequestState(): void {
    // requestState fires from the webview's onMount, and a freshly mounted
    // webview has no terminal records — any PTYs the router still tracks
    // belong to a previous webview instance (reload or crash) and are
    // unreachable orphans. Kill them here rather than leaking shells until
    // the panel itself is disposed. In-flight creates from the dying
    // instance are reaped by the router's generation guard.
    void this.terminalRouter.dispose()
    this.scripts.manager.snapshot()
    this.log(
      `onRequestState: stateReady=${this.stateReady ? "pending" : "missing"}, state=${this.state ? "ok" : "missing"}`,
    )
    void this.stateReady
      ?.then(() => {
        // When the folder is not a git repo (or has no folder open),
        // this.state is never created. pushState() silently returns in that
        // case, so re-send the empty/non-git state explicitly.
        if (!this.state) {
          this.pushEmptyState()
          return
        }
        this.pushState()
        // Re-send cached stats so the webview gets them even if the poller
        // already emitted before the webview was ready to receive messages.
        if (this.cachedWorktreeStats) this.postToWebview(this.cachedWorktreeStats)
        if (this.cachedLocalStats) this.postToWebview(this.cachedLocalStats)
        this.prBridge.replay()
        // Refresh sessions after pushState so the webview's sessionsLoaded
        // handler is guaranteed to be registered (requestState fires from
        // onMount). Without this, the initial refreshSessions() in
        // initializeState() can race ahead of webview mount, causing
        // sessionsLoaded to never flip to true.
        // Unconditional: an empty managed list still needs the backend listing
        // so the webview's sessionsLoaded gate can flip.
        this.panel?.sessions.refreshSessions()
      })
      .catch((err) => {
        this.log("initializeState failed, pushing partial state:", err)
        if (!this.state) {
          this.pushEmptyState()
          return
        }
        this.pushState()
      })
  }

  // Shared helpers

  /** Create a git worktree on disk and register it in state. Returns null on failure. */
  private async createWorktreeOnDisk(opts?: CreateWorktreeOnDiskOptions): Promise<CreateWorktreeOnDiskResult | null> {
    return createWorktreeOnDisk(
      {
        getWorktreeManager: () => this.getWorktreeManager(),
        getStateManager: () => this.getStateManager(),
        postToWebview: (message) => this.postToWebview(message),
        capture: (event, properties) => this.host.capture(event, properties),
        pushState: () => this.pushState(),
        log: (...args) => this.log(...args),
      },
      opts,
    )
  }

  /** Create a CLI session in a worktree directory. Returns null on failure. */
  private async createSessionInWorktree(
    worktreePath: string,
    branch: string,
    worktreeId?: string,
    source?: { sandboxInheritanceToken?: string },
  ): Promise<Session | null> {
    let client: KiloClient
    try {
      client = this.connectionService.getClient()
    } catch (err) {
      this.log("createSessionInWorktree: client not available:", err)
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: "Not connected to CLI backend",
        worktreeId,
      })
      this.host.capture("Agent Manager Session Error", {
        source: PLATFORM,
        error: "Not connected to CLI backend",
        context: "createSession",
      })
      return null
    }

    this.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "starting",
      message: "Starting session...",
      branch,
      worktreeId,
    })

    try {
      const metadata = await sandboxSessionMetadata(this.connectionService.sandboxPreference, client, worktreePath)
      const { data: session } = await startSession(
        client,
        worktreePath,
        () =>
          client.session.create(
            {
              directory: worktreePath,
              platform: PLATFORM,
              metadata,
              ...(source?.sandboxInheritanceToken ? { sandboxInheritanceToken: source.sandboxInheritanceToken } : {}),
            },
            { throwOnError: true },
          ),
        (...args) => this.log(...args),
      )
      return session
    } catch (error) {
      const err = getErrorMessage(error)
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: `Failed to create session: ${err}`,
        worktreeId,
      })
      this.host.capture("Agent Manager Session Error", {
        source: PLATFORM,
        error: err,
        context: "createSession",
      })
      return null
    }
  }

  /** Remove a worktree whose session could not be safely initialized. */
  private async discardWorktree(id: string, dir: string, branch: string, sessionId?: string): Promise<void> {
    this.getStateManager()?.removeWorktree(id)
    this.pushState()

    if (sessionId) {
      try {
        await this.connectionService
          .getClient()
          .session.delete({ sessionID: sessionId, directory: dir }, { throwOnError: true })
      } catch (err) {
        this.log(`Failed to delete session ${sessionId} after worktree setup failed:`, err)
      }
    }

    try {
      await this.getWorktreeManager()?.removeWorktree(dir, branch)
    } catch (err) {
      this.log(`Failed to remove worktree ${id} after setup failed:`, err)
    }
  }

  /** Send worktreeSetup.ready + pushState after worktree creation. */
  private notifyWorktreeReady(sessionId: string, result: CreateWorktreeResult, worktreeId?: string): void {
    this.pushState()
    this.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "ready",
      message: "Worktree ready",
      sessionId,
      branch: result.branch,
      worktreeId,
    })
  }

  private async waitForStateReady(context: string): Promise<void> {
    const ctx = this.projectScope.current()
    // A message scoped to a background project must wait for that project's
    // own initialization; this.stateReady only tracks the active project.
    if (ctx && ctx.id !== this.contexts.active()?.id) {
      const result = await initContextState(ctx, (...args) => this.log(...args))
      if (!result.ok) this.log(`${context}: project ${ctx.id} state did not load`)
      return
    }
    if (!this.stateReady) return
    await this.stateReady.catch((err) => this.log(`${context}: stateReady rejected, continuing:`, err))
  }

  private shouldWaitForState(m: AgentManagerInMessage): boolean {
    if (m.type === "agentManager.terminal.create") return m.worktreeId !== null
    return STATE_GATED.has(m.type)
  }

  private onToolEvent(event: unknown, directory?: string): void {
    const properties = (event as { properties?: unknown }).properties
    const req = parseToolRequest(properties)
    if (!req) return
    if (directory) {
      req.directory = directory
      req.projectId ??= this.contexts.byDirectory(directory)?.id
    }
    void this.startToolRequest(req)
  }

  private async startToolRequest(req: ToolRequest): Promise<void> {
    await startFromTool(
      {
        getClient: () => this.connectionService.getClient(),
        getRoot: () => this.getRoot(),
        getState: () => this.getStateManager(),
        getPanel: () => this.panel,
        openPanel: (preserveFocus) => this.openPanel(preserveFocus),
        waitReady: (context) => this.waitForStateReady(context),
        createWorktree: (opts) => this.createWorktreeOnDisk(opts),
        claimRequest: (id) => {
          if (this.toolRequests.has(id)) return false
          const oldest = this.toolRequests.size >= 100 ? this.toolRequests.values().next().value : undefined
          if (oldest) this.toolRequests.delete(oldest)
          this.toolRequests.add(id)
          return true
        },
        cleanupWorktree: async (wid, dir) => {
          this.getStateManager()?.removeWorktree(wid)
          await this.getWorktreeManager()?.removeWorktree(dir)
          this.pushState()
        },
        setup: (dir, branch, id) => this.runSetupScriptForWorktree(dir, branch, id),
        createSessionInWorktree: (dir, branch, id, source) => this.createSessionInWorktree(dir, branch, id, source),
        sessionMetadata: (client, dir) => sandboxSessionMetadata(this.connectionService.sandboxPreference, client, dir),
        registerWorktreeSession: (sid, dir) => this.registerWorktreeSession(sid, dir),
        notifyReady: (sid, result, wid) => this.notifyWorktreeReady(sid, result, wid),
        push: () => this.pushState(),
        post: (msg) => this.postToWebview(msg as unknown as AgentManagerOutMessage),
        capture: (event, props) => this.host.capture(event, props),
        log: (...args) => this.log(...args),
        error: (msg) => this.host.showError(msg),
      },
      req,
    )
  }

  // Worktree actions

  /** Create a new worktree with an auto-created first session. */
  private async onCreateWorktree(baseBranch?: string, branchName?: string): Promise<null> {
    const ctx = this.context
    if (!ctx) return null
    return createLifecycleWorktree(ctx, this.lifecycleHost, { baseBranch, branchName })
  }

  /** Delete a worktree and dissociate its sessions. */
  private async onDeleteWorktree(worktreeId: string): Promise<null> {
    const ctx = this.context
    if (!ctx) return null
    return deleteLifecycleWorktree(ctx, this.lifecycleHost, worktreeId)
  }

  /** Remove a stale worktree entry from state without touching the filesystem. */
  private async onRemoveStaleWorktree(worktreeId: string): Promise<null> {
    const ctx = this.context
    if (!ctx) return null
    return removeStaleLifecycleWorktree(ctx, this.lifecycleHost, worktreeId)
  }

  /** Promote a session: create a worktree and move the session into it. */
  private async onPromoteSession(sessionId: string): Promise<null> {
    const ctx = this.context
    if (!ctx) return null
    return promoteLifecycleSession(ctx, this.lifecycleHost, sessionId)
  }

  /** Add a new session to an existing worktree. */
  private async onAddSessionToWorktree(worktreeId: string, sessionId?: string): Promise<null> {
    const ctx = this.context
    if (!ctx) return null
    return addSessionToLifecycleWorktree(ctx, this.lifecycleHost, worktreeId, sessionId)
  }

  private onForkSession(sessionId: string, worktreeId?: string, messageId?: string) {
    return forkSession(
      {
        getClient: () => this.connectionService.getClient(),
        state: this.getStateManager(),
        directory: this.getRoot(),
        postError: (msg) => this.postToWebview({ type: "error", message: msg }),
        registerWorktreeSession: (sid, dir) => this.registerWorktreeSession(sid, dir),
        pushState: () => this.pushState(),
        notifyForked: (s, from, wt) =>
          this.postToWebview({
            type: "agentManager.sessionForked",
            sessionId: s.id,
            forkedFromId: from,
            worktreeId: wt,
          }),
        registerSession: (s) => this.panel?.sessions.registerSession(s),
        log: (...args) => this.log(...args),
      },
      sessionId,
      worktreeId,
      messageId,
    )
  }

  /** Stop a session and remove it from Agent Manager. */
  private async onCloseSession(sessionId: string): Promise<null> {
    const ctx = this.context
    if (!ctx) return null
    return closeLifecycleSession(ctx, this.lifecycleHost, sessionId)
  }

  // Multi-version worktree creation

  /** Create N worktree sessions for the same prompt (multi-version mode). */
  private async onCreateMultiVersion(
    msg: Extract<AgentManagerInMessage, { type: "agentManager.createMultiVersion" }>,
  ): Promise<null> {
    await this.waitForStateReady("onCreateMultiVersion")
    const ctx = this.context
    if (!ctx) return null
    return createMultiVersion(ctx, this.multiVersionHost, msg)
  }

  private sendKeybindings(): void {
    const keybindings = this.host.extensionKeybindings()
    const bindings = buildKeybindingMap(keybindings, process.platform === "darwin")
    this.postToWebview({ type: "agentManager.keybindings", bindings })
  }

  // Setup script

  /** Open the worktree setup script in the editor for user configuration. */
  private async configureSetupScript(): Promise<void> {
    const service = this.getSetupScriptService()
    if (!service) return
    try {
      if (!service.hasScript()) {
        await service.createDefaultScript()
      }
      const resolved = service.resolveScript()
      if (!resolved) return
      await this.host.openDocument(resolved.path)
    } catch (error) {
      this.log(`Failed to open setup script: ${error}`)
    }
  }

  /** Copy .env files and run the worktree setup script. Blocks until complete. Shows progress in overlay. */
  private async runSetupScriptForWorktree(worktreePath: string, branch?: string, worktreeId?: string): Promise<void> {
    const root = this.getRoot()
    if (!root) return

    // Always copy .env files from the main repo (before the setup script so it can override)
    await copyEnvFiles(root, worktreePath, (msg) => this.outputChannel.appendLine(`[EnvCopy] ${msg}`))

    try {
      await runWorktreeSetupScript(
        {
          service: this.getSetupScriptService(),
          destination: this.destination.value(),
          projectId: this.context?.id,
          worktreeId,
          branch,
          trusted: () => this.host.isTrusted(),
          manager: this.scripts.manager,
          vscode: executeVscodeTask,
          log: (msg) => this.outputChannel.appendLine(`[SetupScript] ${msg}`),
          post: (message) => this.postToWebview(message),
        },
        { worktreePath, repoPath: root },
      )
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.outputChannel.appendLine(`[AgentManager] Setup script error: ${msg}`)
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: `Setup script failed: ${msg}`,
        projectId: this.context?.id,
        branch,
        worktreeId,
      })
    }
  }

  // Repo info

  private async sendRepoInfo(): Promise<void> {
    const manager = this.getWorktreeManager()
    if (!manager) return
    try {
      const branch = await manager.currentBranch()
      const defaultBranch = await manager.defaultBranch()
      this.postToWebview({ type: "agentManager.repoInfo", branch, defaultBranch })
    } catch (error) {
      this.log(`Failed to get current branch: ${error}`)
    }
  }

  // State helpers

  private registerWorktreeSession(sessionId: string, directory: string): void {
    const worktree = this.state?.findWorktreeByPath(directory)
    if (worktree) this.writeMetadata(sessionId, worktree)

    if (!this.panel) return
    this.panel.sessions.setSessionDirectory(sessionId, directory)
    this.panel.sessions.trackSession(sessionId)
    // Recover any permission/question prompts that arrived before the session
    // was tracked. The CLI backend may have emitted permission.asked between
    // session.create() returning and this registration completing.
    this.panel.sessions.recoverPendingPrompts()
  }

  private writeMetadata(sessionId: string, worktree: Worktree): void {
    const manager = this.getWorktreeManager()
    if (!manager) return
    void manager
      .writeMetadata(worktree.path, sessionId, worktree.parentBranch, worktree.remote)
      .catch((err) => this.log(`Failed to write worktree metadata for ${worktree.id}:`, err))
  }

  /** Route a plan follow-up session to its worktree instead of LOCAL. */
  private adoptFollowupInWorktree(session: Session, directory: string): void {
    const state = this.getStateManager()
    if (!state) return
    const worktree = state.findWorktreeByPath(directory)
    if (!worktree) return

    state.addSession(session.id, worktree.id)
    this.registerWorktreeSession(session.id, directory)
    this.pushState()
    this.postToWebview({
      type: "agentManager.sessionAdded",
      sessionId: session.id,
      worktreeId: worktree.id,
    })
    this.log(`Adopted follow-up session ${session.id} into worktree ${worktree.id}`)
  }

  private onWorktreePresence(result: WorktreePresenceResult): void {
    const state = this.state
    if (!state) return

    const worktrees = state.getWorktrees()
    const ids = new Set(worktrees.map((wt) => wt.id))
    this.pruneStaleWorktreeIds(ids)

    if (result.degraded) {
      this.log("Skipping stale worktree update: degraded worktree probe")
      return
    }

    const entries = result.worktrees.filter((item) => ids.has(item.worktreeId))
    if (entries.length === 0) return

    // Sync branches from git worktree list (no extra git calls)
    let branchChanged = false
    for (const entry of entries) {
      if (entry.branch && state.updateWorktreeBranch(entry.worktreeId, entry.branch)) {
        branchChanged = true
      }
    }

    const next = new Set(entries.filter((entry) => entry.missing).map((entry) => entry.worktreeId))
    const staleChanged =
      next.size !== this.staleWorktreeIds.size || [...next].some((worktreeId) => !this.staleWorktreeIds.has(worktreeId))
    const stale = this.staleWorktreeIds
    stale.clear()
    for (const id of next) stale.add(id)

    if (staleChanged || branchChanged) {
      this.pushState()
    }
  }

  private clearStaleTracking(worktreeId: string): void {
    this.staleWorktreeIds.delete(worktreeId)
  }

  private staleWorktreesForState(worktrees: ReturnType<WorktreeStateManager["getWorktrees"]>): string[] {
    const ids = new Set(worktrees.map((wt) => wt.id))
    this.pruneStaleWorktreeIds(ids)
    return worktrees.filter((wt) => this.staleWorktreeIds.has(wt.id)).map((wt) => wt.id)
  }

  private pruneStaleWorktreeIds(ids: Set<string>): void {
    for (const id of [...this.staleWorktreeIds]) {
      if (ids.has(id)) continue
      this.staleWorktreeIds.delete(id)
    }
  }

  /** Sync the poller's skip set with currently collapsed sections. */
  private syncPollerSkips(): void {
    const state = this.state
    if (!state) return
    const skipped = new Set<string>()
    for (const sec of state.getSections()) {
      if (!sec.collapsed) continue
      for (const id of state.getWorktreesInSection(sec.id)) skipped.add(id)
    }
    const stats = this.statsPoller.syncSkips(skipped)
    if (!stats) return
    const msg = { type: "agentManager.worktreeStats" as const, projectId: this.contexts.active()?.id, stats }
    this.cachedWorktreeStats = msg
    this.postToWebview(msg)
  }

  private pushState(ctx?: ProjectContext): void {
    const target = ctx ?? this.context
    const state = target?.peekState()
    if (!target || !state) {
      this.log(`pushState skipped: target=${target?.id ?? "none"}, state=${state ? "ok" : "missing"}`)
      return
    }
    const active = this.contexts.active()?.id === target.id
    const worktrees = state.getWorktrees()
    this.postToWebview({
      type: "agentManager.state",
      projectId: target.id,
      worktrees,
      sessions: state.getSessions(),
      sections: state.getSections(),
      staleWorktreeIds: active ? this.staleWorktreesForState(worktrees) : [],
      tabOrder: state.getTabOrder(),
      worktreeOrder: state.getWorktreeOrder(),
      sessionsCollapsed: state.getSessionsCollapsed(),
      sidebarCollapsed: state.getSidebarCollapsed(),
      reviewDiffStyle: state.getReviewDiffStyle(),
      reviewMarkdownRender: getDiffMarkdownRender(),
      terminalDestination: this.destination.value(),
      isGitRepo: true,
      defaultBaseBranch: state.getDefaultBaseBranch(),
      activeTarget: state.getActiveTarget(),
      ...(active ? this.runStateFor(target) : {}),
    })
    void pushProjectSessions(target, this.panel?.sessions, (message) => this.postToWebview(message))
    if (!active) return

    // Sync skip set before enabling the poller so the first poll cycle
    // already excludes worktrees in collapsed sections.
    this.syncPollerSkips()
    this.statsPoller.setEnabled(worktrees.length > 0 || this.panel !== undefined)
    this.prBridge.poller.setEnabled(worktrees.length > 0)
  }

  /** Push empty state when the folder is not a git repo or has no folder open. */
  private pushEmptyState(): void {
    this.staleWorktreeIds.clear()
    this.postToWebview({
      type: "agentManager.state",
      worktrees: [],
      sessions: [],
      staleWorktreeIds: [],
      reviewDiffStyle: "unified",
      reviewMarkdownRender: getDiffMarkdownRender(),
      terminalDestination: this.destination.value(),
      isGitRepo: false,
      runStatuses: [],
      runScriptConfigured: false,
    })
  }

  // Manager accessors — repository-bound services are owned by the active ProjectContext (immutable per root).
  /** Provider capabilities for the worktree lifecycle handlers (state stays in ProjectContext). */
  private get lifecycleHost(): LifecycleHost {
    return {
      createOnDisk: (opts) => this.createWorktreeOnDisk(opts),
      runSetup: (dir, branch, id) => this.runSetupScriptForWorktree(dir, branch, id),
      createSession: (dir, branch, id) => this.createSessionInWorktree(dir, branch, id),
      notifyReady: (sid, result, id) => this.notifyWorktreeReady(sid, result, id),
      sessions: {
        register: (session) => this.panel?.sessions.registerSession(session),
        clearDirectory: (sid) => this.panel?.sessions.clearSessionDirectory(sid),
        directories: () => this.panel?.sessions.getSessionDirectories(),
        abort: (ids) => this.panel?.sessions.abortSessions(ids) ?? Promise.resolve(),
        forget: (sid) => void this.panelSessions.delete(sid),
      },
      push: () => this.pushState(),
      register: (sid, dir) => this.registerWorktreeSession(sid, dir),
      skipStats: (id) => this.statsPoller.skipWorktree(id),
      unskipStats: (id) => this.statsPoller.unskipWorktree(id),
      removePR: (id) => this.prBridge.remove(id),
      removeRun: (id) => this.run.remove(id),
      clearRun: (id) => clearScriptTerminals(this.scripts.manager, id, this.context?.id),
      forgetName: (id) => this.naming.forget(id),
      stopDiffs: (path, orphaned) => {
        if (this.diffs.shouldStopForWorktree(path, orphaned)) this.diffs.stop()
      },
      capture: (event, props) => this.host.capture(event, props),
      autoName: () => this.host.autoBranchNaming(),
      client: () => this.connectionService.getClient(),
      metadata: (client, dir) => sandboxSessionMetadata(this.connectionService.sandboxPreference, client, dir),
      post: (msg) => this.postToWebview(msg),
      log: (...args) => this.log(...args),
    }
  }

  private get multiVersionHost(): MultiVersionHost {
    return {
      ...this.lifecycleHost,
      discard: (id, dir, branch, sessionId) => this.discardWorktree(id, dir, branch, sessionId),
      promptName: (input) => this.naming.prompt(input),
      error: (message) => this.host.showError(message),
    }
  }

  private get context(): ProjectContext | undefined {
    return this.projectScope.current() ?? this.contexts.active()
  }

  private getRoot(): string | undefined {
    return this.context?.root
  }

  private getWorktreeManager(): WorktreeManager | undefined {
    return this.context?.worktreeManager()
  }

  private getStateManager(): WorktreeStateManager | undefined {
    return this.context?.stateManager()
  }

  private getSetupScriptService(): SetupScriptService | undefined {
    return this.context?.setupService()
  }

  private get state(): WorktreeStateManager | undefined {
    return this.context?.peekState()
  }
  private get worktrees(): WorktreeManager | undefined {
    return this.context?.peekWorktrees()
  }

  private get setupScript(): SetupScriptService | undefined {
    return this.context?.peekSetup()
  }

  private get staleWorktreeIds(): Set<string> {
    return this.context?.stale ?? this.staleScratch
  }

  /**
   * Namespace the shared "local" run key with the owning project id so two
   * projects' local run scripts do not collide in the provider-wide manager.
   */
  private runKey(worktreeId: string): string {
    if (worktreeId !== "local") return worktreeId
    if (!this.host.multiProject()) return worktreeId
    const ctx = this.context
    if (!ctx) return worktreeId
    return `${ctx.id}:local`
  }

  /** Resolve the project bucket that owns a provider-wide script key. */
  private projectForScript(worktreeId: string): string | undefined {
    if (worktreeId.endsWith(":local") && worktreeId !== "local") return worktreeId.slice(0, -":local".length)
    return this.contexts.byWorktree(worktreeId)?.id ?? this.context?.id
  }

  /** Run state for one project's payload: its worktrees and its own local key, un-namespaced. */
  private runStateFor(ctx: ProjectContext): ReturnType<RunController["state"]> {
    const state = this.run.state()
    const ids = new Set((ctx.peekState()?.getWorktrees() ?? []).map((wt) => wt.id))
    const localKey = `${ctx.id}:local`
    const runStatuses = state.runStatuses
      .filter(
        (status) =>
          ids.has(status.worktreeId) || status.worktreeId === localKey || (status.worktreeId === "local" && ctx.pinned),
      )
      .map((status) => (status.worktreeId === localKey ? { ...status, worktreeId: "local" } : status))
    return { ...state, runStatuses }
  }

  /** Route run status emissions to the owning project and un-namespace the local key. */
  private postRunMessage(message: AgentManagerOutMessage): void {
    if (message.type !== "agentManager.runStatus") {
      this.postToWebview(message)
      return
    }
    const qualified = message.worktreeId.endsWith(":local") && message.worktreeId !== "local"
    const owner = qualified
      ? this.contexts.resolve(message.worktreeId.slice(0, -":local".length))
      : this.contexts.byWorktree(message.worktreeId)
    this.postToWebview({
      ...message,
      worktreeId: qualified ? "local" : message.worktreeId,
      ...(owner ? { projectId: owner.id } : {}),
    })
  }

  private messageProject(m: AgentManagerInMessage): ProjectContext | undefined {
    const pid = (m as { projectId?: unknown }).projectId
    if (typeof pid !== "string") return this.contexts.active()
    // Re-check trust and enablement on every project-stamped message: a context
    // instance can be cached before trust is confirmed, and get() checks neither.
    return this.contexts.usable(pid)
  }

  private activateProject(ctx: ProjectContext): void {
    if (this.contexts.active()?.id !== ctx.id) return
    this.statsPoller.stop()
    this.prBridge.reset()
    this.activeSessionId = undefined
    this.cachedWorktreeStats = this.cachedLocalStats = undefined
    void this.sendRepoInfo()
    if (!reactivateProject(ctx, this.panel?.sessions, (c) => this.pushState(c)))
      this.stateReady = this.initializeState()
    else this.projectPollers.sync(this.contexts)
  }
  private onWorkspaceChanged(): void {
    if (this.contexts.syncPinned()) {
      this.activeSessionId = undefined
      this.stateReady = this.initializeState()
      void this.sendRepoInfo()
    }
    this.pushProjects()
  }

  private pushProjects(): void {
    const projects = this.contexts.snapshots()
    this.postToWebview({
      type: "agentManager.projects",
      multiProject: this.host.multiProject(),
      projects,
    })
    if (this.panel) {
      for (const project of projects) {
        if (project.active || !project.expanded || !project.trusted || project.missing) continue
        if (this.contexts.get(project.id)) continue
        const ctx = this.contexts.expand(project.id)
        if (ctx) this.initExpanded(ctx)
      }
    }
    this.projectPollers.sync(this.contexts)
  }

  // Worktree file helpers

  /** Open a worktree directory directly in VS Code. */
  private openWorktreeDirectory(worktreeId: string): void {
    const state = this.getStateManager()
    if (!state) return
    const worktree = state.getWorktree(worktreeId)
    if (!worktree) return
    const target = path.normalize(worktree.path)
    if (!fs.existsSync(target)) {
      this.log(`openWorktreeDirectory: missing path ${target}`)
      this.host.showError("Worktree folder does not exist on disk.")
      return
    }
    this.host.openFolder(target, true)
  }

  /** Open a file from a worktree or local session in the VS Code editor.
   * Absolute paths are opened directly; relative paths resolve against the
   * context's worktree directory (repo root for local) with symlink-traversal
   * protection. The id may be a worktree id, session id, or `local`. */
  private openWorktreeFile(id: string, filePath: string, line?: number, column?: number): void {
    if (isAbsolutePath(filePath)) {
      this.host.openFile(filePath, line, column)
      return
    }
    const state = this.getStateManager()
    if (!state) return
    const worktree = state.getWorktree(id)
    const session = worktree ? undefined : state.getSession(id)
    const base = worktree?.path ?? (session?.worktreeId ? state.getWorktree(session.worktreeId)?.path : this.getRoot())
    if (!base) return
    // Resolve real paths to prevent symlink traversal and normalize for
    // consistent comparison on both Unix and Windows.
    let resolved: string
    try {
      const root = fs.realpathSync(base)
      resolved = fs.realpathSync(path.resolve(base, filePath))
      // Directory-boundary check: append path.sep so "/foo/bar" won't match "/foo/bar2/..."
      if (resolved !== root && !resolved.startsWith(root + path.sep)) return
    } catch (err) {
      console.error("[Kilo New] AgentManagerProvider: Cannot resolve file path:", err)
      return
    }
    this.host.openFile(resolved, line, column)
  }

  private postToWebview(message: AgentManagerOutMessage): void {
    if (message.type !== "agentManager.worktreeSetup" || message.projectId) {
      this.panel?.postMessage(message)
      return
    }
    this.panel?.postMessage({ ...message, projectId: this.context?.id })
  }

  /**
   * Reveal the Agent Manager panel and focus the prompt input.
   * Used for the keyboard shortcut to switch back from terminal.
   */
  public focusPanel(): void {
    if (!this.panel) return
    this.panel.reveal(false)
    this.postToWebview({ type: "action", action: "focusInput" })
  }

  public isActive(): boolean {
    return this.panel?.active === true
  }

  private async waitForPanel(panel: PanelContext, promise: Promise<void>): Promise<boolean> {
    const done = promise.then(() => true)
    let sub: Disposable | undefined
    const disposed = new Promise<false>((resolve) => {
      sub = panel.onDidDispose(() => {
        sub?.dispose()
        resolve(false)
      })
    })
    void done.finally(() => sub?.dispose())
    const ok = await Promise.race([done, disposed])
    return ok && this.panel === panel
  }

  private waitForPanelReady(panel: PanelContext): Promise<boolean> {
    return this.waitForPanel(panel, panel.waitForReady())
  }

  private waitForPanelActive(panel: PanelContext): Promise<boolean> {
    return this.waitForPanel(panel, panel.waitForActive())
  }

  /** Wait for the current panel's webview to be ready before posting to it. False if there is no panel or it closed while waiting. */
  public waitForReady(): Promise<boolean> {
    const panel = this.panel
    if (!panel) return Promise.resolve(false)
    return this.waitForPanelReady(panel)
  }

  public async showMemory(): Promise<void> {
    const panel = this.panel
    const sid = this.activeSessionId
    if (!panel || !sid) {
      this.host.showError("No active Agent Manager session")
      return
    }
    if (!(await this.waitForPanelReady(panel))) return
    if (this.activeSessionId !== sid) return
    try {
      await panel.sessions.showMemory(sid)
    } catch (error) {
      this.host.showError(getErrorMessage(error) || "Failed to show memory")
    }
  }

  public async toggleMemory(): Promise<void> {
    const panel = this.panel
    const sid = this.activeSessionId
    if (!panel || !sid) {
      this.host.showError("No active Agent Manager session")
      return
    }
    if (!(await this.waitForPanelReady(panel))) return
    if (this.activeSessionId !== sid) return
    try {
      await panel.sessions.toggleMemory(sid)
    } catch (error) {
      this.host.showError(getErrorMessage(error) || "Failed to toggle memory")
    }
  }

  /** Expose worktree session→directory mappings for the auto-approve toggle. */
  public getSessionDirectories(): ReadonlyMap<string, string> {
    return this.panel?.sessions.getSessionDirectories() ?? new Map()
  }

  public getWorktreeDirectories(): string[] {
    return (
      this.getStateManager()
        ?.getWorktrees()
        .map((wt) => wt.path) ?? []
    )
  }

  public workspaceRoot = () => this.getRoot()

  public projectId = () => this.contexts.active()?.id
  /**
   * Continue a sidebar session in a new worktree.
   * Captures git state, creates worktree, applies state, forks session.
   * Called from KiloProvider when the sidebar sends "continueInWorktree".
   */
  public async continueFromSidebar(
    sessionId: string,
    progress: (status: string, detail?: string, error?: string) => void,
  ): Promise<void> {
    const root = this.getRoot()
    if (!root) {
      progress("error", undefined, "No workspace folder open")
      return
    }

    this.openPanel()
    await this.waitForStateReady("continueFromSidebar")

    await continueInWorktree(
      {
        root,
        getClient: () => this.connectionService.getClient(),
        createWorktreeOnDisk: (opts) => this.createWorktreeOnDisk(opts),
        runSetupScript: (p, b, id) => this.runSetupScriptForWorktree(p, b, id),
        cleanupWorktree: async (id) => {
          await this.onDeleteWorktree(id)
        },
        notifyError: (error, result, id) => {
          this.postToWebview({
            type: "agentManager.worktreeSetup",
            status: "error",
            message: error,
            branch: result.branch,
            worktreeId: id,
          })
        },
        getStateManager: () => this.getStateManager(),
        registerWorktreeSession: (sid, dir) => this.registerWorktreeSession(sid, dir),
        registerSession: (session) => this.panel?.sessions.registerSession(session),
        notifyReady: (sid, result, wid) => this.notifyWorktreeReady(sid, result, wid),
        capture: (event, props) => this.host.capture(event, props),
        log: (...args) => this.log(...args),
      },
      sessionId,
      progress,
    )
  }

  public async createFromSidebar(baseBranch?: string, branchName?: string): Promise<void> {
    this.openPanel()
    const panel = this.panel
    if (!panel) return
    if (!(await this.waitForPanelReady(panel))) return
    await this.waitForStateReady("createFromSidebar")
    await this.onCreateWorktree(baseBranch, branchName)
  }

  public async openAdvancedWorktree(): Promise<void> {
    this.openPanel()
    const panel = this.panel
    if (!panel) return
    if (!(await this.waitForPanelActive(panel))) return
    if (!(await this.waitForPanelReady(panel))) return
    await this.waitForStateReady("openAdvancedWorktree")
    queueMicrotask(() => this.postToWebview({ type: "action", action: "advancedWorktree" }))
  }

  private handleSection(m: AgentManagerInMessage): boolean {
    return handleSection(
      this.state,
      m,
      () => this.pushState(),
      (...args) => this.log(...args),
    )
  }

  public postMessage(message: unknown): void {
    this.panel?.postMessage(message)
  }

  public shutdown(): Promise<void> {
    if (!this.closing) this.closing = this.disposeAsync()
    return this.closing
  }

  public dispose(): void {
    void this.shutdown()
  }

  private async disposeAsync(): Promise<void> {
    await this.stateReady?.catch((err) => this.log("dispose: stateReady rejected:", err))
    await this.contexts.dispose()
    this.unsubTool?.()
    this.unsubStatus?.()
    this.unsubSessions?.()
    this.unsubFont?.()
    this.unsubProjects?.()
    this.unsubDestination?.()
    await this.scripts.dispose()
    this.orchestration.dispose()
    this.visiblePresence.clear()
    this.diffs.stop()
    this.diffCatalog.dispose()
    this.naming.dispose()
    this.statsPoller.stop()
    this.projectPollers.dispose()
    this.gitOps.dispose()
    this.prBridge.poller.stop()
    this.run.dispose()
    this.terminalManager.dispose()
    await this.terminalRouter.dispose()
    const panel = this.panel
    this.panel = undefined
    panel?.dispose()
    this.outputChannel.dispose()
    this.host.dispose()
  }
}
