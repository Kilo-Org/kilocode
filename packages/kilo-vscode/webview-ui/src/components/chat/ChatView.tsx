/**
 * ChatView component
 * Main chat container that combines all chat components
 */

import { Component, For, Show, createSignal, createEffect, on, onCleanup, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { BasicTool } from "@kilocode/kilo-ui/basic-tool"
import { TaskHeader } from "./TaskHeader"
import { MessageList } from "./MessageList"
import { PromptInput } from "./PromptInput"
import { QuestionDock } from "./QuestionDock"
import { UPSTREAM_SUPPRESSED_TOOLS } from "./AssistantMessage"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import type { PermissionRequest } from "../../types/messages"

interface ChatViewProps {
  onSelectSession?: (id: string) => void
  readonly?: boolean
}

export const ChatView: Component<ChatViewProps> = (props) => {
  const session = useSession()
  const language = useLanguage()

  const id = () => session.currentSessionID()
  const hasMessages = () => session.messages().length > 0
  const idle = () => session.status() !== "busy"
  const sessionQuestions = () => session.questions().filter((q) => q.sessionID === id())
  const sessionPermissions = () => session.permissions().filter((p) => p.sessionID === id())

  const questionRequest = () => sessionQuestions().find((q) => !q.tool)
  const permissionRequest = () => sessionPermissions().find((p) => !p.tool)
  // Only block the prompt when there's a non-todo permission (todo permissions are shown inline)
  const isInlinePermission = (p: PermissionRequest) => p.tool && UPSTREAM_SUPPRESSED_TOOLS.has(p.toolName)
  const blocked = () =>
    sessionPermissions().some((p) => !isInlinePermission(p)) || sessionQuestions().length > 0

  // When a bottom-dock permission/question disappears while the session is busy,
  // the scroll container grows taller. Dispatch a custom event so MessageList can
  // resume auto-scroll.
  createEffect(
    on(blocked, (isBlocked, wasBlocked) => {
      if (wasBlocked && !isBlocked && !idle()) {
        window.dispatchEvent(new CustomEvent("resumeAutoScroll"))
      }
    }),
  )

  const [responding, setResponding] = createSignal(false)

  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && session.status() === "busy") {
        e.preventDefault()
        session.abort()
      }
    }
    document.addEventListener("keydown", handler)
    onCleanup(() => document.removeEventListener("keydown", handler))
  })

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
      <div class="chat-messages-wrapper">
        <div class="chat-messages">
          <MessageList onSelectSession={props.onSelectSession} />
        </div>
      </div>

      <Show when={!props.readonly}>
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
                  <p data-slot="permission-hint">{language.t("ui.permission.sessionHint")}</p>
                </div>
              </div>
            )}
          </Show>
          <Show when={hasMessages() && idle() && !blocked()}>
            <div class="new-task-button-wrapper">
              <Button
                variant="secondary"
                size="small"
                data-full-width="true"
                onClick={() => window.dispatchEvent(new CustomEvent("newTaskRequest"))}
                aria-label={language.t("command.session.new.task")}
              >
                {language.t("command.session.new.task")}
              </Button>
            </div>
          </Show>
          <Show when={!blocked()}>
            <PromptInput />
          </Show>
        </div>
      </Show>
    </div>
  )
}
