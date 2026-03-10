/**
 * ChatView component
 * Main chat container that combines all chat components
 */

import { Component, For, Show, createEffect, createRoot, on, onCleanup, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { BasicTool } from "@kilocode/kilo-ui/basic-tool"
import { TaskHeader } from "./TaskHeader"
import { MessageList } from "./MessageList"
import { PromptInput } from "./PromptInput"
import { QuestionDock } from "./QuestionDock"
import { UPSTREAM_SUPPRESSED_TOOLS } from "./AssistantMessage"
import { useSession } from "../../context/session"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { useWorktreeMode } from "../../context/worktree-mode"
import type { PermissionRequest } from "../../types/messages"

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
  // Include ALL pending permissions/questions -- both from the current session
  // and from child sessions (subagents). The extension host already filters
  // SSE events to only tracked sessions, so everything in these lists is
  // relevant to the current workspace.
  const allPermissions = () => session.permissions()
  const allQuestions = () => session.questions()

  // Bottom-dock permission: prefer current-session non-tool permissions,
  // then fall back to any pending permission (including child sessions).
  const questionRequest = () =>
    allQuestions().find((q) => q.sessionID === id() && !q.tool) ?? allQuestions().find((q) => !q.tool) ?? allQuestions()[0]
  const permissionRequest = () =>
    allPermissions().find((p) => p.sessionID === id() && !p.tool) ?? allPermissions().find((p) => !p.tool) ?? allPermissions()[0]
  // Only block the prompt when there's a non-inline permission or any question pending
  // (todo permissions are shown inline, not in the bottom dock)
  const isInlinePermission = (p: PermissionRequest) => p.tool && UPSTREAM_SUPPRESSED_TOOLS.has(p.toolName)
  const blocked = () => allPermissions().some((p) => !isInlinePermission(p)) || allQuestions().length > 0

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

  // Mode action: waits for session idle, switches agent, sends follow-up prompt
  let modeActionAbort: AbortController | undefined

  const waitForIdle = (sessionID: string, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      let settled = false
      const ref: { dispose?: () => void } = {}
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        ref.dispose?.()
        fn()
      }
      const timeout = setTimeout(() => {
        settle(() => reject(new Error("Timed out waiting for session idle")))
      }, 30_000)

      createRoot((dispose) => {
        ref.dispose = dispose
        signal.addEventListener("abort", () => settle(() => reject(new Error("Cancelled"))), { once: true })
        createEffect(() => {
          const info = session.allStatusMap()[sessionID]
          if (info && info.type !== "idle") return
          settle(() => resolve())
        })
      })
    })

  const handleModeAction = async (input: { mode: string; text: string; description?: string }) => {
    const sessionID = id()
    if (!sessionID) return

    modeActionAbort?.abort()
    const controller = new AbortController()
    modeActionAbort = controller

    try {
      // Allow one microtask for session status to reflect the reply before checking idle
      await new Promise((r) => setTimeout(r, 0))
      await waitForIdle(sessionID, controller.signal)
    } catch {
      return
    }

    if (controller.signal.aborted) return

    // Guard against session switch during the wait — if the user navigated to a
    // different session, don't apply the mode change to the wrong session
    if (id() !== sessionID) return

    session.selectAgent(input.mode)
    const sel = session.selected()
    session.sendMessage(input.description ?? input.text, sel?.providerID, sel?.modelID)
  }

  onCleanup(() => modeActionAbort?.abort())

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
    if (!perm || session.respondingPermissions().has(perm.id)) return
    session.respondToPermission(perm.id, response)
  }

  return (
    <div class="chat-view">
      <TaskHeader />
      <div class="chat-messages-wrapper">
        <div class="chat-messages">
          <MessageList onSelectSession={props.onSelectSession} onModeAction={handleModeAction} />
        </div>
      </div>

      <Show when={!props.readonly}>
        <div class="chat-input">
          <Show when={questionRequest()} keyed>
            {(req) => <QuestionDock request={req} onModeAction={handleModeAction} />}
          </Show>
          <Show when={permissionRequest()} keyed>
            {(perm) => {
              const fromChild = () => perm.sessionID !== id()
              const subtitle = () => fromChild() ? `${perm.toolName} (subagent)` : perm.toolName
              return (
              <div data-component="tool-part-wrapper" data-permission="true">
                <BasicTool
                  icon="checklist"
                  locked
                  defaultOpen
                  trigger={{
                    title: language.t("notification.permission.title"),
                    subtitle: subtitle(),
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
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => decide("reject")}
                      disabled={session.respondingPermissions().has(perm.id)}
                    >
                      {language.t("ui.permission.deny")}
                    </Button>
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => decide("always")}
                      disabled={session.respondingPermissions().has(perm.id)}
                    >
                      {language.t("ui.permission.allowAlways")}
                    </Button>
                    <Button
                      variant="primary"
                      size="small"
                      onClick={() => decide("once")}
                      disabled={session.respondingPermissions().has(perm.id)}
                    >
                      {language.t("ui.permission.allowOnce")}
                    </Button>
                  </div>
                  <p data-slot="permission-hint">{language.t("ui.permission.sessionHint")}</p>
                </div>
              </div>
              )
            }}
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
          <PromptInput />
        </div>
      </Show>
    </div>
  )
}
