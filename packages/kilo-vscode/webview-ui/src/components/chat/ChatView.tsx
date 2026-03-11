/**
 * ChatView component
 * Main chat container that combines all chat components
 */

import { Component, Show, createEffect, createMemo, on, onCleanup, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { TaskHeader } from "./TaskHeader"
import { MessageList } from "./MessageList"
import { PromptInput } from "./PromptInput"
import { QuestionDock } from "./QuestionDock"
import { PermissionDock } from "./PermissionDock"
import { useSession } from "../../context/session"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { useWorktreeMode } from "../../context/worktree-mode"

interface ChatViewProps {
  onSelectSession?: (id: string) => void
  readonly?: boolean
}

export const ChatView: Component<ChatViewProps> = (props) => {
  const session = useSession()
  const vscode = useVSCode()
  const language = useLanguage()
  const worktreeMode = useWorktreeMode()
  // Show "Show Changes" only in the standalone sidebar, not inside Agent Manager
  const isSidebar = () => worktreeMode === undefined

  const id = () => session.currentSessionID()
  const hasMessages = () => session.messages().length > 0
  const idle = () => session.status() !== "busy"

  // Collect child session IDs spawned by task tools in the current session
  // (recursive: subagents can spawn their own subagents).
  const sessionFamily = createMemo<Set<string>>(() => {
    const root = id()
    if (!root) return new Set()
    const family = new Set([root])
    const parts = session.allParts()
    const messages = session.allMessages()
    const queue = [root]
    while (queue.length > 0) {
      const sid = queue.pop()!
      const msgs = messages[sid]
      if (!msgs) continue
      for (const msg of msgs) {
        const msgParts = parts[msg.id]
        if (!msgParts) continue
        for (const p of msgParts) {
          if (p.type !== "tool") continue
          const child = (p as { state?: { metadata?: { sessionId?: string } } }).state?.metadata?.sessionId
          if (child && !family.has(child)) {
            family.add(child)
            queue.push(child)
          }
        }
      }
    }
    return family
  })

  // Filter permissions/questions to the current session + its child sessions
  // (subagents). In the Agent Manager all worktree sessions share one provider,
  // so without this filter prompts from unrelated sessions would leak through.
  const scopedPermissions = () => session.permissions().filter((p) => sessionFamily().has(p.sessionID))
  const scopedQuestions = () => session.questions().filter((q) => sessionFamily().has(q.sessionID))

  // Bottom-dock permission: prefer current-session non-tool permissions,
  // then fall back to any scoped pending permission (including child sessions).
  const questionRequest = () =>
    scopedQuestions().find((q) => q.sessionID === id() && !q.tool) ??
    scopedQuestions().find((q) => !q.tool) ??
    scopedQuestions()[0]
  const permissionRequest = () => scopedPermissions().find((p) => p.sessionID === id()) ?? scopedPermissions()[0]
  const blocked = () => scopedPermissions().length > 0 || scopedQuestions().length > 0

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

  onMount(() => {
    if (props.readonly) return
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
    if (!perm || session.respondingPermissions().has(perm.id)) return
    session.respondToPermission(perm.id, response)
  }

  return (
    <div class="chat-view">
      <TaskHeader readonly={props.readonly} />
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
              <PermissionDock
                request={perm}
                responding={session.respondingPermissions().has(perm.id)}
                onDecide={decide}
              />
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
              <Show when={isSidebar()}>
                <Button
                  variant="ghost"
                  size="small"
                  data-full-width="true"
                  onClick={() => vscode.postMessage({ type: "openChanges" })}
                  aria-label={language.t("command.session.show.changes")}
                >
                  <Icon name="file-tree" size="small" />
                  {language.t("command.session.show.changes")}
                </Button>
              </Show>
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
