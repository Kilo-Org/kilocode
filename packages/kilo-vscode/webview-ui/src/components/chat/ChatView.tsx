/** @jsxImportSource solid-js */

/**
 * ChatView component
 * Main chat container that combines all chat components
 */

import { type Component, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { showToast } from "@kilocode/kilo-ui/toast"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
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
import { isPromptBlocked, isSuggesting, isQuestioning } from "./prompt-input-utils"

interface ChatViewProps {
  onSelectSession?: (id: string) => void
  onShowHistory?: () => void
  onForkMessage?: (sessionId: string, messageId: string) => void
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
  const [repoBranch, setRepoBranch] = createSignal<string>()
  let worktreeRef: HTMLDivElement | undefined

  // Permissions and questions scoped to this session's family (self + subagents).
  // Each ChatView only sees its own session tree — no cross-session leakage.
  // Memoized so the BFS walk in sessionFamily() runs once per reactive update,
  // not once per accessor call (questionRequest, permissionRequest, blocked all read these).
  const familyPermissions = createMemo(() => session.scopedPermissions(id()))
  const familyQuestions = createMemo(() => session.scopedQuestions(id()))
  const familySuggestions = createMemo(() => session.scopedSuggestions(id()))
  // Non-tool questions (standalone, not from the question tool) render inline in
  // the message list since they don't have an associated tool part in the conversation.
  // Tool-linked questions render inline at their tool part position via AssistantMessage.
  const standaloneQuestions = createMemo(() => familyQuestions().filter((q) => !q.tool))
  const standaloneSuggestions = createMemo(() => familySuggestions().filter((s) => !s.tool))
  const permissionRequest = () => familyPermissions().find((p) => p.sessionID === id()) ?? familyPermissions()[0]
  // Prompt input is decoupled from questions/suggestions — only permissions block.
  // Pending questions and suggestions are auto-dismissed in sendMessage/sendCommand.
  const blocked = () => isPromptBlocked(familyPermissions().length)
  // Session is busy only because a suggestion tool call is pending — prompt should behave as idle
  const suggesting = () => isSuggesting(blocked(), familySuggestions().length)
  // Session is busy only because a question tool call is pending — prompt should behave as idle
  const questioning = () => isQuestioning(blocked(), familyQuestions().length)
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
      capturing: language.t("sidebar.session.progress.capturing"),
      creating: language.t("sidebar.session.progress.creating"),
      setup: language.t("sidebar.session.progress.setup"),
      transferring: language.t("sidebar.session.progress.transferring"),
      forking: language.t("sidebar.session.progress.forking"),
    }
    const cleanup = vscode.onMessage((msg) => {
      if (msg.type === "agentManager.repoInfo") {
        setRepoBranch(msg.branch)
        return
      }
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
        showToast({ title: m.error ?? language.t("sidebar.session.progress.failed") })
        return
      }
      setTransferDetail(labels[m.status] ?? language.t("session.status.working"))
    })
    onCleanup(cleanup)
  }

  const decide = (response: "once" | "always" | "reject", approvedAlways: string[], deniedAlways: string[]) => {
    const perm = permissionRequest()
    if (!perm || session.respondingPermissions().has(perm.id)) return
    session.respondToPermission(perm.id, response, approvedAlways, deniedAlways)
  }

  const startSession = () => window.dispatchEvent(new CustomEvent("newTaskRequest"))

  const startWorktree = () => vscode.postMessage({ type: "agentManager.createWorktree" })

  const startWorktreeFromBranch = () =>
    vscode.postMessage({ type: "agentManager.createWorktree", baseBranch: repoBranch()! })

  const openAgentManager = () => vscode.postMessage({ type: "openAgentManager" })

  const openChanges = () => vscode.postMessage({ type: "openChanges" })

  const moveToWorktree = () => {
    if (transferring()) return
    const sid = id()
    if (!sid) return
    setTransferring(true)
    setTransferDetail(language.t("sidebar.session.progress.capturing"))
    vscode.postMessage({ type: "continueInWorktree", sessionId: sid })
  }

  const worktreeTooltip = language.t("sidebar.session.newWorktree.tooltip")

  const advancedTooltip = language.t("sidebar.session.configureWorktree.tooltip")

  const moveTooltip = () => {
    const stats = session.worktreeStats()
    if (!stats?.files) return language.t("sidebar.session.moveToWorktree.tooltip.empty")
    if (stats.files === 1) return language.t("sidebar.session.moveToWorktree.tooltip.one")
    return language.t("sidebar.session.moveToWorktree.tooltip.other", { files: stats.files })
  }

  const changesTooltip = () => {
    const stats = session.worktreeStats()
    if (!stats?.files) return language.t("sidebar.session.showChanges.tooltip.empty")
    return (
      <span class="session-changes-tooltip">
        <span>{stats.files === 1 ? "1 file changed" : `${stats.files} files changed`}</span>
        <span class="session-changes-tooltip-separator">·</span>
        <span class="session-diff-add">+{stats.additions}</span>
        <span class="session-diff-del">-{stats.deletions}</span>
        <span>Open the changes view.</span>
      </span>
    )
  }

  const showAdvancedWorktree = () => vscode.postMessage({ type: "openAdvancedWorktree" })

  createEffect(() => {
    if (!isSidebar() || !server.gitInstalled()) return
    vscode.postMessage({ type: "agentManager.requestRepoInfo" })
  })

  const renderActions = (hasChat: boolean) => (
    <div class="new-task-button-wrapper" classList={{ "new-task-button-wrapper--empty": !hasChat }}>
      <div class="session-actions-row">
        <Tooltip
          value={
            hasChat
              ? language.t("sidebar.session.newSession.tooltip")
              : language.t("sidebar.session.newSession.disabled")
          }
          placement="top"
        >
          <Button
            variant="secondary"
            size="small"
            class="session-new-button"
            onClick={startSession}
            disabled={!hasChat}
            aria-label={language.t("sidebar.session.newSession")}
          >
            {language.t("sidebar.session.newSession")}
          </Button>
        </Tooltip>
        <Show when={isSidebar() && server.gitInstalled()}>
          <div class="session-worktree-split" ref={worktreeRef}>
            <Tooltip value={worktreeTooltip} placement="top">
              <Button
                variant="secondary"
                size="small"
                class="session-worktree-main"
                onClick={startWorktree}
                aria-label={language.t("sidebar.session.newWorktree")}
              >
                {language.t("sidebar.session.newWorktree")}
              </Button>
            </Tooltip>
            <DropdownMenu gutter={4} placement="top-start" getAnchorRect={() => worktreeRef?.getBoundingClientRect()}>
              <Tooltip value={advancedTooltip} placement="top">
                <DropdownMenu.Trigger
                  class="session-worktree-split-arrow"
                  aria-label={language.t("agentManager.worktree.advancedOptions")}
                >
                  <Icon name="chevron-down" size="small" />
                </DropdownMenu.Trigger>
              </Tooltip>
              <DropdownMenu.Portal>
                <DropdownMenu.Content class="session-worktree-split-menu">
                  <DropdownMenu.Item disabled={!repoBranch()} onSelect={startWorktreeFromBranch}>
                    <span class="session-worktree-menu-gap" aria-hidden="true" />
                    <DropdownMenu.ItemLabel class="session-worktree-menu-label">
                      <span>{language.t("sidebar.session.newWorktree.from")}</span>
                      <span class="session-worktree-menu-branch">
                        <Icon name="branch" size="small" />
                        <strong>{repoBranch() ?? language.t("sidebar.session.currentBranch")}</strong>
                      </span>
                    </DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={showAdvancedWorktree}>
                    <Icon name="settings-gear" size="small" />
                    <DropdownMenu.ItemLabel>
                      {language.t("agentManager.dialog.configureWorktree")}
                    </DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>
          </div>
        </Show>
        <Show when={hasChat && canContinueInWorktree() && server.gitInstalled()}>
          <>
            <Tooltip value={moveTooltip()} placement="top">
              <Button
                variant="ghost"
                size="small"
                class="session-move-action"
                aria-disabled={transferring()}
                onClick={moveToWorktree}
                aria-label={language.t("sidebar.session.moveToWorktree")}
              >
                <Show when={transferring()} fallback={<Icon name="branch" size="small" />}>
                  <Spinner class="chat-spinner-small" />
                </Show>
                <span class="session-move-label">
                  {transferring() ? transferDetail() : language.t("sidebar.session.moveToWorktree")}
                </span>
              </Button>
            </Tooltip>
            <Tooltip value={changesTooltip()} placement="top" class="session-move-changes-trigger">
              <Button
                variant="ghost"
                size="small"
                class="session-move-changes"
                classList={{
                  "session-move-changes--empty": !session.worktreeStats()?.files,
                  "session-move-changes--has-changes": !!session.worktreeStats()?.files,
                }}
                onClick={openChanges}
                aria-label={language.t("command.session.show.changes")}
              >
                <Icon name="layers" size="small" />
                <Show when={session.worktreeStats()?.files}>
                  <span class="session-diff-add">+{session.worktreeStats()!.additions}</span>
                  <span class="session-diff-del">-{session.worktreeStats()!.deletions}</span>
                  <span class="session-move-dot" aria-hidden="true" />
                </Show>
              </Button>
            </Tooltip>
          </>
        </Show>
      </div>
    </div>
  )

  return (
    <div class="chat-view">
      <TaskHeader readonly={props.readonly} />
      <div class="chat-messages-wrapper">
        <div class="chat-messages">
          <MessageList
            onSelectSession={props.onSelectSession}
            onShowHistory={props.onShowHistory}
            onForkMessage={props.onForkMessage}
            questions={standaloneQuestions}
            suggestions={standaloneSuggestions}
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
          <Show when={!props.readonly && idle() && !blocked() && (hasMessages() || isSidebar())}>
            {renderActions(hasMessages())}
          </Show>
          <Show when={!props.readonly}>
            <PromptInput
              blocked={blocked}
              suggesting={suggesting}
              questioning={questioning}
              boxId={props.promptBoxId}
              pendingSessionID={props.pendingSessionID}
            />
          </Show>
        </div>
      </Show>
    </div>
  )
}
