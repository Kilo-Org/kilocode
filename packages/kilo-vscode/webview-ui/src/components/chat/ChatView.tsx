/** @jsxImportSource solid-js */

/** Main chat container that combines the chat components. */
import { type Component, type JSX, Show, createMemo, onCleanup, onMount } from "solid-js"
import { useData } from "@kilocode/kilo-ui/context/data"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { TaskHeader } from "./TaskHeader"
import { MessageList } from "./MessageList"
import { PromptInput } from "./PromptInput"
import { PermissionDock } from "./PermissionDock"
import { SessionDock } from "./SessionDock"
import { StartupErrorBanner } from "./StartupErrorBanner"
import { SessionTabStrip } from "./SessionTabStrip"
import { useSession } from "../../context/session"
import { useLocalTabs } from "../../context/local-tabs"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { useServer } from "../../context/server"
import { TranscriptSearchProvider } from "../../context/transcript-search"
import { isPromptBlocked, isQuestioning } from "./prompt-input-utils"
import { showTabStrip } from "../../utils/local-tabs"
import { forcesExternalBrowser } from "../../utils/link-modifier"

interface ChatViewProps {
  onSelectSession?: (id: string) => void
  isSessionOpen?: (id: string) => boolean
  onShowHistory?: () => void
  onForkMessage?: (sessionId: string, messageId: string) => void
  promptBoxId?: string
  deferFocusToQuestion?: () => boolean
  pendingSessionID?: string
  focusOnDraftChange?: () => boolean
  onFocusChange?: (focused: boolean) => void
  emptyState?: () => JSX.Element
  introduction?: boolean
}

export const ChatView: Component<ChatViewProps> = (props) => {
  const session = useSession()
  const data = useData()
  const vscode = useVSCode()
  const language = useLanguage()
  const server = useServer()
  const tabs = useLocalTabs()
  const pendingSessionID = () => props.pendingSessionID ?? tabs?.pending()
  const id = () => session.currentSessionID()
  const openLink = (event: MouseEvent) => {
    if (!data.openUrl || !(event.target instanceof Element)) return
    const anchor = event.target.closest("a[href]")
    if (!anchor || anchor.closest(".chat-view") !== event.currentTarget) return
    const url = anchor.getAttribute("href") ?? ""
    if (!/^https?:\/\//i.test(url)) return
    event.preventDefault()
    event.stopPropagation()
    if (forcesExternalBrowser(event, data.browserLinks)) {
      vscode.postMessage({ type: "openExternal", url })
      return
    }
    data.openUrl(url, id())
  }
  const hasMessages = createMemo(() => session.messages().length > 0 || session.submitting())
  let scroll: (() => void) | undefined
  const setScroll = (handler: (() => void) | undefined) => {
    scroll = handler
  }
  const scrollToBottom = () => scroll?.()
  const familyPermissions = createMemo(() => session.scopedPermissions(id()))
  const familyQuestions = createMemo(() => session.scopedQuestions(id()))
  const standaloneQuestions = createMemo(() => familyQuestions().filter((q) => !q.tool))
  const permissionRequest = () => familyPermissions().at(0)
  const blocked = () => isPromptBlocked(familyPermissions().length)
  const questioning = () => isQuestioning(blocked(), familyQuestions().length)
  const dockBlocked = () => blocked() || familyQuestions().length > 0

  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (!session.submitting() && session.status() === "idle") || e.defaultPrevented) return
      e.preventDefault()
      session.abort()
    }
    document.addEventListener("keydown", handler)
    onCleanup(() => document.removeEventListener("keydown", handler))
  })

  const decide = (
    permissionID: string,
    response: "once" | "always" | "reject",
    approvedAlways: string[],
    deniedAlways: string[],
    feedback?: string,
  ) => {
    const perm = permissionRequest()
    if (!perm || perm.id !== permissionID || session.respondingPermissions().has(permissionID)) return
    session.respondToPermission(permissionID, response, approvedAlways, deniedAlways, feedback)
  }
  const startSession = () => window.dispatchEvent(new CustomEvent("newTaskRequest"))
  const renderActions = (hasChat: boolean, todos: JSX.Element) => (
    <Show when={hasChat}>
      <div class="new-task-button-wrapper" classList={{ "new-task-button-wrapper--empty": !hasChat }}>
        <div class="session-actions-row">
          <Tooltip value={language.t("sidebar.session.newSession.tooltip")} placement="top">
            <Button
              variant="secondary"
              size="small"
              class="session-new-button"
              onClick={startSession}
              aria-label={language.t("sidebar.session.newSession")}
            >
              {language.t("sidebar.session.newSession")}
            </Button>
          </Tooltip>
          {todos}
        </div>
      </div>
    </Show>
  )

  return (
    <TranscriptSearchProvider>
      <div
        class="chat-view"
        ref={(node) => {
          node.addEventListener("click", openLink, true)
          onCleanup(() => node.removeEventListener("click", openLink, true))
        }}
      >
        <Show when={tabs && showTabStrip(tabs.ids())}>
          <SessionTabStrip />
        </Show>
        <TaskHeader />
        <div class="chat-messages-wrapper">
          <div class="chat-messages">
            <MessageList
              onSelectSession={props.onSelectSession}
              isSessionOpen={props.isSessionOpen}
              onShowHistory={props.onShowHistory}
              onForkMessage={props.onForkMessage}
              onScrollToBottomReady={setScroll}
              questions={standaloneQuestions}
              emptyState={props.emptyState}
              introduction={props.introduction}
              announce
              sessionID={pendingSessionID}
            />
          </div>
        </div>
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
          <SessionDock
            blocked={dockBlocked()}
            hasActions={hasMessages}
            actions={(todos) => renderActions(hasMessages(), todos)}
            onScrollToBottom={scrollToBottom}
          />
          <PromptInput
            blocked={blocked}
            questioning={questioning}
            boxId={props.promptBoxId}
            deferFocusToQuestion={props.deferFocusToQuestion}
            pendingSessionID={pendingSessionID()}
            focusOnDraftChange={props.focusOnDraftChange}
            onFocusChange={props.onFocusChange}
          />
        </div>
      </div>
    </TranscriptSearchProvider>
  )
}
