/**
 * ChatView component
 * Main chat container that combines all chat components
 */

import { Component, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { showToast } from "@kilocode/kilo-ui/toast"
import { TaskHeader } from "./TaskHeader"
import { MessageList } from "./MessageList"
import { PromptInput } from "./PromptInput"
import { PermissionDock } from "./PermissionDock"
import { StartupErrorBanner } from "./StartupErrorBanner"
import { useSession } from "../../context/session"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { useWorktreeMode } from "../../context/worktree-mode"
import { useServer } from "../../context/server"

interface ChatViewProps {
  onSelectSession?: (id: string) => void
  onShowHistory?: () => void
  readonly?: boolean
  /** When true, show the "Continue in Worktree" button. Defaults to true in the sidebar. */
  continueInWorktree?: boolean
  promptBoxId?: string
  pendingSessionID?: string
}

export const ChatView: Component<ChatViewProps> = (props) => {
  const session = useSession()
  const vscode = useVSCode()
  const language = useLanguage()
  const worktreeMode = useWorktreeMode()
  const server = useServer()
  // Show "Show Changes" only in the standalone sidebar, not inside Agent Manager
  const isSidebar = () => worktreeMode === undefined
  // Show "Continue in Worktree": only when explicitly enabled via prop
  const canContinueInWorktree = () => props.continueInWorktree === true

  const id = () => session.currentSessionID()
  const hasMessages = () => session.messages().length > 0
  const idle = () => session.status() !== "busy"

  // "Continue in Worktree" state
  const [transferring, setTransferring] = createSignal(false)
  const [transferDetail, setTransferDetail] = createSignal("")

  // Permissions and questions scoped to this session's family (self + subagents).
  // Each ChatView only sees its own session tree — no cross-session leakage.
  // Memoized so the BFS walk in sessionFamily() runs once per reactive update,
  // not once per accessor call (questionRequest, permissionRequest, blocked all read these).
  const familyPermissions = createMemo(() => session.scopedPermissions(id()))
  const familyQuestions = createMemo(() => session.scopedQuestions(id()))

  // Non-tool questions (standalone, not from the question tool) render inline in
  // the message list since they don't have an associated tool part in the conversation.
  // Tool-linked questions render inline at their tool part position via AssistantMessage.
  const standaloneQuestions = createMemo(() => familyQuestions().filter((q) => !q.tool))
  const permissionRequest = () => familyPermissions().find((p) => p.sessionID === id()) ?? familyPermissions()[0]
  const blocked = () => familyPermissions().length > 0 || familyQuestions().length > 0
  const dock = () => !props.readonly || !!permissionRequest()

  // When a bottom-dock permission disappears while the session is busy,
  // the scroll container grows taller. Dispatch a custom event so MessageList can
  // resume auto-scroll.
  createEffect(
    on(blocked, (isBlocked, wasBlocked) => {
      if (wasBlocked && !isBlocked && !idle()) {
        window.dispatchEvent(new CustomEvent("resumeAutoScroll"))
      }
    }),
  )

  onMount(() => {
    if (props.readonly) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || session.status() === "idle" || e.defaultPrevented) return
      e.preventDefault()
      session.abort()
    }
    document.addEventListener("keydown", handler)
    onCleanup(() => document.removeEventListener("keydown", handler))
  })

  // Listen for "Continue in Worktree" progress messages
  {
    const labels: Record<string, string> = {
      capturing: "Capturing changes...",
      creating: "Creating worktree...",
      setup: "Running setup...",
      transferring: "Transferring changes...",
      forking: "Starting session...",
    }
    const cleanup = vscode.onMessage((msg) => {
      if (msg.type !== "continueInWorktreeProgress") return
      const m = msg as { status: string; error?: string }
      if (m.status === "done") {
        setTransferring(false)
        setTransferDetail("")
        return
      }
      if (m.status === "error") {
        setTransferring(false)
        setTransferDetail("")
        showToast({ title: m.error ?? "Failed to continue in worktree" })
        return
      }
      setTransferDetail(labels[m.status] ?? "Working...")
    })
    onCleanup(cleanup)
  }

  const decide = (response: "once" | "always" | "reject", approvedAlways: string[], deniedAlways: string[]) => {
    const perm = permissionRequest()
    if (!perm || session.respondingPermissions().has(perm.id)) return
    session.respondToPermission(perm.id, response, approvedAlways, deniedAlways)
  }

  return (
    <div class="chat-view">
      <TaskHeader readonly={props.readonly} />
      <div class="chat-messages-wrapper">
        <div class="chat-messages">
          <MessageList
            onSelectSession={props.onSelectSession}
            onShowHistory={props.onShowHistory}
            questions={standaloneQuestions}
            readonly={props.readonly}
          />
        </div>
      </div>

      <Show when={dock()}>
        <div class="chat-input">
          <Show when={server.connectionState() === "error" && server.errorMessage()}>
            <StartupErrorBanner errorMessage={server.errorMessage()!} errorDetails={server.errorDetails()!} />
          </Show>
          <Show when={permissionRequest()} keyed>
            {(perm) => (
              <PermissionDock
                request={perm}
                responding={session.respondingPermissions().has(perm.id)}
                onDecide={decide}
              />
            )}
          </Show>
          <Show when={!props.readonly && hasMessages() && idle() && !blocked()}>
            <div class="new-task-button-wrapper">
              <div class="session-actions-row">
                <Tooltip value="Start a new conversation" placement="top">
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => window.dispatchEvent(new CustomEvent("newTaskRequest"))}
                    aria-label={language.t("command.session.new.task")}
                  >
                    {language.t("command.session.new.task")}
                  </Button>
                </Tooltip>
                <Show when={canContinueInWorktree() && server.gitInstalled()}>
                  <Tooltip value="Continue in isolated worktree" placement="top">
                    <Button
                      variant="ghost"
                      size="small"
                      disabled={transferring()}
                      onClick={() => {
                        const sid = id()
                        if (!sid) return
                        setTransferring(true)
                        setTransferDetail("Capturing changes...")
                        vscode.postMessage({ type: "continueInWorktree", sessionId: sid })
                      }}
                      aria-label="Continue in Worktree"
                    >
                      <Show when={transferring()} fallback={<Icon name="branch" size="small" />}>
                        <Spinner class="chat-spinner-small" />
                      </Show>
                      {transferring() ? transferDetail() : "Worktree"}
                    </Button>
                  </Tooltip>
                </Show>
                <Show when={isSidebar() && server.gitInstalled()}>
                  <Tooltip
                    value={
                      session.worktreeStats()?.files
                        ? `${session.worktreeStats()!.files} file${session.worktreeStats()!.files > 1 ? "s" : ""} changed · +${session.worktreeStats()!.additions} -${session.worktreeStats()!.deletions}`
                        : "No file changes"
                    }
                    placement="top"
                    class="session-diff-wrapper"
                  >
                    <button
                      class="session-diff-badge"
                      classList={{
                        "session-diff-badge--empty": !session.worktreeStats()?.files,
                        "session-diff-badge--has-changes": !!session.worktreeStats()?.files,
                      }}
                      onClick={() => vscode.postMessage({ type: "openChanges" })}
                      aria-label={language.t("command.session.show.changes")}
                    >
                      <Icon name="layers" size="small" />
                      <Show when={session.worktreeStats()?.files}>
                        <span class="session-diff-add">+{session.worktreeStats()!.additions}</span>
                        <span class="session-diff-del">-{session.worktreeStats()!.deletions}</span>
                      </Show>
                    </button>
                  </Tooltip>
                </Show>
              </div>
            </div>
          </Show>
          <Show when={!props.readonly}>
            <PromptInput blocked={blocked} boxId={props.promptBoxId} pendingSessionID={props.pendingSessionID} />
          </Show>
        </div>
      </Show>
    </div>
  )
}
