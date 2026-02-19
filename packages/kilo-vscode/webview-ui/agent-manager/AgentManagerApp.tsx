// Agent Manager root component

import { Component, For, Show, createSignal, createMemo, onMount, onCleanup } from "solid-js"
import type {
  ExtensionMessage,
  AgentManagerWorktreeSetupMessage,
  AgentManagerStateMessage,
  WorktreeState,
  ManagedSessionState,
  SessionInfo,
} from "../src/types/messages"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
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
import "./agent-manager.css"

interface SetupState {
  active: boolean
  message: string
  branch?: string
  error?: boolean
}

const AgentManagerContent: Component = () => {
  const session = useSession()
  const vscode = useVSCode()

  const [setup, setSetup] = createSignal<SetupState>({ active: false, message: "" })
  const [worktrees, setWorktrees] = createSignal<WorktreeState[]>([])
  const [managedSessions, setManagedSessions] = createSignal<ManagedSessionState[]>([])
  const [selectedWorktree, setSelectedWorktree] = createSignal<string | null>(null)

  const worktreeSessionIds = createMemo(
    () =>
      new Set(
        managedSessions()
          .filter((ms) => ms.worktreeId)
          .map((ms) => ms.id),
      ),
  )

  // Sessions NOT in any worktree
  const unassignedSessions = createMemo(() =>
    [...session.sessions()]
      .filter((s) => !worktreeSessionIds().has(s.id))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  )

  // Sessions for the currently selected worktree (tab bar), sorted by creation date (stable order)
  const activeWorktreeSessions = createMemo((): SessionInfo[] => {
    const selected = selectedWorktree()
    if (!selected) return []
    const managed = managedSessions().filter((ms) => ms.worktreeId === selected)
    const ids = new Set(managed.map((ms) => ms.id))
    return session
      .sessions()
      .filter((s) => ids.has(s.id))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  })

  // Whether the selected worktree has zero sessions (show empty state)
  const worktreeEmpty = createMemo(() => selectedWorktree() !== null && activeWorktreeSessions().length === 0)

  // Read-only mode: viewing an unassigned session (not in a worktree)
  const readOnly = createMemo(() => !selectedWorktree() && !!session.currentSessionID())

  // Display name for worktree: use first session's title or branch name
  const worktreeLabel = (wt: WorktreeState): string => {
    const managed = managedSessions().filter((ms) => ms.worktreeId === wt.id)
    const ids = new Set(managed.map((ms) => ms.id))
    const first = session.sessions().find((s) => ids.has(s.id))
    return first?.title || wt.branch
  }

  // Scroll selected sidebar item into view
  const scrollIntoView = (el: HTMLElement) => {
    el.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }

  // Navigate sidebar items with arrow keys
  const navigate = (direction: "up" | "down") => {
    const flat = [
      ...worktrees().map((wt) => ({ type: "wt" as const, id: wt.id })),
      ...unassignedSessions().map((s) => ({ type: "session" as const, id: s.id })),
    ]
    if (flat.length === 0) return

    const current = selectedWorktree() ?? session.currentSessionID()
    const idx = current ? flat.findIndex((f) => f.id === current) : -1
    const next = direction === "up" ? idx - 1 : idx + 1
    if (next < 0 || next >= flat.length) return

    const item = flat[next]!
    if (item.type === "wt") {
      selectWorktree(item.id)
    } else {
      setSelectedWorktree(null)
      session.selectSession(item.id)
    }

    // Scroll the item into view
    const el = document.querySelector(`[data-sidebar-id="${item.id}"]`)
    if (el instanceof HTMLElement) scrollIntoView(el)
  }

  // Navigate tabs with Cmd+Left/Right
  const navigateTab = (direction: "left" | "right") => {
    const tabs = activeWorktreeSessions()
    if (tabs.length === 0) return
    const current = session.currentSessionID()
    const idx = current ? tabs.findIndex((s) => s.id === current) : -1
    const next = direction === "left" ? idx - 1 : idx + 1
    if (next < 0 || next >= tabs.length) return
    session.selectSession(tabs[next]!.id)
  }

  const selectWorktree = (worktreeId: string) => {
    setSelectedWorktree(worktreeId)
    // Select the first session in this worktree, or clear if empty
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
    }
    window.addEventListener("message", handler)

    // Prevent Cmd+Up/Down/Left/Right from triggering native scroll
    const preventScroll = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault()
      }
    }
    window.addEventListener("keydown", preventScroll)

    // When the panel regains focus (e.g. returning from terminal), focus the prompt
    const onWindowFocus = () => window.dispatchEvent(new Event("focusPrompt"))
    window.addEventListener("focus", onWindowFocus)

    const unsub = vscode.onMessage((msg) => {
      if (msg.type === "agentManager.worktreeSetup") {
        const ev = msg as AgentManagerWorktreeSetupMessage
        if (ev.status === "ready" || ev.status === "error") {
          const error = ev.status === "error"
          setSetup({ active: true, message: ev.message, branch: ev.branch, error })
          globalThis.setTimeout(() => setSetup({ active: false, message: "" }), error ? 3000 : 500)
          // Auto-focus the new session in its worktree
          if (!error && ev.sessionId) {
            session.selectSession(ev.sessionId)
          }
        } else {
          setSetup({ active: true, message: ev.message, branch: ev.branch })
        }
      }

      if (msg.type === "agentManager.state") {
        const state = msg as AgentManagerStateMessage
        setWorktrees(state.worktrees)
        setManagedSessions(state.sessions)
        // Auto-select worktree if current session belongs to one
        const current = session.currentSessionID()
        if (current) {
          const ms = state.sessions.find((s) => s.id === current)
          if (ms?.worktreeId) setSelectedWorktree(ms.worktreeId)
        }
      }
    })

    onCleanup(() => {
      window.removeEventListener("message", handler)
      window.removeEventListener("keydown", preventScroll)
      window.removeEventListener("focus", onWindowFocus)
      unsub()
    })
  })

  const handleCreateWorktree = () => {
    vscode.postMessage({ type: "agentManager.createWorktree" })
  }

  const handleDeleteWorktree = (worktreeId: string, e: MouseEvent) => {
    e.stopPropagation()
    vscode.postMessage({ type: "agentManager.deleteWorktree", worktreeId })
    if (selectedWorktree() === worktreeId) setSelectedWorktree(null)
  }

  const handlePromote = (sessionId: string, e: MouseEvent) => {
    e.stopPropagation()
    vscode.postMessage({ type: "agentManager.promoteSession", sessionId })
  }

  const handleAddSession = () => {
    const id = selectedWorktree()
    if (id) vscode.postMessage({ type: "agentManager.addSessionToWorktree", worktreeId: id })
  }

  const handleCloseTab = (sessionId: string, e: MouseEvent) => {
    e.stopPropagation()
    // Switch to adjacent tab before closing
    if (session.currentSessionID() === sessionId) {
      const tabs = activeWorktreeSessions()
      const idx = tabs.findIndex((s) => s.id === sessionId)
      const next = tabs[idx + 1] ?? tabs[idx - 1]
      if (next) session.selectSession(next.id)
      else session.setCurrentSessionID(undefined)
    }
    vscode.postMessage({ type: "agentManager.closeSession", sessionId })
  }

  const handleTabMouseDown = (sessionId: string, e: MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault()
      handleCloseTab(sessionId, e)
    }
  }

  const isWorktreeActive = (worktreeId: string) => selectedWorktree() === worktreeId

  return (
    <div class="am-layout">
      <div class="am-sidebar">
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
                  class={`am-worktree-item ${isWorktreeActive(wt.id) ? "am-worktree-item-active" : ""}`}
                  data-sidebar-id={wt.id}
                  onClick={() => selectWorktree(wt.id)}
                >
                  <Icon name="branch" size="small" />
                  <span class="am-worktree-branch" title={wt.branch}>
                    {worktreeLabel(wt)}
                  </span>
                  <IconButton
                    icon="close-small"
                    size="small"
                    variant="ghost"
                    label="Close worktree"
                    class="am-worktree-close"
                    onClick={(e: MouseEvent) => handleDeleteWorktree(wt.id, e)}
                  />
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

        {/* SESSIONS section */}
        <div class="am-section am-section-grow">
          <div class="am-section-header">
            <span class="am-section-label">SESSIONS</span>
          </div>
          <div class="am-list">
            <For each={unassignedSessions()}>
              {(s) => (
                <button
                  class={`am-item ${s.id === session.currentSessionID() && !selectedWorktree() ? "am-item-active" : ""}`}
                  data-sidebar-id={s.id}
                  onClick={() => {
                    setSelectedWorktree(null)
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
        {/* Tab bar for worktree sessions */}
        <Show when={selectedWorktree()}>
          <div class="am-tab-bar">
            <div class="am-tab-list">
              <For each={activeWorktreeSessions()}>
                {(s) => (
                  <Tooltip value={s.title || "Untitled"} placement="bottom">
                    <div
                      class={`am-tab ${s.id === session.currentSessionID() ? "am-tab-active" : ""}`}
                      onClick={() => session.selectSession(s.id)}
                      onMouseDown={(e: MouseEvent) => handleTabMouseDown(s.id, e)}
                    >
                      <span class="am-tab-label">{s.title || "Untitled"}</span>
                      <button
                        class="am-tab-close"
                        onClick={(e: MouseEvent) => handleCloseTab(s.id, e)}
                        aria-label="Close tab"
                      >
                        ×
                      </button>
                    </div>
                  </Tooltip>
                )}
              </For>
            </div>
            <IconButton
              icon="plus"
              size="small"
              variant="ghost"
              label="New session"
              class="am-tab-add"
              onClick={handleAddSession}
            />
          </div>
        </Show>

        {/* Empty worktree state */}
        <Show when={worktreeEmpty()}>
          <div class="am-empty-state">
            <div class="am-empty-state-icon">
              <Icon name="branch" size="large" />
            </div>
            <div class="am-empty-state-text">No sessions open</div>
            <Button variant="primary" size="small" onClick={handleAddSession}>
              New session
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
        <Show when={!worktreeEmpty()}>
          <div class="am-chat-wrapper">
            <ChatView onSelectSession={(id) => session.selectSession(id)} readonly={readOnly()} />
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
