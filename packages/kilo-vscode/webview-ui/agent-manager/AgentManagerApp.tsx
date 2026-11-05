/** @jsxImportSource solid-js */

/**
 * The Agent Manager panel.
 *
 * The panel owns the project catalog, the sidebar, the tab bar and the inspector. Sessions come from the v2 store of
 * each directory (see app-session), so the chat is the shared SessionView wrapped in the store of the selected
 * worktree, or of the project root for a local session.
 */
import {
  batch,
  For,
  Show,
  createSignal,
  createMemo,
  createUniqueId,
  createEffect,
  on,
  untrack,
  onMount,
  onCleanup,
  type Component,
  type JSX,
} from "solid-js"
import type { ToolActions } from "@kilocode/kilo-ui/message-part"
import type {
  AgentManagerSidebarTarget,
  AgentManagerStateMessage,
  AgentManagerWorktreeSetupMessage,
  AgentProjectSnapshot,
  ExtensionMessage,
  LocalGitStats,
  PRStatus,
  SessionInfo,
  TerminalDestination,
  TerminalFont,
  WorktreeGitStats,
} from "../src/types/messages/agent-manager"
import { historyRowActions as historyRowActionsFactory } from "./history-actions"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { showToast } from "@kilocode/kilo-ui/toast"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Button } from "@kilocode/kilo-ui/button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { useLanguage } from "../src/context/language"
import { fallbackFontSize } from "../src/v2/kilo-settings"
import { LOCAL, canOpenRootSession, isKnownRootSession, adjacentHint, focusChatSearch } from "./navigate"
import { useBridge } from "./v2/vscode"
import { V2Scope } from "../src/v2/client"
import { SessionView } from "../src/v2/session-view"
import { createComposerQueue } from "../src/v2/composer"
import type { ToWebview } from "../../src/protocol"
import { createAppDirectories } from "./app-directories"
import { createAppSession } from "./app-session"
import {
  applyImportResult,
  applyKeybindings,
  applyMultiVersion,
  applyMultiVersionReady,
  applyRepoInfo,
  applyRevealSession,
  applySendInitial,
  applySessionAdded,
  applySessionForked,
  applySetupMessage,
  clearFailedDelete,
} from "./app-messages"
import { bindAppKeys } from "./app-keys"
import { nextTabAfterClose, reconcileTrackedTabs, trackedSessionInventory } from "../src/utils/local-tabs"
import { createLocalTabPlacement, closeSessionTab, newTabForSelection, selectSessionTab as selectTab } from "./app-tabs"
import {
  createSessionRestore,
  createTabMemory,
  rememberSelectionTab,
  selectLocalAction,
  selectWorktreeAction,
} from "./selection-actions"
import { createProjectRegistry, type PersistedProjectTabs } from "./project/registry"
import { createProjectLive } from "./project/live"
import { createProjectSessionsLive } from "./project/sessions-live"
import { worktreeSessionIds as worktreeMembership, worktreeSessions } from "./project/session-filter"
import { applyProjectSelection, createTargetRememberer } from "./project/selection"
import { createLocalSessions } from "./project/local-tabs"
import { persistLocalTabs, projectLocalIds, projectLocalSessions } from "./project/local-tabs"
import { createProjectHydration } from "./project/hydration"
import { createProjectStateRouter } from "./project/state"
import { createWorktreeActivity } from "./project/session-busy"
import { switchProject } from "./project/switch"
import { createProjectStateHandlers } from "./project/state-handlers"
import { ownsParent as ownsParentSession, isCurrent } from "./project/message-ownership"
import { routeReview } from "./project/review-routing"
import {
  reviewComments as readReviewComments,
  reviewOpen as isReviewOpen,
  createReviewState,
  pruneReviewState,
  setReviewComments,
  setReviewOpen,
} from "./project/review-state"
import { applyRunStatus } from "./project/run-status"
import { setupVisible, type SetupState } from "./project/progress"
import { defaultBase as projectDefaultBase } from "./project/default-base"
import { createModeRouter } from "./mode-router"
import * as modifier from "./modifier"
import { ProjectList } from "./ProjectList"
import { reportFailure } from "./failure-toast"
import { TabBar } from "./TabBar"
import { createIntro } from "./intro/AgentManagerIntro"
import { createShortcutHints } from "./ShortcutHints"
import { baseUpdateTarget } from "./base-update-target"
import { useBaseUpdate } from "./update-from-base"
import { createWorktreeMentionReferences as createMentionRefs } from "./worktree-references"
import { createSidebarCollapse } from "./sidebar-collapse"
import { createSidebarScrollPreserver } from "./sidebar-scroll"
import { usePendingCreate } from "./pending-create"
import { createNewTaskDrafts } from "./new-task-drafts"
import { buildShortcutMap } from "./section-helpers"
import { buildProjectNavEntries, createProjectNav } from "./project-nav"
import { createTabPersistence } from "./tab-persistence"
import { createTabDrag } from "./tab-drag"
import { createTabOrderSync } from "./tab-order-sync"
import { activeTask, closeAllTasks, closeFocusedTask } from "./task-close"
import { reportRemoteSessions, reportVisibleSession, visible } from "./remote-sessions"
import {
  createTerminalState,
  createTerminalHandlers,
  createTerminalMessageHandler,
  SideTerminalPanel,
  createSideTerminal,
  createAmbientSetup,
  hasSetupTerminal,
  keepTerminalStack,
  readSavedDestination,
  resolveRunScriptRequest,
  resolveVscodeTerminalRequest,
} from "./terminal"
import { createEmbeddedTerminalReader } from "./terminal/output"
import { focusCurrentTab, renderTab, renderTerminalLayer, renderNewTabButton } from "./tab-rendering"
import { useTabScroll } from "./tab-scroll"
import { setTabWidths } from "./tab-widths"
import { DiffPanelCache } from "./DiffPanelCache"
import { createPRNavigation, PRPanelHost } from "./pr/PRPanelHost"
import { createPRReview } from "./pr/review"
import { createPRDiffCommentState } from "./pr/diff-comment-state"
import { createRevertFile } from "./revert-file"
import { FullScreenDiffView } from "../diff-viewer/FullScreenDiffView"
import { DiffScopeControls } from "../diff-viewer/DiffScopeControls"
import { createTabFocus } from "../src/utils/tab-navigation"
import { createDiffReviewScope } from "./diff-review-scope"
import { scopeCapabilities } from "./diff-scope-state"
import HistoryView from "./HistoryView"
import { createApplyToLocal } from "./apply-to-local"
import { applyTabOrder } from "./tab-order"
import { createWorktreeDiffs, diffDataKey, wireDiffId } from "./worktree-diffs"
import { createReviewComposers } from "./review-composers"
import type { ReviewComment } from "../diff-viewer/review-comments"
import type { PRComment } from "./pr/pr-types"
import {
  APPEND_REVIEW_COMMENTS,
  takeReviewCommentsForPrompt,
  type AppendReviewCommentsDetail,
} from "../diff-viewer/review-annotations"
import { createMarkdownRender } from "./review-preferences"
import { buildShortcutCategories } from "./shortcuts"
import { ShortcutsDialog } from "./ShortcutsDialog"
import { defaultBindings } from "./keybind-defaults"
import { createChatFocus, createFocusBridge, createPromptFocus, forgetTerminalFocus } from "./focus"
import { createAppDiffPanelFocus } from "./diff-panel-focus"
import { clampPanelWidth, createPanelResize, maxPanelWidth, minPanelWidth, SidePanel } from "./side-panel-layout"
import { createSidePanel, sideHostNeeded } from "./side-panel-state"
import { createDocumentInspector, isMarkdownPath } from "../documents/state"
import { chunkPaths } from "../src/v2/validate-paths"
import { DocumentPanelHost } from "./documents/DocumentPanelHost"
import { SubagentPanel } from "./SubagentPanel"
import { attachSubagentEvent, createSubagentController } from "./subagent-tabs"
import { EditPreviewPanel } from "./EditPreviewPanel"
import {
  createEditPreview,
  previewMatchesContext,
  sessionTreeContains,
  sessionWorktree,
  type EditPreviewDiff,
} from "./edit-preview"
import { NewWorktreeDialog } from "./NewWorktreeDialog"
import { ResizeHandle } from "@kilocode/kilo-ui/resize-handle"
import "./agent-manager.css"
import "./agent-manager-review.css"
import { PENDING_PREFIX, REVIEW_TAB_ID } from "./tab-ids"
import type { SidebarSearchMenuRef } from "./SidebarSearchMenu"
import type { WorktreeDelete } from "./worktree-delete"
import { SpeechToTextStatusProvider } from "../src/components/speech-to-text/status"
import { useDisplaySettings } from "../src/v2/display-settings"

type SidebarSelection = typeof LOCAL | string | null
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
const isPending = (id: string) => id.startsWith(PENDING_PREFIX)

const AgentManagerContent: Component = () => {
  const { t } = useLanguage()
  const vscode = useBridge()
  const dialog = useDialog()
  const updateBase = useBaseUpdate()
  const mode = createModeRouter()
  let sidebarSearchMenu: SidebarSearchMenuRef | undefined
  let confirmDelete: WorktreeDelete["confirm"] | undefined
  const [kb, setKb] = createSignal<Record<string, string>>(defaultBindings)
  const [setup, setSetup] = createSignal<SetupState>({ active: false, message: "" })
  const worktrees = () => registry.active().worktrees()
  const managedSessions = () => registry.active().managedSessions()
  const [selection, setSelection] = createSignal<SidebarSelection>(LOCAL)
  const busyWorktrees = () => registry.active().busy()
  const [held, setHeld] = createSignal(false)
  const [worktreesLoaded, setWorktreesLoaded] = createSignal(false)
  const [sessionsLoaded, setSessionsLoaded] = createSignal(false)
  const [isGitRepo, setIsGitRepo] = createSignal(true)
  const [repoBranches, setRepoBranches] = createSignal<Record<string, string | undefined>>({})
  const repoDetectedBranch = () => repoBranches()[currentProjectId() ?? "single"]
  const [projectList, setProjectList] = createSignal<AgentProjectSnapshot[]>([])
  const [restricted, setRestricted] = createSignal(false)
  const [currentProjectId, setCurrentProjectId] = createSignal<string | undefined>()
  const [projectStates, setProjectStates] = createSignal<Record<string, AgentManagerStateMessage>>({})
  const activeProjectId = () => projectList().find((p) => p.active)?.id ?? currentProjectId()
  const repoDefaultBranch = () => repoDetectedBranch() ?? "main"

  const DEFAULT_SIDEBAR_WIDTH = 260
  const MIN_SIDEBAR_WIDTH = 200
  const MAX_SIDEBAR_WIDTH_RATIO = 0.4
  const persisted = vscode.getState<
    PersistedProjectTabs & { sidebarWidth?: number; sidePanelWidth?: number; sidebarCollapsed?: boolean }
  >()
  const registry = createProjectRegistry({ persisted: persisted ?? {}, activeId: () => currentProjectId() ?? "single" })
  const defaultBase = (id: string) =>
    projectDefaultBase(registry.ensure(id), id === activeProjectId(), repoBranches()[id])
  const localSessionIDs = () => registry.active().tabs.ids()
  const setLocalSessionIDs = (next: string[] | ((prev: string[]) => string[])) => registry.active().tabs.set(next)
  const evictLocal = (sid: string) =>
    setLocalSessionIDs((prev) => (prev.includes(sid) ? prev.filter((id) => id !== sid) : prev))
  const closedLocals = new Map<string, Set<string>>()
  const closedSet = () => {
    const key = currentProjectId() ?? "single"
    const existing = closedLocals.get(key)
    if (existing) return existing
    const set = new Set<string>()
    closedLocals.set(key, set)
    return set
  }
  const [sidebarWidth, setSidebarWidth] = createSignal(persisted?.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH)
  const sidebar = createSidebarCollapse(vscode, { initial: persisted?.sidebarCollapsed })
  const sidebarCollapsed = sidebar.collapsed
  const expandSidebar = sidebar.expand
  const toggleSidebar = sidebar.toggle
  let sidebarRaf: number | undefined
  let pendingSidebarWidth: number | undefined
  const [history, setHistory] = createSignal(false)
  const [historyProject, setHistoryProject] = createSignal<string | undefined>()
  const [historySwitches, setHistorySwitches] = createSignal<string[]>([])
  const closeHistory = () => {
    setHistory(false)
    setHistoryProject(undefined)
    setHistorySwitches([])
  }
  const openHistory = (pid?: string) => {
    comments.cancel()
    const scoped = pid !== undefined
    if (scoped && (currentProjectId() !== pid || historySwitches().length > 0))
      setHistorySwitches((prev) => (prev.includes(pid) ? prev : [...prev, pid]))
    setHistoryProject(scoped ? pid : undefined)
    setHistory(true)
    if (scoped) activateSelection({ projectId: pid, kind: "local" })
  }
  const [reviewActive, setReviewActive] = createSignal(false)
  const [diffStyle, setDiffStyle] = createSignal<"unified" | "split">("unified")

  const directories = createAppDirectories({
    projects: projectList,
    activeProjectId,
    store: (id) => registry.ensure(id),
    currentProjectId,
    selection,
    managedSessions,
    openTabs: localSessionIDs,
  })
  const rootDirectory = createMemo(() => directories.root(activeProjectId() ?? currentProjectId()))
  const appSession = createAppSession({ vscode, directories, rootDirectory })
  const panel = appSession.panel
  // Display layouts are Kilo-only config keys, so the host reads them. Ask on connect and after every config change.
  const display = useDisplaySettings()
  createEffect(
    on(
      () => panel.connection.status(),
      (status) => {
        if (status === "connected") display.request()
      },
    ),
  )
  createEffect(() => {
    const store = appSession.rootStore()
    if (!store) return
    onCleanup(store.data.on("config.updated", () => display.request()))
  })
  // The sessions are loaded once the project root store listed them after connecting.
  createEffect(() => {
    const store = appSession.rootStore()
    if (store?.connection.status() === "connected" && !store.loading()) setSessionsLoaded(true)
  })
  const sessions = appSession.sessions

  const to = (msg: unknown) => vscode.postMessage(msg as never)
  const onHostMessage = (callback: (message: ExtensionMessage) => void) =>
    vscode.onMessage((message) => callback(message as unknown as ExtensionMessage))
  const activateSelection = (target: AgentManagerSidebarTarget, restore?: boolean) => {
    saveTabMemory()
    comments.cancel()
    to({ type: "agentManager.activateSelection", target, restore })
  }
  const creation = usePendingCreate(activeProjectId, (projectId, worktreeId) =>
    activateSelection({ projectId, kind: "worktree", worktreeId }),
  )
  const isActivePayload = (pid: string | undefined) =>
    projectList().length === 0 || pid === undefined || pid === activeProjectId()

  const panels = createSidePanel({
    project: currentProjectId,
    selection,
    current: () => sessions.currentSessionID(),
    visible: (value) => {
      if (history() || reviewActive()) return false
      if (value === SidePanel.Diff)
        return (
          !setupVisible(setup(), currentProjectId(), selection()) &&
          busyWorktrees().get(selection() ?? "")?.reason !== "setting-up"
        )
      if (value === SidePanel.PR) return !!activePR()
      if (value === SidePanel.Subagents) return subagents.tabs().length > 0
      if (value === SidePanel.EditPreview) return !!editPreview.preview()
      return true
    },
  })
  const sidePanel = panels.panel
  const [diffMounted, setDiffMounted] = createSignal(false)
  const diffOpen = () => sidePanel() === SidePanel.Diff
  const prOpen = () => sidePanel() === SidePanel.PR
  const activePR = createMemo(() => {
    const selected = selection()
    if (!selected || selected === LOCAL) return undefined
    const pr = prStatuses()[selected]
    if (!pr) return undefined
    return { pr, selected, wt: worktrees().find((item) => item.id === selected) }
  })
  const diffs = createWorktreeDiffs(vscode, activeProjectId)
  const diffDatas = diffs.diffDatas
  const diffLoading = diffs.diffLoading
  const setDiffLoading = diffs.setDiffLoading
  const diffNotices = diffs.diffNotices
  const [panelWidth, setPanelWidth] = createSignal(clampPanelWidth(persisted?.sidePanelWidth, window.innerWidth))
  const resizeSide = createPanelResize(setPanelWidth, () => window.innerWidth)
  const showSideTerminal = () => {
    closeHistory()
    setReviewActive(false)
    panels.open(SidePanel.Terminal)
  }
  const composers = createReviewComposers(currentProjectId)
  createEffect(
    on(projectList, (next, previous) => {
      const ids = new Set(next.map((project) => project.id))
      previous
        ?.filter((project) => !ids.has(project.id))
        .forEach((project) => {
          composers.clearProject(project.id)
          documentInspector.clearProject(project.id)
        })
    }),
  )
  const reviewState = createReviewState()
  const reviewOpenByContext = reviewState.open
  const setReviewOpenByContext = reviewState.setOpen
  const reviewCommentsByContext = reviewState.comments
  const setReviewCommentsByContext = reviewState.setComments
  const setSharedDiffStyle = (style: "unified" | "split") => {
    if (diffStyle() === style) return
    setDiffStyle(style)
    to({ type: "agentManager.setReviewDiffStyle", style })
  }
  const documentInspector = createDocumentInspector(
    {
      send: (sessionId, file, contextKey) => to({ type: "agentManager.requestDocument", sessionId, file, contextKey }),
      openFile: (file, sessionId, line, column) => {
        if (!sessionId) return false
        to({ type: "agentManager.openFile", sessionId, filePath: file, line, column })
        return true
      },
      copyPath: (file, sessionId) => {
        if (!sessionId) return false
        to({ type: "agentManager.copyFilePath", sessionId, filePath: file })
        return true
      },
      onMessage: (handler) =>
        onHostMessage((message) => {
          if (message.type === "agentManager.document") handler(message)
        }),
    },
    selection,
    currentProjectId,
    () => sidePanel() === SidePanel.Documents,
    () => {
      closeHistory()
      setReviewActive(false)
      panels.open(SidePanel.Documents)
    },
    () => panels.close(SidePanel.Documents),
  )
  const subagentCtl = createSubagentController({
    project: currentProjectId,
    current: () => sessions.currentSessionID(),
    selection,
    parts: (id) =>
      sessions
        .messages(id)
        .flatMap((message) =>
          message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
        ),
    visible: () => sidePanel() === SidePanel.Subagents,
    sync: (id) => void sessions.sync(id),
    unsync: (id) => sessions.release(id),
    show: () => {
      closeHistory()
      setReviewActive(false)
      panels.open(SidePanel.Subagents)
    },
    hide: () => panels.close(SidePanel.Subagents),
  })
  const subagents = subagentCtl.tabs
  const editPreview = createEditPreview({
    context: panels.session,
    matches: (id) =>
      previewMatchesContext(
        id,
        sessions.currentSessionID(),
        selection(),
        id ? sessionWorktree(id, sessions.sessions(), managedSessions()) : undefined,
        (child, parent) => sessionTreeContains(child, parent, sessions.sessions()),
      ),
    show: () => {
      closeHistory()
      setReviewActive(false)
      panels.open(SidePanel.EditPreview)
    },
    hide: () => panels.close(SidePanel.EditPreview),
    style: diffStyle,
    onStyleChange: setSharedDiffStyle,
  })
  const markdown = createMarkdownRender(vscode)
  const worktreeStats = () => registry.active().worktreeStats()
  const prStatuses = () => registry.active().prStatuses()
  const runStatuses = () => registry.active().runStatuses()
  const runScriptConfigured = () => registry.active().runScriptConfigured()
  const localStats = () => registry.active().localStats()
  const projectLive = createProjectLive({ ensure: (pid) => (pid ? registry.ensure(pid) : registry.active()) })
  const [activePendingId, setActivePendingId] = createSignal<string | undefined>()
  const [terminalFont, setTerminalFont] = createSignal<TerminalFont>({
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--vscode-editor-font-family").trim(),
    fontSize: fallbackFontSize(),
  })
  const nsKey = (sel: string) => `${currentProjectId() ?? "single"}:${sel}`
  const terms = createTerminalState(() => {
    const sel = selection()
    return sel === null ? null : nsKey(sel)
  })
  const resolveTerminal = createEmbeddedTerminalReader({
    key: (context) => nsKey(context ?? LOCAL),
    local: LOCAL,
    side: (key) => terms.sidesForContext(key),
    tabs: (key) => terms.forSelection(key),
    focused: terms.focusedId,
    sideActive: terms.sideActiveFor,
    active: terms.activeId,
  })
  const requestChatFocus = createChatFocus({
    term: () => terms.activeId(),
    history,
    review: reviewActive,
  })
  createEffect(
    on(
      () => sessions.currentSessionID(),
      () => requestChatFocus(),
      { defer: true },
    ),
  )
  type FocusOwner = "prompt" | { terminal: string }
  const focusMemory = new Map<string, FocusOwner>()
  const prompt = createPromptFocus(terms, requestChatFocus)
  const focusKey = () => `${terms.sideKey()}:${sessions.currentSessionID() ?? activePendingId() ?? "new"}`
  const forgetSessionFocus = (sessionID: string) => {
    for (const key of focusMemory.keys()) if (key.endsWith(`:${sessionID}`)) focusMemory.delete(key)
  }
  const forgetContextFocus = (context: string) => {
    for (const key of focusMemory.keys()) if (key.startsWith(`${context}:`)) focusMemory.delete(key)
  }
  let restoreSession: () => "none" | "ready" | "pending" = () => "none"
  const focusCtl = createFocusBridge({
    prompt,
    post: (target) => to({ type: "agentManagerFocusChanged", target }),
    remember: () => focusMemory.set(focusKey(), "prompt"),
    restore: () => restoreSession(),
  })
  const terminalVisible = () => sidePanel() === SidePanel.Terminal && !history() && !reviewActive()
  const focusOnDraftChange = () => {
    const key = focusKey()
    const owner = focusMemory.get(key)
    if (!owner || owner === "prompt") return true
    if (!terms.sidesForContext(terms.sideKey()).some((term) => term.id === owner.terminal)) {
      focusMemory.delete(key)
      return true
    }
    return !terminalVisible()
  }
  const restoreFocus = () => {
    if (prompt.active()) return
    const key = focusKey()
    const owner = focusMemory.get(key)
    if (owner && owner !== "prompt") {
      const context = terms.sideKey()
      const terminal = terms.sidesForContext(context).find((term) => term.id === owner.terminal)
      if (terminal && terminalVisible()) {
        terms.setSideActive(context, terminal.id)
        terms.requestFocus(terminal.id)
        return
      }
      if (!terminal) focusMemory.delete(key)
    }
    requestChatFocus()
  }
  const diffPanels = createAppDiffPanelFocus({
    isOpen: () => diffOpen() && !reviewActive(),
    isReviewActive: reviewActive,
    openSide: () => panels.open(SidePanel.Diff),
    closeSide: () => panels.close(SidePanel.Diff),
    closeHistory,
    closeReview: (focus) => closeReviewTab(focus),
    focusPrompt: requestChatFocus,
    hideReview: () => setReviewActive(false),
    clearTerminal: () => terms.setActiveId(undefined),
    track: () => undefined,
  })
  createEffect(
    on(
      () => terms.focusedId(),
      (id) => {
        if (!id) return
        const key = terms.contextFor(id)
        if (!key || !terms.sidesForContext(key).some((term) => term.id === id)) return
        focusMemory.set(focusKey(), { terminal: id })
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      focusKey,
      (_key, previous) => {
        if (previous !== undefined) queueMicrotask(restoreFocus)
      },
      { defer: true },
    ),
  )
  const ambientSetup = createAmbientSetup({
    terms,
    selection: () => {
      const sel = selection()
      return sel === null ? null : nsKey(sel)
    },
    sidePanel: panels.selected,
    close: () => panels.close(SidePanel.Terminal),
  })
  const cancelAmbientSetup = ambientSetup.cancel
  const tabMemory = () => registry.active().tabMemory.all()
  const reviewOpen = createMemo(() => {
    const sel = selection()
    if (sel === null) return false
    return isReviewOpen(reviewOpenByContext(), currentProjectId() ?? "single", sel)
  })
  const setReviewOpenForContext = (context: string, open: boolean) =>
    setReviewOpenByContext((prev) => setReviewOpen(prev, currentProjectId() ?? "single", context, open))
  const setReviewOpenForSelection = (open: boolean) => {
    const sel = selection()
    if (sel === null) return
    setReviewOpenForContext(sel, open)
  }
  const apply = createApplyToLocal({
    vscode,
    dialog,
    t,
    selection,
    local: LOCAL,
    worktrees,
    diffDatas,
    diffLoading,
    projectId: activeProjectId,
  })
  const openApplyDialog = apply.openApplyDialog
  const openWorktreeDirectory = () => {
    const sel = selection()
    if (!sel || sel === LOCAL) return
    to({ type: "agentManager.openWorktree", worktreeId: sel })
  }
  const togglePRPanel = () => {
    const opening = sidePanel() !== SidePanel.PR
    panels.toggle(SidePanel.PR)
    closeHistory()
    if (reviewActive()) closeReviewTab()
    if (!opening) return
    const sel = selection()
    if (sel && sel !== LOCAL) to({ type: "agentManager.refreshPR", projectId: activeProjectId(), worktreeId: sel })
  }
  const openSelectedPR = () => {
    const sel = selection()
    if (!sel || sel === LOCAL || !prStatuses()[sel]) return
    togglePRPanel()
  }
  const comments = createPRNavigation({
    project: currentProjectId,
    active: activeProjectId,
    selection,
    select: ({ projectId, worktreeId }) => {
      if (projectId) return activateSelection({ projectId, kind: "worktree", worktreeId })
      if (selection() !== worktreeId) selectWorktree(worktreeId)
    },
    visible: () => panels.selected() === SidePanel.PR && !history() && !reviewActive(),
    open: () => {
      closeHistory()
      if (reviewActive()) closeReviewTab()
      panels.open(SidePanel.PR)
    },
    refresh: ({ projectId, worktreeId }) => to({ type: "agentManager.refreshPR", projectId, worktreeId }),
  })
  const runWorktree = (id: string, destination: TerminalDestination) => {
    const state = runStatuses()[id]?.state ?? "idle"
    if (state === "running" || state === "stopping") {
      to({ type: "agentManager.stopRunScript", worktreeId: id })
      return
    }
    to(resolveRunScriptRequest(id, destination))
  }
  const configureRunScript = () => to({ type: "agentManager.configureRunScript" })
  const runSelected = () => {
    const sel = selection()
    if (sel) runWorktree(sel, sideCtl.destination())
  }
  reportRemoteSessions(vscode, localSessionIDs, managedSessions, isPending)
  const releaseTabs = () => setTabWidths(false)
  const freezeTabs = () => {
    const bar = document.querySelector(".am-tab-bar")
    if (!(bar instanceof HTMLElement) || !bar.matches(":hover")) return
    setTabWidths(true)
    requestAnimationFrame(releaseTabs)
  }
  const worktreeTabOrder = () => registry.active().tabOrder()
  const setWorktreeTabOrder = (
    value: Record<string, string[]> | ((prev: Record<string, string[]>) => Record<string, string[]>),
  ) => registry.active().setTabOrder(value)
  const tabState = createTabPersistence(registry.active, selection, REVIEW_TAB_ID, (message) => to(message))
  const orders = (store = registry.active) =>
    createTabOrderSync({
      LOCAL,
      REVIEW_TAB_ID,
      order: () => store().tabOrder(),
      setOrder: (value) => store().setTabOrder(value),
      persist: (key, order) => {
        if (store() === registry.active()) tabState.persistOrder(key, order)
      },
      localSessionIDs: () => store().tabs.ids(),
      sessions: () =>
        sessions.sessions().map((info) => ({ id: info.id, createdAt: new Date(info.time.created).toISOString() })),
      managedSessions: () => store().managedSessions(),
      reviewOpen: (key) => isReviewOpen(reviewOpenByContext(), store().id, key),
      terminalIdsFor: (key) => terms.forSelection(`${store().id}:${key}`).map((term) => term.id),
    })
  const tabOrderSync = orders()
  const appendToTabOrder = tabOrderSync.append
  const localPlacement = createLocalTabPlacement({
    ids: localSessionIDs,
    setIds: setLocalSessionIDs,
    appendOrder: appendToTabOrder,
    replaceOrder: tabOrderSync.replaceOrAppend,
    activePending: activePendingId,
    setActivePending: setActivePendingId,
    setActiveTerminal: (id) => terms.setActiveId(id),
    clearSession: () => sessions.clearCurrentSession(),
    selectSession: (id) => sessions.selectSession(id),
    setSelection: (id) => setSelection(id),
    setReviewActive,
    focus: () => requestChatFocus(),
    closed: closedSet,
  })
  const addPendingTab = localPlacement.addPending
  const placeLocal = localPlacement.place
  const focusLocalSession = (id: string, scrollToBottom = false) => {
    const pending = activePendingId()
    const replace =
      pending && !localSessionIDs().includes(id) && localSessionIDs().includes(pending) ? pending : undefined
    placeLocal(id, replace, replace)
    setActivePendingId(undefined)
    terms.setActiveId(undefined)
    setReviewActive(false)
    setSelection(LOCAL)
    sessions.selectSession(id)
    requestChatFocus(scrollToBottom)
  }
  persistLocalTabs({
    tabs: () => {
      registry.version()
      return Object.fromEntries(registry.all().map((store) => [store.id, store.tabs.durable(isPending)]))
    },
    key: () => registry.active().id,
    width: sidebarWidth,
    panelWidth,
    get: () => vscode.getState<Record<string, unknown>>(),
    set: (value) => vscode.setState(value),
  })
  const saveTabMemory = createTabMemory({
    selection,
    tab: () =>
      terms.activeId() ?? (reviewActive() ? REVIEW_TAB_ID : (sessions.currentSessionID() ?? activePendingId())),
    applied: currentProjectId,
    active: activeProjectId,
    owns: (sel) => worktrees().some((wt) => wt.id === sel),
    locals: localSessionIDs,
    localTab: (id) => id === REVIEW_TAB_ID || terms.hasRemembered(nsKey(LOCAL), id),
    session: () => sessions.currentSessionID() ?? activePendingId(),
    rememberSession: (sel, id) => registry.active().sessionRestore.set(sel, id),
    set: (sel, tab) => registry.active().tabMemory.set(sel, tab),
  })
  const activateAfterRemoval = (order: string[], removed: string) => {
    const after = nextTabAfterClose(order, removed)
    setActivePendingId(after && isPending(after) ? after : undefined)
    if (after && !isPending(after)) return sessions.selectSession(after)
    sessions.clearCurrentSession()
  }
  createEffect(() => {
    if (!worktreesLoaded()) return
    const all = sessions.sessions()
    if (all.length === 0) return
    const next = reconcileTrackedTabs(
      localSessionIDs(),
      all.filter(isKnownRootSession).map((item) => item.id),
      trackedSessionInventory(managedSessions(), all),
      isPending,
      currentProjectId() === activeProjectId(),
    )
    if (!next) return
    for (const id of next.forget) to({ type: "agentManager.forgetSession", sessionId: id })
    const previous = localSessionIDs()
    setLocalSessionIDs(next.ids)
    // A tab that leaves here was not closed by the user; the shown session must follow the remaining tabs.
    untrack(() => {
      const current = sessions.currentSessionID()
      if (selection() !== LOCAL || !current || !previous.includes(current) || next.ids.includes(current)) return
      activateAfterRemoval(
        previous.filter((id) => id === current || next.ids.includes(id)),
        current,
      )
    })
  })
  createEffect(() => {
    const ids = new Set(worktrees().map((wt) => wt.id))
    composers.prune(ids)
    const selected = selection()
    documentInspector.prune(currentProjectId() ?? "single", new Set([...ids, "local", ...(selected ? [selected] : [])]))
    untrack(() => diffs.prune(ids))
    setReviewOpenByContext((prev) => {
      const next = pruneReviewState(prev, currentProjectId() ?? "single", ids)
      if (Object.keys(next).length === Object.keys(prev).length) return prev
      return next
    })
    setReviewCommentsByContext((prev) => {
      const next = pruneReviewState(prev, currentProjectId() ?? "single", ids)
      if (Object.keys(next).length === Object.keys(prev).length) return prev
      return next
    })
  })
  const worktreeSessionIds = createMemo(
    () =>
      new Set(
        managedSessions()
          .filter((ms) => ms.worktreeId)
          .map((ms) => ms.id),
      ),
  )
  const localSet = createMemo(() => new Set(localSessionIDs()))
  const projectSessionsLive = createProjectSessionsLive({
    base: projectLive.sessions,
    pid: currentProjectId,
    store: sessions.sessions,
    managed: managedSessions,
    locals: localSet,
  })
  const { references, dialogRefs } = createMentionRefs(vscode, registry.active, projectSessionsLive.current, selection)
  const historySessionIds = createMemo(() => {
    const pid = historyProject()
    if (!pid) return undefined
    if (pid === currentProjectId()) return undefined
    const list = projectSessionsLive()[pid]
    if (!list) return new Set<string>()
    return new Set(list.filter(isKnownRootSession).map((item) => item.id))
  })
  // Every root session the panel knows; the history tabs narrow it to the project or its worktrees.
  const historyList = createMemo(() =>
    sessions
      .sessions()
      .filter(
        (session) =>
          isKnownRootSession(session) || managedSessions().some((item) => item.id === session.id && item.worktreeId),
      ),
  )
  const localSessions = createLocalSessions({
    ids: localSessionIDs,
    sessions: () => {
      const pid = currentProjectId() ?? ""
      const host = projectLocalSessions(
        projectSessionsLive()[pid] ?? [],
        projectLocalIds(projectStates()[pid]),
        isPending,
        directories.root(pid) ?? "",
      )
      const known = new Set(host.map((session) => session.id))
      const live = sessions.sessions().filter((session) => isKnownRootSession(session) && !known.has(session.id))
      return [...host, ...live]
    },
    pending: isPending,
    root: isKnownRootSession,
    title: () => t("agentManager.session.newSession"),
    directory: () => directories.root(currentProjectId()) ?? "",
  })
  // The host may not have stamped a freshly created worktree session yet, but its tab is already in the order.
  const sessionsForWorktree = (id: string) => {
    const order = worktreeTabOrder()[id] ?? []
    const list = worktreeSessions(id, managedSessions(), sessions.sessions(), order)
    const known = new Set(list.map((session) => session.id))
    const extra = order.flatMap((sessionID) => {
      const session = sessions.get(sessionID)
      return session && !known.has(sessionID) && isKnownRootSession(session) ? [session] : []
    })
    return extra.length > 0 ? applyTabOrder([...list, ...extra], order) : list
  }
  const activeWorktreeSessions = createMemo((): SessionInfo[] => {
    const sel = selection()
    if (!sel || sel === LOCAL) return []
    return sessionsForWorktree(sel)
  })
  const activeWorktreeSessionIds = createMemo<ReadonlySet<string> | undefined>(() => {
    const sel = selection()
    if (!sel || sel === LOCAL) return undefined
    const ids = new Set(worktreeMembership(sel, managedSessions()))
    for (const session of sessionsForWorktree(sel)) ids.add(session.id)
    return ids
  })
  const activeTabs = createMemo((): SessionInfo[] => {
    const sel = selection()
    if (sel === LOCAL) return localSessions()
    if (sel) return activeWorktreeSessions()
    return []
  })
  const contextEmpty = createMemo(() => {
    const sel = selection()
    if (terms.current().length > 0) return false
    if (sel === LOCAL) return localSessionIDs().length === 0
    if (sel) return activeWorktreeSessions().length === 0 && managedSessions().every((ms) => ms.worktreeId !== sel)
    return false
  })
  const showDetailStack = createMemo(
    () =>
      !restricted() &&
      keepTerminalStack(history(), selection(), contextEmpty(), terms.all().length + terms.sides().length),
  )
  const sideHostVisible = () =>
    sideHostNeeded(sidePanel(), diffMounted(), terms.sides().length, subagents.tabs().length)
  const overlay = createMemo((): SetupState | null => {
    if (restricted()) return null
    const state = setup()
    const sel = selection()
    if (typeof sel === "string" && sel !== LOCAL && hasSetupTerminal(nsKey(sel), terms.sides())) return null
    if (setupVisible(state, currentProjectId(), sel)) return state
    if (typeof sel !== "string" || sel === LOCAL) return null
    const busy = busyWorktrees().get(sel)
    if (busy?.reason !== "setting-up") return null
    const tree = worktrees().find((item) => item.id === sel)
    return { active: true, message: busy.message ?? "", branch: busy.branch ?? tree?.branch }
  })
  const settingUpSelection = createMemo(() => {
    const sel = selection()
    if (typeof sel !== "string" || sel === LOCAL) return undefined
    const busy = busyWorktrees().get(sel)
    if (busy?.reason !== "setting-up") return undefined
    return busy
  })
  createEffect(() => {
    const sel = selection()
    if (sel === null) {
      if (reviewActive()) setReviewActive(false)
      return
    }
    if (reviewActive() && !reviewOpen()) setReviewActive(false)
  })
  createEffect(() => {
    const pid = currentProjectId()
    const id = selection()
    if (!pid || !id) return
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-sidebar-id="${pid}:${id}"]`)
      if (el instanceof HTMLElement) scrollIntoView(el)
    })
  })
  const readOnly = createMemo(() => selection() === null && !!sessions.currentSessionID())
  const visibleTabId = createMemo(() => {
    const term = terms.activeId()
    if (term) return term
    if (reviewActive()) return REVIEW_TAB_ID
    return sessions.currentSessionID() ?? activePendingId()
  })
  const visibleSession = createMemo(() =>
    visible(
      sessions.currentSessionID(),
      !!terms.activeId() || reviewActive() || history() || !!overlay() || contextEmpty(),
    ),
  )
  reportVisibleSession(vscode, visibleSession)
  const activity = createWorktreeActivity({
    managed: managedSessions,
    local: localSessionIDs,
    projects: projectSessionsLive,
    active: activeProjectId,
    activityFor: sessions.activityFor,
    inUseFor: (id) => sessions.activityFor(id) === "waiting",
    terminal: (id, project) => terms.activityFor(`${project ?? currentProjectId() ?? "single"}:${id ?? LOCAL}`),
    worktrees: (id) => (id ? registry.ensure(id) : registry.active()).worktrees(),
    subscribe: onHostMessage,
  })
  const projectShortcutMap = createMemo(() =>
    buildShortcutMap(buildProjectNavEntries(projectList(), projectStates()).map((entry) => ({ id: entry.id }))),
  )
  const scrollIntoView = (el: HTMLElement) => el.scrollIntoView({ block: "nearest", behavior: "smooth" })
  const projectNav = createProjectNav(
    {
      projects: projectList,
      states: projectStates,
      activeProjectId,
      selection,
      currentSessionID: () => sessions.currentSessionID(),
    },
    activateSelection,
    scrollIntoView,
  )
  const navigateTab = (direction: "left" | "right") => {
    const ids = tabIds()
    if (ids.length === 0) return
    const index = ids.indexOf(visibleTabId() ?? "")
    if (index === -1) return
    const next = direction === "left" ? index - 1 : index + 1
    if (next < 0 || next >= ids.length) return
    focusTab(ids[next]!)
    requestChatFocus(true)
  }
  const selectionDeps = {
    saveTabMemory,
    setReviewActive,
    setSelection,
    post: to,
    tabMemory,
    sessionMemory: (sel: string) => registry.active().sessionRestore.get(sel),
    terms,
    nsKey,
    activateTerminal: (id: string) => termHandlers.activate(id),
    setActivePendingId,
    focusLocal: focusLocalSession,
    selectSession: (id: string) => sessions.selectSession(id),
    clearSession: () => sessions.clearCurrentSession(),
    resetSession: () => sessions.clearCurrentSession(),
    isPending,
    isReviewTab: (remembered: string | undefined, sel: string) =>
      remembered === REVIEW_TAB_ID && isReviewOpen(reviewOpenByContext(), currentProjectId() ?? "single", sel),
  }
  const selectLocal = () => {
    selectLocalAction(selectionDeps, localSessions(), projectLocalIds(projectStates()[currentProjectId() ?? ""]))
    requestChatFocus()
  }
  const selectWorktree = (worktreeId: string) => {
    const ids = managedSessions()
      .filter((item) => item.worktreeId === worktreeId)
      .map((item) => item.id)
    selectWorktreeAction(selectionDeps, worktreeId, sessionsForWorktree(worktreeId), ids)
    requestChatFocus()
  }
  const addSessionToCurrentWorktree = (sid: string) => {
    const sel = selection()
    if (!sel || sel === LOCAL || !canOpenRootSession(sid, sessions.sessions())) return false
    const current = managedSessions().find((entry) => entry.id === sid)
    if (current?.worktreeId) return focusManagedSession(current.worktreeId, sid)
    saveTabMemory()
    closeHistory()
    setReviewActive(false)
    appendToTabOrder(sel, sid)
    evictLocal(sid)
    to({ type: "agentManager.addSessionToWorktree", worktreeId: sel, sessionId: sid })
    return true
  }
  const focusManagedSession = (worktreeId: string, sid: string, scrollToBottom = false) => {
    selectWorktree(worktreeId)
    closeHistory()
    terms.setActiveId(undefined)
    setActivePendingId(undefined)
    setReviewActive(false)
    sessions.selectSession(sid)
    requestChatFocus(scrollToBottom)
    return true
  }
  const focusExistingSession = (sid: string) => {
    if (localSessionIDs().includes(sid)) {
      focusLocalSession(sid)
      return true
    }
    const item = managedSessions().find((entry) => entry.id === sid)
    if (!item?.worktreeId) return false
    return focusManagedSession(item.worktreeId, sid)
  }
  const cycleAgent = (direction: 1 | -1) => {
    const id = sessions.currentSessionID() ?? activePendingId()
    if (!id) return
    const list = appSession.agents()
    if (list.length < 2) return
    const index = list.findIndex((item) => item.id === sessions.get(id)?.agent)
    const raw = index + direction
    const next = raw < 0 ? list.length - 1 : raw >= list.length ? 0 : raw
    const value = list[next]?.id
    if (value) void sessions.scope(id)?.api.session.switchAgent({ sessionID: id, agent: value })
  }
  const router = createProjectStateRouter({
    catalog: projectList,
    apply: (state) => applyActiveState(state),
    pruneLive: (ids) => projectLive.prune(ids),
  })
  const stateHandlers = createProjectStateHandlers({
    setProjects: (projects) => {
      const live = new Set(projects.map((project) => project.id))
      setRepoBranches((prev) =>
        Object.keys(prev).every((id) => id === "single" || live.has(id))
          ? prev
          : Object.fromEntries(Object.entries(prev).filter(([id]) => id === "single" || live.has(id))),
      )
      setProjectList(projects)
    },
    migrate: (id) => registry.migrate(id),
    setStates: setProjectStates,
    prune: (ids) => registry.prune(ids),
    ensure: (id) => registry.ensure(id),
    active: () => registry.active(),
    routeCatalog: router.routeCatalog,
    routeState: router.routeState,
    font: (font) => font && setTerminalFont(font),
  })
  const preserveSidebarScroll = createSidebarScrollPreserver(() => selection() ?? sessions.currentSessionID())
  const applyActiveState = createProjectHydration({
    switch: (state) => applyProjectSwitch(state),
    restricted: setRestricted,
    repo: setIsGitRepo,
    loaded: () => setWorktreesLoaded(true),
    sessionsLoaded: () => setSessionsLoaded(true),
    style: setSharedDiffStyle,
    markdown: markdown.setRender,
    current: () => sessions.currentSessionID(),
    settingUp: () => !!settingUpSelection(),
    sessions: () => sessions.sessions(),
    tabs: localSessionIDs,
    closed: closedSet,
    pending: isPending,
    setTabs: setLocalSessionIDs,
    terminals: () => terms.forSelection(nsKey(LOCAL)),
    draft: addPendingTab,
    restore: {
      selectLocal,
      selectWorktree,
      focusLocal: focusLocalSession,
      focusManaged: focusManagedSession,
      setSelection,
      setActivePendingId,
    },
    focus: () => requestChatFocus(),
    sidebar: sidebar.hydrate,
  })
  const applyProjectSwitch = (state: AgentManagerStateMessage): "first" | "switched" | "same" =>
    switchProject({
      id: state.projectId,
      current: currentProjectId,
      set: setCurrentProjectId,
      first: () => undefined,
      close: () => {
        saveTabMemory(true)
        setSelection(null)
        terms.setActiveId(undefined)
        setActivePendingId(undefined)
        sessions.clearCurrentSession()
        setReviewActive(false)
      },
      history: () =>
        state.projectId && historySwitches().includes(state.projectId)
          ? setHistorySwitches((prev) => prev.filter((id) => id !== state.projectId))
          : closeHistory(),
    })
  createTargetRememberer({
    pid: activeProjectId,
    applied: currentProjectId,
    selection,
    owns: (sel) => worktrees().some((wt) => wt.id === sel),
    sessionId: () => (reviewActive() ? undefined : sessions.currentSessionID()),
    post: (msg) => to(msg),
  })

  // The composer of the visible session; review comments and Fix with Kilo append to it.
  let promptAppend: ((value: string, send: boolean) => void) | undefined
  const appendToPrompt = (text: string, autoSend: boolean) => {
    promptAppend?.(text, autoSend)
    requestChatFocus(true)
  }
  // Editor and terminal context actions target the visible composer, and wait while no composer is mounted.
  const composerQueue = createComposerQueue()

  const handleSessionCreated = (id: string | undefined) => {
    if (!id) {
      sessions.clearCurrentSession()
      return
    }
    const sel = selection()
    if (sel && sel !== LOCAL) {
      appendToTabOrder(sel, id)
      // Every send reports its session. Adopting a session the worktree already owns would end its branch auto-naming.
      if (managedSessions().find((entry) => entry.id === id)?.worktreeId !== sel)
        to({ type: "agentManager.addSessionToWorktree", worktreeId: sel, sessionId: id })
      sessions.selectSession(id)
      return
    }
    placeLocal(id, activePendingId(), activePendingId() ?? sessions.currentSessionID())
    setSelection(LOCAL)
    to({ type: "agentManager.persistSession", projectId: currentProjectId(), sessionId: id })
    sessions.selectSession(id)
  }

  // Tool cards and edit permissions open their file changes in the edit preview, next to the session.
  const previewEdit = (files: EditPreviewDiff[], sessionID = sessions.currentSessionID()) => {
    const first = files[0]
    if (!first) return
    const diff =
      files.length === 1
        ? first
        : {
            file: first.file,
            additions: files.reduce((sum, item) => sum + item.additions, 0),
            deletions: files.reduce((sum, item) => sum + item.deletions, 0),
            files,
          }
    editPreview.open(diff, sessionID, diffStyle())
  }
  // Inline file candidates are validated by the host, which owns filesystem access and the worktree boundary.
  const fileChecks = new Map<string, { resolve: (existing: string[]) => void; reject: (error: Error) => void }>()
  const fileCheckPrefix = createUniqueId()
  let fileCheckCount = 0
  const stopFileChecks = onHostMessage((message) => {
    if (message.type !== "agentManager.validateFilesResult") return
    const pending = fileChecks.get(message.id)
    if (!pending) return
    fileChecks.delete(message.id)
    pending.resolve(message.existing)
  })
  onCleanup(() => {
    stopFileChecks()
    // Reject on dispose so the shared cache keeps these paths unknown instead of caching them as missing.
    for (const pending of fileChecks.values()) pending.reject(new Error("validateFiles cancelled"))
    fileChecks.clear()
  })
  // Keep each host request small so one frame with many candidates stays responsive; every path is still checked.
  const FILE_CHECK_CHUNK = 64
  const validateFiles = (sessionID: string, paths: string[]) => {
    const chunks = chunkPaths(paths, FILE_CHECK_CHUNK)
    return Promise.all(
      chunks.map(
        (chunk) =>
          new Promise<string[]>((resolve, reject) => {
            const id = `${fileCheckPrefix}-${++fileCheckCount}`
            fileChecks.set(id, { resolve, reject })
            to({ type: "agentManager.validateFiles", id, sessionId: sessionID, paths: chunk })
            setTimeout(() => {
              const pending = fileChecks.get(id)
              if (!pending) return
              fileChecks.delete(id)
              pending.reject(new Error("validateFiles timed out"))
            }, 3000)
          }),
      ),
    ).then((results) => results.flat())
  }
  const toolActions: ToolActions = {
    openFile: (filePath, line, column, sessionID) => {
      // Tool paths are raw model strings, so the resolver needs the session to pick the worktree or local root.
      const sessionId = sessionID ?? sessions.currentSessionID() ?? selection() ?? LOCAL
      if (isMarkdownPath(filePath) && documentInspector.open(filePath, sessionId, line, column)) return
      to({ type: "agentManager.openFile", sessionId, filePath, line, column })
    },
    validateFiles,
    openDiff: (diff) => previewEdit([diff]),
    openDiffs: (diffs) => previewEdit(diffs),
    openSession: (id) => {
      if (!focusExistingSession(id)) to({ type: "agentManager.openSessionLocally", sessionId: id })
    },
  }

  const handleForkSession = (sessionId: string, messageId?: string) => {
    const sel = selection()
    const message = { type: "agentManager.forkSession" as const, sessionId, ...(messageId ? { messageId } : {}) }
    if (!sel || sel === LOCAL) return to(message)
    to({ ...message, worktreeId: sel })
  }
  const handleCloseTab = (sessionId: string, notify = true) => {
    freezeTabs()
    closeSessionTab({
      sessionId,
      notify,
      order: activeTabs().map((tab) => tab.id),
      isActive: isPending(sessionId) ? sessionId === activePendingId() : sessions.currentSessionID() === sessionId,
      next: nextTabAfterClose(
        activeTabs().map((tab) => tab.id),
        sessionId,
      ),
      isPending,
      setActivePending: setActivePendingId,
      clearSession: () => sessions.clearCurrentSession(),
      selectSession: (id) => sessions.selectSession(id),
      forgetFocus: forgetSessionFocus,
      local: localSet(),
      closed: closedSet(),
      removeLocal: evictLocal,
      postClose: (id) => to({ type: "agentManager.closeSession", sessionId: id }),
      restoreFocus: () => tabFocus.restore(),
    })
  }
  const handleTabMouseDown = (sessionId: string, event: MouseEvent) => {
    if (event.button !== 1) return
    event.preventDefault()
    event.stopPropagation()
    handleCloseTab(sessionId)
  }
  const selectSessionTab = (id: string, pending: boolean) =>
    selectTab({
      id,
      pending,
      selection,
      remember: (sel, tab) =>
        rememberSelectionTab((value, next) => registry.active().tabMemory.set(value, next), sel, tab),
      setActivePending: setActivePendingId,
      clearSession: () => sessions.clearCurrentSession(),
      selectSession: (sessionID) => sessions.selectSession(sessionID),
      setReviewActive,
    })
  const handleNewTabForCurrentSelection = () =>
    newTabForSelection({
      selection: selection(),
      addPending: addPendingTab,
      postToWorktree: (worktreeId) => to({ type: "agentManager.addSessionToWorktree", worktreeId }),
    })
  const tabs = createSessionRestore({
    terminal: terms.activeId,
    selection,
    remembered: (sel) => registry.active().sessionRestore.get(sel),
    sessions: activeTabs,
    current: () => sessions.currentSessionID(),
    pending: activePendingId,
    isPending,
    select: selectSessionTab,
    create: handleNewTabForCurrentSelection,
    remember: (sel, id) => registry.active().sessionRestore.set(sel, id),
  })
  restoreSession = tabs.restore
  const termHandlers = createTerminalHandlers({
    state: terms,
    tabIds: () => tabIds(),
    selectReview: () => setReviewActive(true),
    selectSessionTab,
    clearSession: () => sessions.clearCurrentSession(),
    resetOthers: () => {
      tabs.remember()
      setReviewActive(false)
      setActivePendingId(undefined)
      sessions.clearCurrentSession()
    },
    isPendingId: isPending,
    findTab: (id) => tabLookup().get(id),
    postMessage: to,
    onRemove: freezeTabs,
    onShowSide: showSideTerminal,
    getSelection: selection,
    LOCAL,
    REVIEW_TAB_ID,
    getFont: terminalFont,
  })
  const sideCtl = createSideTerminal({
    handlers: termHandlers,
    visible: () => sidePanel() === SidePanel.Terminal && !history() && !reviewActive(),
    focusedId: () => terms.sideFocusedId(),
    count: () => terms.sidesForContext(terms.sideKey()).length,
    isScript: terms.isScript,
    hide: () => {
      cancelAmbientSetup()
      panels.close(SidePanel.Terminal)
    },
    refocus: requestChatFocus,
    postMessage: to,
    track: () => undefined,
    saved: readSavedDestination(vscode.getState<Record<string, unknown>>()),
    save: (destination) =>
      vscode.setState({ ...vscode.getState<Record<string, unknown>>(), terminalDestination: destination }),
    openVscode: () =>
      to(
        resolveVscodeTerminalRequest(
          selection(),
          sessions.currentSessionID(),
          (worktree) => managedSessions().find((entry) => entry.worktreeId === worktree)?.id,
        ),
      ),
  })
  createEffect(on(terms.sideKey, (key, previous) => sideCtl.syncContext(key, previous), { defer: true }))
  const handleReviewTabMouseDown = (event: MouseEvent) => {
    if (event.button !== 1) return
    event.preventDefault()
    event.stopPropagation()
    closeReviewTab()
  }
  const tabLookup = createMemo(() => new Map(activeTabs().map((session) => [session.id, session])))
  const drag = createTabDrag({
    selection,
    sessions: activeTabs,
    review: { id: REVIEW_TAB_ID, open: reviewOpen, title: () => t("session.tab.review") },
    order: worktreeTabOrder,
    setOrder: setWorktreeTabOrder,
    ...tabState.drag,
    setLocal: setLocalSessionIDs,
    terms,
    namespace: nsKey,
    persist: tabState.persistOrder,
  })
  const tabIds = drag.ids
  const tabScroll = useTabScroll(tabIds, visibleTabId)
  const focusTab = (id: string) =>
    focusCurrentTab({
      id,
      terms,
      isTerminal: (value) => value.startsWith("terminal"),
      isPending,
      reviewId: REVIEW_TAB_ID,
      reviewOpen,
      setReviewOpen: setReviewOpenForSelection,
      setReviewActive,
      tabLookup,
      setActivePendingId,
      clearSession: () => sessions.clearCurrentSession(),
      selectSession: (sessionID) => sessions.selectSession(sessionID),
      activateTerminal: termHandlers.activate,
    })
  const tabFocus = createTabFocus({ ids: () => tabIds(), select: focusTab })
  const cycleTerminal = (direction: "previous" | "next") => {
    const focused = terms.focusedId()
    const placement = terms.sideFocusedId() || (!focused && terminalVisible()) ? "side" : "tab"
    return termHandlers.cycle(direction, placement)
  }
  const activeTaskId = () => activeTask(activeTabs(), sessions.currentSessionID(), activePendingId())
  const closeActiveTab = () => {
    if (sidePanel() === SidePanel.Subagents && subagents.active()) {
      subagents.close(subagents.active()!)
      return
    }
    if (sidePanel() === SidePanel.Terminal && terms.sideFocusedId()) {
      if (sideCtl.close()) return
    }
    if (termHandlers.closeFocused()) {
      tabFocus.restore()
      return
    }
    if (termHandlers.closeActive()) {
      tabFocus.restore()
      return
    }
    if (reviewActive()) {
      closeReviewTab()
      return
    }
    const list = activeTabs()
    if (list.length === 0) {
      closeSelectedWorktree()
      return
    }
    const target = activeTaskId()
    if (target) handleCloseTab(target)
  }
  const closeSelectedWorktree = () => {
    const sel = selection()
    const project = activeProjectId()
    if (!project || project !== currentProjectId() || !sel || sel === LOCAL) return
    expandSidebar()
    confirmDelete?.(project, sel)
  }
  const renderTabById = (id: string) =>
    renderTab(id, {
      terms,
      REVIEW_TAB_ID,
      tabIds,
      kb,
      reviewActive,
      currentSessionID: () => sessions.currentSessionID(),
      activePendingId,
      visibleTabId,
      isPending,
      activityFor: (sessionID) => sessions.activityFor(sessionID),
      stateLabel: (state) => t(`session.activity.${state}`),
      tabLookup,
      adjacentHint,
      activateTerminal: termHandlers.activate,
      deactivateTerminal: termHandlers.deactivate,
      closeTerminal: (terminalID) => tabFocus.run(() => termHandlers.closeTerminal(terminalID)),
      terminalMiddleClick: (terminalID, event) =>
        tabFocus.middle(event, () => termHandlers.middleClick(terminalID, event)),
      closeReview: closeReviewTab,
      reviewMiddleClick: handleReviewTabMouseDown,
      selectReviewTab: () => setReviewActive(true),
      selectSessionTab,
      sessionMiddleClick: handleTabMouseDown,
      sessionClose: handleCloseTab,
      sessionFork: handleForkSession,
      ...tabState.tab,
      onTabKey: tabFocus.key,
      reviewLabel: t("session.tab.review"),
      reviewTooltip: t("command.review.toggle"),
    })
  const renderAddTab = () =>
    renderNewTabButton({
      contextSelected: () => selection() !== null,
      kb,
      newSessionLabel: t("agentManager.session.new"),
      newTerminalLabel: t("agentManager.terminal.new"),
      newSessionMenuLabel: t("agentManager.session.newSession"),
      moreOptionsLabel: t("agentManager.tab.newOptions"),
      onNewSession: handleAddSession,
      onNewTerminal: () => termHandlers.requestNew(),
    })
  const handleAddSession = () => {
    if (settingUpSelection()) return
    expandSidebar()
    const sel = selection()
    if (sel === LOCAL) {
      addPendingTab()
      return
    }
    if (!sel) return
    terms.setActiveId(undefined)
    to({ type: "agentManager.addSessionToWorktree", worktreeId: sel })
  }
  const selectChatSession = (id: string) => {
    if (addSessionToCurrentWorktree(id)) return
    if (localSessionIDs().includes(id)) {
      sessions.selectSession(id)
      if (selection() === null) setSelection(LOCAL)
      requestChatFocus()
      return
    }
    if (!worktreeSessionIds().has(id)) return openLocally(id)
    const worktree = managedSessions().find((entry) => entry.id === id)?.worktreeId
    if (!worktree) return openLocally(id)
    selectWorktree(worktree)
    sessions.selectSession(id)
    setReviewActive(false)
    requestChatFocus()
  }
  const openLocally = (sid: string) => {
    if (!canOpenRootSession(sid, sessions.sessions())) return
    saveTabMemory()
    expandSidebar()
    const pending = activePendingId()
    placeLocal(sid, pending, pending ?? sessions.currentSessionID())
    setSelection(LOCAL)
    setReviewActive(false)
    sessions.selectSession(sid)
    requestChatFocus()
    to({ type: "agentManager.openLocally", sessionId: sid })
  }
  const hints = createShortcutHints({
    kb,
    selection,
    registry,
    activePR,
    nav: () => buildProjectNavEntries(projectList(), projectStates()),
  })
  const intro = createIntro({
    hints: hints.list,
    base: repoDefaultBranch,
    git: isGitRepo,
    onCreateWorktree: () => showNewWorktreeDialog(),
    onSelectSession: selectChatSession,
    onShowHistory: () => openHistory(),
    reveal: () => {
      const id = sessions.currentSessionID() ?? activePendingId()
      if (!id || sessions.messages(id).length || sessions.loading(id) || readOnly() || settingUpSelection()) {
        selectLocal()
        addPendingTab()
      }
      closeHistory()
      terms.setActiveId(undefined)
      setReviewActive(false)
    },
    focus: () => requestChatFocus(),
  })
  const historyRowActions = historyRowActionsFactory({
    t,
    onPromote: (sessionId) => {
      closeHistory()
      to({ type: "agentManager.promoteSession", sessionId })
    },
    onLocal: (sessionId) => {
      const pid = historyProject()
      if (pid) to({ type: "agentManager.openSessionLocally", projectId: pid, sessionId })
      else openLocally(sessionId)
      closeHistory()
    },
  })
  const diffCtx = createMemo(() => selection() ?? undefined)
  const activeDiffSession = createMemo(() => {
    const sel = selection()
    if (!sel) return undefined
    const current = sessions.currentSessionID()
    if (sel === LOCAL) {
      if (current && localSessionIDs().includes(current) && !isPending(current)) return current
      return localSessionIDs().find((id) => !isPending(id))
    }
    if (current) {
      const item = managedSessions().find((entry) => entry.id === current)
      if (item?.worktreeId === sel) return current
    }
    return managedSessions().find((entry) => entry.worktreeId === sel)?.id
  })
  const review = createDiffReviewScope({
    ctx: diffCtx,
    key: () => diffCtx() && diffDataKey(currentProjectId(), diffCtx()!),
    session: activeDiffSession,
    panelOpen: diffOpen,
    reviewActive,
    vscode,
    project: activeProjectId,
  })
  const diffScopeId = review.id
  const openTurnChanges = (sessionID: string, turnID: string) => {
    if (activeDiffSession() !== sessionID) return
    closeHistory()
    setReviewActive(false)
    review.openTurn(turnID)
    panels.open(SidePanel.Diff)
  }
  const reviewComments = createMemo(() => {
    const key = diffScopeId()
    if (!key) return [] as ReviewComment[]
    return readReviewComments(reviewCommentsByContext(), currentProjectId() ?? "single", key)
  })
  const setReviewCommentsForSelection = (value: ReviewComment[]) => {
    const key = diffScopeId()
    if (!key) return
    setReviewCommentsByContext((prev) => setReviewComments(prev, currentProjectId() ?? "single", key, value))
  }
  const diffScopeControls = (compact: boolean) => <DiffScopeControls {...review.controls()} compact={compact} />
  const remote = createPRReview({
    context: diffCtx,
    project: activeProjectId,
    current: () => sessions.currentSessionID() ?? activePendingId(),
    sessions: sessions.sessions,
    managed: managedSessions,
    statuses: prStatuses,
    select: review.select,
    show: () => {
      closeHistory()
      setReviewActive(false)
      panels.open(SidePanel.Diff)
    },
  })
  const prDiffComments = createPRDiffCommentState({
    post: to,
    onMessage: onHostMessage,
    project: activeProjectId,
    statuses: prStatuses,
  })
  createEffect(() => {
    const ctx = diffCtx()
    if (!ctx || (!diffOpen() && !reviewActive())) return
    prDiffComments.load(ctx)
  })
  createEffect(() => {
    const panelOpen = diffOpen()
    const active = reviewActive()
    const id = review.id()
    if ((panelOpen || active) && id) {
      untrack(() => diffs.retain(id))
      to({ type: "agentManager.startDiffWatch", projectId: activeProjectId(), ...wireDiffId(id) })
      return
    }
    setDiffLoading(false)
    to({ type: "agentManager.stopDiffWatch", projectId: activeProjectId() })
  })
  onCleanup(() => {
    if (diffOpen() || reviewActive()) to({ type: "agentManager.stopDiffWatch", projectId: activeProjectId() })
  })
  const openReviewTab = () => {
    const sel = selection()
    if (sel === null) return
    terms.setActiveId(undefined)
    setReviewOpenForContext(sel, true)
    setReviewActive(true)
    diffPanels.focusReview()
  }
  const closeReviewTab = (focus = true) => {
    freezeTabs()
    setReviewActive(false)
    setReviewOpenForSelection(false)
    if (focus) tabFocus.restore()
  }
  const reviewDiffs = createMemo(() => {
    const key = diffScopeId()
    if (!key) return []
    return diffDatas()[diffDataKey(activeProjectId(), key)] ?? []
  })
  const diffNotice = createMemo(() => {
    const key = diffScopeId()
    if (!key) return undefined
    return diffNotices()[diffDataKey(activeProjectId(), key)]
  })
  const requestDiffFile = (file: string) => {
    const id = diffScopeId()
    if (!id) return
    diffs.requestDiffFile(id, file)
  }
  const diffFileLoadingForCurrent = createMemo(() => diffs.diffFileLoadingFor(diffScopeId))
  const diffLoadingForCurrent = createMemo(() => diffs.diffLoadingFor(diffScopeId))
  const revertCtl = createRevertFile(diffScopeId, diffCtx, () => review.scope(), vscode, showToast, t, activeProjectId)
  createEffect(() => diffOpen() && setDiffMounted(true))
  const handleShowKeyboardShortcuts = () => {
    const categories = buildShortcutCategories(kb(), t)
    dialog.show(() => <ShortcutsDialog title={t("agentManager.shortcuts.title")} categories={categories} />)
  }
  const loaded = () => worktreesLoaded() && sessionsLoaded()
  const handleCreateWorktree = () => {
    if (!loaded()) return
    expandSidebar()
    to({ type: "agentManager.createWorktree" })
  }
  const showNewWorktreeDialog = (projectId = activeProjectId()) => {
    if (!loaded()) return
    expandSidebar()
    const directory = directories.root(projectId)
    const store = directory ? panel.store(directory) : undefined
    if (!store) return
    dialog.show(() => (
      <V2Scope value={store}>
        <SpeechToTextStatusProvider>
          <NewWorktreeDialog
            mode={mode}
            onClose={() => dialog.close()}
            projectId={projectId}
            projects={projectList}
            activeProjectId={activeProjectId()}
            defaultBase={defaultBase}
            onCreate={creation.schedule}
            worktrees={dialogRefs}
            store={store}
            models={appSession.models()}
            providers={appSession.providers()}
            agents={appSession.agents()}
            commands={appSession.commands()}
            sessions={appSession.mentionSessions()}
          />
        </SpeechToTextStatusProvider>
      </V2Scope>
    ))
  }
  // The keyboard action updates the selected worktree in the session the user is reading, with its model and agent.
  const update = () => {
    const worktreeId = selection()
    if (!worktreeId || worktreeId === LOCAL) return updateBase(worktreeId, activeProjectId())
    const sessionId = sessions.currentSessionID()
    updateBase(
      worktreeId,
      activeProjectId(),
      baseUpdateTarget({
        worktreeId,
        session: sessionId ? sessions.get(sessionId) : undefined,
        managedSessions: managedSessions(),
      }),
    )
  }

  onMount(() => {
    const drafts = createNewTaskDrafts()
    const keys = bindAppKeys({
      handlers: {
        sessionPrevious: () => projectNav.step("up"),
        sessionNext: () => projectNav.step("down"),
        tabPrevious: () => document.hasFocus() && navigateTab("left"),
        tabNext: () => document.hasFocus() && navigateTab("right"),
        terminalPrevious: () => cycleTerminal("previous"),
        terminalNext: () => cycleTerminal("next"),
        search: () => {
          if (!sidebarCollapsed()) sidebarSearchMenu?.open()
          else {
            expandSidebar()
            requestAnimationFrame(() => sidebarSearchMenu?.open())
          }
        },
        showTerminal: () => sideCtl.openPreferred("keyboard_shortcut"),
        toggleDiff: () => diffPanels.toggleCommand(),
        newTab: handleNewTabForCurrentSelection,
        closeTask: () => closeFocusedTask(visibleTabId(), tabLookup(), handleCloseTab),
        closeAllTasks: () => closeAllTasks(activeTabs(), activeTaskId(), handleCloseTab),
        closeTab: closeActiveTab,
        newWorktree: showNewWorktreeDialog,
        quickWorktree: handleCreateWorktree,
        openWorktree: openWorktreeDirectory,
        updateFromBase: update,
        openPR: openSelectedPR,
        runScript: runSelected,
        advancedWorktree: showNewWorktreeDialog,
        closeWorktree: closeSelectedWorktree,
        showShortcuts: handleShowKeyboardShortcuts,
        focusInput: focusCtl.focus,
        focusSearch: () =>
          focusChatSearch({
            history: setHistory,
            review: setReviewActive,
            terminal: () => terms.setActiveId(undefined),
          }),
        newTerminalTab: termHandlers.requestNew,
        newSideTerminal: termHandlers.addSide,
        cycleAgentMode: () => {
          if (!mode.dispatch(1)) cycleAgent(1)
        },
        cyclePreviousAgentMode: () => {
          if (!mode.dispatch(-1)) cycleAgent(-1)
        },
        jump: (index) => projectNav.jump(index),
      },
      openHistory: () => openHistory(),
      press: (event) => sideCtl.press(event),
      isDiffFocusTarget: (target) => diffPanels.isFocusTarget(target),
      selection,
      closeWorktree: closeSelectedWorktree,
      setHeld,
      focusReport: focusCtl.report,
      restoreFocus,
      createDraft: (sel) => drafts.create(sel),
      setActiveTerminal: (id) => terms.setActiveId(id),
      postToWorktree: (worktreeId) => to({ type: "agentManager.addSessionToWorktree", worktreeId }),
      cleanupDrafts: drafts.cleanup,
    })
    const stopModifier = modifier.watch(window, isMac, setHeld)

    const subagent = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionID?: unknown; title?: unknown; parentSessionID?: unknown }>).detail
      if (typeof detail?.sessionID !== "string") return
      const parent = typeof detail.parentSessionID === "string" ? detail.parentSessionID : sessions.currentSessionID()
      if (parent && !ownsParentSession(projectStates(), parent, currentProjectId())) return
      subagents.open(detail.sessionID, typeof detail.title === "string" ? detail.title : undefined, parent)
    }
    window.addEventListener("agentManager.openSubagent", subagent)
    const documents = documentInspector.subscribe((message) => documentInspector.documents.onMessage(message))

    const terminalDispatch = createTerminalMessageHandler({
      state: terms,
      activate: termHandlers.activate,
      saveTabMemory,
      rememberSession: tabs.remember,
      setSelection: (value) => setSelection(value),
      showError: (description) =>
        showToast({ variant: "error", title: t("agentManager.terminal.errorTitle"), description }),
      postMessage: to,
      onCreated: (key, id, pid) => orders(pid ? () => registry.ensure(pid) : registry.active).append(key, id),
      onSideClosed: (_contextKey, terminalId) => forgetTerminalFocus(focusMemory, terminalId),
      onScriptRunning: (contextKey, terminalId) => {
        if (terms.sideKey() !== contextKey) return
        if (terms.scriptStatus(terminalId)?.kind === "setup") {
          ambientSetup.reveal(contextKey, terminalId)
          showSideTerminal()
          terms.setSideActive(contextKey, terminalId)
          return
        }
        showSideTerminal()
        terms.setSideActive(contextKey, terminalId)
        terms.requestFocus(terminalId)
      },
      onDestinationChanged: (destination) => sideCtl.syncDefault(destination),
    })

    const unsubscribe = vscode.onMessage((raw) => {
      const message = raw as unknown as ExtensionMessage
      clearFailedDelete(
        message as unknown as { type: string; code?: string; worktreeId?: string; projectId?: string },
        registry,
      )
      if (message.type === "agentManager.repoInfo") applyRepoInfo(message, setRepoBranches)
      if (message.type === "agentManager.terminal.fontChanged") setTerminalFont(message.font)
      terminalDispatch(message as unknown as Parameters<typeof terminalDispatch>[0])
      stateHandlers.projects(message)
      if (message.type === "agentManager.state") {
        preserveSidebarScroll(() => stateHandlers.state(message))
        return
      }
      if (message.type === "agentManager.worktreeSetup") {
        applySetupMessage(message, {
          setup,
          setSetup,
          creation,
          ensure: (pid) => registry.ensure(pid),
          active: () => registry.active(),
          currentProjectId,
          selection,
          isActivePayload,
          setSelection: (id) => setSelection(id),
          setReviewActive,
          selectSession: (id) => sessions.selectSession(id),
          managedSessions,
          evictLocal,
          requestChatFocus,
        })
        applyMultiVersionReady(message as AgentManagerWorktreeSetupMessage, {
          ensure: (pid) => registry.ensure(pid),
          active: () => registry.active(),
        })
        return
      }
      if (message.type === "agentManager.importResult") {
        applyImportResult(message, (pid) => creation.abandon(pid))
        return
      }
      if (message.type === "agentManager.sessionAdded") {
        applySessionAdded(message, {
          currentProjectId,
          saveTabMemory,
          appendOrder: appendToTabOrder,
          setSelection: (id) => setSelection(id),
          evictLocal,
          applyDraft: (worktreeId, sessionId) => drafts.apply(worktreeId, sessionId),
          selectSession: (id) => sessions.selectSession(id),
          requestChatFocus,
        })
        return
      }
      if (message.type === "agentManager.sessionForked") {
        applySessionForked(message, {
          currentProjectId,
          insertAfter: tabOrderSync.insertAfter,
          setLocal: setLocalSessionIDs,
          persist: (sessionId) => to({ type: "agentManager.persistSession", sessionId }),
          saveTabMemory,
          setSelection: (id) => setSelection(id),
          evictLocal,
          selectSession: (id) => sessions.selectSession(id),
          requestChatFocus,
        })
        return
      }
      if (message.type === "agentManager.keybindings") {
        applyKeybindings(message, setKb)
        return
      }
      if (message.type === "agentManager.focusContextRequested") {
        focusCtl.report()
        return
      }
      if (message.type === "agentManager.revealSession") {
        applyRevealSession(message, {
          currentProjectId,
          focusManaged: focusManagedSession,
          focusLocal: focusLocalSession,
        })
        return
      }
      if (message.type === "agentManager.multiVersionProgress") {
        applyMultiVersion(message, {
          creation,
          ensure: (pid) => registry.ensure(pid),
          active: () => registry.active(),
        })
        return
      }
      if (message.type === "agentManager.setSessionModel") {
        void appSession.switchModel(message.sessionId, message.providerID, message.modelID)
        return
      }
      if (message.type === "agentManager.sendInitialMessage") {
        applySendInitial(message, {
          sendInitial: appSession.sendInitial,
          clearBusy: (projectId, worktreeId) => {
            const store = projectId ? registry.ensure(projectId) : registry.active()
            store.setBusy((prev) => {
              const next = new Map(prev)
              next.delete(worktreeId)
              return next
            })
          },
        })
        return
      }
      if (message.type === "agentManager.sessionClosed") {
        if (isCurrent(message, currentProjectId())) handleCloseTab(message.sessionId, false)
        return
      }
      applyRunStatus(message, { ensure: (id) => registry.ensure(id), active: () => registry.active() })
      if (
        routeReview(message, currentProjectId, {
          diff: diffs.onWorktreeDiff,
          file: diffs.onWorktreeDiffFile,
          loading: diffs.onWorktreeDiffLoading,
          notice: diffs.onWorktreeDiffNotice,
          branches: review.onBranches,
          apply: apply.onApplyResult,
          revert: revertCtl.onResult,
        }) === "stale"
      )
        return
      applyProjectSelection(message, {
        active: (projectId) => activeProjectId() === projectId,
        applied: (projectId) => currentProjectId() === projectId,
        managed: (projectId) => projectStates()[projectId]?.sessions ?? projectLive.sessions()[projectId] ?? [],
        local: () => selectLocal(),
        worktree: (projectId, worktreeId) => selectWorktree(worktreeId),
        focusLocal: focusLocalSession,
        managedSession: focusManagedSession,
      })
      if (
        (String(message.type) === "error" || message.type === "agentManager.prError") &&
        reportFailure(message as unknown as Parameters<typeof reportFailure>[0], {
          toast: showToast,
          t,
          project: currentProjectId(),
        }) === "stale"
      )
        return
      projectLive.apply(message)
    })

    const reviewCommentsEvent = (event: Event) => {
      const detail = (event as CustomEvent<AppendReviewCommentsDetail>).detail
      const text = takeReviewCommentsForPrompt(detail)
      if (text === undefined) return
      appendToPrompt(text, detail.autoSend)
    }
    window.addEventListener(APPEND_REVIEW_COMMENTS, reviewCommentsEvent)
    // These host messages are shared with the sidebar protocol, not the Agent Manager message union.
    const context = vscode.onMessage((raw) => {
      const message = raw as unknown as ToWebview
      if (message.type === "appendContext") {
        composerQueue.push({ type: "attach", items: message.items })
        requestChatFocus(true)
        return
      }
      if (message.type !== "startPrompt") return
      composerQueue.push({ type: "submit", text: message.text, items: message.items ?? [] })
    })

    onCleanup(() => {
      keys()
      stopModifier()
      window.removeEventListener("agentManager.openSubagent", subagent)
      window.removeEventListener(APPEND_REVIEW_COMMENTS, reviewCommentsEvent)
      context()
      documents()
      unsubscribe()
    })
  })

  onMount(() => {
    selectLocal()
    to({ type: "agentManager.requestState" })
    to({ type: "agentManager.requestProjects" })
    if (localSessionIDs().length === 0) addPendingTab()
  })

  // A worktree selection names its directory. Local, and a session opened outside the catalog, read the store that
  // holds the session: the host does not tag every session with a worktree, and a session in another worktree
  // directory keeps updating and sends into that directory only from its own store.
  const chatStore = createMemo(() => {
    const sel = selection()
    if (sel && sel !== LOCAL) {
      const directory = directories.worktreePath(sel)
      return directory ? panel.store(directory) : undefined
    }
    const id = sessions.currentSessionID()
    const scoped = id && !isPending(id) ? sessions.scope(id) : undefined
    if (scoped) return scoped
    const directory = directories.root(currentProjectId())
    return directory ? panel.store(directory) : undefined
  })
  // The PR conflict fix runs in the visible session when it belongs to the PR's worktree, on that session's
  // model and agent; otherwise the host picks the session and the default model.
  const prBaseTarget = createMemo(() => {
    const worktreeId = activePR()?.selected
    if (!worktreeId) return undefined
    const sessionId = sessions.currentSessionID()
    return baseUpdateTarget({
      worktreeId,
      session: sessionId ? sessions.get(sessionId) : undefined,
      managedSessions: managedSessions(),
    })
  })

  const renderSidebar = () => (
    <div
      class="am-sidebar"
      classList={{ "am-sidebar-collapsed": sidebarCollapsed(), "am-show-shortcuts": held() }}
      style={{ width: sidebarCollapsed() ? "0px" : `${sidebarWidth()}px` }}
      inert={sidebarCollapsed() || undefined}
    >
      <ResizeHandle
        direction="horizontal"
        size={sidebarWidth()}
        min={MIN_SIDEBAR_WIDTH}
        max={9999}
        onResize={(width) => {
          pendingSidebarWidth = Math.min(width, window.innerWidth * MAX_SIDEBAR_WIDTH_RATIO)
          if (sidebarRaf === undefined) {
            sidebarRaf = requestAnimationFrame(() => {
              sidebarRaf = undefined
              setSidebarWidth(pendingSidebarWidth ?? sidebarWidth())
            })
          }
        }}
      />
      <ProjectList
        projects={projectList()}
        states={projectStates()}
        store={(id) => registry.ensure(id)}
        busy={(projectId, id) => registry.ensure(projectId).busy().has(id)}
        blocked={(projectId, id) => activity.blocked(id, projectId)}
        stats={projectLive.stats()}
        local={projectLive.local()}
        prs={projectLive.prs()}
        sessions={projectSessionsLive()}
        selectedProject={activeProjectId()}
        selection={selection() ?? undefined}
        currentSessionID={() => sessions.currentSessionID()}
        mode={mode}
        defaultBase={defaultBase}
        onCreate={creation.schedule}
        onSelect={activateSelection}
        onOpenComments={(projectId, worktreeId) => comments.open({ projectId, worktreeId })}
        onOpenPR={(projectId, worktreeId) => comments.open({ projectId, worktreeId })}
        bindings={kb()}
        t={t}
        onSearchRef={(ref) => (sidebarSearchMenu = ref)}
        onDeleteRef={(confirm) => (confirmDelete = confirm)}
        onDelete={(projectId, worktreeId) => forgetContextFocus(`${projectId}:${worktreeId}`)}
        onNewWorktree={showNewWorktreeDialog}
        onShortcuts={handleShowKeyboardShortcuts}
        onHistory={openHistory}
        shortcutMap={projectShortcutMap}
        activityFor={activity.project}
        sessionActivity={sessions.activityFor}
      />
    </div>
  )

  const historyView = () => (
    <HistoryView
      sessions={historyList}
      store={sessions.scope}
      sessionIds={historySessionIds}
      worktreeSessionIds={historyProject() ? undefined : activeWorktreeSessionIds}
      onSelectSession={(id) => {
        if (addSessionToCurrentWorktree(id)) return
        closeHistory()
        if (localSessionIDs().includes(id)) {
          saveTabMemory()
          sessions.selectSession(id)
          setSelection(LOCAL)
          requestChatFocus(true)
          return true
        }
        const managed = worktreeSessionIds().has(id) ? managedSessions().find((entry) => entry.id === id) : undefined
        if (managed?.worktreeId) {
          selectWorktree(managed.worktreeId)
          sessions.selectSession(id)
          setReviewActive(false)
          requestChatFocus()
          return true
        }
        openLocally(id)
        return true
      }}
      onBack={closeHistory}
      rowActions={historyRowActions}
    />
  )
  // The list reads the host catalog, not the project root store, so history opens before that store resolves.
  const renderHistory = () => <Show when={!restricted() && history()}>{historyView()}</Show>

  const renderMain = () => (
    <div class={`am-main-pane ${terms.activeId() ? "am-main-pane-terminal-active" : ""}`}>
      {renderTerminalLayer({ state: terms, onFocusPrompt: focusCtl.focus, onFocusChange: focusCtl.report })}
      <Show when={contextEmpty()}>
        <div class="am-empty-state">
          <Show
            when={!settingUpSelection()}
            fallback={
              <>
                <Spinner class="am-setup-spinner" />
                <div class="am-empty-state-text">
                  {settingUpSelection()?.message ?? t("agentManager.setup.settingUp")}
                </div>
              </>
            }
          >
            <div class="am-empty-state-icon">
              <Icon name="branch" size="large" />
            </div>
            <div class="am-empty-state-text">{t("agentManager.session.noSessions")}</div>
            <Button variant="primary" size="small" onClick={handleAddSession}>
              {t("agentManager.session.new")}
              <span class="am-shortcut-hint">{kb().newTab ?? ""}</span>
            </Button>
          </Show>
        </div>
      </Show>
      <div class="am-chat-wrapper" classList={{ "am-chat-wrapper-hidden": contextEmpty() }}>
        <Show
          when={chatStore()}
          keyed
          fallback={
            <Show when={appSession.rootStore()} keyed fallback={intro.render()}>
              {(store) => <V2Scope value={store}>{intro.render()}</V2Scope>}
            </Show>
          }
        >
          {(store) => (
            <V2Scope value={store}>
              <SpeechToTextStatusProvider>
                <SessionView
                  session={
                    sessions.currentSessionID() && !isPending(sessions.currentSessionID()!)
                      ? sessions.currentSessionID()
                      : undefined
                  }
                  draftKey={sessions.currentSessionID() ?? activePendingId()}
                  readOnly={readOnly()}
                  onSession={handleSessionCreated}
                  actions={toolActions}
                  onShowHistory={() => openHistory()}
                  empty={intro.render}
                  onAppendReady={(append) => (promptAppend = append)}
                  onComposerReady={composerQueue.ready}
                  onPreviewEdit={(files, sessionID) => previewEdit(files, sessionID)}
                  onViewTurnChanges={openTurnChanges}
                  onForkSession={handleForkSession}
                  onForkMessage={handleForkSession}
                  onMissing={(id) => handleCloseTab(id)}
                  onPrompted={(sessionId, text, model) =>
                    to({
                      type: "agentManager.promptSent",
                      sessionId,
                      text,
                      providerID: model?.providerID,
                      modelID: model?.id,
                    })
                  }
                />
              </SpeechToTextStatusProvider>
            </V2Scope>
          )}
        </Show>
        <Show when={readOnly()}>
          <div class="am-readonly-banner">
            <Icon name="branch" size="small" />
            <span class="am-readonly-text">{t("agentManager.session.readonly")}</span>
            <Button
              variant="secondary"
              size="small"
              onClick={() => {
                const sid = sessions.currentSessionID()
                if (sid) openLocally(sid)
              }}
            >
              {t("agentManager.session.openLocally")}
            </Button>
            <Button
              variant="primary"
              size="small"
              onClick={() => {
                const sid = sessions.currentSessionID()
                if (sid) to({ type: "agentManager.promoteSession", sessionId: sid })
              }}
            >
              {t("agentManager.session.openInWorktree")}
            </Button>
          </div>
        </Show>
      </div>
    </div>
  )

  const renderSideHost = () => (
    <Show when={sideHostVisible()}>
      <div
        class={`am-diff-resize ${sidePanel() === null ? "am-side-host-hidden" : ""}`}
        style={{ width: `${panelWidth()}px` }}
        inert={sidePanel() === null}
      >
        <Show when={sidePanel() !== null}>
          <ResizeHandle
            direction="horizontal"
            edge="start"
            size={panelWidth()}
            min={minPanelWidth(window.innerWidth)}
            max={maxPanelWidth(window.innerWidth)}
            onResize={resizeSide}
          />
        </Show>
        <div class="am-diff-panel-wrapper">
          <DiffPanelCache
            current={diffScopeId}
            context={diffCtx}
            project={activeProjectId}
            active={() => diffOpen() && !history() && !reviewActive()}
            data={diffDatas}
            loading={(key) => diffs.diffLoadingFor(() => key)}
            loadingFiles={(key) => diffs.diffFileLoadingFor(() => key)}
            notice={(key) => diffNotices()[diffDataKey(activeProjectId(), key)]}
            comments={(key) => readReviewComments(reviewCommentsByContext(), currentProjectId() ?? "single", key)}
            setComments={(key, value) =>
              setReviewCommentsByContext((prev) => setReviewComments(prev, currentProjectId() ?? "single", key, value))
            }
            remoteComments={remote.comments}
            remoteTarget={remote.target}
            prTarget={prDiffComments.target}
            prSnapshot={prDiffComments.snapshot}
            prLoading={prDiffComments.loading}
            prError={prDiffComments.error}
            focusedComment={remote.focus}
            composer={composers.get}
            lead={() => diffScopeControls(true)}
            canRevert={scopeCapabilities(review.scope()).revert}
            diffStyle={diffStyle()}
            onDiffStyleChange={setSharedDiffStyle}
            markdownRender={markdown.render()}
            onMarkdownRenderChange={markdown.update}
            onSendClick={() => {}}
            onClose={diffPanels.closePanel}
            onExpand={selection() !== null ? openReviewTab : undefined}
            onRequestDiff={diffs.requestDiffFile}
            onOpenFile={(ctx: string, file: string, line?: number) =>
              to({ type: "agentManager.openFile", sessionId: ctx, filePath: file, line })
            }
            onOpenDocument={(file: string) => documentInspector.open(file)}
            onRevertFile={(key, ctx, file) => revertCtl.revertFor(key, ctx, review.scope(), file)}
            revertingFiles={revertCtl.revertingFor}
            activeTerminalId={terms.activeId()}
            contexts={() => new Set(worktrees().map((wt) => wt.id))}
            onEvict={(key) => composers.drop(key)}
          />
          <Show when={sidePanel() === SidePanel.PR && activePR()}>
            <PRPanelHost
              pr={activePR()!.pr}
              projectId={activeProjectId()}
              worktree={activePR()!.wt}
              worktreeId={activePR()!.selected}
              activeTerminalId={terms.activeId()}
              sessionId={activeDiffSession()}
              baseTarget={prBaseTarget()}
              onOpenDiff={remote.open}
              jump={comments.jump()}
              onJump={comments.complete}
              onClose={() => panels.close(SidePanel.PR)}
            />
          </Show>
          <Show when={subagents.tabs().length > 0}>
            <SubagentPanel
              sessions={sessions}
              tabs={subagents.tabs}
              active={subagents.active}
              visible={() => sidePanel() === SidePanel.Subagents}
              nextKeybind={kb().nextTab ?? ""}
              closeKeybind={kb().closeTab ?? ""}
              actions={toolActions}
              onSelect={subagents.select}
              onClose={subagents.close}
              onCloseOthers={subagents.closeOthers}
              onReorder={subagents.reorder}
              onClosePanel={() => panels.close(SidePanel.Subagents)}
              onShowHistory={() => openHistory()}
            />
          </Show>
          <Show when={editPreview.preview()}>
            <EditPreviewPanel state={editPreview} visible={() => sidePanel() === SidePanel.EditPreview} />
          </Show>
          <DocumentPanelHost
            inspector={documentInspector}
            onClosePanel={() => panels.close(SidePanel.Documents)}
            onSendAll={focusCtl.focus}
            activeTerminalId={terms.activeId()}
            visible={() => sidePanel() === SidePanel.Documents}
          />
          <SideTerminalPanel
            state={terms}
            contextKey={terms.sideKey}
            visible={() => sidePanel() === SidePanel.Terminal}
            nextKeybind={kb().nextTerminal ?? ""}
            closeKeybind={kb().closeTab ?? ""}
            onFocusPrompt={focusCtl.focus}
            onFocusChange={focusCtl.report}
            onSelect={(id) => termHandlers.selectSide(id)}
            onClose={(id) => {
              cancelAmbientSetup()
              termHandlers.closeSide(id)
            }}
            onCloseOthers={(id) => {
              cancelAmbientSetup()
              termHandlers.closeSideOthers(id)
            }}
            onStart={() => {
              cancelAmbientSetup()
              termHandlers.addSide()
            }}
            onStop={(id) => {
              cancelAmbientSetup()
              termHandlers.stopSide(id)
            }}
          />
        </div>
      </div>
    </Show>
  )

  const renderReview = () => (
    <Show when={reviewOpen()}>
      <div class="am-review-host" style={{ display: reviewActive() && !terms.activeId() ? undefined : "none" }}>
        <FullScreenDiffView
          diffs={reviewDiffs()}
          loading={diffLoadingForCurrent()}
          loadingFiles={diffFileLoadingForCurrent()}
          sessionId={activeDiffSession()}
          sessionKey={`${activeProjectId() ?? "single"}\0${diffScopeId() ?? ""}`}
          projectId={activeProjectId()}
          worktreeId={diffCtx()}
          prTarget={prDiffComments.target(diffCtx())}
          prSnapshot={prDiffComments.snapshot(diffCtx())}
          prLoading={prDiffComments.loading(diffCtx())}
          prError={prDiffComments.error(diffCtx())}
          notice={diffNotice()}
          lead={diffScopeControls(false)}
          canRevert={scopeCapabilities(review.scope()).revert}
          canComment={scopeCapabilities(review.scope()).comments}
          comments={reviewComments()}
          remoteComments={remote.comments()}
          remoteTarget={(comment: PRComment) => remote.target(diffCtx(), comment)}
          focusedComment={reviewActive() ? remote.focus(diffScopeId()) : undefined}
          onCommentsChange={setReviewCommentsForSelection}
          composer={composers.get(`${activeProjectId() ?? "single"}\0${diffScopeId() ?? ""}`)}
          onSendAll={closeReviewTab}
          diffStyle={diffStyle()}
          onDiffStyleChange={setSharedDiffStyle}
          markdownRender={markdown.render()}
          onMarkdownRenderChange={markdown.update}
          onRequestDiff={requestDiffFile}
          onOpenFile={(file: string, line?: number) => {
            const id = diffCtx()
            if (id) to({ type: "agentManager.openFile", sessionId: id, filePath: file, line })
          }}
          onRevertFile={revertCtl.revert}
          revertingFiles={revertCtl.reverting()}
          activeTerminalId={terms.activeId()}
          onClose={() => closeReviewTab()}
        />
      </div>
    </Show>
  )

  const renderDetail = () => (
    <div class="am-detail">
      <TabBar
        t={t}
        bindings={kb}
        selection={selection}
        empty={() => restricted() || contextEmpty()}
        collapsed={sidebarCollapsed()}
        onToggleSidebar={toggleSidebar}
        scroll={tabScroll}
        ids={tabIds}
        renderTab={renderTabById}
        newTab={renderAddTab}
        onDragStart={drag.start}
        onDragEnd={drag.end}
        onDragOver={drag.over}
        onRelease={releaseTabs}
        overlay={drag.overlay}
        localStats={localStats}
        worktreeStats={worktreeStats}
        applyState={apply.applyStateForSelection}
        reviewScope={review.scope}
        onApply={openApplyDialog}
        onOpen={openWorktreeDirectory}
        runStatuses={runStatuses}
        runConfigured={runScriptConfigured}
        onRun={(id) => runWorktree(id, sideCtl.destination())}
        onConfigureRun={configureRunScript}
        diffOpen={diffOpen}
        reviewActive={reviewActive}
        onToggleDiff={diffPanels.toggleToolbar}
        browserOpen={() => false}
        browserAutomation={() => false}
        onToggleBrowser={() => undefined}
        prStatus={() => activePR()?.pr}
        prOpen={prOpen}
        onTogglePR={togglePRPanel}
        documentsOpen={documentInspector.isOpen}
        documentsAvailable={documentInspector.available}
        onToggleDocuments={documentInspector.toggle}
        subagentsAvailable={() => subagentCtl.tabs.tabs().length > 0 || subagentCtl.toolbar.available().length > 0}
        subagentsOpen={() => sidePanel() === SidePanel.Subagents}
        onToggleSubagents={subagentCtl.toolbar.toggle}
        terminalDestination={sideCtl.destination}
        terminalDestinationActive={() => sidePanel() === SidePanel.Terminal}
        terminalKeybind={() => kb().showTerminal ?? ""}
        onTerminalDestinationOpen={() => {
          cancelAmbientSetup()
          sideCtl.openPreferred("tab_toolbar")
        }}
        onTerminalDestinationChoose={sideCtl.choose}
      />

      <Show when={restricted()}>
        <div class="am-empty-state am-restricted-state" role="status">
          <div class="am-empty-state-text">{t("agentManager.project.restricted")}</div>
        </div>
      </Show>

      <Show when={overlay()}>
        {(state) => (
          <div class="am-setup-overlay">
            <div class="am-setup-card">
              <Icon name="branch" size="large" />
              <div class="am-setup-title">
                {state().error ? t("agentManager.setup.failed") : t("agentManager.setup.settingUp")}
              </div>
              <Show when={state().branch}>
                <div class="am-setup-branch">{state().branch}</div>
              </Show>
              <div class="am-setup-status">
                <Show when={!state().error} fallback={<Icon name="circle-x" size="small" />}>
                  <Spinner class="am-setup-spinner" />
                </Show>
                <span>{state().errorCode ? t(`agentManager.setup.error.${state().errorCode}`) : state().message}</span>
              </div>
            </div>
          </div>
        )}
      </Show>

      {renderHistory()}
      <Show when={!restricted() && showDetailStack()}>
        <div class={`am-detail-stack ${history() ? "am-detail-stack-hidden" : ""}`} inert={history()}>
          <div
            class={`am-detail-content ${sidePanel() !== null ? "am-detail-split" : ""} ${reviewActive() ? "am-detail-content-hidden" : ""}`}
          >
            {renderMain()}
            {renderSideHost()}
          </div>
          {renderReview()}
        </div>
      </Show>
    </div>
  )

  return (
    <div
      class="am-layout"
      classList={{ "am-layout-hydrated": sidebar.hydrated() }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {renderSidebar()}
      {renderDetail()}
    </div>
  )
}

export const AgentManagerApp: Component = () => <AgentManagerContent />
