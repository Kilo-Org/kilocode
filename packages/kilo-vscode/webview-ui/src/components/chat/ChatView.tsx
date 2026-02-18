/**
 * ChatView component
 * Main chat container that combines all chat components
 */

import { Component, For, Show, createSignal } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { BasicTool } from "@kilocode/kilo-ui/basic-tool"
import { TaskHeader } from "./TaskHeader"
import { MessageList } from "./MessageList"
import { PromptInput } from "./PromptInput"
import { QuestionDock } from "./QuestionDock"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"

interface ChatViewProps {
  onSelectSession?: (id: string) => void
}

export const ChatView: Component<ChatViewProps> = (props) => {
  const session = useSession()
  const language = useLanguage()

  const id = () => session.currentSessionID()
  const sessionQuestions = () => session.questions().filter((q) => q.sessionID === id())
  const sessionPermissions = () => session.permissions().filter((p) => p.sessionID === id())

  const questionRequest = () => sessionQuestions()[0]
  const permissionRequest = () => sessionPermissions()[0]
  const blocked = () => sessionPermissions().length > 0 || sessionQuestions().length > 0

  const [responding, setResponding] = createSignal(false)

  const decide = (response: "once" | "always" | "reject") => {
    const perm = permissionRequest()
    if (!perm || responding()) return
    setResponding(true)
    session.respondToPermission(perm.id, response)
    setResponding(false)
  }

  return (
    <div class="chat-view">
      <TaskHeader />
      <div class="chat-messages">
        <MessageList onSelectSession={props.onSelectSession} />
      </div>

      <div class="chat-input">
        <Show when={questionRequest()} keyed>
          {(req) => <QuestionDock request={req} />}
        </Show>
        <Show when={permissionRequest()} keyed>
          {(perm) => (
            <div data-component="tool-part-wrapper" data-permission="true">
              <BasicTool
                icon="checklist"
                locked
                defaultOpen
                trigger={{
                  title: language.t("notification.permission.title"),
                  subtitle: perm.toolName,
                }}
              >
                <Show when={perm.patterns.length > 0}>
                  <div class="permission-dock-patterns">
                    <For each={perm.patterns}>
                      {(pattern) => <code class="permission-dock-pattern">{pattern}</code>}
                    </For>
                  </div>
                </Show>
              </BasicTool>
              <div data-component="permission-prompt">
                <div data-slot="permission-actions">
                  <Button variant="ghost" size="small" onClick={() => decide("reject")} disabled={responding()}>
                    {language.t("ui.permission.deny")}
                  </Button>
                  <Button variant="secondary" size="small" onClick={() => decide("always")} disabled={responding()}>
                    {language.t("ui.permission.allowAlways")}
                  </Button>
                  <Button variant="primary" size="small" onClick={() => decide("once")} disabled={responding()}>
                    {language.t("ui.permission.allowOnce")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Show>
        <Show when={!blocked()}>
          <PromptInput />
        </Show>
      </div>
    </div>
  )
}
