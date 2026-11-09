import * as fs from "node:fs"
import * as path from "node:path"
import type { OpenCodeClient, OpenCodeEvent, SessionInfo } from "@opencode/client"
import type { WebviewPanel } from "vscode"
import type { AgentManagerConnection } from "./connection"
import { located } from "./connection"
import { createHostAutoApprove, onHostAutoApproveChange } from "./provider-auto-approve"
import { WorktreeManager } from "./WorktreeManager"
import { WorktreeStateManager, type Worktree } from "./WorktreeStateManager"
import { GitOps } from "./GitOps"
import type { GitExecutable } from "../util/git-executable"
import type { Host, PanelContext, OutputHandle, Disposable } from "./host"
import type { AgentManagerOutMessage, AgentManagerInMessage } from "./types"
import type { ProjectContext } from "./project/context"
import { ProjectContexts } from "./project/contexts"
import { ProjectScope } from "./project/scope"
import type { ProjectMessageDeps } from "./project/messages"
import { createProjectWiring, type ProjectWiring } from "./project/wiring"
import { initContextState, reconcileProject } from "./project/init"
import { createPollers, type ProjectPollers } from "./project/pollers"
import { Semaphore } from "./semaphore"
import { BranchNamingController } from "./branch-naming"
import {
  createWorktreeOnDisk,
  type CreateWorktreeOnDiskOptions,
  type CreateWorktreeOnDiskResult,
} from "./worktree-create"
import {
  addSessionToLifecycleWorktree,
  closeLifecycleSession,
  createLifecycleWorktree,
  deleteLifecycleWorktree,
  promoteLifecycleSession,
  removeStaleLifecycleWorktree,
  runLifecycleSetup,
  type LifecycleHost,
} from "./provider-lifecycle"
import { handleRecovery, type RecoveryMessage } from "./worktree-recovery"
import { createMultiVersion, type MultiVersionHost } from "./provider-multi-version"
import { forkSession } from "./fork-session"
import { handleMessage, setReviewMarkdownRender, type MessageHost } from "./provider-messages"
import { messageHost, lifecycleHost, multiVersionHost, type ProviderHostsSource } from "./provider-hosts"
import { createWorktreeActivity } from "./worktree-activity"
import { handleSessionLifecycle } from "./session-lifecycle"
import { runningFromEvent } from "../session-status"
import { WorktreeImporter } from "./worktree-importer"
import { shouldOpenLinkInIntegratedBrowser } from "../browser-links"
import { createBrowserLifecycle } from "./browser-lifecycle"
import { routableProject } from "./browser-message"
import { editorTabOwns } from "../browser-tab/sidebar-session"
import type { BrowserBroker } from "../services/browser-automation"
import { TerminalRouter } from "./terminal-routing"
import { acquirePtyCleanup } from "./pty-cleanup"
import { PtyRelay } from "./pty-relay"
import { KiloAgentManagerRpc } from "@opencode/schema/kilocode/agent-manager"
import { createRunController, createScriptTerminalRuntime } from "./script-terminal-runtime"
import type { RunController } from "./run/controller"
import { createOrchestrationBridge } from "./orchestration-setup"
import type { AgentManagerOrchestrationBridge } from "./orchestration-bridge"
import { WorktreeDiffController } from "./worktree-diff-controller"
import { DiffSourceCatalog } from "../diff/sources/catalog"
import { createLocalDiff } from "./local-diff"
import { sendDiffBranches as postDiffBranches } from "./project/diff-branches"
import { pruneSubagents, sessionMissing } from "./prune-subagents"
import { readTerminalFont, watchTerminalFont } from "./terminal-font"
import { buildKeybindingMap } from "./format-keybinding"
import { documentExists, readDocument } from "../documents/document-reader"
import { resolveWorktreeFile, resolveWorktreeRoot, sessionDirectory } from "./worktree-file-path"
import { focusPanelPrompt, revealPanel } from "./focus-panel"
import { formatLog } from "./log-format"
import { HealthScheduler } from "./worktree-health"
import { broken } from "./worktree-reconcile"
import { CaffeinationService } from "../services/caffeination"
import { createPanel } from "./panel"
import type { GitStatsPoller, WorktreePresenceResult } from "./GitStatsPoller"
import {
  activateProject,
  hotWorktrees,
  messageProject,
  onWorktreePresence,
  onWorkspaceChanged,
  postRunMessage,
  pushEmptyState,
  pushProjects,
  pushState,
  requestState,
  runStateFor,
  type ProviderStateHost,
} from "./provider-state"
import {
  createFromSidebar,
  continueFromSidebar,
  continueInActiveProject,
  diagnose,
  focusPanel,
  getSessionDirectories,
  getWorktreeDirectories,
  isActive,
  openAdvancedWorktree,
  postMessage,
  revealSession,
  shutdown,
  syncWorktrees,
  waitForReady,
  type ProviderApiHost,
} from "./provider-api"
import { parseToolRequest, startFromTool } from "./tool-start"
import { createSessionInWorktree, type ProviderSessionHost } from "./provider-session"
import type { Timing } from "./creation-timing"
import type { CreationBoot } from "./provider-lifecycle"
import type { CreateWorktreeResult } from "./WorktreeManager"
import type { ToolRequest } from "./tool-start"
import type { SetupScriptService } from "./SetupScriptService"

export class AgentManagerProvider implements Disposable, ProviderHostsSource, ProviderStateHost, ProviderApiHost {
  public static readonly viewType = "kilo-code.v2.agentManagerPanel"
  public panel: PanelContext | undefined
  public readonly outputChannel: OutputHandle
  public readonly contexts: ProjectContexts
  public readonly projects: ProjectMessageDeps
  public readonly projectScope = new ProjectScope()
  public readonly importer: WorktreeImporter
  public readonly terminalRouter: TerminalRouter
  public readonly relay: PtyRelay
  public readonly scripts: ReturnType<typeof createScriptTerminalRuntime>
  public readonly run: RunController
  public stateReady: Promise<void> | undefined
  public readonly browser: ReturnType<typeof createBrowserLifecycle>
  public onBrowserDebug?: (...args: unknown[]) => void
  public readonly statsPoller: GitStatsPoller
  public readonly projectPollers: ProjectPollers
  public readonly prBridge: ReturnType<typeof createPollers>["pr"]
  public readonly orchestration: AgentManagerOrchestrationBridge
  public readonly gitOps: GitOps
  public readonly diffs: WorktreeDiffController
  public readonly diffCatalog: DiffSourceCatalog
  public readonly naming: BranchNamingController
  public readonly toolRequests = new Set<string>()
  public cachedWorktreeStats: Extract<AgentManagerOutMessage, { type: "agentManager.worktreeStats" }> | undefined
  public cachedLocalStats: Extract<AgentManagerOutMessage, { type: "agentManager.localStats" }> | undefined
  public readonly unsubTool: () => void
  public readonly activity: ReturnType<typeof createWorktreeActivity>
  public readonly unsubFont: () => void
  public readonly unsubProjects: () => void
  public readonly unsubEvents: () => void
  public readonly autoApprove: ReturnType<typeof createHostAutoApprove>
  public readonly unsubAutoApprove: () => void
  public readonly staleScratch = new Set<string>()
  public readonly healthScheduler = new HealthScheduler<ProjectContext>(async (ctx) => {
    await this.reconcileAndPush(ctx)
    if (this.contexts.active()?.id === ctx.id) this.pushState(ctx)
  })
  public closing: Promise<void> | undefined
  public onVisibilityChange: ((visible: boolean) => void) | undefined
  public readonly panelSessions = new Set<string>()
  public readonly busySessions = new Set<string>()
  public readonly removedSessions = new Set<string>()
  public visibleSession: string | null = null
  public readonly caffeination: CaffeinationService
  readonly settings: ProjectWiring["settings"]

  constructor(
    public readonly host: Host,
    public readonly connection: AgentManagerConnection,
    public readonly panelHost: ReturnType<typeof createPanel>,
    binary: GitExecutable | string = "git",
    browser?: BrowserBroker,
  ) {
    this.outputChannel = host.createOutput("Kilo Agent Manager")
    this.terminalRouter = new TerminalRouter({
      connection: this.connection,
      getRoot: () => this.getRoot(),
      getWorktreePath: (id) => this.getStateManager()?.getWorktree(id)?.path,
      getProjectId: () => this.projectScope.current()?.id ?? this.contexts.active()?.id,
      log: (...args) => this.log("[XTerm]", ...args),
      post: (message) => this.postToWebview(message),
      closed: (terminalId) => this.relay.closeTerminal(terminalId),
      getTerminalFont: () => readTerminalFont(),
    })
    this.relay = new PtyRelay({
      connection: this.connection,
      terminal: (id) => this.terminalRouter.ptyFor(id) ?? this.scripts.manager.ptyFor(id),
      post: (message) => this.postToWebview(message),
      log: (...args) => this.log("[PtyRelay]", ...args),
    })
    this.scripts = createScriptTerminalRuntime({
      connection: this.connection,
      output: this.outputChannel,
      post: (message) => this.postToWebview(message),
      closed: (terminalId) => this.relay.closeTerminal(terminalId),
    })
    this.unsubFont = watchTerminalFont((font) => {
      this.postToWebview({ type: "agentManager.terminal.fontChanged", font })
      void this.scripts.manager.snapshot()
    })
    this.run = createRunController({
      manager: this.scripts.manager,
      root: () => this.getRoot(),
      state: () => this.getStateManager(),
      project: (id) => this.projectForScript(id),
      open: (file) => this.host.openDocument(file),
      trusted: () => this.host.isTrusted(),
      post: (message) => this.postRunMessage(message),
      log: (message) => this.outputChannel.appendLine(`[RunScript] ${message}`),
      refresh: () => this.pushState(),
    })
    this.importer = new WorktreeImporter({
      manager: () => this.getWorktreeManager(),
      state: () => this.getStateManager(),
      post: (message) => this.postToWebview(message),
      push: () => this.pushState(),
      setup: (dir, branch, id) => this.runSetupScriptForWorktree(dir, branch, id),
      session: (dir, branch, id) => this.createSessionInWorktree(dir, branch, id),
      acquirePtyCleanup: (directory) => this.acquirePtyCleanup(directory),
      register: (sessionId, dir) => this.registerWorktreeSession(sessionId, dir),
      ready: (sessionId, result, id) => this.notifyWorktreeReady(sessionId, result, id),
      log: (...args) => this.log(...args),
    })
    const semaphore = new Semaphore(3)
    this.gitOps = new GitOps({ log: (...args) => this.log(...args), semaphore, binary })
    const wiring = createProjectWiring({
      host: this.host,
      git: this.gitOps,
      log: (...args) => this.log(...args),
      output: (message) => this.outputChannel.appendLine(message),
      activate: (ctx) => this.activateProject(ctx),
      empty: () => this.pushEmptyState(),
      expand: (ctx) => this.initExpanded(ctx),
      ready: (ctx, opts) => initContextState(ctx, (...args) => this.log(...args), opts),
      push: () => this.pushProjects(),
      pushState: (ctx) => this.pushState(ctx),
      changed: () => this.onWorkspaceChanged(),
      removed: (id) => this.browser.closeProject(id),
      selected: (target) => this.postToWebview({ type: "agentManager.selectionActivated", target }),
      post: (message) => this.postToWebview(message),
    })
    this.contexts = wiring.contexts
    // One browser page per Agent Manager session. The sidebar editor tab uses the same broker instance.
    this.browser = createBrowserLifecycle({
      browser,
      host,
      contexts: () => this.contexts,
      post: (message) => this.postToWebview(message),
      openPanel: () => this.openPanel(true),
      editorTab: editorTabOwns,
      log: (...args) => {
        this.log(...args)
        this.onBrowserDebug?.(...args)
      },
    })
    this.settings = wiring.settings
    this.projects = wiring.messages
    this.unsubProjects = () => wiring.dispose()
    this.naming = new BranchNamingController({
      state: () => this.getStateManager(),
      manager: () => this.getWorktreeManager(),
      client: () => this.connection.client(),
      settings: () => this.host.autoBranchNaming(),
      push: () => this.pushState(),
      log: (message) => this.log(message),
    })
    const local = createLocalDiff(this.gitOps, (...args) => this.log(...args))
    this.diffCatalog = new DiffSourceCatalog(this.connection, local)
    this.diffs = new WorktreeDiffController({
      getState: () => this.getStateManager(),
      getRoot: () => this.getRoot(),
      getStateReady: () => this.stateReady,
      catalog: this.diffCatalog,
      git: this.gitOps,
      localDiffFile: local.file,
      post: (message) => this.postToWebview(message),
      log: (...args) => this.log(...args),
      projectId: () => this.context?.id,
    })
    const pollers = createPollers({
      dirtyFiles: () => this.host.dirtyFiles(),
      git: this.gitOps,
      semaphore,
      state: () => this.state,
      root: () => this.getRoot(),
      activeId: () => this.contexts.active()?.id,
      hot: () => hotWorktrees(this.stateHost()),
      isUnhealthy: (id) => this.context?.report?.entries.some((e) => e.id === id && broken(e.health)) === true,
      visible: () => this.panel?.visible ?? false,
      post: (message) => this.postToWebview(message),
      cache: (message) => {
        if (message.type === "agentManager.worktreeStats") this.cachedWorktreeStats = message
        if (message.type === "agentManager.localStats") this.cachedLocalStats = message
      },
      presence: (presence) => this.onWorktreePresence(presence),
      openExternal: (url) => this.host.openExternal(url),
      log: (...args) => this.log(...args),
      mergeMethods: this.host,
    })
    this.statsPoller = pollers.stats
    this.prBridge = pollers.pr
    this.projectPollers = pollers.projects
    this.orchestration = createOrchestrationBridge({
      connection: this.connection,
      contexts: this.contexts,
      projectScope: this.projectScope,
      getRoot: () => this.getRoot(),
      getState: () => this.state,
      getStateReady: () => this.stateReady,
      initStateReady: () => (this.stateReady = this.initializeState()),
      getStats: () => this.statsPoller.snapshot(),
      getPrs: () => this.prBridge.snapshot(),
      pushState: (ctx) => this.pushState(ctx),
      hasPanelSession: (id) => this.panelSessions.has(id),
      closeSession: (id) => this.onCloseSession(id),
      postSessionClosed: (id, projectId) =>
        this.postToWebview({ type: "agentManager.sessionClosed", sessionId: id, projectId }),
      log: (...args) => this.log(...args),
    })
    this.unsubTool = this.connection.onEvent(
      (event) => this.onToolEvent(event),
      (event) => event.type === "rpc.kilocode.agent-manager.start",
    )
    this.activity = createWorktreeActivity({
      connection: this.connection,
      paths: () =>
        [...this.contexts.values()].flatMap((ctx) => ctx.peekState()?.getWorktrees() ?? []).map((wt) => wt.path),
      post: (active) => this.postToWebview({ type: "agentManager.worktreeActivity", active }),
      status: (sessionID, running) => this.onSessionStatus(sessionID, running),
      log: (err) => this.log("Failed to load worktree activity:", err),
    })
    this.unsubEvents = this.connection.onEvent(
      (event) => this.onSessionEvent(event),
      located(() =>
        [...this.contexts.values()].flatMap((ctx) => [
          ctx.root,
          ...(ctx
            .peekState()
            ?.getWorktrees()
            .map((wt) => wt.path) ?? []),
        ]),
      ),
    )
    this.autoApprove = createHostAutoApprove({
      client: () => this.connection.client(),
      directories: () => {
        const workspace = this.host.workspacePath()
        return [
          ...(workspace ? [workspace] : []),
          ...[...this.contexts.values()].flatMap((ctx) => [
            ctx.root,
            ...(ctx
              .peekState()
              ?.getWorktrees()
              .map((wt) => wt.path) ?? []),
          ]),
        ]
      },
      log: (message) => this.log(message),
    })
    const stopAutoApproveEvents = this.connection.onEvent(
      (event) => this.autoApprove.event(event),
      (event) => event.type === "permission.asked",
    )
    const stopAutoApproveState = onHostAutoApproveChange(() => this.autoApprove.sweep())
    const stopAutoApproveConnection = this.connection.onState((status) => {
      if (status === "connected") this.autoApprove.sweep()
    })
    this.unsubAutoApprove = () => {
      stopAutoApproveEvents()
      stopAutoApproveState()
      stopAutoApproveConnection()
    }
    this.caffeination = new CaffeinationService(this.connection, () =>
      [...this.contexts.values()].flatMap((ctx) => [
        ctx.root,
        ...(ctx
          .peekState()
          ?.getWorktrees()
          .map((wt) => wt.path) ?? []),
      ]),
    )
    this.caffeination.onChange((state) => this.postToWebview({ type: "agentManager.caffeination", ...state }))
  }

  public onSessionEvent(event: OpenCodeEvent): void {
    handleSessionLifecycle(event, { busy: this.busySessions, removed: this.removedSessions })
    const running = runningFromEvent(event)
    if (!running) return
    if (running.running) this.naming.busy(running.sessionID)
    else this.naming.idle(running.sessionID)
  }

  public onSessionStatus(sessionID: string, running: boolean): void {
    if (this.removedSessions.has(sessionID)) return
    if (running) {
      this.busySessions.add(sessionID)
      this.naming.busy(sessionID)
      return
    }
    this.busySessions.delete(sessionID)
    this.naming.idle(sessionID)
  }

  public stateHost(): ProviderStateHost {
    return this as unknown as ProviderStateHost
  }

  public log(...args: unknown[]) {
    this.outputChannel.appendLine(`${new Date().toISOString()} ${formatLog(args)}`)
  }

  public browserAutomation(): boolean {
    return this.host.browserAutomation()
  }

  /** The Integrated Browser setting changed: close its pages when disabled and republish availability. */
  public browserAutomationChanged(): void {
    if (!this.host.browserAutomation()) void this.browser.closeAll().catch((error) => this.log(error))
    if (this.context) this.pushState(this.context)
  }

  public openPanel(preserveFocus?: boolean): void {
    if (this.panel) {
      const panel = this.panel
      revealPanel(panel, preserveFocus, () =>
        focusPanelPrompt(panel, this.waitForPanelReady(panel), this.waitForPanelActive(panel)),
      )
      return
    }
    const panel = this.panelHost.open((message) => void this.handlePanelMessage(message))
    this.attachPanel(panel)
    if (!preserveFocus) focusPanelPrompt(panel, this.waitForPanelReady(panel), this.waitForPanelActive(panel))
  }

  public onPanelVisibilityChange(cb: (visible: boolean) => void): void {
    this.onVisibilityChange = cb
  }

  /** Restore the Agent Manager panel from a serialized state. */
  public deserializePanel(raw: WebviewPanel): void {
    if (this.panel) {
      raw.dispose()
      return
    }
    this.attachPanel(this.panelHost.restore(raw, (message) => void this.handlePanelMessage(message)))
  }

  public attachPanel(panel: PanelContext): void {
    if (this.panel) {
      const previous = this.panel
      this.panel = undefined
      previous.dispose()
    }
    // Sockets of the previous webview instance cannot be reached by this one.
    this.relay.reset()
    this.panel = panel
    this.browser.attach(panel)
    void this.statsPoller
    for (const poller of [this.statsPoller, this.projectPollers]) poller.setVisible(panel.visible)
    void this.diffs.setVisible(panel.visible)
    this.onVisibilityChange?.(panel.visible)
    panel.onDidChangeVisibility((visible) => {
      for (const poller of [this.statsPoller, this.projectPollers]) poller.setVisible(visible)
      void this.diffs.setVisible(visible)
      this.syncView()
    })
    this.stateReady = this.initializeState()
    this.pushProjects()
    void this.sendRepoInfo()
    this.sendKeybindings()
    const keys = this.host.onDidChangeKeybindings?.(() => this.sendKeybindings())
    this.prBridge.attachPanel(panel)
    panel.onDidDispose(() => {
      keys?.dispose()
      if (this.panel !== panel) return
      this.log("Panel disposed")
      const ids = new Set(this.panelSessions)
      if (this.visibleSession) ids.add(this.visibleSession)
      const busy = [...ids].filter((id) => this.busySessions.has(id))
      this.panelSessions.clear()
      this.busySessions.clear()
      void this.interrupt(busy)
      this.statsPoller.stop()
      this.projectPollers.dispose()
      this.prBridge.poller.stop()
      this.diffs.stop()
      this.visibleSession = null
      this.connection.view([])
      this.panel = undefined
      void this.terminalRouter.dispose()
      this.relay.reset()
      this.onVisibilityChange?.(false)
    })
    this.postCaffeination()
  }

  public async interrupt(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return
    const client = await this.connection.client().catch(() => undefined)
    if (!client) return
    await Promise.all(
      [...new Set(ids)].map((sessionID) =>
        client.session
          .interrupt({ sessionID })
          .catch((error: unknown) => this.log(`Failed to abort session ${sessionID} on panel close:`, error)),
      ),
    )
  }

  public async initializeState(): Promise<void> {
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
    if (init.refsFixed > 0) {
      this.log(`Migration fixed ${init.refsFixed} git worktree ref(s), refreshing git`)
      this.host.refreshGit()
    }
    this.pushState()
    // The state shows at once; sessions the server cannot open leave it once the server answers.
    const client = await this.connection.client().catch(() => undefined)
    if (!client) return
    const sessions = {
      getSessionInfo: (id: string) =>
        client.session.get({ sessionID: id }).catch((error: unknown) => (sessionMissing(error) ? null : undefined)),
      clearSessionDirectory: () => undefined,
    }
    const before = state.getSessions().length
    await pruneSubagents(state, sessions, (message) => this.log(message))
    if (state.getSessions().length !== before) this.pushState()
  }

  public initExpanded(ctx: ProjectContext): void {
    void initContextState(ctx, (...args) => this.log(...args))
      .then((result) => {
        if (!result.current) return
        this.pushState(ctx)
        this.projectPollers.sync(this.contexts)
      })
      .catch((err) => this.log("Failed to initialize expanded project:", err))
  }

  public async handlePanelMessage(message: { type: string } & Record<string, unknown>): Promise<void> {
    if (message.type === "agentManager.openWebLink" && typeof message.url === "string") {
      this.openWebLink(message.url, message.external === true)
      return
    }
    if (this.browser.handle(message as unknown as AgentManagerInMessage)) return
    if (this.prBridge.handleMessage(message)) return
    if (this.relay.handle(message as unknown as AgentManagerInMessage)) return
    await handleMessage(message as unknown as AgentManagerInMessage, this.messageHost)
  }

  /**
   * Chat links open in the Integrated Browser for the visible session when it is enabled and a project can route that
   * session, else externally. Shift-click (`external`) always opens the system browser.
   */
  private openWebLink(url: string, external: boolean): void {
    const session = this.visibleSession
    const preferred = this.projectScope.current()?.id ?? this.contexts.active()?.id
    const project = session ? routableProject(this.contexts, session, preferred) : undefined
    if (!external && session && project && shouldOpenLinkInIntegratedBrowser(url)) {
      void this.browser.handle({ type: "agentManager.browser.open", sessionId: session, projectId: project, url })
      return
    }
    this.host.openExternal(url)
  }

  public hostSource(): ProviderHostsSource {
    return this as unknown as ProviderHostsSource
  }

  public get messageHost(): MessageHost {
    return messageHost(this.hostSource())
  }

  public trackOpenSessions(ids: string[]): void {
    for (const id of ids) this.panelSessions.add(id)
    this.syncView()
  }

  /** Default directory for a file the visible session saves, for example a rendered diagram. */
  public imageDirectory(): string | undefined {
    const id = this.visibleSession
    const session = id ? this.state?.getSession(id) : undefined
    const direct = session ? sessionDirectory(this.state, id, this.getRoot()) : undefined
    return direct ?? this.diffs.activeDirectory() ?? this.getRoot()
  }

  public trackVisibleSession(id: string | null): void {
    this.visibleSession = id
    if (id) {
      this.panelSessions.add(id)
    }
    // The poller follows the visible session so its fast poll and immediate fetch target the
    // worktree the user is reading. The PR poller belongs to the active project, so a session
    // from another project, a local session, or an unknown one clears the target.
    this.prBridge.poller.setActiveWorktreeId(this.visibleWorktreeId(id))
    this.syncView()
  }

  private visibleWorktreeId(id: string | null): string | undefined {
    if (!id) return undefined
    const ctx = this.context
    if (!ctx || ctx.id !== this.contexts.active()?.id) return undefined
    return ctx.peekState()?.getSession(id)?.worktreeId ?? undefined
  }

  public syncView(): void {
    if (!this.panel?.visible) {
      this.connection.view([])
      return
    }
    // Only the session the user is reading is viewed. Background tabs stay unread until they are opened, so their
    // indicators do not clear on idle for conversations nobody saw.
    this.connection.view(this.visibleSession ? [this.visibleSession] : [])
  }

  public async setCaffeination(enabled: boolean): Promise<void> {
    await this.caffeination.setEnabled(enabled)
    this.postCaffeination()
  }

  public postCaffeination(): void {
    this.postToWebview({ type: "agentManager.caffeination", ...this.caffeination.getState() })
  }

  public requestState(): Promise<void> {
    return requestState(this.stateHost())
  }

  public async createWorktreeOnDisk(opts?: CreateWorktreeOnDiskOptions): Promise<CreateWorktreeOnDiskResult | null> {
    const result = await createWorktreeOnDisk(
      {
        getWorktreeManager: () => this.getWorktreeManager(),
        getStateManager: () => this.getStateManager(),
        postToWebview: (message) => this.postToWebview(message),
        pushState: () => this.pushState(),
        log: (...args) => this.log(...args),
      },
      opts,
    )
    if (result) await this.syncWorktrees()
    return result
  }

  public createSessionInWorktree(
    worktreePath: string,
    branch: string,
    worktreeId?: string,
    timing?: Timing,
    model?: { providerID: string; modelID: string; variant?: string },
    agent?: string,
    boot?: CreationBoot,
  ): Promise<SessionInfo | null> {
    return createSessionInWorktree(
      this as unknown as ProviderSessionHost,
      worktreePath,
      branch,
      worktreeId,
      timing,
      model,
      agent,
      boot,
    )
  }

  public async acquirePtyCleanup(directory: string): Promise<() => void> {
    return acquirePtyCleanup(directory, {
      terminals: this.terminalRouter,
      scripts: this.scripts.manager,
      connection: this.connection,
    })
  }

  public notifyWorktreeReady(sessionId: string, result: CreateWorktreeResult, worktreeId?: string): void {
    this.pushState()
    this.postToWebview({
      type: "agentManager.worktreeSetup",
      projectId: this.context?.id,
      status: "ready",
      message: "Worktree ready",
      sessionId,
      branch: result.branch,
      worktreeId,
    })
  }

  public async waitForStateReady(where: string): Promise<void> {
    const ctx = this.projectScope.current()
    if (ctx && ctx.id !== this.contexts.active()?.id) {
      const result = await initContextState(ctx, (...args) => this.log(...args))
      if (!result.ok) this.log(`${where}: project ${ctx.id} state did not load`)
      return
    }
    if (!this.stateReady) return
    await this.stateReady.catch((err) => this.log(`${where}: stateReady rejected, continuing:`, err))
  }

  public onToolEvent(event: OpenCodeEvent): void {
    const directory = event.location?.directory
    const request = parseToolRequest(event.data, directory)
    if (!request) return
    const owner = directory ? this.contexts.byDirectory(directory) : undefined
    if (owner) {
      void this.projectScope.run(owner, () => this.startToolRequest(request))
      return
    }
    void this.startToolRequest(request)
  }

  public async startToolRequest(req: ToolRequest): Promise<void> {
    const client = this.connection.current()
    await startFromTool(
      {
        getClient: () => {
          if (!client) throw new Error("Not connected to CLI backend")
          return client
        },
        getRoot: () => this.getRoot(),
        // The request runs inside its owning project's scope when the caller directory matched one.
        getProjectId: () => this.projectScope.current()?.id ?? this.contexts.active()?.id,
        getState: () => this.getStateManager(),
        getPanel: () => this.panel,
        openPanel: (preserveFocus) => this.openPanel(preserveFocus),
        waitReady: (context) => this.waitForStateReady(context),
        createWorktree: (opts) => this.createWorktreeOnDisk(opts),
        claimRequest: (id) => this.claimToolRequest(id),
        cleanupWorktree: async (wid, dir) => {
          const release = await this.acquirePtyCleanup(dir)
          try {
            await this.getWorktreeManager()?.removeWorktree(dir)
            this.getStateManager()?.removeWorktree(wid)
            await this.syncWorktrees()
            this.pushState()
          } finally {
            release()
          }
        },
        hasScript: () => this.getSetupScriptService()?.hasScript() ?? false,
        setup: (dir, branch, id) => this.runSetupScriptForWorktree(dir, branch, id),
        createSessionInWorktree: (dir, branch, id, _source, boot, timing, model, agent) =>
          this.createSessionInWorktree(dir, branch, id, timing, model, agent, boot),
        sessionMetadata: async () => ({ kilocode: { platform: "agent-manager" } }),
        registerWorktreeSession: (sid, dir) => this.registerWorktreeSession(sid, dir),
        notifyReady: (sid, result, wid) => this.notifyWorktreeReady(sid, result, wid),
        push: () => this.pushState(),
        post: (message) => this.postToWebview(message as AgentManagerOutMessage),
        log: (...args) => this.log(...args),
        error: (message) => this.host.showError(message),
      },
      req,
    )
  }

  public claimToolRequest(id: string): boolean {
    if (this.toolRequests.has(id)) return false
    const oldest = this.toolRequests.size >= 100 ? this.toolRequests.values().next().value : undefined
    if (oldest) this.toolRequests.delete(oldest)
    this.toolRequests.add(id)
    return true
  }

  public async onCreateWorktree(baseBranch?: string, branchName?: string): Promise<null> {
    const ctx = this.context
    if (!ctx) return null
    await createLifecycleWorktree(ctx, this.lifecycleHost, { baseBranch, branchName })
    return null
  }

  public async onDeleteWorktree(worktreeId: string): Promise<null> {
    const ctx = this.context
    if (!ctx) return null
    const result = await deleteLifecycleWorktree(ctx, this.lifecycleHost, worktreeId)
    await this.syncWorktrees()
    return result
  }

  public async onRemoveStaleWorktree(worktreeId: string, keepSessions: boolean): Promise<null> {
    const ctx = this.context
    if (!ctx) return null
    const result = await removeStaleLifecycleWorktree(ctx, this.lifecycleHost, worktreeId, keepSessions)
    await this.syncWorktrees()
    return result
  }

  public reconcileAndPush(ctx: ProjectContext) {
    return reconcileProject(ctx, (...args: unknown[]) => this.log(...args))
  }

  public recover(m: RecoveryMessage): Promise<null> {
    return handleRecovery(m, this.context, {
      post: (message) => this.postToWebview(message),
      push: () => this.pushState(),
      log: (...args) => this.log(...args),
      reconcile: (ctx) => this.reconcileAndPush(ctx),
      refresh: (worktreeId) => (this.prBridge.poller.refresh(worktreeId, true), this.statsPoller.revive(worktreeId)),
      reveal: (target) => this.host.revealInOS(target),
      teardown: async (root, target) => {
        const client = await this.connection.client()
        await client.debug.location.evict({ location: { directory: target } })
        return
      },
      removeSnapshot: async (root, target) => {
        const client = await this.connection.client()
        const result = await client
          .rpc(KiloAgentManagerRpc.Definition)
          .removeSnapshot({ worktree: target }, { location: { directory: root } })
        return result.removed
      },
      withProgress: (title, task) => this.host.withProgress(title, task),
      notifyResult: (kind, message) => this.host.notify(kind, message),
    })
  }

  public async onPromoteSession(sessionId: string): Promise<null> {
    const ctx = this.context
    if (!ctx) return null
    const result = await promoteLifecycleSession(ctx, this.lifecycleHost, sessionId)
    await this.syncWorktrees()
    return result
  }

  public async onAddSessionToWorktree(worktreeId: string, sessionId?: string): Promise<null> {
    const ctx = this.context
    if (!ctx) return null
    return addSessionToLifecycleWorktree(ctx, this.lifecycleHost, worktreeId, sessionId)
  }

  public onForkSession(sessionId: string, worktreeId?: string, messageId?: string): Promise<null> {
    return forkSession(
      {
        client: () => this.connection.client(),
        state: this.getStateManager(),
        directory: this.getRoot(),
        postError: (message) => this.postToWebview({ type: "error", message }),
        registerWorktreeSession: (sid, dir) => this.registerWorktreeSession(sid, dir),
        pushState: () => this.pushState(),
        notifyForked: (session, from, worktree) =>
          this.postToWebview({
            type: "agentManager.sessionForked",
            projectId: this.context?.id,
            sessionId: session.id,
            forkedFromId: from,
            worktreeId: worktree,
            session,
          }),
        log: (...args) => this.log(...args),
      },
      sessionId,
      worktreeId,
      messageId,
    )
  }

  public async onCloseSession(sessionId: string): Promise<null> {
    const ctx = this.context
    if (!ctx) return null
    this.browser.close(sessionId, ctx.id)
    return closeLifecycleSession(ctx, this.lifecycleHost, sessionId)
  }

  public async onCreateMultiVersion(
    msg: Extract<AgentManagerInMessage, { type: "agentManager.createMultiVersion" }>,
  ): Promise<null> {
    await this.waitForStateReady("onCreateMultiVersion")
    const ctx = this.context
    if (!ctx) return null
    return createMultiVersion(ctx, this.multiVersionHost, msg)
  }

  public sendKeybindings(): void {
    const bindings = buildKeybindingMap(this.host.extensionKeybindings(), process.platform === "darwin")
    this.postToWebview({ type: "agentManager.keybindings", bindings })
  }

  public async configureSetupScript(): Promise<void> {
    const service = this.getSetupScriptService()
    if (!service) return
    try {
      if (!service.hasScript()) await service.createDefaultScript()
      const resolved = service.resolveScript()
      if (!resolved) return
      await this.host.openDocument(resolved.path)
    } catch (error) {
      this.log(`Failed to open setup script: ${error}`)
    }
  }

  public async runSetupScriptForWorktree(
    worktreePath: string,
    branch: string | undefined,
    worktreeId: string,
    early?: () => Promise<void>,
  ): Promise<void> {
    const root = this.getRoot()
    if (!root) return
    await runLifecycleSetup(
      {
        service: this.getSetupScriptService(),
        projectId: this.context?.id,
        worktreeId,
        branch,
        trusted: () => this.host.isTrusted(),
        manager: this.scripts.manager,
        log: (msg) => this.outputChannel.appendLine(`[SetupScript] ${msg}`),
        post: (message) => this.postToWebview(message),
      },
      { worktreePath, repoPath: root },
      (msg) => this.outputChannel.appendLine(msg),
      early,
    )
  }

  public async sendRepoInfo(): Promise<void> {
    const ctx = this.context
    const manager = this.getWorktreeManager()
    if (!manager) return
    try {
      const branch = await manager.currentBranch()
      const defaultBranch = await manager.defaultBranch()
      this.postToWebview({ type: "agentManager.repoInfo", branch, defaultBranch, projectId: ctx?.id })
    } catch (error) {
      this.log(`Failed to get current branch: ${error}`)
    }
  }

  public registerWorktreeSession(sessionId: string, directory: string): void {
    const worktree = this.state?.findWorktreeByPath(directory)
    if (worktree) this.writeMetadata(sessionId, worktree)
    this.panelSessions.add(sessionId)
  }

  public writeMetadata(sessionId: string, worktree: Worktree): void {
    const manager = this.getWorktreeManager()
    if (!manager) return
    void manager
      .writeMetadata(worktree.path, sessionId, worktree.parentBranch, worktree.remote)
      .catch((err) => this.log(`Failed to write worktree metadata for ${worktree.id}:`, err))
  }

  public onWorktreePresence(result: WorktreePresenceResult): void {
    onWorktreePresence(this.stateHost(), result)
  }

  public pushState(ctx?: ProjectContext): void {
    pushState(this.stateHost(), ctx)
  }

  public pushEmptyState(): void {
    pushEmptyState(this.stateHost())
  }

  public get lifecycleHost(): LifecycleHost {
    return lifecycleHost(this.hostSource())
  }

  public get multiVersionHost(): MultiVersionHost {
    return multiVersionHost(this.hostSource())
  }

  public get context(): ProjectContext | undefined {
    return this.projectScope.current() ?? this.contexts.active()
  }

  public client(): Promise<OpenCodeClient> {
    return this.connection.client()
  }

  public getRoot(): string | undefined {
    return this.context?.root
  }

  public getWorktreeManager(): WorktreeManager | undefined {
    return this.context?.worktreeManager()
  }

  public getStateManager(): WorktreeStateManager | undefined {
    return this.context?.stateManager()
  }

  public getSetupScriptService(): SetupScriptService | undefined {
    return this.context?.setupService()
  }

  public get state(): WorktreeStateManager | undefined {
    return this.context?.peekState()
  }

  public get staleIds(): Set<string> {
    return this.context?.stale ?? this.staleScratch
  }

  public runKey(worktreeId: string): string {
    if (worktreeId !== "local") return worktreeId
    const ctx = this.context
    if (!ctx) return worktreeId
    return `${ctx.id}:local`
  }

  public projectForScript(worktreeId: string): string | undefined {
    if (worktreeId.endsWith(":local") && worktreeId !== "local") return worktreeId.slice(0, -":local".length)
    return this.contexts.byWorktree(worktreeId)?.id ?? this.context?.id
  }

  public runStateFor(ctx: ProjectContext): ReturnType<RunController["state"]> {
    return runStateFor(this.stateHost(), ctx)
  }

  public postRunMessage(message: AgentManagerOutMessage): void {
    postRunMessage(this.stateHost(), message)
  }

  public messageProject(m: AgentManagerInMessage): ProjectContext | undefined {
    return messageProject(this.stateHost(), m)
  }

  public activateProject(ctx: ProjectContext): void {
    activateProject(this.stateHost(), ctx)
  }

  public onWorkspaceChanged(): void {
    // A workspace switch drops every page the old workspace could still show.
    void this.browser.closeAll().catch((error) => this.log(error))
    onWorkspaceChanged(this.stateHost())
  }

  public pushProjects(): void {
    pushProjects(this.stateHost())
  }

  public openWorktreeDirectory(worktreeId: string): void {
    const worktree = this.getStateManager()?.getWorktree(worktreeId)
    if (!worktree) return
    const target = path.normalize(worktree.path)
    if (!fs.existsSync(target)) {
      this.log(`openWorktreeDirectory: missing path ${target}`)
      this.host.showError("Worktree folder does not exist on disk.")
      return
    }
    this.host.openFolder(target, true)
  }

  public openWorktreeFile(id: string, filePath: string, line?: number, column?: number): void {
    const target = resolveWorktreeFile(this.getStateManager(), id, filePath, this.getRoot())
    if (target) this.host.openFile(target, line, column)
  }

  public async validateFiles(id: string, sessionId: string, paths: string[]): Promise<void> {
    // Session roots come from the recovered worktree state, so wait for it as the other session lookups do.
    await this.waitForStateReady("validateFiles")
    const root = resolveWorktreeRoot(this.getStateManager(), sessionId, this.getRoot())
    // An unresolved session is not "every path missing": let the client timeout treat it as unknown.
    if (!root) return
    const existing = paths.filter((file) => documentExists(root, file))
    this.postToWebview({ type: "agentManager.validateFilesResult", id, existing })
  }

  public async readDocument(sessionId: string, file: string, contextKey?: string): Promise<void> {
    await this.waitForStateReady("readDocument")
    const root = resolveWorktreeRoot(this.getStateManager(), sessionId, this.getRoot())
    const result = root ? readDocument(root, file) : { error: "The document context is no longer available." }
    this.postToWebview({ type: "agentManager.document", sessionId, file, requestedFile: file, contextKey, ...result })
  }

  public postToWebview(message: AgentManagerOutMessage): void {
    if (message.type !== "agentManager.worktreeSetup" || message.projectId) {
      this.panel?.postMessage(message)
      return
    }
    this.panel?.postMessage({ ...message, projectId: this.context?.id })
  }

  public api(): ProviderApiHost {
    return this as unknown as ProviderApiHost
  }

  public focusPanel(): void {
    focusPanel(this.api())
  }

  public isActive(): boolean {
    return isActive(this.api())
  }

  public async waitForPanel(panel: PanelContext, promise: Promise<void>): Promise<boolean> {
    const done = promise.then(() => true)
    let subscription: Disposable | undefined
    const disposed = new Promise<false>((resolve) => {
      subscription = panel.onDidDispose(() => {
        subscription?.dispose()
        resolve(false)
      })
    })
    void done.finally(() => subscription?.dispose())
    const ok = await Promise.race([done, disposed])
    return ok && this.panel === panel
  }

  public waitForPanelReady(panel: PanelContext): Promise<boolean> {
    return this.waitForPanel(panel, panel.waitForReady())
  }

  public waitForPanelActive(panel: PanelContext): Promise<boolean> {
    return this.waitForPanel(panel, panel.waitForActive())
  }

  public waitForReady(): Promise<boolean> {
    return waitForReady(this.api())
  }

  public getSessionDirectories(): ReadonlyMap<string, string> {
    return getSessionDirectories(this.api())
  }

  public revealSession(sessionId: string): Promise<boolean> {
    return revealSession(this.api(), sessionId)
  }

  public getWorktreeDirectories(): string[] {
    return getWorktreeDirectories(this.api())
  }

  public workspaceRoot = () => this.getRoot()

  public projectId = () => this.contexts.active()?.id

  public sessionProject(): string | undefined {
    return this.projectScope.current()?.id ?? this.contexts.active()?.id
  }

  public continueFromSidebar(
    sessionId: string,
    progress: (status: string, detail?: string, error?: string) => void,
  ): Promise<void> {
    return this.inWorkspaceProject(() => continueFromSidebar(this.api(), sessionId, progress))
  }

  /** Continues a session of the project the Agent Manager panel shows in a new worktree of that project. */
  public continueInWorktree(
    sessionId: string,
    progress: (status: string, detail?: string, error?: string) => void,
  ): Promise<void> {
    return continueInActiveProject(this.api(), sessionId, progress)
  }

  public createFromSidebar(baseBranch?: string, branchName?: string): Promise<void> {
    return this.inWorkspaceProject(() => createFromSidebar(this.api(), baseBranch, branchName))
  }

  public openAdvancedWorktree(): Promise<void> {
    return this.inWorkspaceProject(() => openAdvancedWorktree(this.api()))
  }

  /** The current branch of the workspace project, for the sidebar New Worktree menu. */
  public workspaceBranch(): Promise<string | undefined> {
    const manager = this.contexts.pinned()?.worktreeManager()
    if (!manager) return Promise.resolve(undefined)
    return manager
      .currentBranch()
      .then((branch) => branch || undefined)
      .catch(() => undefined)
  }

  /**
   * Runs a sidebar action on the workspace project, which the sidebar shows, and not on the project the panel shows.
   * The panel switches to that project first, because the action opens it.
   */
  private inWorkspaceProject(action: () => Promise<void>): Promise<void> {
    const context = this.contexts.pinned()
    if (!context) return action()
    if (this.contexts.active()?.id !== context.id) {
      this.contexts.activate(context.id)
      this.activateProject(context)
      this.pushProjects()
    }
    return this.projectScope.run(context, action)
  }

  public diagnose(): Promise<void> {
    return diagnose(this.api())
  }

  public postMessage(message: unknown): void {
    postMessage(this.api(), message)
  }

  public shutdown(): Promise<void> {
    return shutdown(this.api())
  }

  public async dispose(): Promise<void> {
    this.unsubAutoApprove()
    this.relay.dispose()
    await Promise.all([this.browser.dispose(), this.shutdown()])
  }

  public syncWorktrees(): Promise<void> {
    return syncWorktrees(this.api())
  }

  public async sendDiffBranches(sessionId: string, scope?: string, projectId = this.context?.id): Promise<void> {
    return postDiffBranches(
      this.diffs,
      (message) => this.postToWebview(message),
      (...args) => this.log(...args),
      sessionId,
      scope,
      projectId,
    )
  }

  public async setReviewMarkdownRender(value: boolean): Promise<void> {
    await setReviewMarkdownRender(value)
  }
}
