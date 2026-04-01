// Agent Manager root component

import {
  Component,
  For,
  Show,
  createSignal,
  createMemo,
  createEffect,
  createRoot,
  on,
  onMount,
  onCleanup,
  type Accessor,
} from "solid-js"
import type {
  ExtensionMessage,
  AgentManagerRepoInfoMessage,
  AgentManagerWorktreeSetupMessage,
  AgentManagerStateMessage,
  AgentManagerKeybindingsMessage,
  AgentManagerMultiVersionProgressMessage,
  AgentManagerSendInitialMessage,
  AgentManagerBranchesMessage,
  AgentManagerWorktreeDiffMessage,
  AgentManagerWorktreeDiffFileMessage,
  AgentManagerWorktreeDiffLoadingMessage,
  AgentManagerApplyWorktreeDiffResultMessage,
  AgentManagerApplyWorktreeDiffStatus,
  AgentManagerApplyWorktreeDiffConflict,
  AgentManagerWorktreeStatsMessage,
  AgentManagerLocalStatsMessage,
  WorktreeFileDiff,
  WorktreeGitStats,
  LocalGitStats,
  WorktreeState,
  ManagedSessionState,
  SessionInfo,
  BranchInfo,
} from "../src/types/messages"
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  closestCenter,
  createSortable,
  useDragDropContext,
} from "@thisbeyond/solid-dnd"
import type { DragEvent, Transformer } from "@thisbeyond/solid-dnd"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { DialogProvider, useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { FileComponentProvider } from "@kilocode/kilo-ui/context/file"
import { Code } from "@kilocode/kilo-ui/code"
import { Diff } from "@kilocode/kilo-ui/diff"
import { File } from "@kilocode/kilo-ui/file"
import { Toast, showToast } from "@kilocode/kilo-ui/toast"
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
import { NotificationsProvider } from "../src/context/notifications"
import { SessionProvider, useSession } from "../src/context/session"
import { WorktreeModeProvider } from "../src/context/worktree-mode"
import { ChatView } from "../src/components/chat"
import { NewWorktreeDialog } from "./NewWorktreeDialog"
import { LanguageBridge, DataBridge } from "../src/App"
import { useLanguage } from "../src/context/language"
import { formatRelativeDate } from "../src/utils/date"
import { validateLocalSession, nextSelectionAfterDelete, adjacentHint, LOCAL } from "./navigate"
import { reorderTabs, applyTabOrder, firstOrderedTitle } from "./tab-order"
import { ConstrainDragYAxis, SortableReviewTab, SortableTab } from "./sortable-tab"
import { DiffPanel } from "./DiffPanel"
import { FullScreenDiffView } from "./FullScreenDiffView"
import { ApplyDialog } from "./ApplyDialog"
import { groupApplyConflicts } from "./apply-conflicts"
import type { ReviewComment } from "./review-comments"
import { BranchSelect } from "./BranchSelect"
import { WorktreeItem } from "./WorktreeItem"
import { mergeWorktreeDiffs } from "./diff-state"
import "./agent-manager.css"
import "./agent-manager-review.css"

const REVIEW_TAB_ID = "review"

interface SetupState {
  active: boolean
  message: string
  branch?: string
  error?: boolean
  worktreeId?: string
  errorCode?: string
}

interface WorktreeBusyState {
  reason: "setting-up" | "deleting"
  message?: string
  branch?: string
}

interface ApplyState {
  status: AgentManagerApplyWorktreeDiffStatus
  message: string
  conflicts: AgentManagerApplyWorktreeDiffConflict[]
}

/** Sidebar selection: LOCAL for local repo, worktree ID for a worktree, or null for an unassigned session. */
type SidebarSelection = typeof LOCAL | string | null

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

// Fallback keybindings before extension sends resolved ones
const MAX_JUMP_INDEX = 9

const defaultBindings: Record<string, string> = {
  previousSession: isMac ? "⌘⌥↑" : "Ctrl+Alt+↑",
  nextSession: isMac ? "⌘⌥↓" : "Ctrl+Alt+↓",
  previousTab: isMac ? "⌘⌥←" : "Ctrl+Alt+←",
  nextTab: isMac ? "⌘⌥→" : "Ctrl+Alt+→",
  showTerminal: isMac ? "⌘/" : "Ctrl+/",
  toggleDiff: isMac ? "⌘D" : "Ctrl+D",
  showShortcuts: isMac ? "⌘⇧/" : "Ctrl+Shift+/",
  newTab: isMac ? "⌘T" : "Ctrl+T",
  closeTab: isMac ? "⌘W" : "Ctrl+W",
  newWorktree: isMac ? "⌘N" : "Ctrl+N",
  advancedWorktree: isMac ? "⌘⇧N" : "Ctrl+Shift+N",
  closeWorktree: isMac ? "⌘⇧W" : "Ctrl+Shift+W",
  openWorktree: isMac ? "⌘⇧O" : "Ctrl+Shift+O",
  agentManagerOpen: isMac ? "⌘⇧M" : "Ctrl+Shift+M",
  cycleAgentMode: isMac ? "⌘." : "Ctrl+.",
  cyclePreviousAgentMode: isMac ? "⌘⇧." : "Ctrl+Shift+.",
  ...Object.fromEntries(
    Array.from({ length: MAX_JUMP_INDEX }, (_, i) => [`jumpTo${i + 1}`, isMac ? `⌘${i + 1}` : `Ctrl+${i + 1}`]),
  ),
}

/** Manages horizontal scroll for the tab list: hides the scrollbar, converts
 *  vertical wheel events to horizontal scroll, tracks overflow to show/hide
 *  fade indicators, and auto-scrolls the active tab into view. */
function useTabScroll(activeTabs: Accessor<SessionInfo[]>, activeId: Accessor<string | undefined>) {
  const [ref, setRef] = createSignal<HTMLDivElement | undefined>()
  const [showLeft, setShowLeft] = createSignal(false)
  const [showRight, setShowRight] = createSignal(false)

  let scrollFrame: number | undefined
  const update = () => {
    if (scrollFrame !== undefined) return
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined
      const el = ref()
      if (!el) return
      setShowLeft(el.scrollLeft > 2)
      setShowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
    })
  }

  // Wheel → horizontal scroll conversion
  const onWheel = (e: WheelEvent) => {
    const el = ref()
    if (!el) return
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    e.preventDefault()
    el.scrollLeft += e.deltaY > 0 ? 60 : -60
  }

  // Recalculate on scroll, resize, or tab changes
  createEffect(() => {
    const el = ref()
    if (!el) return
    el.addEventListener("scroll", update, { passive: true })
    el.addEventListener("wheel", onWheel, { passive: false })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    const mo = new MutationObserver(update)
    mo.observe(el, { childList: true, subtree: true })
    onCleanup(() => {
      el.removeEventListener("scroll", update)
      el.removeEventListener("wheel", onWheel)
      ro.disconnect()
      mo.disconnect()
    })
  })

  // Auto-scroll active tab into view
  createEffect(() => {
    const id = activeId()
    const el = ref()
    // depend on tabs length to trigger on tab add/remove
    activeTabs()
    if (!id || !el) return
    requestAnimationFrame(() => {
      const tab = el.querySelector(`[data-tab-id="${id}"]`) as HTMLElement | null
      if (!tab) return
      const left = tab.offsetLeft
      const right = left + tab.offsetWidth
      if (left < el.scrollLeft) {
        el.scrollTo({ left: left - 8, behavior: "smooth" })
      } else if (right > el.scrollLeft + el.clientWidth) {
        el.scrollTo({ left: right - el.clientWidth + 8, behavior: "smooth" })
      }
    })
  })

  return { setRef, showLeft, showRight }
}

/** Shortcut category definition for the keyboard shortcuts dialog */
interface ShortcutEntry {
  label: string
  binding: string
}

interface ShortcutCategory {
  title: string
  shortcuts: ShortcutEntry[]
}

/** Build the categorized list of keyboard shortcuts from the current bindings */
function buildShortcutCategories(
  bindings: Record<string, string>,
  t: (key: string, params?: Record<string, string | number>) => string,
): ShortcutCategory[] {
  return [
    {
      title: t("agentManager.shortcuts.category.quickSwitch"),
      shortcuts: [
        {
          label: t("agentManager.shortcuts.jumpToItem"),
          binding: (() => {
            const first = bindings.jumpTo1 ?? ""
            const prefix = first.replace(/\d+$/, "")
            return prefix ? `${prefix}1-9` : ""
          })(),
        },
      ],
    },
    {
      title: t("agentManager.shortcuts.category.sidebar"),
      shortcuts: [
        { label: t("agentManager.shortcuts.previousItem"), binding: bindings.previousSession ?? "" },
        { label: t("agentManager.shortcuts.nextItem"), binding: bindings.nextSession ?? "" },
        { label: t("agentManager.shortcuts.newWorktree"), binding: bindings.newWorktree ?? "" },
        { label: t("agentManager.shortcuts.advancedWorktree"), binding: bindings.advancedWorktree ?? "" },
        { label: t("agentManager.shortcuts.deleteWorktree"), binding: bindings.closeWorktree ?? "" },
        { label: t("agentManager.shortcuts.openWorktree"), binding: bindings.openWorktree ?? "" },
      ],
    },
    {
      title: t("agentManager.shortcuts.category.tabs"),
      shortcuts: [
        { label: t("agentManager.shortcuts.previousTab"), binding: bindings.previousTab ?? "" },
        { label: t("agentManager.shortcuts.nextTab"), binding: bindings.nextTab ?? "" },
        { label: t("agentManager.shortcuts.newTab"), binding: bindings.newTab ?? "" },
        { label: t("agentManager.shortcuts.closeTab"), binding: bindings.closeTab ?? "" },
      ],
    },
    {
      title: t("agentManager.shortcuts.category.terminal"),
      shortcuts: [
        { label: t("agentManager.shortcuts.toggleTerminal"), binding: bindings.showTerminal ?? "" },
        { label: t("agentManager.shortcuts.toggleDiff"), binding: bindings.toggleDiff ?? "" },
      ],
    },
    {
      title: t("agentManager.shortcuts.category.global"),
      shortcuts: [
        { label: t("agentManager.shortcuts.openAgentManager"), binding: bindings.agentManagerOpen ?? "" },
        { label: t("agentManager.shortcuts.cycleAgentMode"), binding: bindings.cycleAgentMode ?? "" },
        { label: t("agentManager.shortcuts.cyclePreviousAgentMode"), binding: bindings.cyclePreviousAgentMode ?? "" },
        { label: t("agentManager.shortcuts.showShortcuts"), binding: bindings.showShortcuts ?? "" },
      ].filter((s) => s.binding),
    },
  ].filter((c) => c.shortcuts.length > 0)
}

import { parseBindingTokens } from "./keybind-tokens"

const AgentManagerContent: Component = () => {
  const { t } = useLanguage()
  const session = useSession()
  const vscode = useVSCode()
  const dialog = useDialog()

  const [kb, setKb] = createSignal<Record<string, string>>(defaultBindings)

  const [setup, setSetup] = createSignal<SetupState>({ active: false, message: "" })
  const [worktrees, setWorktrees] = createSignal<WorktreeState[]>([])
  const [managedSessions, setManagedSessions] = createSignal<ManagedSessionState[]>([])
  const [selection, setSelection] = createSignal<SidebarSelection>(LOCAL)
  const [repoBranch, setRepoBranch] = createSignal<string | undefined>()
  const [busyWorktrees, setBusyWorktrees] = createSignal<Map<string, WorktreeBusyState>>(new Map())
  const [staleWorktreeIds, setStaleWorktreeIds] = createSignal<Set<string>>(new Set())
  const [worktreesLoaded, setWorktreesLoaded] = createSignal(false)
  const [sessionsLoaded, setSessionsLoaded] = createSignal(false)
  const [isGitRepo, setIsGitRepo] = createSignal(true)
  const [repoDetectedBranch, setRepoDetectedBranch] = createSignal<string | undefined>()
  const [defaultBaseBranch, setDefaultBaseBranch] = createSignal<string | undefined>()

  const repoDefaultBranch = () => defaultBaseBranch() ?? repoDetectedBranch() ?? "main"
  const hasConfiguredBranch = () => !!defaultBaseBranch()

  const DEFAULT_SIDEBAR_WIDTH = 260
  const MIN_SIDEBAR_WIDTH = 200
  const MAX_SIDEBAR_WIDTH_RATIO = 0.4

  // Recover persisted local session IDs from webview state
  const persisted = vscode.getState<{ localSessionIDs?: string[]; sidebarWidth?: number }>()
  const [localSessionIDs, setLocalSessionIDs] = createSignal<string[]>(persisted?.localSessionIDs ?? [])
  const [sidebarWidth, setSidebarWidth] = createSignal(persisted?.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH)
  const [sessionsCollapsed, setSessionsCollapsed] = createSignal(false)

  // rAF coalescing for resize handlers — at most one signal write per frame
  let sidebarRaf: number | undefined
  let pendingSidebarWidth: number | undefined
  let diffRaf: number | undefined
  let pendingDiffWidth: number | undefined

  // Diff panel state
  const [diffOpen, setDiffOpen] = createSignal(false)
  const [diffDatas, setDiffDatas] = createSignal<Record<string, WorktreeFileDiff[]>>({})
  const [diffLoading, setDiffLoading] = createSignal(false)
  const [diffFileLoading, setDiffFileLoading] = createSignal<Record<string, Record<string, true>>>({})
  const [diffWidth, setDiffWidth] = createSignal(Math.round(window.innerWidth * 0.5))

  // Full-screen review state (in-memory, per sidebar context: local/worktree)
  const [reviewOpenByContext, setReviewOpenByContext] = createSignal<Record<string, boolean>>({})
  const [reviewCommentsByContext, setReviewCommentsByContext] = createSignal<Record<string, ReviewComment[]>>({})
  const [reviewActive, setReviewActive] = createSignal(false)
  const [reviewDiffStyle, setReviewDiffStyle] = createSignal<"unified" | "split">("unified")
  // reviewOpen (memo below) controls tab presence for selected context.

  // Per-worktree git stats (diff additions/deletions, commits missing from origin)
  const [worktreeStats, setWorktreeStats] = createSignal<Record<string, WorktreeGitStats>>({})

  // Local repo git stats (branch name, diff additions/deletions, commits)
  const [localStats, setLocalStats] = createSignal<LocalGitStats | undefined>()

  // Per-worktree apply-to-local status
  const [applyStates, setApplyStates] = createSignal<Record<string, ApplyState>>({})
  const [applyTarget, setApplyTarget] = createSignal<string | undefined>()
  const [applySelectedFiles, setApplySelectedFiles] = createSignal<string[]>([])
  const [applySelectionTouched, setApplySelectionTouched] = createSignal(false)

  // Pending local tab counter for generating unique IDs
  let pendingCounter = 0
  const PENDING_PREFIX = "pending:"
  const [activePendingId, setActivePendingId] = createSignal<string | undefined>()

  // Inline delete confirmation: tracks which worktree is awaiting a second click/press
  const [pendingDelete, setPendingDelete] = createSignal<string | null>(null)
  let pendingDeleteTimer: ReturnType<typeof setTimeout> | undefined
  const cancelPendingDelete = () => {
    clearTimeout(pendingDeleteTimer)
    setPendingDelete(null)
  }
  createEffect(on(selection, () => cancelPendingDelete(), { defer: true }))
  onCleanup(() => clearTimeout(pendingDeleteTimer))

  // Per-context tab memory: maps sidebar selection key -> last active session/pending ID
  const [tabMemory, setTabMemory] = createSignal<Record<string, string>>({})

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

  const applyStateForSelection = createMemo(() => {
    const sel = selection()
    if (!sel || sel === LOCAL) return undefined
    return applyStates()[sel]
  })

  const resolveWorktreeSessionId = (worktreeId: string) => {
    const id = session.currentSessionID()
    if (id) {
      const current = managedSessions().find((entry) => entry.id === id)
      if (current?.worktreeId === worktreeId) return id
    }
    return managedSessions().find((entry) => entry.worktreeId === worktreeId)?.id
  }

  const applyTargetSessionId = createMemo(() => {
    const target = applyTarget()
    if (!target) return undefined
    return resolveWorktreeSessionId(target)
  })

  const applyDiffs = createMemo(() => {
    const target = applyTarget()
    if (!target) return [] as WorktreeFileDiff[]
    const data = diffDatas()
    const current = applyTargetSessionId()
    if (current && data[current]) return data[current]!
    const ids = managedSessions()
      .filter((entry) => entry.worktreeId === target)
      .map((entry) => entry.id)
    for (const id of ids) {
      if (data[id]) return data[id]!
    }
    return [] as WorktreeFileDiff[]
  })

  const applyStateForTarget = createMemo(() => {
    const target = applyTarget()
    if (!target) return undefined
    return applyStates()[target]
  })

  const applyBusyForTarget = createMemo(() => {
    const state = applyStateForTarget()
    if (!state) return false
    return state.status === "checking" || state.status === "applying"
  })

  const applySelectedSet = createMemo(() => new Set(applySelectedFiles()))

  const applySelectionStats = createMemo(() => {
    const set = applySelectedSet()
    const selected = applyDiffs().filter((diff) => set.has(diff.file))
    const additions = selected.reduce((sum, diff) => sum + diff.additions, 0)
    const deletions = selected.reduce((sum, diff) => sum + diff.deletions, 0)
    return {
      total: applyDiffs().length,
      selected: selected.length,
      additions,
      deletions,
    }
  })

  const applyHasSelection = createMemo(() => applySelectionStats().selected > 0)

  const applyConflictRows = createMemo(() => groupApplyConflicts(applyStateForTarget()?.conflicts ?? []))

  const applyToLocal = (worktreeId: string, selectedFiles: string[]) => {
    setApplyStates((prev) => ({
      ...prev,
      [worktreeId]: {
        status: "checking",
        message: t("agentManager.apply.checking"),
        conflicts: [],
      },
    }))
    vscode.postMessage({ type: "agentManager.applyWorktreeDiff", worktreeId, selectedFiles })
  }

  const resetApplyDialog = () => {
    setApplyTarget(undefined)
    setApplySelectedFiles([])
    setApplySelectionTouched(false)
  }

  const closeApplyDialog = () => {
    resetApplyDialog()
    dialog.close()
  }

  const applySelectAll = () => {
    setApplySelectionTouched(true)
    setApplySelectedFiles(applyDiffs().map((diff) => diff.file))
  }

  const applySelectNone = () => {
    setApplySelectionTouched(true)
    setApplySelectedFiles([])
  }

  const applyToggleFile = (file: string, checked: boolean) => {
    setApplySelectionTouched(true)
    setApplySelectedFiles((prev) => {
      if (checked) {
        if (prev.includes(file)) return prev
        const set = new Set(prev)
        set.add(file)
        return applyDiffs()
          .map((diff) => diff.file)
          .filter((path) => set.has(path))
      }
      if (!prev.includes(file)) return prev
      return prev.filter((path) => path !== file)
    })
  }

  const triggerApply = () => {
    const target = applyTarget()
    if (!target) return
    if (!applyHasSelection()) return
    if (applyBusyForTarget()) return
    applyToLocal(target, applySelectedFiles())
  }

  const openApplyDialog = () => {
    const sel = selection()
    if (!sel || sel === LOCAL) return
    setApplyStates((prev) => {
      if (!prev[sel]) return prev
      const next = { ...prev }
      delete next[sel]
      return next
    })
    setApplyTarget(sel)
    setApplySelectionTouched(false)
    setApplySelectedFiles([])
    const sid = resolveWorktreeSessionId(sel)
    if (sid) vscode.postMessage({ type: "agentManager.requestWorktreeDiff", sessionId: sid })

    setApplySelectedFiles(applyDiffs().map((diff) => diff.file))

    dialog.show(
      () => (
        <ApplyDialog
          diffs={applyDiffs()}
          loading={diffLoading()}
          selectedFiles={applySelectedSet()}
          selectedCount={applySelectionStats().selected}
          additions={applySelectionStats().additions}
          deletions={applySelectionStats().deletions}
          busy={applyBusyForTarget()}
          hasSelection={applyHasSelection()}
          status={applyStateForTarget()?.status}
          message={applyStateForTarget()?.message}
          conflictRows={applyConflictRows()}
          onSelectAll={applySelectAll}
          onSelectNone={applySelectNone}
          onToggleFile={applyToggleFile}
          onApply={triggerApply}
          onClose={closeApplyDialog}
        />
      ),
      resetApplyDialog,
    )
  }

  const openWorktreeDirectory = () => {
    const sel = selection()
    if (!sel || sel === LOCAL) return
    vscode.postMessage({ type: "agentManager.openWorktree", worktreeId: sel })
  }

  createEffect(
    on(
      () => [applyTarget(), applyDiffs(), applySelectionTouched()] as const,
      ([target, diffs, touched]) => {
        if (!target) return
        const files = diffs.map((diff) => diff.file)
        if (files.length === 0) {
          if (!touched) setApplySelectedFiles([])
          return
        }

        if (!touched) {
          setApplySelectedFiles(files)
          return
        }

        const current = applySelectedFiles()
        const set = new Set(current)
        const next = files.filter((file) => set.has(file))
        const same = next.length === current.length && next.every((file, index) => file === current[index])
        if (!same) setApplySelectedFiles(next)
      },
    ),
  )

  const isPending = (id: string) => id.startsWith(PENDING_PREFIX)

  // Drag-and-drop state for tab reordering
  const [draggingTab, setDraggingTab] = createSignal<string | undefined>()
  // Tab ordering: context key → ordered session ID array (recovered from extension state)
  const [worktreeTabOrder, setWorktreeTabOrder] = createSignal<Record<string, string[]>>({})
  // Sidebar worktree order (persisted to extension state)
  const [sidebarWorktreeOrder, setSidebarWorktreeOrder] = createSignal<string[]>([])
  const [draggingWorktree, setDraggingWorktree] = createSignal<string | undefined>()

  const addPendingTab = () => {
    const id = `${PENDING_PREFIX}${++pendingCounter}`
    setLocalSessionIDs((prev) => [...prev, id])
    setActivePendingId(id)
    session.clearCurrentSession()
    return id
  }

  // Persist local session IDs and sidebar width to webview state for recovery (exclude pending tabs).
  // Debounced to avoid serializing state on every pixel during resize drag.
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    // Read signals eagerly so Solid tracks them as dependencies
    const ids = localSessionIDs().filter((id) => !isPending(id))
    const width = sidebarWidth()
    clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      const prev = vscode.getState<Record<string, unknown>>() ?? {}
      vscode.setState({ ...prev, localSessionIDs: ids, sidebarWidth: width })
    }, 300)
  })
  onCleanup(() => clearTimeout(persistTimer))

  // Save the currently active tab for the current sidebar context before switching away
  const saveTabMemory = () => {
    const sel = selection()
    if (sel === null) return
    const key = sel === LOCAL ? LOCAL : sel
    const active = reviewActive() ? REVIEW_TAB_ID : (session.currentSessionID() ?? activePendingId())
    if (active) {
      setTabMemory((prev) => (prev[key] === active ? prev : { ...prev, [key]: active }))
    }
  }

  // Invalidate local session IDs if they no longer exist (preserve pending tabs)
  createEffect(() => {
    const all = session.sessions()
    if (all.length === 0) return // sessions not loaded yet
    const ids = all.map((s) => s.id)
    const valid = localSessionIDs().filter((lid) => isPending(lid) || validateLocalSession(lid, ids))
    if (valid.length !== localSessionIDs().length) {
      setLocalSessionIDs(valid)
    }
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

    setApplyStates((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([id]) => ids.has(id)))
      if (Object.keys(next).length === Object.keys(prev).length) return prev
      return next
    })

    const target = applyTarget()
    if (target && !ids.has(target)) closeApplyDialog()
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
    [...session.sessions()]
      .filter((s) => !worktreeSessionIds().has(s.id) && !localSet().has(s.id))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  )

  // Local sessions (resolved from session list + pending tabs, in insertion order)
  const localSessions = createMemo((): SessionInfo[] => {
    const ids = localSessionIDs()
    const all = session.sessions()
    const lookup = new Map(all.map((s) => [s.id, s]))
    const result: SessionInfo[] = []
    const now = new Date().toISOString()
    for (const id of ids) {
      const real = lookup.get(id)
      if (real) {
        result.push(real)
      } else if (isPending(id)) {
        result.push({ id, title: t("agentManager.session.newSession"), createdAt: now, updatedAt: now })
      }
    }
    return result
  })

  // Sessions for the currently selected worktree (tab bar), respecting custom order if set
  const activeWorktreeSessions = createMemo((): SessionInfo[] => {
    const sel = selection()
    if (!sel || sel === LOCAL) return []
    const managed = managedSessions().filter((ms) => ms.worktreeId === sel)
    const ids = new Set(managed.map((ms) => ms.id))
    const sessions = session
      .sessions()
      .filter((s) => ids.has(s.id))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    return applyTabOrder(sessions, worktreeTabOrder()[sel])
  })

  // Active tab sessions: local sessions when on "local", worktree sessions otherwise
  const activeTabs = createMemo((): SessionInfo[] => {
    const sel = selection()
    if (sel === LOCAL) return localSessions()
    if (sel) return activeWorktreeSessions()
    return []
  })

  // Whether the selected context has zero sessions
  const contextEmpty = createMemo(() => {
    const sel = selection()
    if (sel === LOCAL) return localSessionIDs().length === 0
    if (sel) return activeWorktreeSessions().length === 0
    return false
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

  // Scroll the sidebar to the focused item whenever selection changes (covers keyboard
  // navigation, new worktree creation, and any other programmatic selection change).
  createEffect(() => {
    const id = selection() ?? session.currentSessionID()
    if (!id) return
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-sidebar-id="${id}"]`)
      if (el instanceof HTMLElement) scrollIntoView(el)
    })
  })

  // Read-only mode: viewing an unassigned session (not in a worktree or local)
  const readOnly = createMemo(() => selection() === null && !!session.currentSessionID())

  // Tab scroll: hidden scrollbar with fade overflow indicators
  const visibleTabId = createMemo(() =>
    reviewActive() ? REVIEW_TAB_ID : (session.currentSessionID() ?? activePendingId()),
  )
  const tabScroll = useTabScroll(activeTabs, visibleTabId)

  // Display name for worktree — prefers persisted label, then first session title, then branch
  const worktreeLabel = (wt: WorktreeState): string => {
    if (wt.label) return wt.label
    const managed = managedSessions().filter((ms) => ms.worktreeId === wt.id)
    const ids = new Set(managed.map((ms) => ms.id))
    const sessions = session.sessions().filter((s) => ids.has(s.id))
    return firstOrderedTitle(sessions, worktreeTabOrder()[wt.id], wt.branch)
  }

  const isStaleWorktree = (worktreeId: string): boolean => staleWorktreeIds().has(worktreeId)

  /** True when any session in the given ID list is actively working (busy/retry and not blocked by permissions/questions). */
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

  /** Worktrees sorted so that grouped items are always adjacent, respecting custom order if set. */
  const sortedWorktrees = createMemo(() => {
    const ordered = applyTabOrder(worktrees(), sidebarWorktreeOrder())
    if (ordered.length === 0) return []

    // Collect grouped worktrees by groupId
    const grouped = new Map<string, WorktreeState[]>()
    for (const wt of ordered) {
      if (!wt.groupId) continue
      const list = grouped.get(wt.groupId) ?? []
      list.push(wt)
      grouped.set(wt.groupId, list)
    }

    // Build output: interleave groups at the position of their earliest member
    const result: WorktreeState[] = []
    const placed = new Set<string>()
    for (const wt of ordered) {
      if (placed.has(wt.id)) continue
      if (wt.groupId) {
        if (placed.has(wt.groupId)) continue
        placed.add(wt.groupId)
        const group = grouped.get(wt.groupId) ?? []
        for (const g of group) {
          result.push(g)
          placed.add(g.id)
        }
      } else {
        result.push(wt)
        placed.add(wt.id)
      }
    }
    return result
  })

  /** Check if this worktree is part of a group. */
  const isGrouped = (wt: WorktreeState) => !!wt.groupId

  /** Check if this is the first item in its group. */
  const isGroupStart = (wt: WorktreeState, idx: number) => {
    if (!wt.groupId) return false
    const list = sortedWorktrees()
    if (idx === 0) return true
    return list[idx - 1]?.groupId !== wt.groupId
  }

  /** Check if this is the last item in its group. */
  const isGroupEnd = (wt: WorktreeState, idx: number) => {
    if (!wt.groupId) return false
    const list = sortedWorktrees()
    if (idx === list.length - 1) return true
    return list[idx + 1]?.groupId !== wt.groupId
  }

  const scrollIntoView = (el: HTMLElement) => {
    el.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }

  // Navigate sidebar items with arrow keys
  const navigate = (direction: "up" | "down") => {
    const flat: { type: typeof LOCAL | "wt" | "session"; id: string }[] = [
      { type: LOCAL, id: LOCAL },
      ...sortedWorktrees().map((wt) => ({ type: "wt" as const, id: wt.id })),
      ...unassignedSessions().map((s) => ({ type: "session" as const, id: s.id })),
    ]
    if (flat.length === 0) return

    const current = selection() ?? session.currentSessionID()
    const idx = current ? flat.findIndex((f) => f.id === current) : -1
    const next = direction === "up" ? idx - 1 : idx + 1
    if (next < 0 || next >= flat.length) return

    const item = flat[next]!
    if (item.type === LOCAL) {
      selectLocal()
    } else if (item.type === "wt") {
      selectWorktree(item.id)
    } else {
      saveTabMemory()
      setSelection(null)
      setReviewActive(false)
      session.selectSession(item.id)
    }

    const el = document.querySelector(`[data-sidebar-id="${item.id}"]`)
    if (el instanceof HTMLElement) scrollIntoView(el)
  }

  // Jump to sidebar item by 1-based index (⌘1 = LOCAL, ⌘2 = first worktree, etc.)
  const jumpToItem = (index: number) => {
    if (index === 0) {
      selectLocal()
      const el = document.querySelector(`[data-sidebar-id="local"]`)
      if (el instanceof HTMLElement) scrollIntoView(el)
      return
    }
    const wts = sortedWorktrees()
    const wt = wts[index - 1]
    if (!wt) return
    selectWorktree(wt.id)
    const el = document.querySelector(`[data-sidebar-id="${wt.id}"]`)
    if (el instanceof HTMLElement) scrollIntoView(el)
  }

  // Navigate tabs with Cmd+Alt+Left/Right
  const navigateTab = (direction: "left" | "right") => {
    const ids = tabIds()
    if (ids.length === 0) return
    const current = reviewActive() ? REVIEW_TAB_ID : (session.currentSessionID() ?? activePendingId() ?? "")
    const idx = ids.indexOf(current)
    if (idx === -1) return
    const next = direction === "left" ? idx - 1 : idx + 1
    if (next < 0 || next >= ids.length) return
    const targetId = ids[next]!
    if (targetId === REVIEW_TAB_ID) {
      if (!reviewOpen()) setReviewOpenForSelection(true)
      setReviewActive(true)
      return
    }
    const target = tabLookup().get(targetId)
    if (!target) return
    setReviewActive(false)
    if (isPending(target.id)) {
      setActivePendingId(target.id)
      session.clearCurrentSession()
      return
    }
    setActivePendingId(undefined)
    session.selectSession(target.id)
  }

  const selectLocal = () => {
    saveTabMemory()
    setReviewActive(false)
    setSelection(LOCAL)
    vscode.postMessage({ type: "agentManager.requestRepoInfo" })
    const locals = localSessions()
    const remembered = tabMemory()[LOCAL]
    const target = remembered ? locals.find((s) => s.id === remembered) : undefined
    const fallback = target ?? locals[0]
    if (fallback && !isPending(fallback.id)) {
      setActivePendingId(undefined)
      session.selectSession(fallback.id)
    } else if (fallback && isPending(fallback.id)) {
      setActivePendingId(fallback.id)
      session.clearCurrentSession()
      vscode.postMessage({ type: "agentManager.showExistingLocalTerminal" })
    } else {
      setActivePendingId(undefined)
      session.clearCurrentSession()
      vscode.postMessage({ type: "agentManager.showExistingLocalTerminal" })
    }
    setReviewActive(remembered === REVIEW_TAB_ID && reviewOpenByContext()[LOCAL] === true)
  }

  const selectWorktree = (worktreeId: string) => {
    saveTabMemory()
    setSelection(worktreeId)
    const managed = managedSessions().filter((ms) => ms.worktreeId === worktreeId)
    const ids = new Set(managed.map((ms) => ms.id))
    const sessions = session.sessions().filter((s) => ids.has(s.id))
    const remembered = tabMemory()[worktreeId]
    const target = remembered ? sessions.find((s) => s.id === remembered) : undefined
    const fallback = target ?? sessions[0]
    if (fallback) {
      session.selectSession(fallback.id)
    } else {
      session.setCurrentSessionID(undefined)
    }
    setReviewActive(remembered === REVIEW_TAB_ID && reviewOpenByContext()[worktreeId] === true)
  }

  const cycleAgent = (direction: 1 | -1) => {
    const available = session.agents().filter((a) => a.mode !== "subagent" && !a.hidden)
    if (available.length <= 1) return
    const current = session.selectedAgent()
    const idx = available.findIndex((a) => a.name === current)
    const raw = idx + direction
    const next = raw < 0 ? available.length - 1 : raw >= available.length ? 0 : raw
    const agent = available[next]
    if (agent) session.selectAgent(agent.name)
  }

  onMount(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as ExtensionMessage
      if (msg?.type !== "action") return
      if (msg.action === "sessionPrevious") navigate("up")
      else if (msg.action === "sessionNext") navigate("down")
      else if (msg.action === "tabPrevious") navigateTab("left")
      else if (msg.action === "tabNext") navigateTab("right")
      else if (msg.action === "showTerminal") {
        const id = session.currentSessionID()
        if (id) vscode.postMessage({ type: "agentManager.showTerminal", sessionId: id })
        else if (selection() === LOCAL) vscode.postMessage({ type: "agentManager.showLocalTerminal" })
      } else if (msg.action === "toggleDiff") {
        if (reviewActive()) {
          closeReviewTab()
          setDiffOpen(true)
        } else {
          setDiffOpen((prev) => !prev)
        }
      } else if (msg.action === "newTab") handleNewTabForCurrentSelection()
      else if (msg.action === "closeTab") closeActiveTab()
      else if (msg.action === "newWorktree") handleNewWorktreeOrPromote()
      else if (msg.action === "openWorktree") openWorktreeDirectory()
      else if (msg.action === "advancedWorktree") showAdvancedWorktreeDialog()
      else if (msg.action === "closeWorktree") closeSelectedWorktree()
      else if (msg.action === "showShortcuts") handleShowKeyboardShortcuts()
      else if (msg.action === "focusInput") window.dispatchEvent(new Event("focusPrompt"))
      else if (msg.action === "cycleAgentMode" && document.hasFocus()) cycleAgent(1)
      else if (msg.action === "cyclePreviousAgentMode" && document.hasFocus()) cycleAgent(-1)
      else {
        // Handle jumpTo1 through jumpTo9
        const match = /^jumpTo([1-9])$/.exec(msg.action ?? "")
        if (match) jumpToItem(parseInt(match[1]!) - 1)
      }
    }
    window.addEventListener("message", handler)

    // Prevent Cmd/Ctrl shortcuts from triggering native browser actions
    const preventDefaults = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      // Arrow navigation requires Alt modifier (Cmd+Alt+Arrow for tabs/sessions)
      if (e.altKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault()
      }
      // Prevent browser defaults for our shortcuts (new tab, close tab, new window, toggle diff, find)
      if (["t", "w", "n", "d", "f"].includes(e.key.toLowerCase()) && !e.shiftKey) {
        e.preventDefault()
      }
      // Prevent defaults for shift variants (close worktree, advanced/new open worktree)
      if (["w", "n", "o"].includes(e.key.toLowerCase()) && e.shiftKey) {
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

    // When the panel regains focus (e.g. returning from terminal), focus the prompt
    // and clear any stale body styles left by Kobalte modal overlays (dropdowns/dialogs
    // set pointer-events:none and overflow:hidden on body, but cleanup never runs if
    // focus leaves the webview before the overlay closes).
    const onWindowFocus = () => {
      document.body.style.pointerEvents = ""
      document.body.style.overflow = ""
      window.dispatchEvent(new Event("focusPrompt"))
    }
    window.addEventListener("focus", onWindowFocus)

    // When a session is created, add it as a local tab. This handles both direct
    // creation from the prompt input and backend-created follow-up sessions (plan
    // follow-up "Start new session"). Guard against duplicates (HTTP + SSE can both fire).
    const unsubCreate = vscode.onMessage((msg) => {
      if (msg.type !== "sessionCreated") return
      const created = msg as { type: string; session: { id: string } }
      if (localSessionIDs().includes(created.session.id)) return
      if (worktreeSessionIds().has(created.session.id)) return
      const pending = selection() === LOCAL ? activePendingId() : undefined
      if (pending) {
        setLocalSessionIDs((prev) => prev.map((id) => (id === pending ? created.session.id : id)))
        setActivePendingId(undefined)
      } else {
        saveTabMemory()
        setLocalSessionIDs((prev) => [...prev, created.session.id])
        setSelection(LOCAL)
      }
      session.selectSession(created.session.id)
    })

    // Mark sessions loaded as soon as the session context receives data (even if empty)
    const unsubSessions = vscode.onMessage((msg) => {
      if (msg.type === "sessionsLoaded" && !sessionsLoaded()) setSessionsLoaded(true)
    })

    const unsub = vscode.onMessage((msg) => {
      if (msg.type === "agentManager.repoInfo") {
        const info = msg as AgentManagerRepoInfoMessage
        setRepoBranch(info.branch)
        if (info.defaultBranch) setRepoDetectedBranch(info.defaultBranch)
      }

      if (msg.type === "agentManager.worktreeSetup") {
        const ev = msg as AgentManagerWorktreeSetupMessage
        if (ev.status === "ready" || ev.status === "error") {
          const error = ev.status === "error"
          // Remove from busy map
          if (ev.worktreeId) {
            setBusyWorktrees((prev) => {
              const next = new Map(prev)
              next.delete(ev.worktreeId!)
              return next
            })
          }
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
            // Auto-switch sidebar to the worktree containing this session
            const ms = managedSessions().find((s) => s.id === ev.sessionId)
            if (ms?.worktreeId) setSelection(ms.worktreeId)
          }
        } else {
          // Track this worktree as setting up and auto-select it in the sidebar
          if (ev.worktreeId) {
            setBusyWorktrees(
              (prev) =>
                new Map([...prev, [ev.worktreeId!, { reason: "setting-up", message: ev.message, branch: ev.branch }]]),
            )
            setSelection(ev.worktreeId)
          }
          // Close diff/review panels — nothing to show during setup
          setDiffOpen(false)
          setReviewActive(false)
          setSetup({ active: true, message: ev.message, branch: ev.branch, worktreeId: ev.worktreeId })
        }
      }

      if (msg.type === "agentManager.sessionAdded") {
        const ev = msg as { type: string; sessionId: string; worktreeId: string }
        saveTabMemory()
        setSelection(ev.worktreeId)
        session.selectSession(ev.sessionId)
      }

      if (msg.type === "agentManager.sessionForked") {
        const ev = msg as { type: string; sessionId: string; forkedFromId: string; worktreeId?: string }
        if (!ev.worktreeId) {
          // Local session: insert new tab after the forked-from tab
          setLocalSessionIDs((prev) => {
            const idx = prev.indexOf(ev.forkedFromId)
            if (idx >= 0) return [...prev.slice(0, idx + 1), ev.sessionId, ...prev.slice(idx + 1)]
            return [...prev, ev.sessionId]
          })
        }
        session.selectSession(ev.sessionId)
      }

      if (msg.type === "agentManager.keybindings") {
        const ev = msg as AgentManagerKeybindingsMessage
        setKb(ev.bindings)
      }

      if (msg.type === "agentManager.state") {
        const state = msg as AgentManagerStateMessage
        setWorktrees(state.worktrees)
        setManagedSessions(state.sessions)
        setStaleWorktreeIds(new Set(state.staleWorktreeIds ?? []))
        if (state.isGitRepo !== undefined) setIsGitRepo(state.isGitRepo)
        if (!worktreesLoaded()) setWorktreesLoaded(true)
        // When not a git repo, also mark sessions as loaded since the Kilo
        // server won't connect to send the sessionsLoaded message.
        if (state.isGitRepo === false && !sessionsLoaded()) setSessionsLoaded(true)
        if (state.tabOrder) setWorktreeTabOrder(state.tabOrder)
        if (state.worktreeOrder) setSidebarWorktreeOrder(state.worktreeOrder)
        if (state.reviewDiffStyle === "split" || state.reviewDiffStyle === "unified") {
          setReviewDiffStyle(state.reviewDiffStyle)
        }
        if ("defaultBaseBranch" in state) setDefaultBaseBranch(state.defaultBaseBranch || undefined)
        const current = session.currentSessionID()
        if (current) {
          const ms = state.sessions.find((s) => s.id === current)
          if (ms?.worktreeId) setSelection(ms.worktreeId)
        }
        // Recover local tab order from persisted state
        const localOrder = state.tabOrder?.[LOCAL]
        if (localOrder && localSessionIDs().length > 0) {
          const reordered = applyTabOrder(
            localSessionIDs().map((id) => ({ id })),
            localOrder,
          ).map((item) => item.id)
          setLocalSessionIDs(reordered)
        }
        // Recover sessions collapsed state from extension-persisted state
        if (state.sessionsCollapsed !== undefined) setSessionsCollapsed(state.sessionsCollapsed)
        // Clear busy state for worktrees that have been removed
        const ids = new Set(state.worktrees.map((wt) => wt.id))
        setBusyWorktrees((prev) => {
          const next = new Map([...prev].filter(([id]) => ids.has(id)))
          return next.size === prev.size ? prev : next
        })
      }

      // When a multi-version progress update arrives, mark newly created worktrees as loading
      if ((msg as { type: string }).type === "agentManager.multiVersionProgress") {
        const ev = msg as unknown as AgentManagerMultiVersionProgressMessage
        if (ev.status === "done" && ev.groupId) {
          // Clear busy state for all worktrees in this group
          setBusyWorktrees((prev) => {
            const next = new Map(prev)
            for (const wt of worktrees()) {
              if (wt.groupId === ev.groupId) next.delete(wt.id)
            }
            return next
          })
        }
      }

      // When state updates arrive, mark new grouped worktrees as loading
      // (they were just created and haven't received their prompt yet)
      if (msg.type === "agentManager.worktreeSetup") {
        const ev = msg as AgentManagerWorktreeSetupMessage
        if (ev.status === "ready" && ev.sessionId) {
          const ms = managedSessions().find((s) => s.id === ev.sessionId)
          const wt = ms?.worktreeId ? worktrees().find((w) => w.id === ms.worktreeId) : undefined
          if (wt?.groupId) {
            setBusyWorktrees((prev) => new Map([...prev, [wt.id, { reason: "setting-up" as const }]]))
          }
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

        // Only send a message if there's text — otherwise just clear busy state
        if (ev.text) {
          vscode.postMessage({
            type: "sendMessage",
            text: ev.text,
            sessionID: ev.sessionId,
            providerID: ev.providerID,
            modelID: ev.modelID,
            agent: ev.agent,
            files: ev.files,
          })
        }
        // Clear busy state — use worktreeId from the message directly
        // to avoid race condition where managedSessions() hasn't updated yet
        if (ev.worktreeId) {
          setBusyWorktrees((prev) => {
            const next = new Map(prev)
            next.delete(ev.worktreeId)
            return next
          })
        }
      }

      if (msg.type === "agentManager.worktreeDiff") {
        const ev = msg as AgentManagerWorktreeDiffMessage
        setDiffDatas((prev) => {
          const existing = prev[ev.sessionId]
          const next = existing ? mergeWorktreeDiffs(existing, ev.diffs) : ev.diffs
          if (existing && existing.length === next.length) {
            const same = existing.every((old, i) => {
              const item = next[i]!
              return (
                old.file === item.file &&
                old.before === item.before &&
                old.after === item.after &&
                old.status === item.status &&
                old.tracked === item.tracked &&
                old.generatedLike === item.generatedLike &&
                old.summarized === item.summarized &&
                old.additions === item.additions &&
                old.deletions === item.deletions
              )
            })
            if (same) return prev
          }
          return { ...prev, [ev.sessionId]: next }
        })
      }

      if (msg.type === "agentManager.worktreeDiffFile") {
        const ev = msg as AgentManagerWorktreeDiffFileMessage
        if (ev.diff) {
          setDiffDatas((prev) => {
            const existing = prev[ev.sessionId] ?? []
            const next = existing.map((item) => (item.file === ev.diff!.file ? ev.diff! : item))
            return { ...prev, [ev.sessionId]: next }
          })
          setDiffFilePending(ev.sessionId, ev.diff.file, false)
          return
        }
        setDiffFilePending(ev.sessionId, ev.file, false)
      }

      if (msg.type === "agentManager.worktreeDiffLoading") {
        const ev = msg as AgentManagerWorktreeDiffLoadingMessage
        setDiffLoading(ev.loading)
      }

      if (msg.type === "agentManager.applyWorktreeDiffResult") {
        const ev = msg as AgentManagerApplyWorktreeDiffResultMessage
        const files = new Set((ev.conflicts ?? []).map((entry) => entry.file).filter(Boolean)).size
        const count = ev.conflicts?.length ?? 0
        setApplyStates((prev) => ({
          ...prev,
          [ev.worktreeId]: {
            status: ev.status,
            message: ev.message,
            conflicts: ev.conflicts ?? [],
          },
        }))

        if (ev.status === "success") {
          showToast({ variant: "success", title: t("agentManager.apply.success"), description: ev.message })
          if (applyTarget() === ev.worktreeId) closeApplyDialog()
        }
        if (ev.status === "conflict") {
          const summary =
            count > 0 ? t("agentManager.apply.conflictToast", { count, files: Math.max(files, 1) }) : ev.message
          showToast({ variant: "error", title: t("agentManager.apply.conflict"), description: summary })
        }
        if (ev.status === "error") {
          showToast({ variant: "error", title: t("agentManager.apply.error"), description: ev.message })
        }
      }

      if (msg.type === "agentManager.worktreeStats") {
        const ev = msg as AgentManagerWorktreeStatsMessage
        const map: Record<string, WorktreeGitStats> = {}
        for (const s of ev.stats) map[s.worktreeId] = s
        setWorktreeStats(map)
      }

      if (msg.type === "agentManager.localStats") {
        const ev = msg as AgentManagerLocalStatsMessage
        setLocalStats(ev.stats)
        setRepoBranch(ev.stats.branch)
      }
    })

    onCleanup(() => {
      window.removeEventListener("message", handler)
      window.removeEventListener("keydown", preventDefaults, true)
      window.removeEventListener("keydown", deleteKeyHandler)
      window.removeEventListener("focus", onWindowFocus)
      unsubCreate()
      unsubSessions()
      unsub()
    })
  })

  // Always select local on mount to initialize branch info and session state
  onMount(() => {
    selectLocal()
    // Request worktree/session state from extension — handles race where
    // initializeState() pushState fires before the webview is mounted
    vscode.postMessage({ type: "agentManager.requestState" })
    // Open a pending "New Session" tab if there are no persisted local sessions
    if (localSessionIDs().length === 0) {
      addPendingTab()
    }
  })

  // Start/stop diff watch when panel opens/closes, review tab opens, or session changes
  createEffect(() => {
    const panel = diffOpen()
    const review = reviewActive()
    const sel = selection()
    const id = session.currentSessionID()
    if (panel) {
      if (sel === LOCAL) {
        // For local tab, diff against unpushed changes using LOCAL sentinel
        vscode.postMessage({ type: "agentManager.startDiffWatch", sessionId: LOCAL })
        return
      } else if (id) {
        const ms = managedSessions().find((s) => s.id === id)
        if (ms?.worktreeId) {
          vscode.postMessage({ type: "agentManager.startDiffWatch", sessionId: id })
          return
        }
      }
      vscode.postMessage({ type: "agentManager.stopDiffWatch" })
      return
    }
    if (review) {
      // Review tab is open but no specific session — use local sentinel for local,
      // or any session in the selected worktree.
      if (sel === LOCAL) {
        vscode.postMessage({ type: "agentManager.startDiffWatch", sessionId: LOCAL })
        return
      }
      if (sel) {
        const managed = managedSessions().find((ms) => ms.worktreeId === sel)
        if (managed) {
          vscode.postMessage({ type: "agentManager.startDiffWatch", sessionId: managed.id })
          return
        }
      }
      vscode.postMessage({ type: "agentManager.stopDiffWatch" })
      return
    }
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
    setDiffOpen(false)
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
    setReviewActive(false)
    setReviewOpenForSelection(false)
  }

  // Data for the review tab: use local diff data for local context,
  // current session for selected worktree context, or first available in that worktree.
  const reviewDiffs = createMemo(() => {
    const data = diffDatas()
    const sel = selection()
    const id = session.currentSessionID()
    if (sel === LOCAL) return data[LOCAL] ?? []
    if (id && data[id]) {
      const current = managedSessions().find((s) => s.id === id)
      if (sel && current?.worktreeId === sel) return data[id]!
    }
    if (!sel) return []
    const ids = managedSessions()
      .filter((s) => s.worktreeId === sel)
      .map((s) => s.id)
    for (const sid of ids) {
      if (data[sid]) return data[sid]!
    }
    return []
  })

  const currentDiffSessionId = createMemo(() => {
    const sel = selection()
    if (sel === LOCAL) return LOCAL

    const current = session.currentSessionID()
    if (current) {
      const item = managedSessions().find((entry) => entry.id === current)
      if (sel && item?.worktreeId === sel) return current
    }

    if (!sel) return undefined
    return managedSessions().find((entry) => entry.worktreeId === sel)?.id
  })

  const diffSessionKey = createMemo(() => {
    const sel = selection()
    if (sel === LOCAL) return `local:${LOCAL}`
    if (sel === null) return `session:${session.currentSessionID() ?? ""}`
    return `worktree:${sel}`
  })

  const setSharedDiffStyle = (style: "unified" | "split") => {
    if (reviewDiffStyle() === style) return
    setReviewDiffStyle(style)
    vscode.postMessage({ type: "agentManager.setReviewDiffStyle", style })
  }

  const setDiffFilePending = (sessionId: string, file: string, value: boolean) => {
    setDiffFileLoading((prev) => {
      const session = prev[sessionId] ?? {}
      if (value) {
        if (session[file]) return prev
        return {
          ...prev,
          [sessionId]: { ...session, [file]: true },
        }
      }

      if (!session[file]) return prev
      const next = { ...session }
      delete next[file]
      if (Object.keys(next).length === 0) {
        const result = { ...prev }
        delete result[sessionId]
        return result
      }
      return {
        ...prev,
        [sessionId]: next,
      }
    })
  }

  const requestDiffFile = (file: string) => {
    const sessionId = currentDiffSessionId()
    if (!sessionId) return
    if (diffFileLoading()[sessionId]?.[file]) return
    setDiffFilePending(sessionId, file, true)
    vscode.postMessage({ type: "agentManager.requestWorktreeDiffFile", sessionId, file })
  }

  const diffFileLoadingForCurrent = createMemo(() => {
    const sessionId = currentDiffSessionId()
    if (!sessionId) return new Set<string>()
    return new Set(Object.keys(diffFileLoading()[sessionId] ?? {}))
  })

  const handleConfigureSetupScript = () => {
    vscode.postMessage({ type: "agentManager.configureSetupScript" })
  }

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
    vscode.postMessage({ type: "agentManager.createWorktree" })
  }

  // Advanced worktree dialog — opens a full dialog with prompt, versions, model, mode
  const showAdvancedWorktreeDialog = () => {
    if (!loaded()) return
    dialog.show(() => <NewWorktreeDialog onClose={() => dialog.close()} defaultBaseBranch={repoDefaultBranch()} />)
  }

  const confirmDeleteWorktree = (worktreeId: string) => {
    const wt = worktrees().find((w) => w.id === worktreeId)
    if (!wt) return

    // Second press/click: execute the delete
    if (pendingDelete() === worktreeId) {
      cancelPendingDelete()
      setBusyWorktrees((prev) => new Map([...prev, [wt.id, { reason: "deleting" as const }]]))
      vscode.postMessage({ type: "agentManager.deleteWorktree", worktreeId: wt.id })
      if (selection() === wt.id) {
        const next = nextSelectionAfterDelete(
          wt.id,
          worktrees().map((w) => w.id),
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
          worktrees().map((w) => w.id),
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

  const handlePromote = (sessionId: string, e: MouseEvent) => {
    e.stopPropagation()
    if (!loaded()) return
    vscode.postMessage({ type: "agentManager.promoteSession", sessionId })
  }

  const openLocally = (sid: string) => {
    saveTabMemory()
    const pending = activePendingId()
    if (pending) {
      setLocalSessionIDs((prev) => prev.map((id) => (id === pending ? sid : id)))
      setActivePendingId(undefined)
    } else {
      setLocalSessionIDs((prev) => [...prev, sid])
    }
    setSelection(LOCAL)
    setReviewActive(false)
    session.selectSession(sid)
    vscode.postMessage({ type: "agentManager.openLocally", sessionId: sid })
  }

  const handleAddSession = () => {
    const sel = selection()
    if (sel === LOCAL) {
      addPendingTab()
    } else if (sel) {
      vscode.postMessage({ type: "agentManager.addSessionToWorktree", worktreeId: sel })
    }
  }

  const handleForkSession = (sessionId: string) => {
    const sel = selection()
    if (sel === LOCAL) {
      vscode.postMessage({ type: "agentManager.forkSession", sessionId })
    } else if (sel) {
      vscode.postMessage({ type: "agentManager.forkSession", sessionId, worktreeId: sel })
    }
  }

  const handleCloseTab = (sessionId: string) => {
    const pending = isPending(sessionId)
    const isActive = pending ? sessionId === activePendingId() : session.currentSessionID() === sessionId
    if (isActive) {
      const tabs = activeTabs()
      const idx = tabs.findIndex((s) => s.id === sessionId)
      const next = tabs[idx + 1] ?? tabs[idx - 1]
      if (next) {
        if (isPending(next.id)) {
          setActivePendingId(next.id)
          session.clearCurrentSession()
        } else {
          setActivePendingId(undefined)
          session.selectSession(next.id)
        }
      } else {
        setActivePendingId(undefined)
        session.clearCurrentSession()
      }
    }
    if (pending || localSet().has(sessionId)) {
      setLocalSessionIDs((prev) => prev.filter((id) => id !== sessionId))
    } else {
      vscode.postMessage({ type: "agentManager.closeSession", sessionId })
    }
  }

  const handleTabMouseDown = (sessionId: string, e: MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault()
      handleCloseTab(sessionId)
    }
  }

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
    const current = reviewOpen() ? [...ids, REVIEW_TAB_ID] : ids
    if (sel === LOCAL) return current
    return applyTabOrder(
      current.map((id) => ({ id })),
      worktreeTabOrder()[sel],
    ).map((item) => item.id)
  })

  const handleDragStart = (event: DragEvent) => {
    const id = event.draggable?.id
    if (typeof id === "string") setDraggingTab(id)
  }

  const handleDragOver = (event: DragEvent) => {
    const from = event.draggable?.id
    const to = event.droppable?.id
    if (typeof from !== "string" || typeof to !== "string") return
    const sel = selection()
    if (sel === LOCAL) {
      setLocalSessionIDs((prev) => {
        const ids = reviewOpen() ? [...prev, REVIEW_TAB_ID] : prev
        const reordered = reorderTabs(ids, from, to)
        if (!reordered) return prev
        return reordered.filter((id) => id !== REVIEW_TAB_ID)
      })
      return
    }
    if (sel) {
      setWorktreeTabOrder((prev) => {
        const ids = activeTabs().map((s) => ({ id: s.id }))
        if (reviewOpen()) ids.push({ id: REVIEW_TAB_ID })
        const current = applyTabOrder(ids, prev[sel]).map((item) => item.id)
        const reordered = reorderTabs(current, from, to)
        if (!reordered) return prev
        return { ...prev, [sel]: reordered }
      })
    }
  }

  const handleDragEnd = () => {
    setDraggingTab(undefined)
    // Persist the new tab order to the extension
    const sel = selection()
    if (sel === LOCAL) {
      const order = localSessionIDs().filter((id) => !isPending(id))
      if (order.length > 0) vscode.postMessage({ type: "agentManager.setTabOrder", key: LOCAL, order })
      return
    }
    if (sel) {
      const order = tabIds().filter((id) => id !== REVIEW_TAB_ID)
      if (order.length > 0) vscode.postMessage({ type: "agentManager.setTabOrder", key: sel, order })
    }
  }

  const draggedTab = createMemo(() => {
    const id = draggingTab()
    if (!id) return undefined
    if (id === REVIEW_TAB_ID) return { id, title: t("session.tab.review") }
    return activeTabs().find((s) => s.id === id)
  })

  // Close the currently active tab via keyboard shortcut.
  // If no tabs remain, fall through to close the selected worktree.
  const closeActiveTab = () => {
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

  // Cmd+N: if an unassigned session is selected, promote it; otherwise create a new worktree
  const handleNewWorktreeOrPromote = () => {
    if (!loaded()) return
    const sel = selection()
    const sid = session.currentSessionID()
    if (sel === null && sid && !worktreeSessionIds().has(sid)) {
      vscode.postMessage({ type: "agentManager.promoteSession", sessionId: sid })
      return
    }
    handleCreateWorktree()
  }

  // Close the currently selected worktree with a confirmation dialog
  const closeSelectedWorktree = () => {
    const sel = selection()
    if (!sel || sel === LOCAL) return
    confirmDeleteWorktree(sel)
  }

  return (
    <div class="am-layout" onContextMenu={(e) => e.preventDefault()}>
      <div class="am-sidebar" style={{ width: `${sidebarWidth()}px` }}>
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
        {/* Local repo item */}
        <button
          class={`am-local-item ${selection() === LOCAL ? "am-local-item-active" : ""}`}
          data-sidebar-id="local"
          onClick={() => selectLocal()}
        >
          <Show when={!isLocalBusy()} fallback={<Spinner class="am-worktree-spinner" />}>
            <svg class="am-local-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="2.5" y="3.5" width="15" height="10" rx="1" stroke="currentColor" />
              <path d="M6 16.5H14" stroke="currentColor" stroke-linecap="square" />
              <path d="M10 13.5V16.5" stroke="currentColor" />
            </svg>
          </Show>
          <div class="am-local-text">
            <span class="am-local-label">{t("agentManager.local")}</span>
            <Show when={repoBranch()}>
              <span class="am-local-branch">{repoBranch()}</span>
            </Show>
          </div>
          <Show when={localStats() === undefined}>
            <div class="am-worktree-stats-skeleton">
              <div class="am-worktree-stats-skeleton-row" />
              <div class="am-worktree-stats-skeleton-row" style={{ width: "70%" }} />
            </div>
          </Show>
          <Show
            when={
              localStats() &&
              (localStats()!.files > 0 ||
                localStats()!.additions > 0 ||
                localStats()!.deletions > 0 ||
                localStats()!.ahead > 0 ||
                localStats()!.behind > 0)
            }
          >
            <div class="am-worktree-stats">
              <Show
                when={localStats()!.additions > 0 || localStats()!.deletions > 0}
                fallback={
                  <Show when={localStats()!.files > 0}>
                    <span class="am-stat-files">{localStats()!.files}f</span>
                  </Show>
                }
              >
                <div class="am-worktree-stats-row">
                  <Show when={localStats()!.additions > 0}>
                    <span class="am-stat-additions">+{localStats()!.additions}</span>
                  </Show>
                  <Show when={localStats()!.deletions > 0}>
                    <span class="am-stat-deletions">
                      {"\u2212"}
                      {localStats()!.deletions}
                    </span>
                  </Show>
                </div>
              </Show>
              <Show when={localStats()!.ahead > 0 || localStats()!.behind > 0}>
                <div class="am-worktree-stats-row">
                  <Show when={localStats()!.ahead > 0}>
                    <span class="am-worktree-commits">
                      {"↑"}
                      {localStats()!.ahead}
                    </span>
                  </Show>
                  <Show when={localStats()!.behind > 0}>
                    <span class="am-worktree-behind">
                      {"↓"}
                      {localStats()!.behind}
                    </span>
                  </Show>
                </div>
              </Show>
            </div>
          </Show>
          <span class="am-shortcut-badge">{isMac ? "⌘" : "Ctrl+"}1</span>
        </button>

        {/* WORKTREES section */}
        <div class={`am-section ${sessionsCollapsed() ? "am-section-grow" : ""}`}>
          <div class="am-section-header">
            <span class="am-section-label">{t("agentManager.section.worktrees")}</span>
            <Show when={isGitRepo()}>
              <div class="am-section-actions">
                <div class="am-split-button">
                  <IconButton
                    icon="plus"
                    size="small"
                    variant="ghost"
                    label={t("agentManager.worktree.new")}
                    onClick={handleCreateWorktree}
                    disabled={!loaded()}
                  />
                  <DropdownMenu gutter={4} placement="bottom-end">
                    <DropdownMenu.Trigger
                      class="am-split-arrow"
                      aria-label={t("agentManager.worktree.advancedOptions")}
                      disabled={!loaded()}
                    >
                      <Icon name="chevron-down" size="small" />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content class="am-split-menu">
                        <DropdownMenu.Item onSelect={handleCreateWorktree}>
                          <DropdownMenu.ItemLabel>{t("agentManager.worktree.new")}</DropdownMenu.ItemLabel>
                          <span class="am-menu-shortcut">
                            {parseBindingTokens(kb().newWorktree ?? "").map((token) => (
                              <kbd class="am-menu-key">{token}</kbd>
                            ))}
                          </span>
                        </DropdownMenu.Item>
                        <DropdownMenu.Separator />
                        <DropdownMenu.Item onSelect={showAdvancedWorktreeDialog}>
                          <Icon name="settings-gear" size="small" />
                          <DropdownMenu.ItemLabel>{t("agentManager.dialog.advanced")}</DropdownMenu.ItemLabel>
                          <span class="am-menu-shortcut">
                            {parseBindingTokens(kb().advancedWorktree ?? "").map((token) => (
                              <kbd class="am-menu-key">{token}</kbd>
                            ))}
                          </span>
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                </div>
                <TooltipKeybind
                  title={t("agentManager.shortcuts.title")}
                  keybind={kb().showShortcuts ?? ""}
                  placement="bottom"
                >
                  <IconButton
                    icon="keyboard"
                    size="small"
                    variant="ghost"
                    label={t("agentManager.shortcuts.title")}
                    onClick={handleShowKeyboardShortcuts}
                  />
                </TooltipKeybind>
                <DropdownMenu gutter={4} placement="bottom-end">
                  <DropdownMenu.Trigger
                    as={IconButton}
                    icon="settings-gear"
                    size="small"
                    variant="ghost"
                    label={t("agentManager.worktree.settings")}
                  />
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content class="am-split-menu">
                      <DropdownMenu.Item onSelect={handleConfigureSetupScript}>
                        <DropdownMenu.ItemLabel>{t("agentManager.worktree.setupScript")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item onSelect={handleChangeDefaultBaseBranch}>
                        <DropdownMenu.ItemLabel>
                          {t("agentManager.worktree.defaultBaseBranch")}: {repoDefaultBranch()}
                        </DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu>
              </div>
            </Show>
          </div>
          <div class="am-worktree-list">
            <Show
              when={worktreesLoaded() && sessionsLoaded()}
              fallback={
                <div class="am-skeleton-list">
                  <div class="am-skeleton-wt">
                    <div class="am-skeleton-wt-icon" />
                    <div class="am-skeleton-wt-text" style={{ width: "60%" }} />
                  </div>
                </div>
              }
            >
              <Show when={!isGitRepo()}>
                <div class="am-not-git-notice">
                  <Icon name="warning" size="small" />
                  <span>{t("agentManager.notGitRepo")}</span>
                </div>
              </Show>
              <Show when={isGitRepo()}>
                {(() => {
                  const [renamingWt, setRenamingWt] = createSignal<string | null>(null)
                  const [renameValue, setRenameValue] = createSignal("")

                  const startRename = (wtId: string, current: string) => {
                    setRenamingWt(wtId)
                    setRenameValue(current)
                  }

                  let cancelled = false

                  const commitRename = (wtId: string) => {
                    if (cancelled) {
                      cancelled = false
                      return
                    }
                    const value = renameValue().trim()
                    setRenamingWt(null)
                    if (!value) return
                    vscode.postMessage({ type: "agentManager.renameWorktree", worktreeId: wtId, label: value })
                  }

                  const cancelRename = () => {
                    cancelled = true
                    setRenamingWt(null)
                  }

                  const wtIds = createMemo(() => sortedWorktrees().map((wt) => wt.id))

                  const onWtDragStart = (event: DragEvent) => {
                    const id = event.draggable?.id
                    if (typeof id === "string") setDraggingWorktree(id)
                    document.body.classList.add("am-wt-dragging-active")
                  }

                  const onWtDragOver = (event: DragEvent) => {
                    const from = event.draggable?.id
                    const to = event.droppable?.id
                    if (typeof from !== "string" || typeof to !== "string") return
                    setSidebarWorktreeOrder((prev) => {
                      const current = applyTabOrder(
                        sortedWorktrees().map((wt) => ({ id: wt.id })),
                        prev,
                      ).map((item) => item.id)
                      return reorderTabs(current, from, to) ?? prev
                    })
                  }

                  const onWtDragEnd = () => {
                    setDraggingWorktree(undefined)
                    document.body.classList.remove("am-wt-dragging-active")
                    const order = sortedWorktrees().map((wt) => wt.id)
                    if (order.length > 0) {
                      vscode.postMessage({ type: "agentManager.setWorktreeOrder", order })
                    }
                  }

                  /** Lock drag movement to the Y axis (vertical-only worktree dragging). */
                  const ConstrainDragXAxis: Component = () => {
                    const ctx = useDragDropContext()
                    if (!ctx) return null
                    const [
                      ,
                      { onDragStart: onStart, onDragEnd: onEnd, addTransformer: add, removeTransformer: remove },
                    ] = ctx
                    const xform: Transformer = { id: "constrain-x-axis", order: 100, callback: (t) => ({ ...t, x: 0 }) }
                    const dispose = createRoot((dispose) => {
                      onStart(({ draggable }) => {
                        if (draggable) add("draggables", draggable.id as string, xform)
                      })
                      onEnd(({ draggable }) => {
                        if (draggable) remove("draggables", draggable.id as string, xform.id)
                      })
                      return dispose
                    })
                    onCleanup(dispose)
                    return null
                  }

                  return (
                    <DragDropProvider
                      onDragStart={onWtDragStart}
                      onDragEnd={onWtDragEnd}
                      onDragOver={onWtDragOver}
                      collisionDetector={closestCenter}
                    >
                      <DragDropSensors />
                      <ConstrainDragXAxis />
                      <SortableProvider ids={wtIds()}>
                        <For each={sortedWorktrees()}>
                          {(wt, idx) => {
                            const sessions = createMemo(() => managedSessions().filter((ms) => ms.worktreeId === wt.id))
                            const navHint = () => {
                              const flat = [
                                LOCAL as string,
                                ...sortedWorktrees().map((w) => w.id),
                                ...unassignedSessions().map((s) => s.id),
                              ]
                              const active = selection() ?? session.currentSessionID() ?? ""
                              return adjacentHint(
                                wt.id,
                                active,
                                flat,
                                kb().previousSession ?? "",
                                kb().nextSession ?? "",
                              )
                            }
                            const groupSize = () => {
                              if (!wt.groupId) return 0
                              return sortedWorktrees().filter((w) => w.groupId === wt.groupId).length
                            }
                            const sortable = createSortable(wt.id)
                            void sortable
                            return (
                              <div
                                use:sortable
                                class={`am-wt-sortable ${sortable.isActiveDraggable ? "am-wt-dragging" : ""}`}
                              >
                                <WorktreeItem
                                  worktree={wt}
                                  label={worktreeLabel(wt)}
                                  active={selection() === wt.id}
                                  pendingDelete={pendingDelete() === wt.id}
                                  busy={busyWorktrees().has(wt.id)}
                                  working={isAgentBusy(wt.id)}
                                  stale={isStaleWorktree(wt.id)}
                                  shortcut={idx() + 2}
                                  stats={worktreeStats()[wt.id]}
                                  navHint={navHint()}
                                  sessions={sessions().length}
                                  grouped={isGrouped(wt)}
                                  groupStart={isGroupStart(wt, idx())}
                                  groupEnd={isGroupEnd(wt, idx())}
                                  groupSize={groupSize()}
                                  renaming={renamingWt() === wt.id}
                                  renameValue={renameValue()}
                                  closeKeybind={kb().closeWorktree ?? ""}
                                  openKeybind={kb().openWorktree ?? ""}
                                  onClick={() => {
                                    if (pendingDelete() === wt.id) {
                                      confirmDeleteWorktree(wt.id)
                                      return
                                    }
                                    selectWorktree(wt.id)
                                  }}
                                  onDelete={(e) => handleDeleteWorktree(wt.id, e)}
                                  onStartRename={(current) => startRename(wt.id, current)}
                                  onRenameInput={(v) => setRenameValue(v)}
                                  onCommitRename={() => commitRename(wt.id)}
                                  onCancelRename={cancelRename}
                                  onRemoveStale={() => confirmRemoveStaleWorktree(wt.id)}
                                  onCopyPath={() => navigator.clipboard.writeText(wt.path)}
                                  onOpen={() =>
                                    vscode.postMessage({ type: "agentManager.openWorktree", worktreeId: wt.id })
                                  }
                                />
                              </div>
                            )
                          }}
                        </For>
                      </SortableProvider>
                      <DragOverlay>
                        {(() => {
                          const wt = sortedWorktrees().find((w) => w.id === draggingWorktree())
                          if (!wt) return null
                          return (
                            <div class="am-wt-overlay">
                              <Icon name="branch" size="small" />
                              <span>{worktreeLabel(wt)}</span>
                            </div>
                          )
                        })()}
                      </DragOverlay>
                    </DragDropProvider>
                  )
                })()}
                <Show when={worktrees().length === 0}>
                  <button class="am-worktree-create" onClick={handleCreateWorktree}>
                    <Icon name="plus" size="small" />
                    <span>{t("agentManager.worktree.new")}</span>
                  </button>
                </Show>
              </Show>
            </Show>
          </div>
        </div>

        {/* SESSIONS section (unassigned) — collapsible */}
        <div class={`am-section ${sessionsCollapsed() ? "" : "am-section-grow"}`}>
          <button
            class="am-section-header am-section-toggle"
            onClick={() => {
              const next = !sessionsCollapsed()
              setSessionsCollapsed(next)
              vscode.postMessage({ type: "agentManager.setSessionsCollapsed", collapsed: next })
            }}
          >
            <span class="am-section-label">
              <Icon
                name={sessionsCollapsed() ? "chevron-right" : "chevron-down"}
                size="small"
                class="am-section-chevron"
              />
              {t("agentManager.section.sessions")}
            </span>
          </button>
          <Show when={!sessionsCollapsed()}>
            <div class="am-list">
              <Show
                when={sessionsLoaded()}
                fallback={
                  <div class="am-skeleton-list">
                    <div class="am-skeleton-session">
                      <div class="am-skeleton-session-title" style={{ width: "70%" }} />
                      <div class="am-skeleton-session-time" />
                    </div>
                    <div class="am-skeleton-session">
                      <div class="am-skeleton-session-title" style={{ width: "55%" }} />
                      <div class="am-skeleton-session-time" />
                    </div>
                    <div class="am-skeleton-session">
                      <div class="am-skeleton-session-title" style={{ width: "65%" }} />
                      <div class="am-skeleton-session-time" />
                    </div>
                  </div>
                }
              >
                <For each={unassignedSessions()}>
                  {(s) => (
                    <ContextMenu>
                      <ContextMenu.Trigger as="div" style={{ display: "contents" }}>
                        <button
                          class={`am-item ${s.id === session.currentSessionID() && selection() === null ? "am-item-active" : ""}`}
                          data-sidebar-id={s.id}
                          onClick={() => {
                            saveTabMemory()
                            setSelection(null)
                            setReviewActive(false)
                            session.selectSession(s.id)
                          }}
                        >
                          <span class="am-item-title">{s.title || t("agentManager.session.untitled")}</span>
                          <span class="am-item-time">{formatRelativeDate(s.updatedAt)}</span>
                          <div class="am-item-promote">
                            <TooltipKeybind
                              title={t("agentManager.session.openInWorktree")}
                              keybind={kb().newWorktree ?? ""}
                              placement="right"
                            >
                              <IconButton
                                icon="branch"
                                size="small"
                                variant="ghost"
                                label={t("agentManager.session.openInWorktree")}
                                onClick={(e: MouseEvent) => handlePromote(s.id, e)}
                              />
                            </TooltipKeybind>
                          </div>
                        </button>
                      </ContextMenu.Trigger>
                      <ContextMenu.Portal>
                        <ContextMenu.Content class="am-ctx-menu">
                          <ContextMenu.Item onSelect={() => handlePromote(s.id, new MouseEvent("click"))}>
                            <Icon name="branch" size="small" />
                            <ContextMenu.ItemLabel>{t("agentManager.session.openInWorktree")}</ContextMenu.ItemLabel>
                          </ContextMenu.Item>
                          <ContextMenu.Item onSelect={() => openLocally(s.id)}>
                            <Icon name="folder" size="small" />
                            <ContextMenu.ItemLabel>{t("agentManager.session.openLocally")}</ContextMenu.ItemLabel>
                          </ContextMenu.Item>
                        </ContextMenu.Content>
                      </ContextMenu.Portal>
                    </ContextMenu>
                  )}
                </For>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      <div class="am-detail">
        {/* Tab bar — visible when a section is selected and has tabs or a pending new session */}
        <Show when={selection() !== null && !contextEmpty()}>
          <DragDropProvider
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            collisionDetector={closestCenter}
          >
            <DragDropSensors />
            <ConstrainDragYAxis />
            <div class="am-tab-bar">
              <div class="am-tab-scroll-area">
                <div class={`am-tab-fade am-tab-fade-left ${tabScroll.showLeft() ? "am-tab-fade-visible" : ""}`} />
                <div class="am-tab-list" ref={tabScroll.setRef}>
                  <SortableProvider ids={tabIds()}>
                    <For each={tabIds()}>
                      {(id) => {
                        if (id === REVIEW_TAB_ID) {
                          const ids = tabIds()
                          const activeId = reviewActive()
                            ? REVIEW_TAB_ID
                            : (session.currentSessionID() ?? activePendingId() ?? "")
                          const tabDirection = reviewActive()
                            ? ""
                            : adjacentHint(REVIEW_TAB_ID, activeId, ids, kb().previousTab ?? "", kb().nextTab ?? "")

                          return (
                            <SortableReviewTab
                              id={REVIEW_TAB_ID}
                              label={t("session.tab.review")}
                              tooltip={t("command.review.toggle")}
                              keybind={tabDirection}
                              closeKeybind={kb().closeTab ?? ""}
                              active={reviewActive()}
                              onSelect={() => setReviewActive(true)}
                              onMiddleClick={handleReviewTabMouseDown}
                              onClose={(e: MouseEvent) => {
                                e.stopPropagation()
                                closeReviewTab()
                              }}
                            />
                          )
                        }

                        const s = tabLookup().get(id)
                        if (!s) return null

                        const pending = isPending(s.id)
                        const active = () =>
                          pending
                            ? s.id === activePendingId() && !session.currentSessionID()
                            : s.id === session.currentSessionID()
                        const tabDirection = () => {
                          if (active()) return ""
                          const ids = tabIds()
                          const activeId = reviewActive()
                            ? REVIEW_TAB_ID
                            : (session.currentSessionID() ?? activePendingId() ?? "")
                          return adjacentHint(s.id, activeId, ids, kb().previousTab ?? "", kb().nextTab ?? "")
                        }

                        return (
                          <SortableTab
                            tab={s}
                            active={active() && !reviewActive()}
                            keybind={tabDirection()}
                            closeKeybind={kb().closeTab ?? ""}
                            onSelect={() => {
                              setReviewActive(false)
                              if (pending) {
                                setActivePendingId(s.id)
                                session.clearCurrentSession()
                                return
                              }
                              setActivePendingId(undefined)
                              session.selectSession(s.id)
                            }}
                            onMiddleClick={(e: MouseEvent) => handleTabMouseDown(s.id, e)}
                            onClose={() => handleCloseTab(s.id)}
                            onFork={pending ? undefined : () => handleForkSession(s.id)}
                          />
                        )
                      }}
                    </For>
                  </SortableProvider>
                </div>
                <div class={`am-tab-fade am-tab-fade-right ${tabScroll.showRight() ? "am-tab-fade-visible" : ""}`} />
              </div>
              <TooltipKeybind title={t("agentManager.session.new")} keybind={kb().newTab ?? ""} placement="bottom">
                <IconButton
                  icon="plus"
                  size="small"
                  variant="ghost"
                  label={t("agentManager.session.new")}
                  class="am-tab-add"
                  onClick={handleAddSession}
                />
              </TooltipKeybind>
              <div class="am-tab-actions">
                {(() => {
                  const sel = () => selection()
                  const isWorktree = () => typeof sel() === "string" && sel() !== LOCAL
                  const stats = () => {
                    if (sel() === LOCAL) return localStats()
                    return typeof sel() === "string" ? worktreeStats()[sel() as string] : undefined
                  }
                  const hasChanges = () => {
                    const s = stats()
                    return s && (s.files > 0 || s.additions > 0 || s.deletions > 0)
                  }
                  const applyBusy = () => {
                    const state = applyStateForSelection()
                    if (!state) return false
                    return state.status === "checking" || state.status === "applying"
                  }
                  return (
                    <>
                      <Show when={isWorktree()}>
                        <>
                          <Tooltip value={t("agentManager.open.tooltip")} placement="bottom">
                            <Button size="small" variant="ghost" icon="folder" onClick={openWorktreeDirectory}>
                              {t("agentManager.open.button")}
                            </Button>
                          </Tooltip>
                          <Tooltip value={t("agentManager.apply.tooltip")} placement="bottom">
                            <Button
                              size="small"
                              variant="ghost"
                              onClick={openApplyDialog}
                              disabled={!hasChanges() || applyBusy()}
                            >
                              <Show when={applyBusy()}>
                                <Spinner class="am-apply-spinner" />
                              </Show>
                              {t("agentManager.apply.globalButton")}
                            </Button>
                          </Tooltip>
                        </>
                      </Show>
                      <TooltipKeybind
                        title={t("agentManager.diff.toggle")}
                        keybind={kb().toggleDiff ?? ""}
                        placement="bottom"
                      >
                        <button
                          class={`am-diff-toggle-btn ${diffOpen() && !reviewActive() ? "am-tab-diff-btn-active" : ""} ${hasChanges() ? "am-diff-toggle-has-changes" : ""}`}
                          onClick={() => {
                            if (reviewActive()) {
                              closeReviewTab()
                              setDiffOpen(true)
                              return
                            }
                            setDiffOpen((prev) => !prev)
                          }}
                          title={t("agentManager.diff.toggle")}
                        >
                          <Icon name="layers" size="small" />
                          <Show when={hasChanges()}>
                            <span class="am-diff-toggle-stats">
                              <Show when={stats()!.files > 0}>
                                <span class="am-stat-files">{stats()!.files}f</span>
                              </Show>
                              <span class="am-stat-additions">+{stats()!.additions}</span>
                              <span class="am-stat-deletions">−{stats()!.deletions}</span>
                            </span>
                          </Show>
                        </button>
                      </TooltipKeybind>
                    </>
                  )
                })()}
                <Show when={selection() !== null}>
                  <Tooltip value={t("command.review.toggle")} placement="bottom">
                    <IconButton
                      icon="expand"
                      size="small"
                      variant="ghost"
                      label={t("command.review.toggle")}
                      class={reviewActive() ? "am-tab-diff-btn-active" : ""}
                      onClick={toggleReviewTab}
                    />
                  </Tooltip>
                </Show>
                <TooltipKeybind
                  title={t("agentManager.tab.terminal")}
                  keybind={kb().showTerminal ?? ""}
                  placement="bottom"
                >
                  <IconButton
                    icon="console"
                    size="small"
                    variant="ghost"
                    label={t("agentManager.tab.openTerminal")}
                    onClick={() => {
                      const id = session.currentSessionID()
                      if (id) vscode.postMessage({ type: "agentManager.showTerminal", sessionId: id })
                      else if (selection() === LOCAL) vscode.postMessage({ type: "agentManager.showLocalTerminal" })
                    }}
                  />
                </TooltipKeybind>
              </div>
            </div>
            <DragOverlay>
              <Show when={draggedTab()}>
                {(tab) => (
                  <div class="am-tab am-tab-overlay">
                    <span class="am-tab-label">{tab().title || t("agentManager.session.untitled")}</span>
                  </div>
                )}
              </Show>
            </DragOverlay>
          </DragDropProvider>
        </Show>

        {/* Empty worktree state */}
        <Show when={contextEmpty()}>
          <div class="am-empty-state">
            <div class="am-empty-state-icon">
              <Icon name="branch" size="large" />
            </div>
            <div class="am-empty-state-text">{t("agentManager.session.noSessions")}</div>
            <Button variant="primary" size="small" onClick={handleAddSession}>
              {t("agentManager.session.new")}
              <span class="am-shortcut-hint">{kb().newTab ?? ""}</span>
            </Button>
          </div>
        </Show>

        {(() => {
          // Show setup overlay: either the transient ready/error state for the selected worktree,
          // or if the selected worktree is still being set up (from busyWorktrees map)
          const overlayState = (): SetupState | null => {
            const s = setup()
            const sel = selection()
            // Transient ready/error overlay for the selected worktree (or worktree-less setup)
            if (s.active && (!s.worktreeId || sel === s.worktreeId)) return s
            // Persistent setup-in-progress for the currently selected worktree
            if (typeof sel === "string" && sel !== LOCAL) {
              const busy = busyWorktrees().get(sel)
              if (busy?.reason === "setting-up") {
                const wt = worktrees().find((w) => w.id === sel)
                return {
                  active: true,
                  message: busy.message ?? "",
                  branch: busy.branch ?? wt?.branch,
                } satisfies SetupState
              }
            }
            return null
          }
          return (
            <Show when={overlayState()}>
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
          )
        })()}
        <Show when={!contextEmpty()}>
          {/* Chat + side diff panel (hidden when review tab is active) */}
          <div
            class={`am-detail-content ${diffOpen() ? "am-detail-split" : ""}`}
            style={{ display: reviewActive() ? "none" : undefined }}
          >
            <div class="am-chat-wrapper">
              <ChatView
                onSelectSession={(id) => {
                  if (localSessionIDs().includes(id)) {
                    session.selectSession(id)
                    if (selection() === null) setSelection(LOCAL)
                    return
                  }
                  // Navigate to owning worktree instead of forcing into local mode
                  if (worktreeSessionIds().has(id)) {
                    const ms = managedSessions().find((s) => s.id === id)
                    if (ms?.worktreeId) {
                      selectWorktree(ms.worktreeId)
                      session.selectSession(id)
                      setReviewActive(false)
                      return
                    }
                  }
                  openLocally(id)
                }}
                readonly={readOnly()}
                continueInWorktree={selection() === LOCAL}
                promptBoxId={`agent-manager:${selection() ?? "unassigned"}`}
                pendingSessionID={selection() === LOCAL ? activePendingId() : undefined}
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
                      if (sid) vscode.postMessage({ type: "agentManager.promoteSession", sessionId: sid })
                    }}
                  >
                    {t("agentManager.session.openInWorktree")}
                  </Button>
                </div>
              </Show>
            </div>
            <Show when={diffOpen()}>
              <div class="am-diff-resize" style={{ width: `${diffWidth()}px` }}>
                <ResizeHandle
                  direction="horizontal"
                  edge="start"
                  size={diffWidth()}
                  min={200}
                  max={Math.round(window.innerWidth * 0.8)}
                  onResize={(w) => {
                    pendingDiffWidth = Math.max(200, Math.min(w, window.innerWidth * 0.8))
                    if (diffRaf === undefined) {
                      diffRaf = requestAnimationFrame(() => {
                        diffRaf = undefined
                        setDiffWidth(pendingDiffWidth!)
                      })
                    }
                  }}
                />
                <div class="am-diff-panel-wrapper">
                  <DiffPanel
                    diffs={reviewDiffs()}
                    loading={diffLoading()}
                    loadingFiles={diffFileLoadingForCurrent()}
                    sessionId={currentDiffSessionId()}
                    sessionKey={diffSessionKey()}
                    diffStyle={reviewDiffStyle()}
                    onDiffStyleChange={setSharedDiffStyle}
                    comments={reviewComments()}
                    onCommentsChange={setReviewCommentsForSelection}
                    onClose={() => setDiffOpen(false)}
                    onExpand={selection() !== null ? openReviewTab : undefined}
                    onRequestDiff={requestDiffFile}
                    onOpenFile={(file) => {
                      const id = currentDiffSessionId()
                      if (id) vscode.postMessage({ type: "agentManager.openFile", sessionId: id, filePath: file })
                      else if (selection() === LOCAL) vscode.postMessage({ type: "openFile", filePath: file })
                    }}
                  />
                </div>
              </div>
            </Show>
          </div>
          {/* Full-screen review tab (lazy-mounted, stays alive once opened for fast toggle) */}
          <Show when={reviewOpen()}>
            <div class="am-review-host" style={{ display: reviewActive() ? undefined : "none" }}>
              <FullScreenDiffView
                diffs={reviewDiffs()}
                loading={diffLoading()}
                loadingFiles={diffFileLoadingForCurrent()}
                sessionId={currentDiffSessionId()}
                sessionKey={diffSessionKey()}
                comments={reviewComments()}
                onCommentsChange={setReviewCommentsForSelection}
                onSendAll={closeReviewTab}
                diffStyle={reviewDiffStyle()}
                onDiffStyleChange={setSharedDiffStyle}
                onRequestDiff={requestDiffFile}
                onOpenFile={(file) => {
                  const id = currentDiffSessionId()
                  if (id) vscode.postMessage({ type: "agentManager.openFile", sessionId: id, filePath: file })
                  else if (selection() === LOCAL) vscode.postMessage({ type: "openFile", filePath: file })
                }}
                onClose={closeReviewTab}
              />
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}

export const AgentManagerApp: Component = () => {
  return (
    <ThemeProvider defaultTheme="kilo-vscode">
      <DialogProvider>
        <VSCodeProvider>
          <ServerProvider>
            <LanguageBridge>
              <MarkedProvider>
                <DiffComponentProvider component={Diff}>
                  <CodeComponentProvider component={Code}>
                    <FileComponentProvider component={File}>
                      <ProviderProvider>
                        <ConfigProvider>
                          <NotificationsProvider>
                            <SessionProvider>
                              <WorktreeModeProvider>
                                <DataBridge>
                                  <AgentManagerContent />
                                </DataBridge>
                              </WorktreeModeProvider>
                            </SessionProvider>
                          </NotificationsProvider>
                        </ConfigProvider>
                      </ProviderProvider>
                    </FileComponentProvider>
                  </CodeComponentProvider>
                </DiffComponentProvider>
              </MarkedProvider>
            </LanguageBridge>
          </ServerProvider>
        </VSCodeProvider>
        <Toast.Region />
      </DialogProvider>
    </ThemeProvider>
  )
}
