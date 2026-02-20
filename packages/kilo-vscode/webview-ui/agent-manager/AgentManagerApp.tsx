// Agent Manager root component

import { Component, For, Show, createSignal, createMemo, createEffect, onMount, onCleanup } from "solid-js"
import type {
  ExtensionMessage,
  AgentManagerRepoInfoMessage,
  AgentManagerWorktreeSetupMessage,
  AgentManagerStateMessage,
  WorktreeState,
  ManagedSessionState,
  SessionInfo,
} from "../src/types/messages"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { DialogProvider, useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { Code } from "@kilocode/kilo-ui/code"
import { Diff } from "@kilocode/kilo-ui/diff"
import { Toast } from "@kilocode/kilo-ui/toast"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { VSCodeProvider, useVSCode } from "../src/context/vscode"
import { ServerProvider } from "../src/context/server"
import { ProviderProvider } from "../src/context/provider"
import { ConfigProvider } from "../src/context/config"
import { SessionProvider, useSession } from "../src/context/session"
import { WorktreeModeProvider } from "../src/context/worktree-mode"
import { ChatView } from "../src/components/chat"
import { LanguageBridge, DataBridge } from "../src/App"
import { formatRelativeDate } from "../src/utils/date"
import { validateLocalSession, nextSelectionAfterDelete, LOCAL } from "./navigate"
import "./agent-manager.css"

interface SetupState {
  active: boolean
  message: string
  branch?: string
  error?: boolean
}

/** Sidebar selection: LOCAL for workspace, worktree ID for a worktree, or null for an unassigned session. */
type SidebarSelection = typeof LOCAL | string | null

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
const modKey = isMac ? "\u2318" : "Ctrl+"

const AgentManagerContent: Component = () => {
  const session = useSession()
  const vscode = useVSCode()
  const dialog = useDialog()

  const [setup, setSetup] = createSignal<SetupState>({ active: false, message: "" })
  const [worktrees, setWorktrees] = createSignal<WorktreeState[]>([])
  const [managedSessions, setManagedSessions] = createSignal<ManagedSessionState[]>([])
  const [selection, setSelection] = createSignal<SidebarSelection>(LOCAL)
  const [repoBranch, setRepoBranch] = createSignal<string | undefined>()
  const [deletingWorktrees, setDeletingWorktrees] = createSignal<Set<string>>(new Set())

  // Recover persisted local session IDs from webview state
  const persisted = vscode.getState<{ localSessionIDs?: string[] }>()
  const [localSessionIDs, setLocalSessionIDs] = createSignal<string[]>(persisted?.localSessionIDs ?? [])

  // Pending local tab counter for generating unique IDs
  let pendingCounter = 0
  const PENDING_PREFIX = "pending:"
  const [activePendingId, setActivePendingId] = createSignal<string | undefined>()

  const isPending = (id: string) => id.startsWith(PENDING_PREFIX)

  const addPendingTab = () => {
    const id = `${PENDING_PREFIX}${++pendingCounter}`
    setLocalSessionIDs((prev) => [...prev, id])
    setActivePendingId(id)
    session.clearCurrentSession()
    return id
  }

  // Persist local session IDs to webview state for recovery (exclude pending tabs)
  createEffect(() => {
    vscode.setState({ localSessionIDs: localSessionIDs().filter((id) => !isPending(id)) })
  })

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
        result.push({ id, title: "New Session", createdAt: now, updatedAt: now })
      }
    }
    return result
  })

  // Sessions for the currently selected worktree (tab bar), sorted by creation date
  const activeWorktreeSessions = createMemo((): SessionInfo[] => {
    const sel = selection()
    if (!sel || sel === LOCAL) return []
    const managed = managedSessions().filter((ms) => ms.worktreeId === sel)
    const ids = new Set(managed.map((ms) => ms.id))
    return session
      .sessions()
      .filter((s) => ids.has(s.id))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
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

  // Display name for worktree
  const worktreeLabel = (wt: WorktreeState): string => {
    const managed = managedSessions().filter((ms) => ms.worktreeId === wt.id)
    const ids = new Set(managed.map((ms) => ms.id))
    const first = session.sessions().find((s) => ids.has(s.id))
    return first?.title || wt.branch
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
    setSelection(LOCAL)
    vscode.postMessage({ type: "agentManager.requestRepoInfo" })
    const locals = localSessions()
    const first = locals[0]
    if (first && !isPending(first.id)) {
      setActivePendingId(undefined)
      session.selectSession(first.id)
    } else if (first && isPending(first.id)) {
      setActivePendingId(first.id)
      session.clearCurrentSession()
    } else {
      setActivePendingId(undefined)
      session.clearCurrentSession()
    }
  }

  const selectWorktree = (worktreeId: string) => {
    setSelection(worktreeId)
    const managed = managedSessions().filter((ms) => ms.worktreeId === worktreeId)
    const ids = new Set(managed.map((ms) => ms.id))
    const first = session.sessions().find((s) => ids.has(s.id))
    if (first) {
      session.selectSession(first.id)
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
      } else if (msg.action === "newTab") handleNewTabForCurrentSelection()
      else if (msg.action === "closeTab") closeActiveTab()
      else if (msg.action === "newWorktree") handleNewWorktreeOrPromote()
      else if (msg.action === "closeWorktree") closeSelectedWorktree()
    }
    window.addEventListener("message", handler)

    // Prevent Cmd+Arrow/T/W/N from triggering native browser actions
    const preventDefaults = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault()
      }
      // Prevent browser defaults for our shortcuts (new tab, close tab, new window)
      if (["t", "w", "n"].includes(e.key.toLowerCase()) && !e.shiftKey) {
        e.preventDefault()
      }
      // Prevent defaults for shift variants (close worktree)
      if (e.key.toLowerCase() === "w" && e.shiftKey) {
        e.preventDefault()
      }
    }
    window.addEventListener("keydown", preventDefaults)

    // When the panel regains focus (e.g. returning from terminal), focus the prompt
    const onWindowFocus = () => window.dispatchEvent(new Event("focusPrompt"))
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

    const unsub = vscode.onMessage((msg) => {
      if (msg.type === "agentManager.repoInfo") {
        const info = msg as AgentManagerRepoInfoMessage
        setRepoBranch(info.branch)
      }

      if (msg.type === "agentManager.worktreeSetup") {
        const ev = msg as AgentManagerWorktreeSetupMessage
        if (ev.status === "ready" || ev.status === "error") {
          const error = ev.status === "error"
          setSetup({ active: true, message: ev.message, branch: ev.branch, error })
          globalThis.setTimeout(() => setSetup({ active: false, message: "" }), error ? 3000 : 500)
          if (!error && ev.sessionId) {
            session.selectSession(ev.sessionId)
            // Auto-switch sidebar to the worktree containing this session
            const ms = managedSessions().find((s) => s.id === ev.sessionId)
            if (ms?.worktreeId) setSelection(ms.worktreeId)
          }
        } else {
          setSetup({ active: true, message: ev.message, branch: ev.branch })
        }
      }

      if (msg.type === "agentManager.sessionAdded") {
        const ev = msg as { type: string; sessionId: string; worktreeId: string }
        session.selectSession(ev.sessionId)
      }

      if (msg.type === "agentManager.state") {
        const state = msg as AgentManagerStateMessage
        setWorktrees(state.worktrees)
        setManagedSessions(state.sessions)
        const current = session.currentSessionID()
        if (current) {
          const ms = state.sessions.find((s) => s.id === current)
          if (ms?.worktreeId) setSelection(ms.worktreeId)
        }
        // Clear deleting state for worktrees that have been removed
        const ids = new Set(state.worktrees.map((wt) => wt.id))
        setDeletingWorktrees((prev) => {
          const next = new Set([...prev].filter((id) => ids.has(id)))
          return next.size === prev.size ? prev : next
        })
      }
    })

    onCleanup(() => {
      window.removeEventListener("message", handler)
      window.removeEventListener("keydown", preventDefaults)
      window.removeEventListener("focus", onWindowFocus)
      unsubCreate()
      unsub()
    })
  })

  // Always select local on mount to initialize branch info and session state
  onMount(() => {
    selectLocal()
    // Open a pending "New Session" tab if there are no persisted local sessions
    if (localSessionIDs().length === 0) {
      addPendingTab()
    }
  })

  const handleCreateWorktree = () => {
    vscode.postMessage({ type: "agentManager.createWorktree" })
  }

  const confirmDeleteWorktree = (worktreeId: string) => {
    const wt = worktrees().find((w) => w.id === worktreeId)
    if (!wt) return
    const doDelete = () => {
      setDeletingWorktrees((prev) => new Set([...prev, wt.id]))
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
    dialog.show(() => (
      <Dialog title="Delete Worktree" fit>
        <div class="am-confirm">
          <div class="am-confirm-message">
            <Icon name="trash" size="small" />
            <span>
              Delete worktree <code class="am-confirm-branch">{wt.branch}</code>? This removes the worktree from disk
              and dissociates all sessions.
            </span>
          </div>
          <div class="am-confirm-actions">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              Cancel
            </Button>
            <Button variant="primary" size="large" class="am-confirm-delete" onClick={doDelete} autofocus>
              Delete
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
      <div class="am-sidebar">
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
            <span class="am-local-label">local</span>
            <Show when={repoBranch()}>
              <span class="am-local-branch">{repoBranch()}</span>
            </Show>
          </div>
        </button>

        {/* WORKTREES section */}
        <div class="am-section">
          <div class="am-section-header">
            <span class="am-section-label">WORKTREES</span>
            <IconButton icon="plus" size="small" variant="ghost" label="New Worktree" onClick={handleCreateWorktree} />
          </div>
          <div class="am-worktree-list">
            <For each={worktrees()}>
              {(wt) => (
                <div
                  class={`am-worktree-item ${selection() === wt.id ? "am-worktree-item-active" : ""}`}
                  data-sidebar-id={wt.id}
                  onClick={() => selectWorktree(wt.id)}
                >
                  <Icon name="branch" size="small" />
                  <span class="am-worktree-branch" title={wt.branch}>
                    {worktreeLabel(wt)}
                  </span>
                  <Show when={!deletingWorktrees().has(wt.id)} fallback={<Spinner class="am-worktree-spinner" />}>
                    <IconButton
                      icon="close-small"
                      size="small"
                      variant="ghost"
                      label="Close worktree"
                      class="am-worktree-close"
                      onClick={(e: MouseEvent) => handleDeleteWorktree(wt.id, e)}
                    />
                  </Show>
                </div>
              )}
            </For>
            <Show when={worktrees().length === 0}>
              <button class="am-worktree-create" onClick={handleCreateWorktree}>
                <Icon name="plus" size="small" />
                <span>New Worktree</span>
              </button>
            </Show>
          </div>
        </div>

        {/* SESSIONS section (unassigned) */}
        <div class="am-section am-section-grow">
          <div class="am-section-header">
            <span class="am-section-label">SESSIONS</span>
          </div>
          <div class="am-list">
            <For each={unassignedSessions()}>
              {(s) => (
                <button
                  class={`am-item ${s.id === session.currentSessionID() && selection() === null ? "am-item-active" : ""}`}
                  data-sidebar-id={s.id}
                  onClick={() => {
                    setSelection(null)
                    session.selectSession(s.id)
                  }}
                >
                  <span class="am-item-title">{s.title || "Untitled"}</span>
                  <span class="am-item-time">{formatRelativeDate(s.updatedAt)}</span>
                  <IconButton
                    icon="branch"
                    size="small"
                    variant="ghost"
                    label="Open in worktree"
                    class="am-item-promote"
                    onClick={(e: MouseEvent) => handlePromote(s.id, e)}
                  />
                </button>
              )}
            </For>
          </div>
        </div>
      </div>

      <div class="am-detail">
        {/* Tab bar — visible when a section is selected and has tabs or a pending new session */}
        <Show when={selection() !== null && !contextEmpty()}>
          <div class="am-tab-bar">
            <div class="am-tab-list">
              <For each={activeTabs()}>
                {(s) => {
                  const pending = isPending(s.id)
                  const active = () =>
                    pending
                      ? s.id === activePendingId() && !session.currentSessionID()
                      : s.id === session.currentSessionID()
                  return (
                    <Tooltip value={s.title || "Untitled"} placement="bottom">
                      <div
                        class={`am-tab ${active() ? "am-tab-active" : ""}`}
                        onClick={() => {
                          if (pending) {
                            setActivePendingId(s.id)
                            session.clearCurrentSession()
                          } else {
                            setActivePendingId(undefined)
                            session.selectSession(s.id)
                          }
                        }}
                        onMouseDown={(e: MouseEvent) => handleTabMouseDown(s.id, e)}
                      >
                        <span class="am-tab-label">{s.title || "Untitled"}</span>
                        <IconButton
                          icon="close-small"
                          size="small"
                          variant="ghost"
                          label="Close tab"
                          class="am-tab-close"
                          onClick={(e: MouseEvent) => handleCloseTab(s.id, e)}
                        />
                      </div>
                    </Tooltip>
                  )
                }}
              </For>
            </div>
            <IconButton
              icon="plus"
              size="small"
              variant="ghost"
              label={`New session (${modKey}T)`}
              class="am-tab-add"
              onClick={handleAddSession}
            />
            <div class="am-tab-terminal">
              <Tooltip value="Open Terminal" placement="bottom">
                <IconButton
                  icon="console"
                  size="small"
                  variant="ghost"
                  label="Open Terminal"
                  onClick={() => {
                    const id = session.currentSessionID()
                    if (id) vscode.postMessage({ type: "agentManager.showTerminal", sessionId: id })
                  }}
                />
              </Tooltip>
            </div>
          </div>
        </Show>

        {/* Empty worktree state */}
        <Show when={contextEmpty()}>
          <div class="am-empty-state">
            <div class="am-empty-state-icon">
              <Icon name="branch" size="large" />
            </div>
            <div class="am-empty-state-text">No sessions open</div>
            <Button variant="primary" size="small" onClick={handleAddSession}>
              New session
              <span class="am-shortcut-hint">{modKey}T</span>
            </Button>
          </div>
        </Show>

        <Show when={setup().active}>
          <div class="am-setup-overlay">
            <div class="am-setup-card">
              <Icon name="branch" size="large" />
              <div class="am-setup-title">Setting up workspace</div>
              <Show when={setup().branch}>
                <div class="am-setup-branch">{setup().branch}</div>
              </Show>
              <div class="am-setup-status">
                <Show when={!setup().error} fallback={<Icon name="circle-x" size="small" />}>
                  <Spinner class="am-setup-spinner" />
                </Show>
                <span>{setup().message}</span>
              </div>
            </div>
          </div>
        </Show>
        <Show when={!contextEmpty()}>
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
                <span class="am-readonly-text">Read-only session</span>
                <Button
                  variant="primary"
                  size="small"
                  onClick={() => {
                    const sid = session.currentSessionID()
                    if (sid) vscode.postMessage({ type: "agentManager.promoteSession", sessionId: sid })
                  }}
                >
                  Open in worktree
                </Button>
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
