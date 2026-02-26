// Agent Manager root component

import {
  Component,
  For,
  Show,
  createSignal,
  createMemo,
  createEffect,
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
  AgentManagerImportResultMessage,
  AgentManagerWorktreeDiffMessage,
  AgentManagerWorktreeDiffLoadingMessage,
  WorktreeFileDiff,
  WorktreeState,
  ManagedSessionState,
  SessionInfo,
  BranchInfo,
} from "../src/types/messages"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { DialogProvider, useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { Code } from "@kilocode/kilo-ui/code"
import { Diff } from "@kilocode/kilo-ui/diff"
import { Toast, showToast } from "@kilocode/kilo-ui/toast"
import { ResizeHandle } from "@kilocode/kilo-ui/resize-handle"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip, TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { Popover } from "@kilocode/kilo-ui/popover"
import { HoverCard } from "@kilocode/kilo-ui/hover-card"
import { VSCodeProvider, useVSCode } from "../src/context/vscode"
import { ServerProvider } from "../src/context/server"
import { ProviderProvider } from "../src/context/provider"
import { ConfigProvider } from "../src/context/config"
import { SessionProvider, useSession } from "../src/context/session"
import { WorktreeModeProvider } from "../src/context/worktree-mode"
import { ChatView } from "../src/components/chat"
import { ModelSelectorBase } from "../src/components/chat/ModelSelector"
import { ModeSwitcherBase } from "../src/components/chat/ModeSwitcher"
import {
  MultiModelSelector,
  type ModelAllocations,
  MAX_MULTI_VERSIONS,
  totalAllocations,
  allocationsToArray,
} from "./MultiModelSelector"
import { LanguageBridge, DataBridge } from "../src/App"
import { useLanguage } from "../src/context/language"
import { formatRelativeDate } from "../src/utils/date"
import { useImageAttachments } from "../src/hooks/useImageAttachments"
import { validateLocalSession, nextSelectionAfterDelete, adjacentHint, LOCAL } from "./navigate"
import { reorderTabs, applyTabOrder, firstOrderedTitle } from "./tab-order"
import { ConstrainDragYAxis, SortableTab } from "./sortable-tab"
import { DiffPanel } from "./DiffPanel"
import "./agent-manager.css"

interface SetupState {
  active: boolean
  message: string
  branch?: string
  error?: boolean
  worktreeId?: string
}

interface WorktreeBusyState {
  reason: "setting-up" | "deleting"
  message?: string
  branch?: string
}

/** Sidebar selection: LOCAL for workspace, worktree ID for a worktree, or null for an unassigned session. */
type SidebarSelection = typeof LOCAL | string | null

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

// Fallback keybindings before extension sends resolved ones
const defaultBindings: Record<string, string> = {
  previousSession: isMac ? "⌘↑" : "Ctrl+↑",
  nextSession: isMac ? "⌘↓" : "Ctrl+↓",
  previousTab: isMac ? "⌘←" : "Ctrl+←",
  nextTab: isMac ? "⌘→" : "Ctrl+→",
  showTerminal: isMac ? "⌘/" : "Ctrl+/",
  newTab: isMac ? "⌘T" : "Ctrl+T",
  closeTab: isMac ? "⌘W" : "Ctrl+W",
  newWorktree: isMac ? "⌘N" : "Ctrl+N",
  advancedWorktree: isMac ? "⌘⇧N" : "Ctrl+Shift+N",
  closeWorktree: isMac ? "⌘⇧W" : "Ctrl+Shift+W",
  agentManagerOpen: isMac ? "⌘⇧M" : "Ctrl+Shift+M",
  focusPanel: isMac ? "⌘." : "Ctrl+.",
}

/** Manages horizontal scroll for the tab list: hides the scrollbar, converts
 *  vertical wheel events to horizontal scroll, tracks overflow to show/hide
 *  fade indicators, and auto-scrolls the active tab into view. */
function useTabScroll(activeTabs: Accessor<SessionInfo[]>, activeId: Accessor<string | undefined>) {
  const [ref, setRef] = createSignal<HTMLDivElement | undefined>()
  const [showLeft, setShowLeft] = createSignal(false)
  const [showRight, setShowRight] = createSignal(false)

  const update = () => {
    const el = ref()
    if (!el) return
    setShowLeft(el.scrollLeft > 2)
    setShowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
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
      title: t("agentManager.shortcuts.category.sidebar"),
      shortcuts: [
        { label: t("agentManager.shortcuts.previousItem"), binding: bindings.previousSession ?? "" },
        { label: t("agentManager.shortcuts.nextItem"), binding: bindings.nextSession ?? "" },
        { label: t("agentManager.shortcuts.newWorktree"), binding: bindings.newWorktree ?? "" },
        { label: t("agentManager.shortcuts.advancedWorktree"), binding: bindings.advancedWorktree ?? "" },
        { label: t("agentManager.shortcuts.deleteWorktree"), binding: bindings.closeWorktree ?? "" },
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
        { label: t("agentManager.shortcuts.focusPanel"), binding: bindings.focusPanel ?? "" },
      ],
    },
    {
      title: t("agentManager.shortcuts.category.global"),
      shortcuts: [
        { label: t("agentManager.shortcuts.openAgentManager"), binding: bindings.agentManagerOpen ?? "" },
      ].filter((s) => s.binding),
    },
  ].filter((c) => c.shortcuts.length > 0)
}

/** Parse a display keybinding string into separate key tokens for rendering.
 *  Windows/Linux format ("Ctrl+Shift+W") splits on "+".
 *  Mac format ("⌘⇧W") splits on known modifier symbols. */
function parseBindingTokens(binding: string): string[] {
  if (!binding) return []
  // Windows/Linux: "Ctrl+Shift+W" → ["Ctrl", "Shift", "W"]
  if (binding.includes("+")) return binding.split("+")
  // Mac: "⌘⇧W" → ["⌘", "⇧", "W"] — peel off known modifier symbols
  const tokens: string[] = []
  let rest = binding
  const modifiers = ["⌘", "⇧", "⌃", "⌥"]
  while (rest.length > 0) {
    const mod = modifiers.find((m) => rest.startsWith(m))
    if (mod) {
      tokens.push(mod)
      rest = rest.slice(mod.length)
    } else {
      tokens.push(rest)
      break
    }
  }
  return tokens
}

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
  const [worktreesLoaded, setWorktreesLoaded] = createSignal(false)
  const [sessionsLoaded, setSessionsLoaded] = createSignal(false)
  const [isGitRepo, setIsGitRepo] = createSignal(true)

  const DEFAULT_SIDEBAR_WIDTH = 260
  const MIN_SIDEBAR_WIDTH = 200
  const MAX_SIDEBAR_WIDTH_RATIO = 0.4

  // Recover persisted local session IDs from webview state
  const persisted = vscode.getState<{ localSessionIDs?: string[]; sidebarWidth?: number }>()
  const [localSessionIDs, setLocalSessionIDs] = createSignal<string[]>(persisted?.localSessionIDs ?? [])
  const [sidebarWidth, setSidebarWidth] = createSignal(persisted?.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH)
  const [sessionsCollapsed, setSessionsCollapsed] = createSignal(false)

  // Diff panel state
  const [diffOpen, setDiffOpen] = createSignal(false)
  const [diffDatas, setDiffDatas] = createSignal<Record<string, WorktreeFileDiff[]>>({})
  const [diffLoading, setDiffLoading] = createSignal(false)
  const [diffWidth, setDiffWidth] = createSignal(Math.round(window.innerWidth * 0.5))

  // Pending local tab counter for generating unique IDs
  let pendingCounter = 0
  const PENDING_PREFIX = "pending:"
  const [activePendingId, setActivePendingId] = createSignal<string | undefined>()

  // Per-context tab memory: maps sidebar selection key -> last active session/pending ID
  const [tabMemory, setTabMemory] = createSignal<Record<string, string>>({})

  const isPending = (id: string) => id.startsWith(PENDING_PREFIX)

  // Drag-and-drop state for tab reordering
  const [draggingTab, setDraggingTab] = createSignal<string | undefined>()
  // Tab ordering: context key → ordered session ID array (recovered from extension state)
  const [worktreeTabOrder, setWorktreeTabOrder] = createSignal<Record<string, string[]>>({})

  const addPendingTab = () => {
    const id = `${PENDING_PREFIX}${++pendingCounter}`
    setLocalSessionIDs((prev) => [...prev, id])
    setActivePendingId(id)
    session.clearCurrentSession()
    return id
  }

  // Persist local session IDs and sidebar width to webview state for recovery (exclude pending tabs)
  createEffect(() => {
    vscode.setState({
      localSessionIDs: localSessionIDs().filter((id) => !isPending(id)),
      sidebarWidth: sidebarWidth(),
    })
  })

  // Save the currently active tab for the current sidebar context before switching away
  const saveTabMemory = () => {
    const sel = selection()
    if (sel === null) return
    const key = sel === LOCAL ? LOCAL : sel
    const active = session.currentSessionID() ?? activePendingId()
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

  // Read-only mode: viewing an unassigned session (not in a worktree or local)
  const readOnly = createMemo(() => selection() === null && !!session.currentSessionID())

  // Tab scroll: hidden scrollbar with fade overflow indicators
  const visibleTabId = createMemo(() => session.currentSessionID() ?? activePendingId())
  const tabScroll = useTabScroll(activeTabs, visibleTabId)

  // Display name for worktree — prefers persisted label, then first session title, then branch
  const worktreeLabel = (wt: WorktreeState): string => {
    if (wt.label) return wt.label
    const managed = managedSessions().filter((ms) => ms.worktreeId === wt.id)
    const ids = new Set(managed.map((ms) => ms.id))
    const sessions = session.sessions().filter((s) => ids.has(s.id))
    return firstOrderedTitle(sessions, worktreeTabOrder()[wt.id], wt.branch)
  }

  /** Worktrees sorted so that grouped items are always adjacent, ordered by creation time. */
  const sortedWorktrees = createMemo(() => {
    const all = worktrees()
    if (all.length === 0) return []

    // Collect grouped worktrees by groupId
    const grouped = new Map<string, WorktreeState[]>()
    for (const wt of all) {
      if (!wt.groupId) continue
      const list = grouped.get(wt.groupId) ?? []
      list.push(wt)
      grouped.set(wt.groupId, list)
    }

    // Build output: interleave groups at the position of their earliest member
    const result: WorktreeState[] = []
    const placed = new Set<string>()
    for (const wt of all) {
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
      ...worktrees().map((wt) => ({ type: "wt" as const, id: wt.id })),
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
      session.selectSession(item.id)
    }

    const el = document.querySelector(`[data-sidebar-id="${item.id}"]`)
    if (el instanceof HTMLElement) scrollIntoView(el)
  }

  // Navigate tabs with Cmd+Left/Right
  const navigateTab = (direction: "left" | "right") => {
    const tabs = activeTabs()
    if (tabs.length === 0) return
    const current = session.currentSessionID()
    // Find current index — if no current session, look for the active pending tab
    const idx = current ? tabs.findIndex((s) => s.id === current) : tabs.findIndex((s) => s.id === activePendingId())
    const next = direction === "left" ? idx - 1 : idx + 1
    if (next < 0 || next >= tabs.length) return
    const target = tabs[next]!
    if (isPending(target.id)) {
      setActivePendingId(target.id)
      session.clearCurrentSession()
    } else {
      setActivePendingId(undefined)
      session.selectSession(target.id)
    }
  }

  const selectLocal = () => {
    saveTabMemory()
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
    } else {
      setActivePendingId(undefined)
      session.clearCurrentSession()
    }
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
      } else if (msg.action === "toggleDiff") {
        setDiffOpen((prev) => !prev)
      } else if (msg.action === "newTab") handleNewTabForCurrentSelection()
      else if (msg.action === "closeTab") closeActiveTab()
      else if (msg.action === "newWorktree") handleNewWorktreeOrPromote()
      else if (msg.action === "advancedWorktree") showAdvancedWorktreeDialog()
      else if (msg.action === "closeWorktree") closeSelectedWorktree()
      else if (msg.action === "focusInput") window.dispatchEvent(new Event("focusPrompt"))
    }
    window.addEventListener("message", handler)

    // Prevent Cmd+Arrow/T/W/N from triggering native browser actions
    const preventDefaults = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault()
      }
      // Prevent browser defaults for our shortcuts (new tab, close tab, new window, toggle diff)
      if (["t", "w", "n", "d"].includes(e.key.toLowerCase()) && !e.shiftKey) {
        e.preventDefault()
      }
      // Prevent defaults for shift variants (close worktree, advanced new worktree)
      if (["w", "n"].includes(e.key.toLowerCase()) && e.shiftKey) {
        e.preventDefault()
      }
    }
    window.addEventListener("keydown", preventDefaults)

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

    // When a session is created while on local, replace the current pending tab with the real session.
    // Guard against duplicate sessionCreated events (HTTP response + SSE can both fire).
    const unsubCreate = vscode.onMessage((msg) => {
      if (msg.type === "sessionCreated" && selection() === LOCAL) {
        const created = msg as { type: string; session: { id: string } }
        if (localSessionIDs().includes(created.session.id)) return
        const pending = activePendingId()
        if (pending) {
          setLocalSessionIDs((prev) => prev.map((id) => (id === pending ? created.session.id : id)))
          setActivePendingId(undefined)
        } else {
          setLocalSessionIDs((prev) => [...prev, created.session.id])
        }
      }
    })

    // Mark sessions loaded as soon as the session context receives data (even if empty)
    const unsubSessions = vscode.onMessage((msg) => {
      if (msg.type === "sessionsLoaded" && !sessionsLoaded()) setSessionsLoaded(true)
    })

    const unsub = vscode.onMessage((msg) => {
      if (msg.type === "agentManager.repoInfo") {
        const info = msg as AgentManagerRepoInfoMessage
        setRepoBranch(info.branch)
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
          setSetup({ active: true, message: ev.message, branch: ev.branch, error, worktreeId: ev.worktreeId })
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
          setSetup({ active: true, message: ev.message, branch: ev.branch, worktreeId: ev.worktreeId })
        }
      }

      if (msg.type === "agentManager.sessionAdded") {
        const ev = msg as { type: string; sessionId: string; worktreeId: string }
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
        if (state.isGitRepo !== undefined) setIsGitRepo(state.isGitRepo)
        if (!worktreesLoaded()) setWorktreesLoaded(true)
        // When not a git repo, also mark sessions as loaded since the Kilo
        // server won't connect to send the sessionsLoaded message.
        if (state.isGitRepo === false && !sessionsLoaded()) setSessionsLoaded(true)
        if (state.tabOrder) setWorktreeTabOrder(state.tabOrder)
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

        // Set model and agent selections for this session so the UI reflects them
        if (ev.providerID && ev.modelID) {
          session.setSessionModel(ev.sessionId, ev.providerID, ev.modelID)
        }
        if (ev.agent) {
          session.setSessionAgent(ev.sessionId, ev.agent)
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
        setDiffDatas((prev) => ({ ...prev, [ev.sessionId]: ev.diffs }))
      }

      if (msg.type === "agentManager.worktreeDiffLoading") {
        const ev = msg as AgentManagerWorktreeDiffLoadingMessage
        setDiffLoading(ev.loading)
      }
    })

    onCleanup(() => {
      window.removeEventListener("message", handler)
      window.removeEventListener("keydown", preventDefaults)
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

  // Start/stop diff watch when panel opens/closes or session changes
  createEffect(() => {
    const open = diffOpen()
    const id = session.currentSessionID()
    if (open && id) {
      const ms = managedSessions().find((s) => s.id === id)
      if (ms?.worktreeId) {
        vscode.postMessage({ type: "agentManager.startDiffWatch", sessionId: id })
      } else {
        vscode.postMessage({ type: "agentManager.stopDiffWatch" })
      }
    } else {
      vscode.postMessage({ type: "agentManager.stopDiffWatch" })
    }
  })

  onCleanup(() => {
    if (diffOpen()) {
      vscode.postMessage({ type: "agentManager.stopDiffWatch" })
    }
  })

  const handleConfigureSetupScript = () => {
    vscode.postMessage({ type: "agentManager.configureSetupScript" })
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

  const handleCreateWorktree = () => {
    vscode.postMessage({ type: "agentManager.createWorktree" })
  }

  // Advanced worktree dialog — opens a full dialog with prompt, versions, model, mode
  const showAdvancedWorktreeDialog = () => {
    dialog.show(() => <NewWorktreeDialog onClose={() => dialog.close()} />)
  }

  const confirmDeleteWorktree = (worktreeId: string) => {
    const wt = worktrees().find((w) => w.id === worktreeId)
    if (!wt) return
    const doDelete = () => {
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
      dialog.close()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        doDelete()
      }
    }
    dialog.show(() => (
      <Dialog title={t("agentManager.dialog.deleteWorktree.title")} fit>
        <div class="am-confirm" onKeyDown={onKeyDown}>
          <div class="am-confirm-message">
            <Icon name="trash" size="small" />
            <span>
              {t("agentManager.dialog.deleteWorktree.messagePre")}
              <code class="am-confirm-branch">{wt.branch}</code>
              {t("agentManager.dialog.deleteWorktree.messagePost")}
            </span>
          </div>
          <div class="am-confirm-actions">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {t("agentManager.dialog.deleteWorktree.cancel")}
            </Button>
            <Button variant="primary" size="large" class="am-confirm-delete" onClick={doDelete} autofocus>
              {t("agentManager.dialog.deleteWorktree.confirm")}
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
    vscode.postMessage({ type: "agentManager.promoteSession", sessionId })
  }

  const handleAddSession = () => {
    const sel = selection()
    if (sel === LOCAL) {
      addPendingTab()
    } else if (sel) {
      vscode.postMessage({ type: "agentManager.addSessionToWorktree", worktreeId: sel })
    }
  }

  const handleCloseTab = (sessionId: string, e: MouseEvent) => {
    e.stopPropagation()
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
      handleCloseTab(sessionId, e)
    }
  }

  // Drag-and-drop handlers for tab reordering
  const tabIds = createMemo(() => activeTabs().map((s) => s.id))

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
      setLocalSessionIDs((prev) => reorderTabs(prev, from, to) ?? prev)
    } else if (sel) {
      setWorktreeTabOrder((prev) => {
        const ids = applyTabOrder(
          tabIds().map((id) => ({ id })),
          prev[sel],
        ).map((item) => item.id)
        const reordered = reorderTabs(ids, from, to)
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
    } else if (sel) {
      const order = worktreeTabOrder()[sel]
      if (order) vscode.postMessage({ type: "agentManager.setTabOrder", key: sel, order })
    }
  }

  const draggedTab = createMemo(() => {
    const id = draggingTab()
    if (!id) return undefined
    return activeTabs().find((s) => s.id === id)
  })

  // Close the currently active tab via keyboard shortcut.
  // If no tabs remain, fall through to close the selected worktree.
  const closeActiveTab = () => {
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
    const synthetic = new MouseEvent("click")
    handleCloseTab(target.id, synthetic)
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
    <div class="am-layout">
      <div class="am-sidebar" style={{ width: `${sidebarWidth()}px` }}>
        <ResizeHandle
          direction="horizontal"
          size={sidebarWidth()}
          min={MIN_SIDEBAR_WIDTH}
          max={9999}
          onResize={(width) => setSidebarWidth(Math.min(width, window.innerWidth * MAX_SIDEBAR_WIDTH_RATIO))}
        />
        {/* Local workspace item */}
        <button
          class={`am-local-item ${selection() === LOCAL ? "am-local-item-active" : ""}`}
          data-sidebar-id="local"
          onClick={() => selectLocal()}
        >
          <svg class="am-local-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2.5" y="3.5" width="15" height="10" rx="1" stroke="currentColor" />
            <path d="M6 16.5H14" stroke="currentColor" stroke-linecap="square" />
            <path d="M10 13.5V16.5" stroke="currentColor" />
          </svg>
          <div class="am-local-text">
            <span class="am-local-label">{t("agentManager.local")}</span>
            <Show when={repoBranch()}>
              <span class="am-local-branch">{repoBranch()}</span>
            </Show>
          </div>
        </button>

        {/* WORKTREES section */}
        <div class={`am-section ${sessionsCollapsed() ? "am-section-grow" : ""}`}>
          <div class="am-section-header">
            <span class="am-section-label">{t("agentManager.section.worktrees")}</span>
            <Show when={isGitRepo()}>
              <div class="am-section-actions">
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
                      <DropdownMenu.Item onSelect={handleShowKeyboardShortcuts}>
                        <DropdownMenu.ItemLabel>{t("agentManager.shortcuts.title")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item onSelect={handleConfigureSetupScript}>
                        <DropdownMenu.ItemLabel>{t("agentManager.worktree.setupScript")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu>
                <div class="am-split-button">
                  <IconButton
                    icon="plus"
                    size="small"
                    variant="ghost"
                    label={t("agentManager.worktree.new")}
                    onClick={handleCreateWorktree}
                  />
                  <DropdownMenu gutter={4} placement="bottom-end">
                    <DropdownMenu.Trigger
                      class="am-split-arrow"
                      aria-label={t("agentManager.worktree.advancedOptions")}
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
                  <Icon name="info" size="small" />
                  <span>{t("agentManager.notGitRepo")}</span>
                </div>
              </Show>
              <Show when={isGitRepo()}>
                {(() => {
                  const [hoveredWt, setHoveredWt] = createSignal<string | null>(null)
                  const [overClose, setOverClose] = createSignal(false)
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

                  return (
                    <For each={sortedWorktrees()}>
                      {(wt, idx) => {
                        const grouped = () => isGrouped(wt)
                        const start = () => isGroupStart(wt, idx())
                        const end = () => isGroupEnd(wt, idx())
                        const busy = () => busyWorktrees().has(wt.id)
                        const groupSize = () => {
                          if (!wt.groupId) return 0
                          return sortedWorktrees().filter((w) => w.groupId === wt.groupId).length
                        }
                        const sessions = createMemo(() => managedSessions().filter((ms) => ms.worktreeId === wt.id))
                        const navHint = () => {
                          const flat = [
                            LOCAL as string,
                            ...sortedWorktrees().map((w) => w.id),
                            ...unassignedSessions().map((s) => s.id),
                          ]
                          const active = selection() ?? session.currentSessionID() ?? ""
                          return adjacentHint(wt.id, active, flat, kb().previousSession ?? "", kb().nextSession ?? "")
                        }
                        return (
                          <>
                            <Show when={start()}>
                              <div class="am-wt-group-header">
                                <Icon name="layers" size="small" />
                                <span class="am-wt-group-label">
                                  {t("agentManager.worktree.versions", { count: groupSize() })}
                                </span>
                              </div>
                            </Show>
                            <HoverCard
                              openDelay={100}
                              closeDelay={100}
                              placement="right-start"
                              gutter={8}
                              open={hoveredWt() === wt.id && !overClose()}
                              onOpenChange={(open) => setHoveredWt(open ? wt.id : null)}
                              trigger={
                                <div
                                  class="am-worktree-item"
                                  classList={{
                                    "am-worktree-item-active": selection() === wt.id,
                                    "am-wt-grouped": grouped(),
                                    "am-wt-group-end": end(),
                                  }}
                                  data-sidebar-id={wt.id}
                                  onClick={() => selectWorktree(wt.id)}
                                >
                                  <Show
                                    when={!busyWorktrees().has(wt.id)}
                                    fallback={<Spinner class="am-worktree-spinner" />}
                                  >
                                    <Icon name="branch" size="small" />
                                  </Show>
                                  <Show
                                    when={renamingWt() === wt.id}
                                    fallback={
                                      <span
                                        class="am-worktree-branch"
                                        onDblClick={(e) => {
                                          e.stopPropagation()
                                          startRename(wt.id, worktreeLabel(wt))
                                        }}
                                        title={t("agentManager.worktree.doubleClickRename")}
                                      >
                                        {worktreeLabel(wt)}
                                      </span>
                                    }
                                  >
                                    <input
                                      class="am-worktree-rename-input"
                                      value={renameValue()}
                                      onInput={(e) => setRenameValue(e.currentTarget.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault()
                                          commitRename(wt.id)
                                        }
                                        if (e.key === "Escape") {
                                          e.preventDefault()
                                          cancelRename()
                                        }
                                      }}
                                      onBlur={() => commitRename(wt.id)}
                                      onClick={(e) => e.stopPropagation()}
                                      ref={(el) =>
                                        requestAnimationFrame(() => {
                                          el.focus()
                                          el.select()
                                        })
                                      }
                                    />
                                  </Show>
                                  <Show when={!busyWorktrees().has(wt.id)}>
                                    <div
                                      class="am-worktree-close"
                                      onMouseEnter={() => setOverClose(true)}
                                      onMouseLeave={() => setOverClose(false)}
                                    >
                                      <TooltipKeybind
                                        title={t("agentManager.worktree.delete")}
                                        keybind={kb().closeWorktree ?? ""}
                                        placement="top"
                                      >
                                        <IconButton
                                          icon="close-small"
                                          size="small"
                                          variant="ghost"
                                          label={t("agentManager.worktree.delete")}
                                          onClick={(e: MouseEvent) => handleDeleteWorktree(wt.id, e)}
                                        />
                                      </TooltipKeybind>
                                    </div>
                                  </Show>
                                </div>
                              }
                            >
                              <div class="am-hover-card">
                                <div class="am-hover-card-header">
                                  <div>
                                    <div class="am-hover-card-label">{t("agentManager.hoverCard.branch")}</div>
                                    <div class="am-hover-card-branch">{wt.branch}</div>
                                    <div class="am-hover-card-meta">{formatRelativeDate(wt.createdAt)}</div>
                                  </div>
                                  <Show when={navHint()}>
                                    <span class="am-hover-card-keybind">{navHint()}</span>
                                  </Show>
                                </div>
                                <Show when={wt.parentBranch}>
                                  <div class="am-hover-card-divider" />
                                  <div class="am-hover-card-row">
                                    <span class="am-hover-card-row-label">{t("agentManager.hoverCard.base")}</span>
                                    <span class="am-hover-card-row-value">{wt.parentBranch}</span>
                                  </div>
                                </Show>
                                <div class="am-hover-card-divider" />
                                <div class="am-hover-card-row">
                                  <span class="am-hover-card-row-label">{t("agentManager.hoverCard.sessions")}</span>
                                  <span class="am-hover-card-row-value">{sessions().length}</span>
                                </div>
                              </div>
                            </HoverCard>
                          </>
                        )
                      }}
                    </For>
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
                    <button
                      class={`am-item ${s.id === session.currentSessionID() && selection() === null ? "am-item-active" : ""}`}
                      data-sidebar-id={s.id}
                      onClick={() => {
                        saveTabMemory()
                        setSelection(null)
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
                    <For each={activeTabs()}>
                      {(s) => {
                        const pending = isPending(s.id)
                        const active = () =>
                          pending
                            ? s.id === activePendingId() && !session.currentSessionID()
                            : s.id === session.currentSessionID()
                        const tabDirection = () => {
                          if (active()) return ""
                          const ids = activeTabs().map((t) => t.id)
                          const activeId = session.currentSessionID() ?? activePendingId() ?? ""
                          return adjacentHint(s.id, activeId, ids, kb().previousTab ?? "", kb().nextTab ?? "")
                        }
                        return (
                          <SortableTab
                            tab={s}
                            active={active()}
                            keybind={tabDirection()}
                            closeKeybind={kb().closeTab ?? ""}
                            onSelect={() => {
                              if (pending) {
                                setActivePendingId(s.id)
                                session.clearCurrentSession()
                              } else {
                                setActivePendingId(undefined)
                                session.selectSession(s.id)
                              }
                            }}
                            onMiddleClick={(e: MouseEvent) => handleTabMouseDown(s.id, e)}
                            onClose={(e: MouseEvent) => handleCloseTab(s.id, e)}
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
                <Show when={selection() !== LOCAL}>
                  <TooltipKeybind
                    title={t("agentManager.diff.toggle")}
                    keybind={kb().toggleDiff ?? ""}
                    placement="bottom"
                  >
                    <IconButton
                      icon="layers"
                      size="small"
                      variant="ghost"
                      label={t("agentManager.diff.toggle")}
                      class={diffOpen() ? "am-tab-diff-btn-active" : ""}
                      onClick={() => setDiffOpen((prev) => !prev)}
                    />
                  </TooltipKeybind>
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
          const overlayState = () => {
            const s = setup()
            const sel = selection()
            // Transient ready/error overlay for the selected worktree (or worktree-less setup)
            if (s.active && (!s.worktreeId || sel === s.worktreeId)) return s
            // Persistent setup-in-progress for the currently selected worktree
            if (typeof sel === "string" && sel !== LOCAL) {
              const busy = busyWorktrees().get(sel)
              if (busy?.reason === "setting-up") {
                const wt = worktrees().find((w) => w.id === sel)
                return { active: true, message: busy.message, branch: busy.branch ?? wt?.branch }
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
                      <span>{state().message}</span>
                    </div>
                  </div>
                </div>
              )}
            </Show>
          )
        })()}
        <Show when={!contextEmpty()}>
          <div class={`am-detail-content ${diffOpen() ? "am-detail-split" : ""}`}>
            <div class="am-chat-wrapper">
              <ChatView
                onSelectSession={(id) => {
                  // If on local and selecting a different session, keep local context
                  session.selectSession(id)
                }}
                readonly={readOnly()}
              />
              <Show when={readOnly()}>
                <div class="am-readonly-banner">
                  <Icon name="branch" size="small" />
                  <span class="am-readonly-text">{t("agentManager.session.readonly")}</span>
                  <Button
                    variant="primary"
                    size="small"
                    onClick={() => {
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
              <div class="am-diff-panel-wrapper" style={{ width: `${diffWidth()}px`, "flex-shrink": "0" }}>
                <ResizeHandle
                  direction="horizontal"
                  edge="start"
                  size={diffWidth()}
                  min={200}
                  max={Math.round(window.innerWidth * 0.8)}
                  onResize={(w) => setDiffWidth(Math.max(200, Math.min(w, window.innerWidth * 0.8)))}
                />
                <DiffPanel
                  diffs={diffDatas()[session.currentSessionID() ?? ""] ?? []}
                  loading={diffLoading()}
                  onClose={() => setDiffOpen(false)}
                />
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Advanced "New Worktree" dialog — prompt, versions, model, mode, import tab
// ---------------------------------------------------------------------------

type VersionCount = 1 | 2 | 3 | 4
const VERSION_OPTIONS: VersionCount[] = [1, 2, 3, 4]

type DialogTab = "new" | "import"

function sanitizeSegment(text: string, maxLength = 50): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._+@-]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/@\{/g, "@")
    .replace(/-+/g, "-")
    .replace(/^[-.]|[-.]+$/g, "")
    .replace(/\.lock$/g, "")
    .slice(0, maxLength)
}

function sanitizeBranchName(name: string): string {
  return name
    .split("/")
    .map((s) => sanitizeSegment(s))
    .filter(Boolean)
    .join("/")
}

const NewWorktreeDialog: Component<{ onClose: () => void }> = (props) => {
  const { t } = useLanguage()
  const vscode = useVSCode()
  const session = useSession()

  const [tab, setTab] = createSignal<DialogTab>("new")

  // --- Shared branch data (used by both New tab's base branch selector and Import tab) ---
  const [branches, setBranches] = createSignal<BranchInfo[]>([])
  const [branchesLoading, setBranchesLoading] = createSignal(false)
  const [defaultBranch, setDefaultBranch] = createSignal("main")
  const [branchSearch, setBranchSearch] = createSignal("")

  // --- New tab state ---
  const [name, setName] = createSignal("")
  const [prompt, setPrompt] = createSignal("")
  const [versions, setVersions] = createSignal<VersionCount>(1)
  const [model, setModel] = createSignal<{ providerID: string; modelID: string } | null>(null)
  const [compareMode, setCompareMode] = createSignal(false)
  const [modelAllocations, setModelAllocations] = createSignal<ModelAllocations>(new Map())
  const [agent, setAgent] = createSignal(session.selectedAgent())
  const [starting, setStarting] = createSignal(false)
  const [showAdvanced, setShowAdvanced] = createSignal(false)
  const [branchName, setBranchName] = createSignal("")
  const [baseBranch, setBaseBranch] = createSignal<string | null>(null)
  const [baseBranchOpen, setBaseBranchOpen] = createSignal(false)
  const [highlightedIndex, setHighlightedIndex] = createSignal(0)

  const imageAttach = useImageAttachments()

  let textareaRef: HTMLTextAreaElement | undefined

  onMount(() => {
    requestAnimationFrame(() => {
      if (!textareaRef) return
      textareaRef.focus()
      textareaRef.select()
    })
    setBranchesLoading(true)
    vscode.postMessage({ type: "agentManager.requestBranches" })
  })

  const effectiveBaseBranch = () => baseBranch() ?? defaultBranch()

  const filteredBranches = createMemo(() => {
    const search = branchSearch().toLowerCase()
    if (!search) return branches()
    return branches().filter((b) => b.name.toLowerCase().includes(search))
  })

  const canSubmit = () => {
    if (starting()) return false
    if (compareMode() && totalAllocations(modelAllocations()) === 0) return false
    return true
  }

  const handleSubmit = () => {
    if (!canSubmit()) return
    setStarting(true)

    const text = prompt().trim() || undefined
    const defaultAgent = session.agents()[0]?.name
    const selectedAgent = agent() !== defaultAgent ? agent() : undefined
    const advanced = showAdvanced()
    const customBranch = advanced ? branchName().trim() || undefined : undefined
    const imgs = imageAttach.images()
    const imgFiles = imgs.length > 0 ? imgs.map((img) => ({ mime: img.mime, url: img.dataUrl })) : undefined

    const isCompare = compareMode()
    const allocations = isCompare ? allocationsToArray(modelAllocations()) : undefined
    const count = isCompare ? totalAllocations(modelAllocations()) : versions()
    const sel = isCompare ? null : model()

    vscode.postMessage({
      type: "agentManager.createMultiVersion",
      text,
      name: name().trim() || undefined,
      versions: count,
      providerID: sel?.providerID,
      modelID: sel?.modelID,
      agent: selectedAgent,
      baseBranch: advanced ? (baseBranch() ?? undefined) : undefined,
      branchName: customBranch,
      modelAllocations: allocations,
      files: imgFiles,
    })

    props.onClose()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const adjustHeight = () => {
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 200)}px`
  }

  // --- Import tab state ---
  const [prUrl, setPrUrl] = createSignal("")
  const [prPending, setPrPending] = createSignal(false)
  const [branchOpen, setBranchOpen] = createSignal(false)
  const [importPending, setImportPending] = createSignal(false)

  const isPending = () => prPending() || importPending()

  // Listen for branch data + import results
  const importUnsub = vscode.onMessage((msg) => {
    if (msg.type === "agentManager.branches") {
      const ev = msg as AgentManagerBranchesMessage
      setBranches(ev.branches)
      setDefaultBranch(ev.defaultBranch)
      setBranchesLoading(false)
    }
    if (msg.type === "agentManager.importResult") {
      const ev = msg as AgentManagerImportResultMessage
      setPrPending(false)
      setImportPending(false)
      if (ev.success) {
        props.onClose()
      } else {
        showToast({ variant: "error", title: t("agentManager.import.failed"), description: ev.message })
      }
    }
  })

  onCleanup(() => importUnsub())

  const handlePRSubmit = () => {
    const url = prUrl().trim()
    if (!url || isPending()) return
    setPrPending(true)
    vscode.postMessage({ type: "agentManager.importFromPR", url })
  }

  const handleBranchSelect = (name: string) => {
    if (isPending()) return
    setImportPending(true)
    setBranchOpen(false)
    setBranchSearch("")
    vscode.postMessage({ type: "agentManager.importFromBranch", branch: name })
  }

  return (
    <Dialog title={t("agentManager.dialog.openWorktree")} fit>
      {/* Tab switcher */}
      <div class="am-tab-switcher">
        <button
          class="am-tab-switcher-pill"
          classList={{ "am-tab-switcher-pill-active": tab() === "new" }}
          onClick={() => setTab("new")}
          type="button"
        >
          {t("agentManager.dialog.tab.new")}
        </button>
        <button
          class="am-tab-switcher-pill"
          classList={{ "am-tab-switcher-pill-active": tab() === "import" }}
          onClick={() => setTab("import")}
          type="button"
        >
          {t("agentManager.dialog.tab.import")}
        </button>
      </div>

      {/* New tab */}
      <Show when={tab() === "new"}>
        <div class="am-nv-dialog" onKeyDown={handleKeyDown}>
          <input
            class="am-nv-name-input"
            placeholder={t("agentManager.dialog.namePlaceholder")}
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
          {/* Prompt input — reuses the sidebar chat-input base classes for consistent styling */}
          <div
            class="prompt-input-container am-prompt-input-container"
            classList={{ "prompt-input-container--dragging": imageAttach.dragging() }}
            onDragOver={imageAttach.handleDragOver}
            onDragLeave={imageAttach.handleDragLeave}
            onDrop={imageAttach.handleDrop}
          >
            <Show when={imageAttach.images().length > 0}>
              <div class="image-attachments">
                <For each={imageAttach.images()}>
                  {(img) => (
                    <div class="image-attachment">
                      <img src={img.dataUrl} alt={img.filename} title={img.filename} />
                      <button
                        type="button"
                        class="image-attachment-remove"
                        onClick={() => imageAttach.remove(img.id)}
                        aria-label={t("agentManager.dialog.removeImage")}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <div class="prompt-input-wrapper am-prompt-input-wrapper">
              <div class="prompt-input-ghost-wrapper am-prompt-input-ghost-wrapper">
                <textarea
                  ref={textareaRef}
                  class="prompt-input am-prompt-input"
                  placeholder={t(
                    isMac ? "agentManager.dialog.promptPlaceholder.mac" : "agentManager.dialog.promptPlaceholder.other",
                  )}
                  value={prompt()}
                  onInput={(e) => {
                    setPrompt(e.currentTarget.value)
                    adjustHeight()
                  }}
                  onPaste={(e) => imageAttach.handlePaste(e)}
                  rows={3}
                />
              </div>
            </div>
            <div class="prompt-input-hint">
              <div class="prompt-input-hint-selectors">
                <Show when={!compareMode()}>
                  <ModelSelectorBase
                    value={model()}
                    onSelect={(pid, mid) => setModel(pid && mid ? { providerID: pid, modelID: mid } : null)}
                    placement="top-start"
                    allowClear
                    clearLabel="Default"
                  />
                </Show>
                <Show when={session.agents().length > 1}>
                  <ModeSwitcherBase agents={session.agents()} value={agent()} onSelect={setAgent} />
                </Show>
              </div>
              <div class="prompt-input-hint-actions" />
            </div>
          </div>

          {/* Advanced options toggle */}
          <button class="am-advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced())} type="button">
            <Icon name={showAdvanced() ? "chevron-down" : "chevron-right"} size="small" />
            <span>{t("agentManager.dialog.advancedOptions")}</span>
          </button>

          <Show when={showAdvanced()}>
            <div class="am-advanced-section">
              <div class="am-advanced-field">
                <span class="am-nv-config-label">{t("agentManager.dialog.branchName")}</span>
                <input
                  class="am-advanced-input"
                  type="text"
                  placeholder={t("agentManager.dialog.branchNamePlaceholder")}
                  value={branchName()}
                  onInput={(e) => setBranchName(sanitizeBranchName(e.currentTarget.value))}
                />
              </div>
              <div class="am-advanced-field">
                <span class="am-nv-config-label">{t("agentManager.dialog.baseBranch")}</span>
                <div class="am-branch-selector-wrapper">
                  <button
                    class="am-branch-selector-trigger"
                    onClick={() => setBaseBranchOpen(!baseBranchOpen())}
                    type="button"
                  >
                    <Icon name="branch" size="small" />
                    <span class="am-branch-selector-value">{effectiveBaseBranch()}</span>
                    <Show when={!baseBranch()}>
                      <span class="am-branch-badge">{t("agentManager.dialog.branchBadge.default")}</span>
                    </Show>
                    <Icon name="selector" size="small" />
                  </button>
                  <Show when={baseBranchOpen()}>
                    <div class="am-branch-dropdown" onWheel={(e) => e.stopPropagation()}>
                      <div class="am-branch-search">
                        <Icon name="magnifying-glass" size="small" />
                        <input
                          class="am-branch-search-input"
                          type="text"
                          placeholder={t("agentManager.dialog.searchBranches")}
                          value={branchSearch()}
                          ref={(el) => requestAnimationFrame(() => el.focus())}
                          onInput={(e) => {
                            setBranchSearch(e.currentTarget.value)
                            setHighlightedIndex(0)
                          }}
                          onKeyDown={(e) => {
                            const items = filteredBranches()
                            if (e.key === "ArrowDown") {
                              e.preventDefault()
                              e.stopPropagation()
                              const next = Math.min(highlightedIndex() + 1, items.length - 1)
                              setHighlightedIndex(next)
                              requestAnimationFrame(() => {
                                document
                                  .querySelector(`.am-branch-item[data-index="${next}"]`)
                                  ?.scrollIntoView({ block: "nearest" })
                              })
                            } else if (e.key === "ArrowUp") {
                              e.preventDefault()
                              e.stopPropagation()
                              const prev = Math.max(highlightedIndex() - 1, 0)
                              setHighlightedIndex(prev)
                              requestAnimationFrame(() => {
                                document
                                  .querySelector(`.am-branch-item[data-index="${prev}"]`)
                                  ?.scrollIntoView({ block: "nearest" })
                              })
                            } else if (e.key === "Enter") {
                              e.preventDefault()
                              e.stopPropagation()
                              const selected = items[highlightedIndex()]
                              if (selected) {
                                setBaseBranch(selected.name)
                                setBaseBranchOpen(false)
                                setBranchSearch("")
                                setHighlightedIndex(0)
                              }
                            } else if (e.key === "Escape") {
                              e.preventDefault()
                              e.stopPropagation()
                              setBaseBranchOpen(false)
                              setBranchSearch("")
                              setHighlightedIndex(0)
                            }
                          }}
                        />
                      </div>
                      <div class="am-branch-list">
                        <For each={filteredBranches()}>
                          {(branch, index) => (
                            <button
                              class="am-branch-item"
                              classList={{
                                "am-branch-item-active": effectiveBaseBranch() === branch.name,
                                "am-branch-item-highlighted": highlightedIndex() === index(),
                              }}
                              data-index={index()}
                              onClick={() => {
                                setBaseBranch(branch.name)
                                setBaseBranchOpen(false)
                                setBranchSearch("")
                                setHighlightedIndex(0)
                              }}
                              onMouseEnter={() => setHighlightedIndex(index())}
                              type="button"
                            >
                              <Icon name="branch" size="small" />
                              <span class="am-branch-item-name">{branch.name}</span>
                              <Show when={branch.isDefault}>
                                <span class="am-branch-badge">{t("agentManager.dialog.branchBadge.default")}</span>
                              </Show>
                              <Show when={!branch.isLocal && branch.isRemote}>
                                <span class="am-branch-badge am-branch-badge-remote">
                                  {t("agentManager.dialog.branchBadge.remote")}
                                </span>
                              </Show>
                              <Show when={branch.lastCommitDate}>
                                <span class="am-branch-item-time">{formatRelativeDate(branch.lastCommitDate!)}</span>
                              </Show>
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          </Show>

          {/* Version / compare mode selector */}
          <Show
            when={compareMode()}
            fallback={
              <div class="am-nv-version-bar">
                <span class="am-nv-config-label">{t("agentManager.dialog.versions")}</span>
                <div class="am-nv-pills">
                  {VERSION_OPTIONS.map((count) => (
                    <button
                      class="am-nv-pill"
                      classList={{ "am-nv-pill-active": versions() === count }}
                      onClick={() => setVersions(count)}
                      type="button"
                    >
                      {count}
                    </button>
                  ))}
                  <button
                    class="am-nv-pill am-nv-pill-compare"
                    onClick={() => setCompareMode(true)}
                    type="button"
                    title={t("agentManager.dialog.compareModels")}
                  >
                    <Icon name="layers" size="small" />
                  </button>
                </div>
                <Show when={versions() > 1}>
                  <span class="am-nv-version-hint">{t("agentManager.dialog.versionHint", { count: versions() })}</span>
                </Show>
              </div>
            }
          >
            <div class="am-nv-compare-section">
              <div class="am-nv-version-bar">
                <span class="am-nv-config-label">
                  {t("agentManager.dialog.compareModels")}
                  <Show when={totalAllocations(modelAllocations()) > 0}>
                    <span class="am-nv-compare-count">
                      {totalAllocations(modelAllocations())}/{MAX_MULTI_VERSIONS}
                    </span>
                  </Show>
                </span>
                <button
                  class="am-nv-pill-back"
                  onClick={() => {
                    setCompareMode(false)
                    setModelAllocations(new Map())
                  }}
                  type="button"
                  title={t("agentManager.dialog.versions")}
                >
                  <Icon name="close-small" size="small" />
                </button>
              </div>
              <MultiModelSelector allocations={modelAllocations()} onChange={setModelAllocations} />
            </div>
          </Show>

          {/* Submit button */}
          <Button variant="primary" size="large" class="am-nv-submit" onClick={handleSubmit} disabled={!canSubmit()}>
            <Show
              when={!starting()}
              fallback={
                <>
                  <Spinner class="am-nv-spinner" />
                  <span>{t("agentManager.dialog.creating")}</span>
                </>
              }
            >
              {t("agentManager.dialog.createWorkspace")}
            </Show>
          </Button>
        </div>
      </Show>

      {/* Import tab */}
      <Show when={tab() === "import"}>
        <div class="am-import-tab">
          {/* Pull Request section */}
          <div class="am-import-section">
            <span class="am-nv-config-label">{t("agentManager.import.pullRequest")}</span>
            <div class="am-pr-row">
              <div class="am-pr-input-wrapper">
                <Icon name="branch" size="small" />
                <input
                  class="am-pr-input"
                  type="text"
                  placeholder={t("agentManager.import.pastePrUrl")}
                  value={prUrl()}
                  onInput={(e) => setPrUrl(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handlePRSubmit()
                    }
                  }}
                  disabled={isPending()}
                />
              </div>
              <Button
                variant="secondary"
                size="small"
                onClick={handlePRSubmit}
                disabled={!prUrl().trim() || isPending()}
              >
                <Show when={prPending()} fallback={t("agentManager.import.open")}>
                  <Spinner class="am-nv-spinner" />
                </Show>
              </Button>
            </div>
          </div>

          <div class="am-import-divider" />

          {/* Branches section */}
          <div class="am-import-section">
            <span class="am-nv-config-label">{t("agentManager.import.branches")}</span>
            <div class="am-selector-wrapper">
              <Popover
                open={branchOpen()}
                onOpenChange={setBranchOpen}
                placement="bottom-start"
                sameWidth
                class="am-dropdown"
                trigger={
                  <button class="am-selector-trigger" disabled={isPending()} type="button">
                    <span class="am-selector-left">
                      <Icon name="branch" size="small" />
                      <span class="am-selector-value">
                        {branchesLoading() ? t("agentManager.import.loading") : t("agentManager.import.selectBranch")}
                      </span>
                    </span>
                    <span class="am-selector-right">
                      <Icon name="selector" size="small" />
                    </span>
                  </button>
                }
              >
                <div class="am-dropdown-search">
                  <Icon name="magnifying-glass" size="small" />
                  <input
                    class="am-dropdown-search-input"
                    type="text"
                    placeholder={t("agentManager.dialog.searchBranches")}
                    value={branchSearch()}
                    onInput={(e) => setBranchSearch(e.currentTarget.value)}
                    autofocus
                  />
                </div>
                <div class="am-dropdown-list">
                  <Show
                    when={filteredBranches().length > 0}
                    fallback={
                      <div class="am-dropdown-empty">
                        {branchesLoading()
                          ? t("agentManager.import.loadingBranches")
                          : t("agentManager.import.noMatchingBranches")}
                      </div>
                    }
                  >
                    <For each={filteredBranches()}>
                      {(branch) => (
                        <div class="am-branch-item" onClick={() => handleBranchSelect(branch.name)}>
                          <span class="am-branch-item-left">
                            <Icon name="branch" size="small" />
                            <span class="am-branch-item-name">{branch.name}</span>
                            <Show when={branch.isDefault}>
                              <span class="am-branch-badge">{t("agentManager.dialog.branchBadge.default")}</span>
                            </Show>
                            <Show when={!branch.isLocal && branch.isRemote}>
                              <span class="am-branch-badge">{t("agentManager.dialog.branchBadge.remote")}</span>
                            </Show>
                          </span>
                          <Show when={branch.lastCommitDate}>
                            <span class="am-branch-item-time">{formatRelativeDate(branch.lastCommitDate!)}</span>
                          </Show>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </Popover>
            </div>
          </div>

          {/* Empty state when no branches are available */}
          <Show when={!branchesLoading() && branches().length === 0}>
            <div class="am-import-empty">
              {t("agentManager.import.noBranchesFound")}
              <br />
              {t("agentManager.import.noBranchesHint")}
            </div>
          </Show>
        </div>
      </Show>
    </Dialog>
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
                    <ProviderProvider>
                      <ConfigProvider>
                        <SessionProvider>
                          <WorktreeModeProvider>
                            <DataBridge>
                              <AgentManagerContent />
                            </DataBridge>
                          </WorktreeModeProvider>
                        </SessionProvider>
                      </ConfigProvider>
                    </ProviderProvider>
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
