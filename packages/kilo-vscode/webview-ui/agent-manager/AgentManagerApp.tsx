/** @jsxImportSource solid-js */

import {
  For,
  Show,
  createSignal,
  createMemo,
  createEffect,
  on,
  onMount,
  onCleanup,
  type Component,
  type JSX,
  type Setter,
} from "solid-js"
import type {
  AgentManagerRepoInfoMessage,
  AgentManagerWorktreeSetupMessage,
  AgentManagerStateMessage,
  ExtensionMessage,
  AgentManagerKeybindingsMessage,
  AgentManagerMultiVersionProgressMessage,
  AgentManagerSendInitialMessage,
  AgentManagerBranchesMessage,
  AgentManagerWorktreeDiffMessage,
  AgentManagerWorktreeDiffFileMessage,
  AgentManagerWorktreeDiffLoadingMessage,
  AgentManagerWorktreeDiffNoticeMessage,
  AgentManagerDiffBranchesMessage,
  AgentManagerApplyWorktreeDiffResultMessage,
  AgentManagerWorktreeStatsMessage,
  AgentManagerLocalStatsMessage,
  WorktreeFileDiff,
  WorktreeGitStats,
  LocalGitStats,
  WorktreeState,
  RunStatus,
  PRStatus,
  AgentManagerPRStatusMessage,
  AgentManagerProjectsMessage,
  AgentProjectSnapshot,
  ManagedSessionState,
  SectionState,
  SessionInfo,
  SessionCreatedMessage,
  BranchInfo,
  TerminalDestination,
} from "../src/types/messages"
import { IndexingProvider } from "../src/context/indexing"
import {} from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { showToast } from "@kilocode/kilo-ui/toast"
import { ResizeHandle } from "@kilocode/kilo-ui/resize-handle"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip, TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { Popover } from "@kilocode/kilo-ui/popover"
import { VSCodeProvider, useVSCode } from "../src/context/vscode"
import { ServerProvider } from "../src/context/server"
import { ProviderProvider } from "../src/context/provider"
import { ConfigProvider } from "../src/context/config"
import { DisplayProvider } from "../src/context/display"
import { KiloEmbeddingModelsProvider } from "../src/context/kilo-embedding-models"
import { ImageModelsProvider } from "../src/context/image-models"
import { NotificationsProvider } from "../src/context/notifications"
import { FeedbackProvider } from "../src/context/feedback"
import { MemoryProvider } from "../src/context/memory"
import { SessionProvider, useSession } from "../src/context/session"
import { AgentRequirementsProvider } from "../src/context/agent-requirements"
import { WorktreeModeProvider } from "../src/context/worktree-mode"
import { ProviderShell } from "../src/context/provider-shell"
import { ChatView } from "../src/components/chat"
import HistoryView from "../src/components/history/HistoryView"
import { NewWorktreeDialog } from "./NewWorktreeDialog"
import { createModeRouter } from "./mode-router"
import { ProjectList } from "./ProjectList"
import { SidebarBody } from "./SidebarBody"
import { TabBar } from "./TabBar"
import { createProjectLive } from "./project/live"
import { createProjectSessionsLive } from "./project/sessions-live"
import { applyProjectSelection, createTargetRememberer } from "./project/selection"
import { createLocalSessions, persistLocalTabs } from "./project/local-tabs"
import { createProjectRegistry, type PersistedProjectTabs } from "./project/registry"
import type { WorktreeBusyState } from "./project/store"
import { rememberTarget, restoreProjectTarget } from "./project/restore"
import { createProjectStateRouter } from "./project/state"
import { applyRunStatus } from "./project/run-status"
import { clearMultiVersionBusy, markMultiVersionBusy } from "./project/progress"
import { selectLocalAction, selectWorktreeAction } from "./selection-actions"
import { DataBridge } from "../src/App"
import { LanguageBridge } from "../src/context/language-bridge"
import { useLanguage } from "../src/context/language"
import { createTabFocus } from "../src/utils/tab-navigation"
import {
  canOpenRootSession,
  isKnownRootSession,
  nextSelectionAfterDelete,
  adjacentHint,
  filterUnassignedSessions,
  focusChatSearch,
  LOCAL,
} from "./navigate"
import { buildProjectNavEntries, createProjectNav } from "./project-nav"
import {
  addPendingTab as addLocalPendingTab,
  nextTabAfterClose,
  openSessionTab,
  reconcileTrackedTabs,
  replacePendingTab,
  restoreTrackedTabs,
  trackedSessionInventory,
} from "../src/utils/local-tabs"
import {
  deletePendingDraft,
  discardPendingDraft,
  isPendingSend,
  promotePendingDraftDiscard,
} from "../src/utils/draft-store"
import { reorderTabs, applyTabOrder, firstOrderedTitle } from "./tab-order"
import { createTabOrderSync } from "./tab-order-sync"
import { reportRemoteSessions, reportVisibleSession, visible } from "./remote-sessions"
import { ConstrainDragYAxis } from "../src/components/chat/TabDnd"
import {
  SideTerminalPanel,
  TerminalDestinationButton,
  isTerminalTabId,
  createTerminalState,
  createTerminalHandlers,
  createTerminalMessageHandler,
  createSideTerminal,
  createAmbientSetup,
  hasSetupTerminal,
  showTerminalStack,
  readSavedDestination,
  resolveRunScriptRequest,
  resolveVscodeTerminalRequest,
} from "./terminal"
import { focusCurrentTab, renderTab, renderTerminalLayer, renderNewTabButton } from "./tab-rendering"
import { useTabScroll } from "./tab-scroll"
import { DiffPanel } from "./DiffPanel"
import { createRevertFile } from "./revert-file"
import { FullScreenDiffView } from "../diff-viewer/FullScreenDiffView"
import { createApplyToLocal } from "./apply-to-local"
import { createWorktreeDiffs, wireDiffId } from "./worktree-diffs"
import type { ReviewComment } from "../diff-viewer/review-comments"
import { clearReviewComposer, createReviewComposer } from "../diff-viewer/review-annotations"
import type { SidebarSearchMenuRef } from "./SidebarSearchMenu"
import { createSidebarSearch, type SidebarSearchItem } from "./sidebar-search"
import { BranchSelect } from "../src/components/shared/BranchSelect"
import { randomColor } from "./section-colors"
import { createNewTaskDrafts } from "./new-task-drafts"
import {
  buildTopLevelItems,
  buildSidebarOrder,
  buildShortcutMap,
  isGrouped,
  isGroupStart,
  isGroupEnd,
  sortWorktrees,
  type TopLevelItem,
} from "./section-helpers"
import {} from "./section-dnd"
import {} from "./constrain-drag-x"
import { mergeWorktreeDiffs } from "../diff-viewer/diff-state"
import { DiffScopeControls } from "../diff-viewer/DiffScopeControls"
import { scopeCapabilities } from "./diff-scope-state"
import { createDiffReviewScope } from "./diff-review-scope"
import { initialMessage, seedInitialVariant } from "./initial-message"
import { createMarkdownRender } from "./review-preferences"
import { createSidebarCollapse } from "./sidebar-collapse"
import { SidebarToggleButton } from "./SidebarToggleButton"
import { setTabWidths } from "./tab-widths"
import { clampPanelWidth, maxPanelWidth, minPanelWidth } from "./side-panel-layout"
import { buildShortcutCategories } from "./shortcuts"
import { tracker } from "./telemetry"
import { createChatFocus, hasQuestionOption } from "./focus"
import "./agent-manager.css"
import "./agent-manager-review.css"
import { cycleAgent as cycle } from "../src/context/session-agent"
const REVIEW_TAB_ID = "review"

interface SetupState {
  active: boolean
  message: string
  branch?: string
  error?: boolean
  worktreeId?: string
  errorCode?: string
}

/** Sidebar selection: LOCAL for local repo, worktree ID for a worktree, or null for an unassigned session. */
type SidebarSelection = typeof LOCAL | string | null
type SidePanel = "diff" | "pr" | "terminal" | null
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
// Fallback keybindings before extension sends resolved ones
const MAX_JUMP_INDEX = 9

const defaultBindings: Record<string, string> = {
  previousSession: isMac ? "⌘⌥↑" : "Ctrl+Alt+↑",
  nextSession: isMac ? "⌘⌥↓" : "Ctrl+Alt+↓",
  previousTab: isMac ? "⌘⌥←" : "Ctrl+Alt+←",
  nextTab: isMac ? "⌘⌥→" : "Ctrl+Alt+→",
  search: isMac ? "⌘F" : "Ctrl+F",
  showTerminal: isMac ? "⌘/" : "Ctrl+/",
  newTerminal: isMac ? "⌘⇧T" : "Ctrl+Shift+T",
  runScript: isMac ? "⌘E" : "Ctrl+E",
  toggleDiff: isMac ? "⌘D" : "Ctrl+D",
  showShortcuts: isMac ? "⌘⇧/" : "Ctrl+Shift+/",
  newTab: isMac ? "⌘T" : "Ctrl+T",
  closeTab: isMac ? "⌘W" : "Ctrl+W",
  newWorktree: isMac ? "⌘N" : "Ctrl+N",
  quickWorktree: isMac ? "⌘⇧N" : "Ctrl+Shift+N",
  closeWorktree: isMac ? "⌘⇧W" : "Ctrl+Shift+W",
  openWorktree: isMac ? "⌘⇧O" : "Ctrl+Shift+O",
  openPR: isMac ? "⌘⇧R" : "Ctrl+Shift+R",
  agentManagerOpen: isMac ? "⌘⇧M" : "Ctrl+Shift+M",
  cycleAgentMode: isMac ? "⌘." : "Ctrl+.",
  cyclePreviousAgentMode: isMac ? "⌘⇧." : "Ctrl+Shift+.",
  ...Object.fromEntries(
    Array.from({ length: MAX_JUMP_INDEX }, (_, i) => [`jumpTo${i + 1}`, isMac ? `⌘${i + 1}` : `Ctrl+${i + 1}`]),
  ),
}

import { parseBindingTokens } from "./keybind-tokens"

const AgentManagerContent: Component = () => {
  const { t } = useLanguage()
  const session = useSession()
  const vscode = useVSCode()
  const dialog = useDialog()
  const mode = createModeRouter()
  let sidebarSearchMenu: SidebarSearchMenuRef | undefined

  const [kb, setKb] = createSignal<Record<string, string>>(defaultBindings)

  const [setup, setSetup] = createSignal<SetupState>({ active: false, message: "" })
  const worktrees = () => registry.active().worktrees()
  const setWorktrees = (v: Parameters<Setter<WorktreeState[]>>[0]) => registry.active().setWorktrees(v)
  const managedSessions = () => registry.active().managedSessions()
  const setManagedSessions = (v: Parameters<Setter<ManagedSessionState[]>>[0]) =>
    registry.active().setManagedSessions(v)
  const [selection, setSelection] = createSignal<SidebarSelection>(LOCAL)
  const metrics = tracker(vscode)
  const [repoBranch, setRepoBranch] = createSignal<string | undefined>()
  const busyWorktrees = () => registry.active().busy()
  const setBusyWorktrees: Setter<Map<string, WorktreeBusyState>> = (v) => registry.active().setBusy(v)
  const staleWorktreeIds = () => registry.active().staleWorktreeIds()
  const setStaleWorktreeIds: Setter<Set<string>> = (v) => registry.active().setStaleWorktreeIds(v)
  /** True while the ⌘/Ctrl jump modifier is held — reveals the ⌘1-9 badges on all sidebar items. */
  const [held, setHeld] = createSignal(false)
  const [worktreesLoaded, setWorktreesLoaded] = createSignal(false)
  const [sessionsLoaded, setSessionsLoaded] = createSignal(false)
  const [isGitRepo, setIsGitRepo] = createSignal(true)
  const [repoDetectedBranch, setRepoDetectedBranch] = createSignal<string | undefined>()
  const defaultBaseBranch = () => registry.active().defaultBaseBranch()
  const setDefaultBaseBranch = (v: Parameters<Setter<string | undefined>>[0]) =>
    registry.active().setDefaultBaseBranch(v)
  const [projectList, setProjectList] = createSignal<AgentProjectSnapshot[]>([])
  const [multiProject, setMultiProject] = createSignal(false)
  const [currentProjectId, setCurrentProjectId] = createSignal<string | undefined>()
  const [projectStates, setProjectStates] = createSignal<Record<string, AgentManagerStateMessage>>({})
  const activeProjectId = () => projectList().find((p) => p.active)?.id ?? currentProjectId()
  const isActivePayload = (pid: string | undefined) =>
    projectList().length === 0 || pid === undefined || pid === activeProjectId()

  const repoDefaultBranch = () => defaultBaseBranch() ?? repoDetectedBranch() ?? "main"
  const hasConfiguredBranch = () => !!defaultBaseBranch()

  const DEFAULT_SIDEBAR_WIDTH = 260
  const MIN_SIDEBAR_WIDTH = 200
  const MAX_SIDEBAR_WIDTH_RATIO = 0.4

  // Recover persisted local session IDs from webview state
  const persisted = vscode.getState<PersistedProjectTabs & { sidebarWidth?: number; sidePanelWidth?: number }>()
  const registry = createProjectRegistry({
    persisted: persisted ?? {},
    activeId: () => currentProjectId() ?? "single",
  })
  const localSessionIDs = () => registry.active().tabs.ids()
  const setLocalSessionIDs = (next: string[] | ((prev: string[]) => string[])) => registry.active().tabs.set(next)
  /** Remove a session ID from the local tab (no-op if absent). */
  const evictLocal = (sid: string) =>
    setLocalSessionIDs((prev) => (prev.includes(sid) ? prev.filter((id) => id !== sid) : prev))
  const [sidebarWidth, setSidebarWidth] = createSignal(persisted?.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH)
  const sessionsCollapsed = () => registry.active().sessionsCollapsed() ?? true
  const setSessionsCollapsed = (v: Parameters<Setter<boolean>>[0]) =>
    registry.active().setSessionsCollapsed(typeof v === "function" ? v(sessionsCollapsed()) : v)
  const toggleSessions = () => {
    const collapsed = !sessionsCollapsed()
    setSessionsCollapsed(collapsed)
    vscode.postMessage({ type: "agentManager.setSessionsCollapsed", collapsed })
  }
  const sidebar = createSidebarCollapse(vscode)
  const sidebarCollapsed = sidebar.collapsed
  const expandSidebar = sidebar.expand
  const toggleSidebar = sidebar.toggle
  const sections = () => registry.active().sections()
  const setSections = (v: Parameters<Setter<SectionState[]>>[0]) => registry.active().setSections(v)

  // rAF coalescing for resize handlers — at most one signal write per frame
  let sidebarRaf: number | undefined
  let pendingSidebarWidth: number | undefined
  let sideRaf: number | undefined
  let pendingSideWidth: number | undefined

  const [history, setHistory] = createSignal(false)
  const [sidePanel, setSidePanel] = createSignal<SidePanel>(null)
  const diffOpen = () => sidePanel() === "diff"
  const diffs = createWorktreeDiffs(vscode)
  const diffDatas = diffs.diffDatas
  const diffLoading = diffs.diffLoading
  const setDiffLoading = diffs.setDiffLoading
  const diffNotices = diffs.diffNotices
  // Diff and terminal views share one inspector width, restored from webview
  // state so the user's divider position survives panel reloads.
  const [panelWidth, setPanelWidth] = createSignal(clampPanelWidth(persisted?.sidePanelWidth, window.innerWidth))
  const resizeSide = (width: number) => {
    pendingSideWidth = clampPanelWidth(width, window.innerWidth)
    if (sideRaf !== undefined) return
    sideRaf = requestAnimationFrame(() => {
      sideRaf = undefined
      setPanelWidth(pendingSideWidth!)
    })
  }
  const showSideTerminal = () => {
    setHistory(false)
    setReviewActive(false)
    setSidePanel("terminal")
  }

  const [reviewOpenByContext, setReviewOpenByContext] = createSignal<Record<string, boolean>>({})
  const [reviewCommentsByContext, setReviewCommentsByContext] = createSignal<Record<string, ReviewComment[]>>({})
  const reviewComposer = createReviewComposer()
  const [reviewActive, setReviewActive] = createSignal(false)
  const [reviewDiffStyle, setReviewDiffStyle] = createSignal<"unified" | "split">("unified")
  const markdown = createMarkdownRender(vscode)
  // Per-worktree git stats (diff additions/deletions, commits missing from origin)
  const worktreeStats = () => registry.active().worktreeStats()

  // Per-worktree PR status data
  const prStatuses = () => registry.active().prStatuses()

  const runStatuses = () => registry.active().runStatuses()
  const setRunStatuses: Setter<Record<string, RunStatus>> = (v) => registry.active().setRunStatuses(v)
  const runScriptConfigured = () => registry.active().runScriptConfigured()
  const setRunScriptConfigured = (v: Parameters<Setter<boolean>>[0]) => registry.active().setRunScriptConfigured(v)

  // Local repo git stats (branch name, diff additions/deletions, commits)
  const localStats = () => registry.active().localStats()

  const projectLive = createProjectLive({
    ensure: (pid) => (pid ? registry.ensure(pid) : registry.active()),
    active: isActivePayload,
    branch: (branch) => setRepoBranch(branch),
  })

  const PENDING_PREFIX = "pending:"
  const closedDrafts = new Set<string>()
  const [activePendingId, setActivePendingId] = createSignal<string | undefined>()

  /** Namespace key so worktree/local ids from different projects never collide. */
  const nsKey = (sel: string) => `${currentProjectId() ?? "single"}:${sel}`

  // Per-sidebar-context terminal state. `terms.activeId` holds the id of the focused
  // terminal tab, if any — takes precedence over session/pending/review when deriving
  // the visible tab. Contexts are project-keyed: every project reuses LOCAL and ids like "0".
  const terms = createTerminalState(() => {
    const sel = selection()
    return sel === null ? null : nsKey(sel)
  })
  const requestChatFocus = createChatFocus({
    term: () => terms.activeId(),
    history,
    review: reviewActive,
  })

  createEffect(
    on(
      () => {
        const id = session.currentSessionID()
        return `${id ?? ""}:${session
          .scopedQuestions(id)
          .map((question) => question.id)
          .join(",")}`
      },
      () => {
        requestChatFocus()
      },
      { defer: true },
    ),
  )

  type FocusOwner = "prompt" | { terminal: string }
  const focusMemory = new Map<string, FocusOwner>()
  const focusKey = () => {
    const context = terms.sideKey()
    const sessionID = session.currentSessionID() ?? activePendingId() ?? "new"
    return `${context}:${sessionID}`
  }
  const forgetSessionFocus = (sessionID: string) => {
    for (const key of focusMemory.keys()) if (key.endsWith(`:${sessionID}`)) focusMemory.delete(key)
  }
  const forgetContextFocus = (context: string) => {
    for (const key of focusMemory.keys()) if (key.startsWith(`${context}:`)) focusMemory.delete(key)
  }
  const forgetTerminalFocus = (terminalID: string) => {
    for (const [key, owner] of focusMemory) {
      if (owner !== "prompt" && owner.terminal === terminalID) focusMemory.delete(key)
    }
  }
  const rememberPromptFocus = (focused: boolean) => {
    if (focused) focusMemory.set(focusKey(), "prompt")
  }
  const terminalVisible = () => sidePanel() === "terminal" && !history() && !reviewActive()
  const focusOnDraftChange = () => {
    const key = focusKey()
    const owner = focusMemory.get(key)
    if (!owner || owner === "prompt") return true
    if (!terms.sidesForContext(terms.sideKey()).some((term) => term.id === owner.terminal)) {
      focusMemory.delete(key)
      return true
    }
    return terminalVisible() ? false : true
  }
  const restoreFocus = () => {
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
  // Ambient setup reveal restores the panel after success unless the user engaged.
  const ambientSetup = createAmbientSetup({
    terms,
    selection: () => {
      const sel = selection()
      return sel === null ? null : nsKey(sel)
    },
    sidePanel,
    setSidePanel,
  })
  const cancelAmbientSetup = ambientSetup.cancel

  // Inline delete confirmation: tracks which worktree is awaiting a second click/press
  const [pendingDelete, setPendingDelete] = createSignal<string | null>(null)
  let pendingDeleteTimer: ReturnType<typeof setTimeout> | undefined
  const cancelPendingDelete = () => {
    clearTimeout(pendingDeleteTimer)
    setPendingDelete(null)
  }
  createEffect(on(selection, () => cancelPendingDelete(), { defer: true }))
  createEffect(on(selection, () => clearReviewComposer(reviewComposer), { defer: true }))
  onCleanup(() => clearTimeout(pendingDeleteTimer))

  // Per-context tab memory lives in the active project's store: maps sidebar
  // selection ("local" or a worktree id) -> last active session/pending ID
  const tabMemory = () => registry.active().tabMemory.all()

  const reviewOpen = createMemo(() => {
    const sel = selection()
    if (sel === null) return false
    return reviewOpenByContext()[sel] === true
  })

  const setReviewOpenForContext = (context: string, open: boolean) => {
    setReviewOpenByContext((prev) => {
      if (prev[context] === open) return prev
      return { ...prev, [context]: open }
    })
  }

  const setReviewOpenForSelection = (open: boolean) => {
    const sel = selection()
    if (sel === null) return
    setReviewOpenForContext(sel, open)
  }

  const reviewComments = createMemo(() => {
    const sel = selection()
    if (sel === null) return [] as ReviewComment[]
    return reviewCommentsByContext()[sel] ?? []
  })

  const setReviewCommentsForSelection = (comments: ReviewComment[]) => {
    const sel = selection()
    if (sel === null) return
    setReviewCommentsByContext((prev) => ({ ...prev, [sel]: comments }))
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
    track: metrics.track,
  })
  const openApplyDialog = apply.openApplyDialog

  const openWorktreeDirectory = () => {
    const sel = selection()
    if (!sel || sel === LOCAL) return
    vscode.postMessage({ type: "agentManager.openWorktree", worktreeId: sel })
  }
  const openWindow = metrics.click("open_worktree_window", "tab_toolbar", openWorktreeDirectory)

  const openSelectedPR = () => {
    const sel = selection()
    if (!sel || sel === LOCAL || !prStatuses()[sel]) return
    metrics.track("open_pull_request", "keyboard_shortcut")
    vscode.postMessage({ type: "agentManager.openPR", worktreeId: sel })
  }

  const runWorktree = (id: string, destination: TerminalDestination) => {
    const state = runStatuses()[id]?.state ?? "idle"
    if (state === "running" || state === "stopping") {
      vscode.postMessage({ type: "agentManager.stopRunScript", worktreeId: id })
      return
    }
    vscode.postMessage(resolveRunScriptRequest(id, destination))
  }

  const configureRunScript = () => vscode.postMessage({ type: "agentManager.configureRunScript" })

  const runSelected = () => {
    const sel = selection()
    if (sel) runWorktree(sel, sideCtl.destination())
  }

  const isPending = (id: string) => id.startsWith(PENDING_PREFIX)
  reportRemoteSessions(vscode, localSessionIDs, managedSessions, isPending)

  // Drag-and-drop state for tab reordering
  const [draggingTab, setDraggingTab] = createSignal<string | undefined>()

  const freezeTabs = () => {
    const bar = document.querySelector(".am-tab-bar")
    if (bar instanceof HTMLElement && bar.matches(":hover")) setTabWidths(true)
  }

  const releaseTabs = () => setTabWidths(false)
  // Tab ordering: context key → ordered session ID array (recovered from extension state)
  const worktreeTabOrder = () => registry.active().tabOrder()
  const setWorktreeTabOrder: Setter<Record<string, string[]>> = (v) => registry.active().setTabOrder(v)
  // Sidebar worktree order (persisted to extension state)
  const sidebarWorktreeOrder = () => registry.active().worktreeOrder()
  const setSidebarWorktreeOrder = (v: Parameters<Setter<string[]>>[0]) => registry.active().setWorktreeOrder(v)
  const [draggingWorktree, setDraggingWorktree] = createSignal<string | undefined>()
  const [renamingSection, setRenamingSection] = createSignal<string | null>(null)
  let pendingNewSection = false

  // Pin new tabs at the tail (see tab-order-sync); strip ephemeral ids so agent-manager.json stays clean.
  const persistTabOrder = (key: string, order: string[]) => {
    const durable = order.filter((id) => id !== REVIEW_TAB_ID && !isTerminalTabId(id))
    vscode.postMessage({ type: "agentManager.setTabOrder", key, order: durable })
  }
  const tabOrderSync = createTabOrderSync({
    LOCAL,
    REVIEW_TAB_ID,
    order: worktreeTabOrder,
    setOrder: setWorktreeTabOrder,
    persist: persistTabOrder,
    localSessionIDs,
    sessions: session.sessions,
    managedSessions,
    reviewOpenByContext,
    terminalIdsFor: (key) => terms.forSelection(nsKey(key)).map((t) => t.id),
  })
  const appendToTabOrder = tabOrderSync.append

  const addPendingTab = () => {
    const id = `${PENDING_PREFIX}${crypto.randomUUID()}`
    const next = addLocalPendingTab({ ids: localSessionIDs(), active: activePendingId() }, id)
    setLocalSessionIDs(next.ids)
    appendToTabOrder(LOCAL, id)
    // Deactivate any focused terminal so the new pending session is visible.
    terms.setActiveId(undefined)
    setActivePendingId(id)
    session.clearCurrentSession()
    return id
  }

  const placeLocal = (id: string, pending: string | undefined, active: string | undefined) => {
    const next = pending
      ? replacePendingTab({ ids: localSessionIDs(), active }, pending, id)
      : openSessionTab({ ids: localSessionIDs(), active }, id)
    setLocalSessionIDs(next.ids)
    if (pending) tabOrderSync.replaceOrAppend(LOCAL, pending, id)
    if (!pending) tabOrderSync.append(LOCAL, id)
    if (pending && pending === active) setActivePendingId(undefined)
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

  // Save the currently active tab for the current sidebar context before switching away
  const saveTabMemory = () => {
    const sel = selection()
    if (sel === null) return
    const active = visibleTabId()
    if (active) registry.active().tabMemory.set(sel === LOCAL ? LOCAL : sel, active)
  }

  // Invalidate local session IDs if they no longer exist (preserve pending tabs)
  createEffect(() => {
    if (!worktreesLoaded()) return
    const all = session.sessions()
    if (all.length === 0) return // sessions not loaded yet
    const next = reconcileTrackedTabs(
      localSessionIDs(),
      all.filter(isKnownRootSession).map((s) => s.id),
      trackedSessionInventory(managedSessions(), all),
      isPending,
    )
    if (!next) return
    for (const id of next.forget) vscode.postMessage({ type: "agentManager.forgetSession", sessionId: id })
    setLocalSessionIDs(next.ids)
  })
  // Drop in-memory review state for worktrees that no longer exist.
  createEffect(() => {
    const ids = new Set(worktrees().map((wt) => wt.id))
    setReviewOpenByContext((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([id]) => id === LOCAL || ids.has(id)))
      if (Object.keys(next).length === Object.keys(prev).length) return prev
      return next
    })
    setReviewCommentsByContext((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([id]) => id === LOCAL || ids.has(id)))
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

  // Sessions NOT in any worktree and not local
  const unassignedSessions = createMemo(() =>
    filterUnassignedSessions(session.sessions(), worktreeSessionIds(), localSet()),
  )

  const projectSessionsLive = createProjectSessionsLive({
    base: projectLive.sessions,
    pid: currentProjectId,
    enabled: multiProject,
    store: session.sessions,
    managed: managedSessions,
    locals: localSet,
  })

  const localSessions = createLocalSessions({
    ids: localSessionIDs,
    sessions: session.sessions,
    pending: isPending,
    root: isKnownRootSession,
    title: () => t("agentManager.session.newSession"),
  })

  // Oldest-first sort before applyTabOrder — worktree label and tab bar must agree on "first session".
  const sessionsForWorktree = (worktreeId: string): SessionInfo[] => {
    const ids = new Set(
      managedSessions()
        .filter((ms) => ms.worktreeId === worktreeId)
        .map((ms) => ms.id),
    )
    return applyTabOrder(
      session
        .sessions()
        .filter((s) => isKnownRootSession(s) && ids.has(s.id))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
      worktreeTabOrder()[worktreeId],
    )
  }

  const activeWorktreeSessions = createMemo((): SessionInfo[] => {
    const sel = selection()
    if (!sel || sel === LOCAL) return []
    return sessionsForWorktree(sel)
  })

  const activeWorktreeSessionIds = createMemo<ReadonlySet<string> | undefined>(() => {
    const sel = selection()
    if (!sel || sel === LOCAL) return undefined
    return new Set(
      managedSessions()
        .filter((item) => item.worktreeId === sel)
        .map((item) => item.id),
    )
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

  const showDetailStack = createMemo(() => showTerminalStack(history(), selection(), contextEmpty()))

  const overlay = createMemo((): SetupState | null => {
    const state = setup()
    const sel = selection()
    // A live Setup script terminal shows progress and failures on its own
    // tab; never cover it with the blocking overlay.
    if (typeof sel === "string" && sel !== LOCAL && hasSetupTerminal(nsKey(sel), terms.sides())) return null
    if (state.active && (!state.worktreeId || sel === state.worktreeId)) return state
    if (typeof sel !== "string" || sel === LOCAL) return null
    const busy = busyWorktrees().get(sel)
    if (busy?.reason !== "setting-up") return null
    const tree = worktrees().find((item) => item.id === sel)
    return {
      active: true,
      message: busy.message ?? "",
      branch: busy.branch ?? tree?.branch,
    }
  })

  /** The selected worktree is provisioning: block session CTAs, keep selection put. */
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
    if (reviewActive() && !reviewOpen()) {
      setReviewActive(false)
    }
  })

  createEffect(() => {
    const id = selection() ?? session.currentSessionID()
    if (!id) return
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-sidebar-id="${id}"]`)
      if (el instanceof HTMLElement) scrollIntoView(el)
    })
  })

  const readOnly = createMemo(() => selection() === null && !!session.currentSessionID())

  const visibleTabId = createMemo(() => {
    const term = terms.activeId()
    if (term) return term
    if (reviewActive()) return REVIEW_TAB_ID
    return session.currentSessionID() ?? activePendingId()
  })
  const visibleSession = createMemo(() =>
    visible(
      session.currentSessionID(),
      !!terms.activeId() || reviewActive() || history() || !!overlay() || contextEmpty(),
    ),
  )
  reportVisibleSession(vscode, visibleSession)
  const worktreeLabel = (wt: WorktreeState): string => {
    if (wt.label) return wt.label
    return firstOrderedTitle(sessionsForWorktree(wt.id), worktreeTabOrder()[wt.id], wt.branch)
  }

  const worktreeSubtitle = (wt: WorktreeState): string | undefined => {
    const label = worktreeLabel(wt)
    return label !== wt.branch ? wt.branch : undefined
  }

  const isStaleWorktree = (worktreeId: string): boolean => staleWorktreeIds().has(worktreeId)

  const isAnySessionBusy = (ids: string[]): boolean => {
    if (ids.length === 0) return false
    const statuses = session.allStatusMap()
    const perms = session.permissions()
    const qs = session.questions()
    for (const id of ids) {
      const info = statuses[id]
      if (!info || info.type === "idle") continue
      const blocked = perms.some((p) => p.sessionID === id) || qs.some((q) => q.sessionID === id)
      if (!blocked) return true
    }
    return false
  }

  /** True when an agent session assigned to this worktree is actively working. */
  const isAgentBusy = (worktreeId: string): boolean => {
    const ids = managedSessions()
      .filter((ms) => ms.worktreeId === worktreeId)
      .map((ms) => ms.id)
    return isAnySessionBusy(ids)
  }

  /** True when a local session is actively working. */
  const isLocalBusy = (): boolean => isAnySessionBusy(localSessionIDs())

  const projectBusy = (projectId: string, worktreeId: string | null): boolean => {
    if (projectId === activeProjectId()) {
      return worktreeId === null ? isLocalBusy() : isAgentBusy(worktreeId)
    }
    const ids = (projectSessionsLive()[projectId] ?? [])
      .filter((item) => item.worktreeId === worktreeId)
      .map((item) => item.id)
    return isAnySessionBusy(ids)
  }

  const isSessionBusy = (id: string): boolean => isAnySessionBusy([id])

  /** Worktrees sorted so that grouped items are always adjacent, respecting custom order if set. */
  const sortedWorktrees = createMemo(() => sortWorktrees(worktrees(), sidebarWorktreeOrder()))

  const worktreesInSection = (id: string) => sortedWorktrees().filter((wt) => wt.sectionId === id)
  const ungrouped = createMemo(() => sortedWorktrees().filter((wt) => !wt.sectionId))
  const topLevelItems = createMemo((): TopLevelItem[] =>
    buildTopLevelItems(sections(), ungrouped(), sortedWorktrees(), sidebarWorktreeOrder()),
  )

  /** Flat visual order of all visible sidebar items — used for navigation and shortcut assignment. */
  const sidebarOrder = createMemo(() =>
    buildSidebarOrder(topLevelItems(), sortedWorktrees(), sections(), worktreesInSection, unassignedSessions()),
  )
  /** Map from sidebar item id → 1-based shortcut number (⌘1 for LOCAL, ⌘2 for first worktree, etc.) */
  const shortcutMap = createMemo(() => buildShortcutMap(sidebarOrder()))
  const projectShortcutMap = createMemo(() =>
    buildShortcutMap(
      buildProjectNavEntries(projectList(), projectStates(), projectLive.sessions()).map((entry) => ({ id: entry.id })),
    ),
  )

  const moveToSection = (ids: string[], sec: string | null) =>
    vscode.postMessage({ type: "agentManager.moveToSection", worktreeIds: ids, sectionId: sec })
  const moveSection = (sectionId: string, dir: -1 | 1) =>
    vscode.postMessage({ type: "agentManager.moveSection", sectionId, dir })
  const newSection = (ids?: string[]) => {
    pendingNewSection = true
    vscode.postMessage({
      type: "agentManager.createSection",
      name: t("agentManager.section.defaultName"),
      color: randomColor(),
      worktreeIds: ids,
    })
  }

  const scrollIntoView = (el: HTMLElement) => el.scrollIntoView({ block: "nearest", behavior: "smooth" })

  const selectUnassigned = (id: string) => {
    saveTabMemory()
    setSelection(null)
    setReviewActive(false)
    session.selectSession(id)
    requestChatFocus(true)
  }

  const focusSidebarItem = (item: { type: string; id: string }) => {
    if (item.type === "local") selectLocal()
    else if (item.type === "wt") selectWorktree(item.id)
    else selectUnassigned(item.id)
    requestChatFocus(true)
    const el = document.querySelector(`[data-sidebar-id="${item.id}"]`)
    if (el instanceof HTMLElement) scrollIntoView(el)
  }

  // Sidebar previous/next + numeric-shortcut nav. Multi-project mode traverses
  // every expanded project and atomically activates via activateSelection;
  // single-project mode keeps the legacy in-process path.
  const projectNav = createProjectNav(
    {
      multiProject,
      sidebarOrder,
      focus: focusSidebarItem,
      projects: projectList,
      states: projectStates,
      sessions: projectLive.sessions,
      activeProjectId,
      selection,
      currentSessionID: session.currentSessionID,
    },
    (target) => vscode.postMessage({ type: "agentManager.activateSelection", target }),
    scrollIntoView,
  )

  // Navigate tabs with Cmd+Alt+Left/Right
  const navigateTab = (direction: "left" | "right") => {
    const ids = tabIds()
    if (ids.length === 0) return
    const idx = ids.indexOf(visibleTabId() ?? "")
    if (idx === -1) return
    const next = direction === "left" ? idx - 1 : idx + 1
    if (next < 0 || next >= ids.length) return
    focusTab(ids[next]!)
    requestChatFocus(true)
  }

  const selectionDeps = {
    saveTabMemory,
    setReviewActive,
    setSelection,
    post: (msg: unknown) => vscode.postMessage(msg as never),
    tabMemory,
    terms,
    nsKey,
    activateTerminal: (id: string) => termHandlers.activate(id),
    setActivePendingId,
    selectSession: session.selectSession,
    clearSession: session.clearCurrentSession,
    resetSession: () => session.setCurrentSessionID(undefined),
    isPending,
    isReviewTab: (remembered: string | undefined, sel: string) =>
      remembered === REVIEW_TAB_ID && reviewOpenByContext()[sel] === true,
  }

  const selectLocal = () => {
    selectLocalAction(selectionDeps, localSessions())
    requestChatFocus()
  }

  const selectWorktree = (worktreeId: string) => {
    selectWorktreeAction(selectionDeps, worktreeId, sessionsForWorktree(worktreeId))
    requestChatFocus()
  }

  const addSessionToCurrentWorktree = (sid: string) => {
    const sel = selection()
    if (!sel || sel === LOCAL || !canOpenRootSession(sid, session.sessions())) return false
    const current = managedSessions().find((entry) => entry.id === sid)
    if (current?.worktreeId) return focusManagedSession(current.worktreeId, sid)
    saveTabMemory()
    setHistory(false)
    setReviewActive(false)
    appendToTabOrder(sel, sid)
    evictLocal(sid)
    vscode.postMessage({ type: "agentManager.addSessionToWorktree", worktreeId: sel, sessionId: sid })
    return true
  }

  const focusManagedSession = (worktreeId: string, sid: string) => {
    selectWorktree(worktreeId)
    setHistory(false)
    session.selectSession(sid)
    requestChatFocus()
    return true
  }

  const sidebarSearch = createSidebarSearch({
    worktrees: sortedWorktrees,
    sections,
    local: localSessions,
    localBranch: repoBranch,
    selection,
    sessionId: session.currentSessionID,
    statuses: session.allStatusMap,
    permissions: session.permissions,
    questions: session.questions,
    label: worktreeLabel,
    sessions: sessionsForWorktree,
    pending: isPending,
    busy: (id) => busyWorktrees().has(id) || (runStatuses()[id]?.state ?? "idle") !== "idle",
    localBusy: isLocalBusy,
    t,
  })
  const focusSidebarSearchItem = (item: SidebarSearchItem) => {
    if (item.section?.collapsed)
      vscode.postMessage({ type: "agentManager.toggleSectionCollapsed", sectionId: item.section.id })
    setHistory(false)
    if (item.kind === "local") return selectLocal()
    if (item.kind === "worktree") return selectWorktree(item.worktreeId)
    if (item.location === "local") selectLocal()
    if (item.location === "worktree" && item.worktreeId) selectWorktree(item.worktreeId)
    terms.setActiveId(undefined)
    setReviewActive(false)
    setActivePendingId(undefined)
    session.selectSession(item.sessionId)
  }

  const cycleAgent = (direction: 1 | -1) => {
    const id = session.currentSessionID() ?? activePendingId()
    cycle({
      agents: session.agents(),
      scope: id,
      direction,
      selected: session.selectedAgent,
      select: session.selectAgent,
    })
  }

  const router = createProjectStateRouter({
    catalog: projectList,
    apply: (state) => applyActiveState(state),
    pruneLive: (ids) => projectLive.prune(ids),
  })

  /** Store the project catalog pushed by the extension and drop states of removed projects. */
  const applyProjects = (msg: ExtensionMessage) => {
    if (msg.type !== "agentManager.projects") return
    const ev = msg as AgentManagerProjectsMessage
    setMultiProject(ev.multiProject)
    setProjectList(ev.projects)
    const ids = new Set(ev.projects.map((p) => p.id))
    setProjectStates((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => ids.has(id))))
    router.routeCatalog(ev.projects)
  }

  /** Apply one project state payload. Background payloads only feed their accordion summary. */
  const applyState = (msg: ExtensionMessage) => {
    if (msg.type !== "agentManager.state") return
    const state = msg as AgentManagerStateMessage
    const pid = state.projectId
    if (pid) setProjectStates((prev) => ({ ...prev, [pid]: state }))
    const store = pid ? registry.ensure(pid) : registry.active()
    // A freshly created section needs the previous list to detect the new id,
    // so it is handled before the data write below replaces it.
    if (pendingNewSection && isActivePayload(pid)) {
      const prev = new Set(store.sections().map((s) => s.id))
      const created = (state.sections ?? []).find((s) => !prev.has(s.id))
      pendingNewSection = false
      if (created) setRenamingSection(created.id)
    }
    // Data lands in the payload's own store unconditionally; the router
    // handles only the active-transition effects (selection/tab restore).
    store.applyState(state)
    router.routeState(state)
  }

  /** Apply the active-transition effects of a state payload (data already landed in the store). */
  const applyActiveState = (state: AgentManagerStateMessage) => {
    const switched = applyProjectSwitch(state)
    if (state.isGitRepo !== undefined) setIsGitRepo(state.isGitRepo)
    if (!worktreesLoaded()) setWorktreesLoaded(true)
    // When not a git repo, also mark sessions as loaded since the Kilo
    // server won't connect to send the sessionsLoaded message.
    if (state.isGitRepo === false && !sessionsLoaded()) setSessionsLoaded(true)
    if (state.reviewDiffStyle === "split" || state.reviewDiffStyle === "unified") {
      setReviewDiffStyle(state.reviewDiffStyle)
    }
    markdown.setRender(state.reviewMarkdownRender === true)
    const current = session.currentSessionID()
    if (current && !settingUpSelection()) {
      const ms = state.sessions.find((s) => s.id === current)
      if (ms?.worktreeId) setSelection(ms.worktreeId)
    }
    // Restore local session IDs from persisted state (sessions with no worktreeId)
    const restored = restoreTrackedTabs(
      trackedSessionInventory(state.sessions, session.sessions()),
      localSessionIDs(),
      state.tabOrder?.[LOCAL],
      isPending,
      applyTabOrder,
    )
    if (restored) setLocalSessionIDs(restored)
    ensurePendingTab(switched === "switched")
    if (switched !== "same") {
      restoreProjectTarget(state, {
        selectLocal,
        selectWorktree,
        selectSession: session.selectSession,
        focusManaged: focusManagedSession,
        setSelection,
        setActivePendingId,
      })
      requestChatFocus()
    }
    // Recover sidebar collapsed state and mark hydrated so transitions enable
    sidebar.hydrate(state.sidebarCollapsed)
  }

  /** Track project switches; full selection restore happens via restoreProjectTarget. */
  const applyProjectSwitch = (state: AgentManagerStateMessage): "first" | "switched" | "same" => {
    const pid = state.projectId
    const previousProject = currentProjectId()
    if (pid === previousProject) return "same"
    setCurrentProjectId(pid)
    if (previousProject === undefined) return "first"
    setReviewActive(false)
    setSidePanel(null)
    return "switched"
  }

  /** Guarantee a fresh "New Session" tab after switching to a project with no local sessions. */
  const ensurePendingTab = (switched: boolean) => {
    if (switched && localSessionIDs().length === 0) addPendingTab()
  }

  createTargetRememberer({
    pid: activeProjectId,
    enabled: multiProject,
    applied: currentProjectId,
    selection,
    owns: (sel) => worktrees().some((wt) => wt.id === sel),
    sessionId: session.currentSessionID,
    post: vscode.postMessage,
  })

  onMount(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data
      if (msg?.type === "navigate" && msg.view === "history") return setHistory(true)
      if (msg?.type !== "action") return
      if (msg.action === "sessionPrevious") projectNav.step("up")
      else if (msg.action === "sessionNext") projectNav.step("down")
      else if (msg.action === "tabPrevious") navigateTab("left")
      else if (msg.action === "tabNext") navigateTab("right")
      else if (msg.action === "search") {
        if (!sidebarCollapsed()) sidebarSearchMenu?.open()
        else {
          expandSidebar()
          requestAnimationFrame(() => sidebarSearchMenu?.open())
        }
      } else if (msg.action === "showTerminal") {
        if (!sideCtl.echo()) sideCtl.openPreferred("keyboard_shortcut")
      } else if (msg.action === "toggleDiff") {
        if (reviewActive()) {
          closeReviewTab()
          setSidePanel("diff")
        } else setSidePanel((prev) => (prev === "diff" ? null : "diff"))
      } else if (msg.action === "newTab") handleNewTabForCurrentSelection()
      else if (msg.action === "closeTab") closeActiveTab()
      else if (msg.action === "newWorktree") showNewWorktreeDialog()
      else if (msg.action === "quickWorktree") handleCreateWorktree()
      else if (msg.action === "openWorktree") openWorktreeDirectory()
      else if (msg.action === "openPR") openSelectedPR()
      else if (msg.action === "runScript") runSelected()
      else if (msg.action === "advancedWorktree") showNewWorktreeDialog()
      else if (msg.action === "closeWorktree") closeSelectedWorktree()
      else if (msg.action === "showShortcuts") handleShowKeyboardShortcuts()
      else if (msg.action === "focusInput") requestChatFocus(true)
      else if (msg.action === "focusSearch")
        focusChatSearch({ history: setHistory, review: setReviewActive, terminal: () => terms.setActiveId(undefined) })
      else if (msg.action === "newTerminal") termHandlers.requestNew()
      else if (msg.action === "cycleAgentMode" && document.hasFocus()) {
        if (!mode.dispatch(1)) cycleAgent(1)
      } else if (msg.action === "cyclePreviousAgentMode" && document.hasFocus()) {
        if (!mode.dispatch(-1)) cycleAgent(-1)
      } else {
        // Handle jumpTo1 through jumpTo9
        const match = /^jumpTo([1-9])$/.exec(msg.action ?? "")
        if (match) projectNav.jump(parseInt(match[1]!) - 1)
      }
    }
    window.addEventListener("message", handler)

    // Prevent Cmd/Ctrl shortcuts from triggering native browser actions
    const preventDefaults = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const target = e.target as HTMLElement | null
      if (target?.closest("[data-agent-manager-native-text-shortcuts]")) return
      // Arrow navigation requires Alt modifier (Cmd+Alt+Arrow for tabs/sessions)
      if (e.altKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault()
      }
      // Prevent browser defaults for our shortcuts (new tab, close tab, new window, toggle diff, run, find)
      if (["t", "w", "n", "d", "e", "f"].includes(e.key.toLowerCase()) && !e.shiftKey) {
        e.preventDefault()
      }
      // Prevent defaults for shift variants (close worktree, advanced/new/open worktree, open PR)
      if (["w", "n", "o", "r"].includes(e.key.toLowerCase()) && e.shiftKey) {
        e.preventDefault()
      }
      // Prevent browser defaults for shortcuts help (Cmd/Ctrl+Shift+/)
      if (["/", "?"].includes(e.key) && e.shiftKey) {
        e.preventDefault()
      }
      // Prevent defaults for jump-to shortcuts (Cmd/Ctrl+1-9)
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault()
      }
    }
    window.addEventListener("keydown", preventDefaults, true)

    // Cmd/Ctrl+/ toggles the terminal even when VS Code's webview keybinding
    // forwarding drops the key before it reaches the workbench (reported with
    // the prompt input focused). When forwarding does work, the extension
    // echoes the shortcut back as an action message and sideCtl dedupes it.
    const shortcut = (e: KeyboardEvent) => sideCtl.press(e)
    window.addEventListener("keydown", shortcut, true)

    // Delete/Backspace on a selected worktree triggers inline delete confirmation.
    // Pressing the key twice in a row (within the 2500ms window) confirms the delete.
    const deleteKeyHandler = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return
      const sel = selection()
      if (!sel || sel === LOCAL) return
      e.preventDefault()
      confirmDeleteWorktree(sel)
    }
    window.addEventListener("keydown", deleteKeyHandler)

    // Reveal the ⌘/Ctrl+1-9 jump badges on all sidebar items while the modifier is held.
    // Capture phase so the terminal's key handlers can't swallow them; blur resets state
    // when the keyup is lost (e.g. Cmd+Tab away).
    const modifier = isMac ? "Meta" : "Control"
    const modTrack = (e: KeyboardEvent) => {
      if (e.key === modifier) setHeld(e.type === "keydown")
    }
    const modReset = () => setHeld(false)
    window.addEventListener("keydown", modTrack, true)
    window.addEventListener("keyup", modTrack, true)
    window.addEventListener("blur", modReset)

    // When the panel regains focus (e.g. returning from terminal), focus the prompt
    // and clear any stale body styles left by Kobalte modal overlays (dropdowns/dialogs
    // set pointer-events:none and overflow:hidden on body, but cleanup never runs if
    // focus leaves the webview before the overlay closes).
    const onWindowFocus = () => {
      document.body.style.pointerEvents = ""
      document.body.style.overflow = ""
      restoreFocus()
    }
    window.addEventListener("focus", onWindowFocus)

    const drafts = createNewTaskDrafts()
    const newTaskHandler = (e: Event) => {
      const sel = selection()
      if (!sel || sel === LOCAL) return
      e.stopImmediatePropagation()
      const draft = drafts.create(sel)
      window.dispatchEvent(new CustomEvent("agentManagerCaptureDraft", { detail: { id: draft.id } }))
      terms.setActiveId(undefined)
      vscode.postMessage({ type: "agentManager.addSessionToWorktree", worktreeId: sel })
    }
    window.addEventListener("newTaskRequest", newTaskHandler, true)

    // Add created sessions as local tabs (both direct from the prompt and
    // backend follow-ups). Dedups HTTP + SSE firing together.
    const createdSessions = new Set<string>()
    const unsubCreate = vscode.onMessage((msg) => {
      if (msg.type !== "sessionCreated") return
      const created = msg as SessionCreatedMessage
      if (!isKnownRootSession(created.session)) return
      if (!created.draftID && createdSessions.delete(created.session.id)) return
      if (created.draftID) createdSessions.add(created.session.id)
      if (created.draftID && closedDrafts.delete(created.draftID)) return
      if (created.draftID && promotePendingDraftDiscard(created.draftID, created.session.id)) return
      const pending = created.draftID && localSessionIDs().includes(created.draftID) ? created.draftID : undefined
      if (!pending && localSessionIDs().includes(created.session.id)) return
      if (worktreeSessionIds().has(created.session.id)) return
      const active = activePendingId()
      const focus = !pending || (selection() === LOCAL && pending === active)
      if (!pending) saveTabMemory()
      placeLocal(created.session.id, pending, active)
      if (!pending) setSelection(LOCAL)
      vscode.postMessage({
        type: "agentManager.persistSession",
        sessionId: created.session.id,
        draftID: created.draftID,
      })
      if (focus) session.selectSession(created.session.id)
    })

    // Mark sessions loaded as soon as the session context receives data (even if empty)
    const unsubSessions = vscode.onMessage((msg) => {
      if (msg.type === "sessionsLoaded" && !sessionsLoaded()) setSessionsLoaded(true)
      if (msg.type === "agentManager.sessionClosed") {
        handleCloseTab(msg.sessionId, false)
      }
    })
    const unsubRun = vscode.onMessage((msg) =>
      applyRunStatus(msg, { ensure: (id) => registry.ensure(id), active: () => registry.active() }),
    )
    const unsubProjects = vscode.onMessage((msg) => applyProjects(msg))

    // Terminal messages have their own subscription to keep main-handler complexity in check.
    const terminalDispatch = createTerminalMessageHandler({
      state: terms,
      activate: termHandlers.activate,
      saveTabMemory,
      setSelection,
      showError: (message) =>
        showToast({ variant: "error", title: t("agentManager.terminal.errorTitle"), description: message }),
      postMessage: (message) => vscode.postMessage(message as never),
      onCreated: (contextKey, terminalId) => appendToTabOrder(contextKey, terminalId),
      onSideCreated: (contextKey, terminalId, focus) => {
        // Focus only when the user is still looking at this panel —
        // a slow create landing after a mode switch must not steal it.
        if (focus && sidePanel() === "terminal" && !history() && !reviewActive() && terms.sideKey() === contextKey) {
          terms.requestFocus(terminalId)
        }
      },
      onSideClosed: (_contextKey, terminalId) => forgetTerminalFocus(terminalId),
      onScriptRunning: (contextKey, terminalId) => {
        if (terms.sideKey() !== contextKey) return
        // Setup output is informational: reveal without stealing focus, and
        // remember an ambient reveal so the panel can restore itself later.
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
    const unsubTerminals = vscode.onMessage((msg) => {
      terminalDispatch(msg)
    })

    const unsub = vscode.onMessage((msg) => {
      if (msg.type === "agentManager.repoInfo") {
        const info = msg as AgentManagerRepoInfoMessage
        setRepoBranch(info.branch)
        if (info.defaultBranch) setRepoDetectedBranch(info.defaultBranch)
      }

      if (msg.type === "agentManager.worktreeSetup") {
        const ev = msg as AgentManagerWorktreeSetupMessage
        const store = ev.projectId ? registry.ensure(ev.projectId) : registry.active()
        const updateBusy: Setter<Map<string, WorktreeBusyState>> = (value) => store.setBusy(value)
        if (ev.status === "ready" || ev.status === "error") {
          const error = ev.status === "error"
          if (ev.worktreeId) updateBusy((prev) => new Map([...prev].filter(([k]) => k !== ev.worktreeId)))
          if (!isActivePayload(ev.projectId)) return
          setSetup({
            active: true,
            message: ev.message,
            branch: ev.branch,
            error,
            worktreeId: ev.worktreeId,
            errorCode: ev.errorCode,
          })
          globalThis.setTimeout(() => setSetup({ active: false, message: "" }), error ? 3000 : 500)
          if (!error && ev.sessionId) {
            session.selectSession(ev.sessionId)
            const ms = managedSessions().find((s) => s.id === ev.sessionId)
            if (ms?.worktreeId) setSelection(ms.worktreeId)
            evictLocal(ev.sessionId)
            requestChatFocus(true)
          }
        } else {
          // Track this worktree as setting up and auto-select it in the sidebar
          if (ev.worktreeId) {
            updateBusy(
              (prev) =>
                new Map([...prev, [ev.worktreeId!, { reason: "setting-up", message: ev.message, branch: ev.branch }]]),
            )
            if (!isActivePayload(ev.projectId)) return
            setSelection(ev.worktreeId)
          }
          if (!isActivePayload(ev.projectId)) return
          // Close diff/review panels — nothing to show during setup.
          // Terminal panels keep live setup output, so they stay open.
          if (sidePanel() === "diff") setSidePanel(null)
          setReviewActive(false)
          setSetup({ active: true, message: ev.message, branch: ev.branch, worktreeId: ev.worktreeId })
        }
      }

      if (msg.type === "agentManager.sessionAdded") {
        const ev = msg as { type: string; sessionId: string; worktreeId: string }
        saveTabMemory()
        appendToTabOrder(ev.worktreeId, ev.sessionId)
        setSelection(ev.worktreeId)
        evictLocal(ev.sessionId)
        drafts.apply(ev.worktreeId, ev.sessionId)
        session.selectSession(ev.sessionId)
        requestChatFocus(true)
      }

      if (msg.type === "agentManager.sessionForked") {
        const ev = msg as { type: string; sessionId: string; forkedFromId: string; worktreeId?: string }
        tabOrderSync.insertAfter(ev.worktreeId, ev.forkedFromId, ev.sessionId)
        if (!ev.worktreeId) {
          // Local session: insert new tab after the forked-from tab
          setLocalSessionIDs((prev) => {
            const idx = prev.indexOf(ev.forkedFromId)
            if (idx >= 0) return [...prev.slice(0, idx + 1), ev.sessionId, ...prev.slice(idx + 1)]
            return [...prev, ev.sessionId]
          })
          vscode.postMessage({ type: "agentManager.persistSession", sessionId: ev.sessionId })
        } else {
          saveTabMemory()
          setSelection(ev.worktreeId)
          evictLocal(ev.sessionId)
        }
        session.selectSession(ev.sessionId)
        requestChatFocus(true)
      }

      if (msg.type === "agentManager.keybindings") {
        const ev = msg as AgentManagerKeybindingsMessage
        setKb(ev.bindings)
      }

      if (msg.type === "agentManager.state") applyState(msg)

      // When a multi-version progress update arrives, mark newly created worktrees as loading
      if ((msg as { type: string }).type === "agentManager.multiVersionProgress") {
        const ev = msg as unknown as AgentManagerMultiVersionProgressMessage
        if (ev.status === "done" && ev.groupId) {
          // Clear busy state for all worktrees in this group
          const store = ev.projectId ? registry.ensure(ev.projectId) : registry.active()
          clearMultiVersionBusy(store, ev.groupId)
        }
      }

      // When state updates arrive, mark new grouped worktrees as loading
      // (they were just created and haven't received their prompt yet)
      if (msg.type === "agentManager.worktreeSetup") {
        const ev = msg as AgentManagerWorktreeSetupMessage
        if (ev.status === "ready" && ev.sessionId) {
          const store = ev.projectId ? registry.ensure(ev.projectId) : registry.active()
          markMultiVersionBusy(store, ev.sessionId)
        }
      }

      // Set per-session model selection without clearing busy state.
      // Used during Phase 1 of multi-version creation so the UI selector
      // reflects the correct model as soon as the worktree appears.
      if ((msg as { type: string }).type === "agentManager.setSessionModel") {
        const ev = msg as { type: string; sessionId: string; providerID: string; modelID: string }
        session.setSessionModel(ev.sessionId, ev.providerID, ev.modelID)
      }

      // Handle initial message send for multi-version sessions.
      // The extension creates the worktrees/sessions, then asks the webview
      // to send the prompt through the normal KiloProvider sendMessage path.
      // Once the message is sent, clear the loading state for that worktree.
      if ((msg as { type: string }).type === "agentManager.sendInitialMessage") {
        const ev = msg as unknown as AgentManagerSendInitialMessage

        // Set agent first so setSessionModel (and getSessionModel) resolve the
        // correct agent — otherwise the session falls back to defaultAgent().
        if (ev.agent) {
          session.setSessionAgent(ev.sessionId, ev.agent)
        }
        if (ev.providerID && ev.modelID) {
          session.setSessionModel(ev.sessionId, ev.providerID, ev.modelID)
        }
        seedInitialVariant(session, ev)

        // Only send a message if there's text — otherwise just clear busy state
        const init = initialMessage(ev)
        if (init) {
          vscode.postMessage(init)
        }
        // Clear busy state — use worktreeId from the message directly
        // to avoid race condition where managedSessions() hasn't updated yet
        if (ev.worktreeId) {
          const store = ev.projectId ? registry.ensure(ev.projectId) : registry.active()
          store.setBusy((prev) => {
            const next = new Map(prev)
            next.delete(ev.worktreeId)
            return next
          })
        }
      }

      if (msg.type === "agentManager.worktreeDiff") {
        diffs.onWorktreeDiff(msg as AgentManagerWorktreeDiffMessage)
      }

      if (msg.type === "agentManager.worktreeDiffFile") {
        diffs.onWorktreeDiffFile(msg as AgentManagerWorktreeDiffFileMessage)
      }

      if (msg.type === "agentManager.worktreeDiffLoading") {
        diffs.onWorktreeDiffLoading(msg as AgentManagerWorktreeDiffLoadingMessage)
      }

      if (msg.type === "agentManager.worktreeDiffNotice") {
        diffs.onWorktreeDiffNotice(msg as AgentManagerWorktreeDiffNoticeMessage)
      }

      if (msg.type === "agentManager.diffBranches") {
        review.onBranches(msg as AgentManagerDiffBranchesMessage)
      }

      if (msg.type === "agentManager.applyWorktreeDiffResult") {
        apply.onApplyResult(msg as AgentManagerApplyWorktreeDiffResultMessage)
      }

      if (msg.type === "agentManager.revertWorktreeFileResult") revertCtl.onResult(msg as never)

      applyProjectSelection(msg, {
        // The catalog push is synchronous, so activeProjectId is current when
        // the ack arrives; currentProjectId may still be catching up after an
        // async project reactivation, so it must not be part of the guard.
        active: (projectId) => activeProjectId() === projectId,
        managed: (projectId) => projectLive.sessions()[projectId] ?? projectStates()[projectId]?.sessions ?? [],
        local: () => selectLocal(),
        // The active guard above already scopes by project; apply the worktree
        // optimistically and let the arriving state reconcile.
        worktree: (projectId, worktreeId) => selectWorktree(worktreeId),
        session: session.selectSession,
        openTab: (id) => placeLocal(id, undefined, undefined),
        managedSession: focusManagedSession,
      })

      if (projectLive.apply(msg)) return
    })

    onCleanup(() => {
      window.removeEventListener("message", handler)
      window.removeEventListener("keydown", preventDefaults, true)
      window.removeEventListener("keydown", shortcut, true)
      window.removeEventListener("keydown", deleteKeyHandler)
      window.removeEventListener("keydown", modTrack, true)
      window.removeEventListener("keyup", modTrack, true)
      window.removeEventListener("blur", modReset)
      window.removeEventListener("focus", onWindowFocus)
      window.removeEventListener("newTaskRequest", newTaskHandler, true)
      drafts.cleanup()
      unsubCreate()
      unsubSessions()
      unsubRun()
      unsubProjects()
      unsubTerminals()
      unsub()
    })
  })

  // Always select local on mount to initialize branch info and session state
  onMount(() => {
    selectLocal()
    // Request worktree/session state from extension — handles race where
    // initializeState() pushState fires before the webview is mounted
    vscode.postMessage({ type: "agentManager.requestState" })
    // Same race for the project catalog pushed at panel attach
    vscode.postMessage({ type: "agentManager.requestProjects" })
    // Open a pending "New Session" tab if there are no persisted local sessions
    if (localSessionIDs().length === 0) {
      addPendingTab()
    }
  })

  // Diff context = sidebar selection (worktree id or LOCAL), stable across
  // session tab switches inside the context so the git scopes don't refetch.
  const diffCtx = createMemo(() => selection() ?? undefined)

  // Active session within the diff context. The Session scope follows it, so
  // switching session tabs swaps only the session diff.
  const activeDiffSession = createMemo(() => {
    const sel = selection()
    if (!sel) return undefined
    const current = session.currentSessionID()
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

  // Diff scope + base branch state, shared by the side panel and review tab.
  const review = createDiffReviewScope({
    ctx: diffCtx,
    session: activeDiffSession,
    panelOpen: diffOpen,
    reviewActive,
    vscode,
  })
  // The composite id (ctx#scope) the extension keys diff data by.
  const diffScopeId = review.id

  // Shared scope + base-picker controls for the side panel and review tab.
  const diffScopeControls = (compact: boolean) => (
    <DiffScopeControls
      descriptors={review.descriptors()}
      currentId={review.id()}
      onSelectScope={review.select}
      showBase={review.isBranch()}
      branches={review.branches()}
      branchesLoading={review.loading()}
      defaultBranch={review.defaultBranch()}
      autoBase={review.autoBase()}
      currentBase={review.currentBase()}
      isAuto={review.isAuto()}
      currentBranch={review.currentBranch()}
      onSelectBase={review.selectBase}
      compact={compact}
    />
  )

  // Start/stop diff watch when the panel opens/closes, the review tab opens,
  // or the composite id (context, scope, active session) changes.
  createEffect(() => {
    const panel = diffOpen()
    const active = reviewActive()
    const id = review.id()

    if ((panel || active) && id) {
      vscode.postMessage({ type: "agentManager.startDiffWatch", ...wireDiffId(id) })
      return
    }

    setDiffLoading(false)
    vscode.postMessage({ type: "agentManager.stopDiffWatch" })
  })

  onCleanup(() => {
    if (diffOpen() || reviewActive()) {
      vscode.postMessage({ type: "agentManager.stopDiffWatch" })
    }
  })

  const openReviewTab = () => {
    const sel = selection()
    if (sel === null) return
    terms.setActiveId(undefined)
    setSidePanel(null)
    setReviewOpenForContext(sel, true)
    setReviewActive(true)
  }

  const toggleReviewTab = () => {
    if (reviewActive()) {
      closeReviewTab()
      return
    }
    openReviewTab()
  }

  // Deferred close: flip signal immediately for instant UI feedback,
  // the <Show> unmount triggers heavy FileDiff cleanup but the tab bar
  // and chat view are already visible before that work runs.
  const closeReviewTab = () => {
    freezeTabs()
    setReviewActive(false)
    setReviewOpenForSelection(false)
    tabFocus.restore()
  }

  // Data for the review tab / side panel: keyed by the composite diff id
  // (ctx#scope) the extension pushes, so each scope keeps its own file set and
  // switching back to a fetched scope is instant.
  const reviewDiffs = createMemo(() => {
    const data = diffDatas()
    const key = diffScopeId()
    if (!key) return []
    return data[key] ?? []
  })

  const diffSessionKey = createMemo(() => diffScopeId() ?? "")

  // Source-level notice for the active composite id (e.g. snapshots disabled
  // for the Session scope), shown as a banner instead of the empty state.
  const diffNotice = createMemo(() => {
    const key = diffScopeId()
    if (!key) return undefined
    return diffNotices()[key]
  })

  const setSharedDiffStyle = (style: "unified" | "split") => {
    if (reviewDiffStyle() === style) return
    setReviewDiffStyle(style)
    vscode.postMessage({ type: "agentManager.setReviewDiffStyle", style })
  }

  const requestDiffFile = (file: string) => {
    const id = diffScopeId()
    if (!id) return
    diffs.requestDiffFile(id, file)
  }

  const diffFileLoadingForCurrent = createMemo(() => diffs.diffFileLoadingFor(diffScopeId))

  const revertCtl = createRevertFile(diffScopeId, diffCtx, () => review.scope(), vscode, showToast, t)

  const handleConfigureSetupScript = () => {
    vscode.postMessage({ type: "agentManager.configureSetupScript" })
  }
  const setupScript = metrics.click("configure_setup_script", "worktree_settings", handleConfigureSetupScript)

  const handleChangeDefaultBaseBranch = () => {
    const [search, setSearch] = createSignal("")
    const [branches, setBranches] = createSignal<BranchInfo[]>([])
    const [loading, setLoading] = createSignal(true)
    const [highlighted, setHighlighted] = createSignal(-1)

    const unsub = vscode.onMessage((msg) => {
      if (msg.type === "agentManager.branches") {
        const ev = msg as AgentManagerBranchesMessage
        setBranches(ev.branches)
        if (ev.defaultBranch) setRepoDetectedBranch(ev.defaultBranch)
        setLoading(false)
      }
    })

    vscode.postMessage({ type: "agentManager.requestBranches" })

    const filtered = createMemo(() => {
      const s = search().toLowerCase()
      if (!s) return branches()
      return branches().filter((b) => b.name.toLowerCase().includes(s))
    })

    const selectBranch = (name: string | undefined) => {
      vscode.postMessage({ type: "agentManager.setDefaultBaseBranch", branch: name })
      setDefaultBaseBranch(name)
      dialog.close()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const items = filtered()
      // offset by 1 for auto-detect option (-1 = auto-detect)
      const total = items.length + 1
      if (e.key === "ArrowDown") {
        e.preventDefault()
        e.stopPropagation()
        setHighlighted((prev) => Math.min(prev + 1, total - 2))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        e.stopPropagation()
        setHighlighted((prev) => Math.max(prev - 1, -1))
      } else if (e.key === "Enter") {
        e.preventDefault()
        e.stopPropagation()
        const idx = highlighted()
        if (idx === -1) {
          selectBranch(undefined)
        } else {
          const branch = items[idx]
          if (branch) selectBranch(branch.name)
        }
      } else if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        dialog.close()
      }
    }

    dialog.show(() => {
      onCleanup(unsub)
      return (
        <Dialog title={t("agentManager.worktree.defaultBaseBranch")} fit>
          <div class="am-default-base-branch">
            <BranchSelect
              branches={filtered()}
              loading={loading()}
              search={search()}
              onSearch={(v) => {
                setSearch(v)
                setHighlighted(-1)
              }}
              onSelect={(b) => selectBranch(b.name)}
              onSearchKeyDown={handleKeyDown}
              selected={defaultBaseBranch()}
              highlighted={highlighted()}
              onHighlight={setHighlighted}
              searchPlaceholder={t("agentManager.dialog.searchBranches")}
              emptyLabel={t("agentManager.import.noMatchingBranches")}
              loadingLabel={t("agentManager.import.loadingBranches")}
              defaultLabel={t("agentManager.dialog.branchBadge.default")}
              remoteLabel={t("agentManager.dialog.branchBadge.remote")}
              defaultName={defaultBaseBranch()}
              autoOption={{
                label: t("agentManager.worktree.defaultBaseBranchAuto"),
                hint: repoDetectedBranch(),
                active: !hasConfiguredBranch(),
                highlighted: highlighted() === -1,
                onSelect: () => selectBranch(undefined),
              }}
            />
          </div>
        </Dialog>
      )
    })
  }

  const handleShowKeyboardShortcuts = () => {
    const categories = buildShortcutCategories(kb(), t)
    dialog.show(() => (
      <Dialog title={t("agentManager.shortcuts.title")} fit>
        <div class="am-shortcuts">
          <For each={categories}>
            {(category) => (
              <div class="am-shortcuts-category">
                <div class="am-shortcuts-category-title">{category.title}</div>
                <div class="am-shortcuts-list">
                  <For each={category.shortcuts}>
                    {(shortcut) => (
                      <div class="am-shortcuts-row">
                        <span class="am-shortcuts-label">{shortcut.label}</span>
                        <span class="am-shortcuts-keys">
                          <For each={parseBindingTokens(shortcut.binding)}>
                            {(token) => <kbd class="am-kbd">{token}</kbd>}
                          </For>
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </Dialog>
    ))
  }

  const loaded = () => worktreesLoaded() && sessionsLoaded()

  const handleCreateWorktree = () => {
    if (!loaded()) return
    expandSidebar()
    vscode.postMessage({ type: "agentManager.createWorktree" })
  }
  const createWorktree = metrics.click("new_worktree", "worktrees", handleCreateWorktree)

  const showNewWorktreeDialog = () => {
    if (!loaded()) return
    expandSidebar()
    dialog.show(() => (
      <NewWorktreeDialog mode={mode} onClose={() => dialog.close()} defaultBaseBranch={repoDefaultBranch()} />
    ))
  }

  const confirmDeleteWorktree = (worktreeId: string) => {
    const wt = worktrees().find((w) => w.id === worktreeId)
    if (!wt) return

    // Second press/click: execute the delete
    if (pendingDelete() === worktreeId) {
      cancelPendingDelete()
      forgetContextFocus(nsKey(worktreeId))
      setBusyWorktrees((prev) => new Map([...prev, [wt.id, { reason: "deleting" as const }]]))
      vscode.postMessage({ type: "agentManager.deleteWorktree", worktreeId: wt.id })
      if (selection() === wt.id) {
        const next = nextSelectionAfterDelete(
          wt.id,
          sidebarOrder()
            .filter((f) => f.type === "wt")
            .map((f) => f.id),
        )
        if (next === LOCAL) selectLocal()
        else selectWorktree(next)
      }
      return
    }

    // First press/click: enter pending-delete state
    clearTimeout(pendingDeleteTimer)
    setPendingDelete(worktreeId)
    pendingDeleteTimer = setTimeout(() => setPendingDelete(null), 2500)
  }

  const confirmRemoveStaleWorktree = (worktreeId: string) => {
    const wt = worktrees().find((w) => w.id === worktreeId)
    if (!wt) return

    const remove = () => {
      vscode.postMessage({ type: "agentManager.removeStaleWorktree", worktreeId: wt.id })
      if (selection() === wt.id) {
        const next = nextSelectionAfterDelete(
          wt.id,
          sidebarOrder()
            .filter((f) => f.type === "wt")
            .map((f) => f.id),
        )
        if (next === LOCAL) selectLocal()
        if (next !== LOCAL) selectWorktree(next)
      }
      dialog.close()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        remove()
      }
    }

    dialog.show(() => (
      <Dialog title={t("agentManager.dialog.removeStaleWorktree.title")} fit>
        <div class="am-confirm" onKeyDown={onKeyDown}>
          <div class="am-confirm-message">
            <Icon name="warning" size="small" />
            <span>
              {t("agentManager.dialog.removeStaleWorktree.messagePre")}
              <code class="am-confirm-branch">{wt.branch}</code>
              {t("agentManager.dialog.removeStaleWorktree.messagePost")}
            </span>
          </div>
          <div class="am-confirm-actions">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {t("agentManager.dialog.removeStaleWorktree.cancel")}
            </Button>
            <Button variant="primary" size="large" class="am-confirm-delete" onClick={remove} autofocus>
              {t("agentManager.dialog.removeStaleWorktree.confirm")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  const handleDeleteWorktree = (worktreeId: string, e: MouseEvent) => {
    e.stopPropagation()
    confirmDeleteWorktree(worktreeId)
  }

  const promoteSession = (sessionId: string) => {
    if (!loaded()) return
    metrics.track("promote_session", "unassigned_session")
    vscode.postMessage({ type: "agentManager.promoteSession", sessionId })
  }

  const openLocally = (sid: string) => {
    if (!canOpenRootSession(sid, session.sessions())) return
    saveTabMemory()
    expandSidebar()
    const pending = activePendingId()
    placeLocal(sid, pending, pending ?? session.currentSessionID())
    setSelection(LOCAL)
    setReviewActive(false)
    session.selectSession(sid)
    requestChatFocus()
    vscode.postMessage({ type: "agentManager.openLocally", sessionId: sid })
  }

  const openUnassigned = (id: string) => {
    metrics.track("open_session_locally", "unassigned_session_menu")
    openLocally(id)
  }

  const handleAddSession = () => {
    const sel = selection()
    // Setup is still provisioning this worktree; the Setup tab shows progress.
    if (settingUpSelection()) return
    expandSidebar()
    if (sel === LOCAL) return addPendingTab()
    if (sel) {
      // Deactivate any focused terminal so the new session is visible.
      terms.setActiveId(undefined)
      vscode.postMessage({ type: "agentManager.addSessionToWorktree", worktreeId: sel })
    }
  }
  const handleForkSession = (sessionId: string, messageId?: string) => {
    const sel = selection()
    const msg = { type: "agentManager.forkSession" as const, sessionId, ...(messageId ? { messageId } : {}) }
    if (!sel || sel === LOCAL) return vscode.postMessage(msg)
    vscode.postMessage({ ...msg, worktreeId: sel })
  }
  const handleCloseTab = (sessionId: string, notify = true) => {
    freezeTabs()
    const pending = isPending(sessionId)
    const isActive = pending ? sessionId === activePendingId() : session.currentSessionID() === sessionId
    if (isActive) {
      const id = nextTabAfterClose(
        activeTabs().map((tab) => tab.id),
        sessionId,
      )
      if (id && isPending(id)) {
        setActivePendingId(id)
        session.clearCurrentSession()
      }
      if (id && !isPending(id)) {
        setActivePendingId(undefined)
        session.selectSession(id)
      }
      if (!id) {
        setActivePendingId(undefined)
        session.clearCurrentSession()
      }
    }
    forgetSessionFocus(sessionId)
    if (pending || localSet().has(sessionId)) {
      setLocalSessionIDs((prev) => prev.filter((id) => id !== sessionId))
    }
    if (pending) {
      closedDrafts.add(sessionId)
      if (session.isSubmitting(sessionId) || isPendingSend(sessionId)) discardPendingDraft(sessionId)
      queueMicrotask(() => deletePendingDraft(sessionId))
    }
    if (notify) vscode.postMessage({ type: "agentManager.closeSession", sessionId })
    tabFocus.restore()
  }

  const handleTabMouseDown = (sessionId: string, e: MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault()
      e.stopPropagation()
      handleCloseTab(sessionId)
    }
  }

  const selectSessionTab = (id: string, pending: boolean) => {
    setReviewActive(false)
    if (pending) {
      setActivePendingId(id)
      session.clearCurrentSession()
    } else {
      setActivePendingId(undefined)
      session.selectSession(id)
    }
  }
  const termHandlers = createTerminalHandlers({
    state: terms,
    tabIds: () => tabIds(),
    selectReview: () => setReviewActive(true),
    selectSessionTab,
    clearSession: () => session.clearCurrentSession(),
    resetOthers: () => {
      setReviewActive(false)
      setActivePendingId(undefined)
      session.clearCurrentSession()
    },
    isPendingId: isPending,
    findTab: (id) => tabLookup().get(id),
    postMessage: (msg) => vscode.postMessage(msg as never),
    onRemove: freezeTabs,
    onShowSide: showSideTerminal,
    getSelection: selection,
    LOCAL,
    REVIEW_TAB_ID,
  })

  const sideCtl = createSideTerminal({
    handlers: termHandlers,
    visible: () => sidePanel() === "terminal" && !history() && !reviewActive(),
    focusedId: () => terms.sideFocusedId(),
    hide: () => {
      cancelAmbientSetup()
      setSidePanel(null)
    },
    refocus: requestChatFocus,
    postMessage: (msg) => vscode.postMessage(msg as never),
    track: (button, surface, properties) => metrics.track(button, surface, properties),
    // Panel-local pick, immune to cross-window setting echoes (see side.ts).
    saved: readSavedDestination(vscode.getState<Record<string, unknown>>()),
    save: (d) => vscode.setState({ ...vscode.getState<Record<string, unknown>>(), terminalDestination: d }),
    openVscode: () =>
      vscode.postMessage(
        resolveVscodeTerminalRequest(
          selection(),
          session.currentSessionID(),
          (wt) => managedSessions().find((ms) => ms.worktreeId === wt)?.id,
        ) as never,
      ),
  })
  createEffect(on(terms.sideKey, (key, previous) => sideCtl.syncContext(key, previous), { defer: true }))

  const handleReviewTabMouseDown = (e: MouseEvent) => {
    if (e.button !== 1) return
    e.preventDefault()
    e.stopPropagation()
    closeReviewTab()
  }

  // Drag-and-drop handlers for tab reordering
  const tabLookup = createMemo(() => new Map(activeTabs().map((s) => [s.id, s])))
  const tabIds = createMemo(() => {
    const ids = activeTabs().map((s) => s.id)
    const sel = selection()
    if (sel === null) return ids
    const withReview = reviewOpen() ? [...ids, REVIEW_TAB_ID] : ids
    const terminalIds = terms.current().map((t) => t.id)
    const base = [...withReview, ...terminalIds]
    // `worktreeTabOrder` stores the per-context mixed order. Applied
    // for every context (LOCAL too) and persisted server-side via
    // `setTabOrder`; unknown IDs are filtered by `applyTabOrder`.
    const key = sel === LOCAL ? LOCAL : sel
    return applyTabOrder(
      base.map((id) => ({ id })),
      worktreeTabOrder()[key],
    ).map((item) => item.id)
  })
  const tabScroll = useTabScroll(tabIds, visibleTabId)
  const handleDragStart = (event: DragEvent) => {
    const id = event.draggable?.id
    if (typeof id === "string") setDraggingTab(id)
  }

  const handleDragOver = (event: DragEvent) => {
    const from = event.draggable?.id
    const to = event.droppable?.id
    if (typeof from !== "string" || typeof to !== "string") return
    const sel = selection()
    if (sel === null) return
    const key = sel === LOCAL ? LOCAL : sel
    // Unified mixed-drag: the current visible order is `tabIds()` and
    // includes sessions, review, and terminals. `reorderTabs` moves
    // `from` to `to`'s position regardless of kind, so a user can slot
    // a terminal between two sessions or vice versa.
    const reordered = reorderTabs(tabIds(), from, to)
    if (!reordered) return
    setWorktreeTabOrder((prev) => ({ ...prev, [key]: reordered }))
    // Keep the session-only list in sync for LOCAL so `localSessions()`
    // and membership checks stay aligned after a drag.
    if (key === LOCAL) {
      const sessionSubset = reordered.filter((id) => id !== REVIEW_TAB_ID && !isTerminalTabId(id))
      setLocalSessionIDs(sessionSubset)
    }
    // Mirror the order into the terminal state so `terms.current()`
    // (the source for renderTerminalLayer's slot order) matches. The
    // terminal state is keyed by namespaced context, not the plain
    // tab-order key.
    const terminalSubset = reordered.filter(isTerminalTabId)
    if (terminalSubset.length > 0) terms.reorder(nsKey(key), terminalSubset)
  }

  const handleDragEnd = () => {
    setDraggingTab(undefined)
    const sel = selection()
    if (sel === null) return
    const key = sel === LOCAL ? LOCAL : sel
    const order = worktreeTabOrder()[key]
    if (order && order.length > 0) persistTabOrder(key, order)
  }

  const draggedTab = createMemo(() => {
    const id = draggingTab()
    if (!id) return undefined
    if (id === REVIEW_TAB_ID) return { id, title: t("session.tab.review") }
    if (isTerminalTabId(id)) {
      const title = terms.title(id)
      return title ? { id, title } : undefined
    }
    return activeTabs().find((s) => s.id === id)
  })

  const focusTab = (id: string) => {
    focusCurrentTab({
      id,
      terms,
      isTerminal: isTerminalTabId,
      isPending,
      reviewId: REVIEW_TAB_ID,
      reviewOpen,
      setReviewOpen: setReviewOpenForSelection,
      setReviewActive,
      tabLookup,
      setActivePendingId,
      clearSession: session.clearCurrentSession,
      selectSession: session.selectSession,
      activateTerminal: termHandlers.activate,
    })
  }
  const tabFocus = createTabFocus({ ids: () => tabIds(), select: focusTab })

  // Close the currently active tab via keyboard shortcut.
  // If no tabs remain, fall through to close the selected worktree.
  const closeActiveTab = () => {
    // A focused side terminal owns Cmd+W while its panel is visible —
    // closing a chat tab out from under the user's cursor would be
    // surprising. Only that terminal dies; the panel keeps the rest.
    if (sidePanel() === "terminal" && terms.sideFocusedId()) {
      if (sideCtl.close()) return
    }
    if (termHandlers.closeActive()) {
      tabFocus.restore()
      return
    }
    if (reviewActive()) {
      closeReviewTab()
      return
    }
    const tabs = activeTabs()
    if (tabs.length === 0) {
      closeSelectedWorktree()
      return
    }
    const current = session.currentSessionID()
    const pending = activePendingId()
    const target = current
      ? tabs.find((s) => s.id === current)
      : pending
        ? tabs.find((s) => s.id === pending)
        : undefined
    if (!target) return
    handleCloseTab(target.id)
  }

  // Cmd+T: add a new tab strictly to the current selection (no side effects)
  const handleNewTabForCurrentSelection = () => {
    const sel = selection()
    if (sel === LOCAL) {
      addPendingTab()
    } else if (sel) {
      // Pass the captured worktree ID directly to avoid race conditions
      vscode.postMessage({ type: "agentManager.addSessionToWorktree", worktreeId: sel })
    }
  }

  // Close the currently selected worktree with a confirmation dialog
  const closeSelectedWorktree = () => {
    const sel = selection()
    if (!sel || sel === LOCAL) return
    confirmDeleteWorktree(sel)
  }

  /** The Local/worktrees/sessions body of the active project. */
  const toggleDiffPanel = () => {
    metrics.track("side_review", "tab_toolbar", {
      action: diffOpen() && !reviewActive() ? "close" : "open",
    })
    if (reviewActive()) {
      closeReviewTab()
      setSidePanel("diff")
      return
    }
    setSidePanel((prev) => (prev === "diff" ? null : "diff"))
  }

  const renderTabById = (id: string) =>
    renderTab(id, {
      terms,
      REVIEW_TAB_ID,
      tabIds,
      kb,
      reviewActive,
      currentSessionID: () => session.currentSessionID(),
      activePendingId,
      visibleTabId,
      isPending,
      isBusy: isSessionBusy,
      tabLookup,
      adjacentHint,
      activateTerminal: termHandlers.activate,
      deactivateTerminal: termHandlers.deactivate,
      closeTerminal: (id) => tabFocus.run(() => termHandlers.closeTerminal(id)),
      terminalMiddleClick: (id, event) => tabFocus.middle(event, () => termHandlers.middleClick(id, event)),
      closeReview: closeReviewTab,
      reviewMiddleClick: handleReviewTabMouseDown,
      selectReviewTab: () => setReviewActive(true),
      selectSessionTab,
      sessionMiddleClick: handleTabMouseDown,
      sessionClose: handleCloseTab,
      sessionFork: handleForkSession,
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
      onNewSession: metrics.click("new_session", "tab_bar", handleAddSession),
      onNewTerminal: metrics.click("embedded_terminal", "new_tab_menu", () => termHandlers.requestNew()),
    })

  return (
    <div
      class="am-layout"
      classList={{ "am-layout-hydrated": sidebar.hydrated() }}
      onContextMenu={(e) => e.preventDefault()}
    >
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
                setSidebarWidth(pendingSidebarWidth!)
              })
            }
          }}
        />
        <Show when={multiProject()}>
          <ProjectList
            projects={projectList()}
            states={projectStates()}
            store={(id) => registry.ensure(id)}
            busy={(projectId, id) => registry.ensure(projectId).busy().has(id)}
            working={(projectId, id) => projectBusy(projectId, id)}
            localBusy={(projectId) => projectBusy(projectId, null)}
            stats={projectLive.stats()}
            local={projectLive.local()}
            prs={projectLive.prs()}
            sessions={projectSessionsLive()}
            selectedProject={activeProjectId()}
            selection={selection() ?? undefined}
            currentSessionID={session.currentSessionID}
            mode={mode}
            bindings={kb()}
            t={t}
            onSearchRef={(ref) => (sidebarSearchMenu = ref)}
            onShortcuts={handleShowKeyboardShortcuts}
            shortcutMap={projectShortcutMap}
          />
        </Show>
        <Show when={!multiProject()}>
          <SidebarBody
            t={t}
            selection={selection}
            currentSessionID={session.currentSessionID}
            selectLocal={selectLocal}
            selectWorktree={selectWorktree}
            isLocalBusy={isLocalBusy}
            repoBranch={repoBranch}
            localStats={localStats}
            sessionsCollapsed={sessionsCollapsed}
            toggleSessions={toggleSessions}
            search={{ items: sidebarSearch.items, current: sidebarSearch.current }}
            bindings={kb}
            defaultBranch={repoDefaultBranch}
            isGitRepo={isGitRepo}
            loaded={loaded}
            worktreesLoaded={worktreesLoaded}
            sessionsLoaded={sessionsLoaded}
            onSearchRef={(ref) => (sidebarSearchMenu = ref)}
            onSearchSelect={focusSidebarSearchItem}
            onCreateWorktree={createWorktree}
            onNewWorktree={showNewWorktreeDialog}
            onNewSection={newSection}
            onShortcuts={metrics.click("keyboard_shortcuts", "worktrees_header", handleShowKeyboardShortcuts)}
            onSetup={setupScript}
            onBranch={handleChangeDefaultBaseBranch}
            sections={sections}
            sortedWorktrees={sortedWorktrees}
            worktrees={worktrees}
            ungrouped={ungrouped}
            topLevelItems={topLevelItems}
            worktreesInSection={worktreesInSection}
            sidebarOrder={sidebarOrder}
            sidebarWorktreeOrder={sidebarWorktreeOrder}
            setSidebarWorktreeOrder={setSidebarWorktreeOrder}
            draggingWorktree={draggingWorktree}
            setDraggingWorktree={setDraggingWorktree}
            moveToSection={moveToSection}
            moveSection={moveSection}
            renamingSection={renamingSection}
            setRenamingSection={setRenamingSection}
            managedSessions={managedSessions}
            worktreeLabel={worktreeLabel}
            worktreeSubtitle={worktreeSubtitle}
            pendingDelete={pendingDelete}
            busy={(id) => busyWorktrees().has(id)}
            isAgentBusy={isAgentBusy}
            isStaleWorktree={isStaleWorktree}
            shortcutMap={shortcutMap}
            worktreeStats={worktreeStats}
            prStatuses={prStatuses}
            runStatuses={runStatuses}
            confirmDeleteWorktree={confirmDeleteWorktree}
            handleDeleteWorktree={handleDeleteWorktree}
            confirmRemoveStaleWorktree={confirmRemoveStaleWorktree}
            unassignedSessions={unassignedSessions}
            selectUnassigned={selectUnassigned}
            promoteSession={promoteSession}
            openUnassigned={openUnassigned}
            track={metrics.click}
          />
        </Show>
      </div>

      <div class="am-detail">
        {/* Tab bar — full version with tabs renders when a section is selected
            and has tabs; otherwise a minimal version still renders so the
            sidebar toggle button stays at a fixed position. */}
        <TabBar
          t={t}
          bindings={kb}
          selection={selection}
          empty={contextEmpty}
          collapsed={sidebarCollapsed()}
          onToggleSidebar={toggleSidebar}
          scroll={tabScroll}
          ids={tabIds}
          renderTab={renderTabById}
          newTab={renderAddTab}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onRelease={releaseTabs}
          overlay={draggedTab}
          localStats={localStats}
          worktreeStats={worktreeStats}
          applyState={apply.applyStateForSelection}
          reviewScope={review.scope}
          onOpen={openWindow}
          onApply={openApplyDialog}
          runStatuses={runStatuses}
          runConfigured={runScriptConfigured}
          onRun={(id) => runWorktree(id, sideCtl.destination())}
          onConfigureRun={configureRunScript}
          diffOpen={diffOpen}
          reviewActive={reviewActive}
          onToggleDiff={toggleDiffPanel}
          onToggleReview={metrics.click("fullscreen_review", "tab_toolbar", toggleReviewTab)}
          terminalDestination={sideCtl.destination}
          terminalDestinationActive={() => sidePanel() === "terminal"}
          terminalKeybind={() => kb().showTerminal ?? ""}
          onTerminalDestinationOpen={() => {
            cancelAmbientSetup()
            sideCtl.openPreferred("tab_toolbar")
          }}
          onTerminalDestinationChoose={sideCtl.choose}
          track={metrics.click}
        />

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
                  <span>
                    {state().errorCode ? t(`agentManager.setup.error.${state().errorCode}`) : state().message}
                  </span>
                </div>
              </div>
            </div>
          )}
        </Show>
        <Show when={history()}>
          <HistoryView
            onSelectSession={(id) => {
              if (addSessionToCurrentWorktree(id)) return
              setHistory(false)
              if (localSessionIDs().includes(id)) {
                saveTabMemory()
                session.selectSession(id)
                setSelection(LOCAL)
                requestChatFocus(true)
                return
              }
              const ms = worktreeSessionIds().has(id) ? managedSessions().find((s) => s.id === id) : undefined
              if (ms?.worktreeId) {
                selectWorktree(ms.worktreeId)
                session.selectSession(id)
                setReviewActive(false)
                requestChatFocus()
                return
              }
              openLocally(id)
            }}
            onBack={() => setHistory(false)}
            worktreeSessionIds={activeWorktreeSessionIds}
          />
        </Show>
        <Show when={showDetailStack()}>
          {/* Terminal overlay is scoped to the main pane so it does not cover the tab bar or side panel. */}
          <div class="am-detail-stack">
            {/* Chat/terminal + side diff panel. Keep it mounted under the
                review tab so live xterm canvases never leave the paint tree. */}
            <div
              class={`am-detail-content ${sidePanel() !== null ? "am-detail-split" : ""} ${reviewActive() ? "am-detail-content-hidden" : ""}`}
            >
              <div class={`am-main-pane ${terms.activeId() ? "am-main-pane-terminal-active" : ""}`}>
                {/* Keep terminal tabs mounted so output streams across worktree switches. */}
                {renderTerminalLayer({ state: terms })}
                {/* Session-less context (e.g. a worktree mid-provisioning): the
                    empty state lives in the main pane so the side terminal
                    panel can render next to it. */}
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
                <Show when={!contextEmpty()}>
                  <div class="am-chat-wrapper">
                    <ChatView
                      onSelectSession={(id) => {
                        if (addSessionToCurrentWorktree(id)) return
                        if (localSessionIDs().includes(id)) {
                          session.selectSession(id)
                          if (selection() === null) setSelection(LOCAL)
                          requestChatFocus()
                          return
                        }
                        // Navigate to owning worktree instead of forcing into local mode
                        if (worktreeSessionIds().has(id)) {
                          const ms = managedSessions().find((s) => s.id === id)
                          if (ms?.worktreeId) {
                            selectWorktree(ms.worktreeId)
                            session.selectSession(id)
                            setReviewActive(false)
                            requestChatFocus()
                            return
                          }
                        }
                        openLocally(id)
                      }}
                      onShowHistory={() => setHistory(true)}
                      onForkMessage={readOnly() ? undefined : handleForkSession}
                      onForkSession={readOnly() ? undefined : handleForkSession}
                      readonly={readOnly()}
                      continueInWorktree={selection() === LOCAL}
                      promptBoxId={`agent-manager:${selection() ?? "unassigned"}`}
                      deferFocusToQuestion={hasQuestionOption}
                      pendingSessionID={selection() === LOCAL ? activePendingId() : undefined}
                      focusOnDraftChange={focusOnDraftChange}
                      onFocusChange={rememberPromptFocus}
                    />
                    <Show when={readOnly()}>
                      <div class="am-readonly-banner">
                        <Icon name="branch" size="small" />
                        <span class="am-readonly-text">{t("agentManager.session.readonly")}</span>
                        <Button
                          variant="secondary"
                          size="small"
                          onClick={() => {
                            if (!loaded()) return
                            const sid = session.currentSessionID()
                            if (!sid) return
                            metrics.track("open_session_locally", "readonly_banner")
                            openLocally(sid)
                          }}
                        >
                          {t("agentManager.session.openLocally")}
                        </Button>
                        <Button
                          variant="primary"
                          size="small"
                          onClick={() => {
                            if (!loaded()) return
                            const sid = session.currentSessionID()
                            if (!sid) return
                            metrics.track("promote_session", "readonly_banner")
                            vscode.postMessage({ type: "agentManager.promoteSession", sessionId: sid })
                          }}
                        >
                          {t("agentManager.session.openInWorktree")}
                        </Button>
                      </div>
                    </Show>
                  </div>
                </Show>
              </div>
              {/* One inspector host for all right-side modes. It stays
                  mounted while a side terminal is alive — hidden via
                  .am-side-host-hidden (absolute + opacity), never
                  unmounted, so xterm render loops keep streaming. */}
              <Show when={sidePanel() !== null || terms.sides().length > 0}>
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
                    <Show when={sidePanel() === "diff"}>
                      <DiffPanel
                        diffs={reviewDiffs()}
                        loading={diffLoading()}
                        loadingFiles={diffFileLoadingForCurrent()}
                        sessionId={activeDiffSession()}
                        sessionKey={diffSessionKey()}
                        notice={diffNotice()}
                        lead={diffScopeControls(true)}
                        canRevert={scopeCapabilities(review.scope()).revert}
                        diffStyle={reviewDiffStyle()}
                        onDiffStyleChange={setSharedDiffStyle}
                        markdownRender={markdown.render()}
                        onMarkdownRenderChange={markdown.update}
                        comments={reviewComments()}
                        onCommentsChange={setReviewCommentsForSelection}
                        composer={reviewComposer}
                        onSendClick={() => metrics.track("send_review_comments", "side_review")}
                        onClose={metrics.click("side_review_close", "side_review", () => setSidePanel(null))}
                        onExpand={
                          selection() !== null
                            ? metrics.click("fullscreen_review", "side_review", openReviewTab, { action: "open" })
                            : undefined
                        }
                        onRequestDiff={requestDiffFile}
                        onOpenFile={(file, line) => {
                          const id = diffCtx()
                          if (id)
                            vscode.postMessage({ type: "agentManager.openFile", sessionId: id, filePath: file, line })
                        }}
                        onRevertFile={metrics.use("revert_file", "side_review", revertCtl.revert)}
                        revertingFiles={revertCtl.reverting()}
                        activeTerminalId={terms.activeId()}
                      />
                    </Show>
                    <SideTerminalPanel
                      state={terms}
                      contextKey={terms.sideKey}
                      visible={() => sidePanel() === "terminal"}
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
            </div>
            {/* Full-screen review tab (lazy-mounted, stays alive once opened for fast toggle) */}
            <Show when={reviewOpen()}>
              <div class="am-review-host" style={{ display: reviewActive() && !terms.activeId() ? undefined : "none" }}>
                <FullScreenDiffView
                  diffs={reviewDiffs()}
                  loading={diffLoading()}
                  loadingFiles={diffFileLoadingForCurrent()}
                  sessionId={activeDiffSession()}
                  sessionKey={diffSessionKey()}
                  notice={diffNotice()}
                  lead={diffScopeControls(false)}
                  canRevert={scopeCapabilities(review.scope()).revert}
                  canComment={scopeCapabilities(review.scope()).comments}
                  comments={reviewComments()}
                  onCommentsChange={setReviewCommentsForSelection}
                  composer={reviewComposer}
                  onSendAll={closeReviewTab}
                  onSendClick={() => metrics.track("send_review_comments", "fullscreen_review")}
                  diffStyle={reviewDiffStyle()}
                  onDiffStyleChange={setSharedDiffStyle}
                  markdownRender={markdown.render()}
                  onMarkdownRenderChange={markdown.update}
                  onRequestDiff={requestDiffFile}
                  onOpenFile={(file, line) => {
                    const id = diffCtx()
                    if (id) vscode.postMessage({ type: "agentManager.openFile", sessionId: id, filePath: file, line })
                  }}
                  onRevertFile={metrics.use("revert_file", "fullscreen_review", revertCtl.revert)}
                  revertingFiles={revertCtl.reverting()}
                  activeTerminalId={terms.activeId()}
                  onClose={metrics.click("fullscreen_review", "fullscreen_review", closeReviewTab, { action: "close" })}
                />
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}

export const AgentManagerApp: Component = () => {
  return (
    <ProviderShell.Root>
      <ProviderShell.Session>
        <ProviderShell.Chat>
          <WorktreeModeProvider>
            <DataBridge>
              <AgentManagerContent />
            </DataBridge>
          </WorktreeModeProvider>
        </ProviderShell.Chat>
      </ProviderShell.Session>
    </ProviderShell.Root>
  )
}
