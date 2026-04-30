/**
 * VscodeSessionTurn component
 * Custom replacement for the upstream SessionTurn, designed for the VS Code sidebar.
 *
 * Key differences from upstream SessionTurn:
 * - No "Gathered context" grouping — each tool call is rendered individually
 * - Sub-agents are fully expanded inline via TaskToolExpanded
 * - No per-turn auto-scroll (MessageList handles it)
 * - Simpler flat structure without overflow containers
 */

import { Component, createMemo, For, Show, createEffect } from "solid-js"
import { UserMessageDisplay } from "@kilocode/kilo-ui/message-part"
import { useData } from "@kilocode/kilo-ui/context/data"
import { AssistantMessage } from "./AssistantMessage"
import type { AssistantMessage as SDKAssistantMessage, Message as SDKMessage, Part as SDKPart } from "@kilocode/sdk/v2"
import { ErrorDisplay } from "./ErrorDisplay"
import { useServer } from "../../context/server"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { visibleError } from "../../context/session-errors"
import type { ErrorDisplayProps } from "./ErrorDisplay"
import type { Message as WebMessage } from "../../types/messages"

export interface VscodeTurn {
  id: string
  user: WebMessage
  assistant: WebMessage[]
  partial?: boolean
}

interface VscodeSessionTurnProps {
  turn: VscodeTurn
  queued?: boolean
  onForkMessage?: (sessionId: string, messageId: string) => void
}

export const VscodeSessionTurn: Component<VscodeSessionTurnProps> = (props) => {
  const data = useData()
  const server = useServer()
  const session = useSession()
  const language = useLanguage()

  const emptyParts: SDKPart[] = []

  createEffect(() => {
    const turn = props.turn
    const ids = turn.partial ? turn.assistant.map((m) => m.id) : [turn.user.id, ...turn.assistant.map((m) => m.id)]
    session.hydrateParts(ids)
  })

  const message = createMemo(() => props.turn.user as SDKMessage & { role: "user" })

  const parts = createMemo(() => {
    const msg = message()
    return (data.store.part?.[msg.id] ?? emptyParts) as SDKPart[]
  })

  const assistantMessages = createMemo(() => props.turn.assistant as SDKAssistantMessage[])

  const interrupted = createMemo(() => assistantMessages().some((m) => m.error?.name === "MessageAbortedError"))

  const error = createMemo(() => visibleError(assistantMessages(), session.isErrorHidden))

  // Copy part ID — the last text part from the last assistant message
  const showAssistantCopyPartID = createMemo(() => {
    const msgs = assistantMessages()
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (!msg) continue
      const msgParts = (data.store.part?.[msg.id] ?? emptyParts) as SDKPart[]
      for (let j = msgParts.length - 1; j >= 0; j--) {
        const part = msgParts[j]
        if (!part || part.type !== "text") continue
        if ((part as SDKPart & { text: string }).text?.trim()) return part.id
      }
    }
    return undefined
  })

  return (
    <Show when={message()}>
      {(msg) => (
        <div class="vscode-session-turn" data-message={msg().id}>
          {/* User message */}
          <Show when={!props.turn.partial}>
            <div
              class="vscode-session-turn-user"
              data-revert-disabled={
                assistantMessages().length > 0 && !session.revert() && session.status() !== "idle" ? "" : undefined
              }
              title={
                assistantMessages().length > 0 && !session.revert() && session.status() !== "idle"
                  ? language.t("revert.disabled.agentBusy")
                  : undefined
              }
            >
              <UserMessageDisplay
                message={msg() as unknown as Parameters<typeof UserMessageDisplay>[0]["message"]}
                parts={parts() as unknown as Parameters<typeof UserMessageDisplay>[0]["parts"]}
                interrupted={interrupted()}
                queued={props.queued}
                onFork={props.onForkMessage ? () => props.onForkMessage?.(msg().sessionID, msg().id) : undefined}
                onRevert={
                  assistantMessages().length > 0 && !session.revert()
                    ? () => {
                        if (session.status() !== "idle") return
                        session.revertSession(msg().id)
                      }
                    : undefined
                }
              />
            </div>
          </Show>

          {/* Assistant parts — flat list, no context grouping */}
          <Show when={assistantMessages().length > 0}>
            <div class="vscode-session-turn-assistant">
              <For each={assistantMessages()}>
                {(msg) => <AssistantMessage message={msg} showAssistantCopyPartID={showAssistantCopyPartID()} />}
              </For>
            </div>
          </Show>

          {/* Error handling */}
          <Show when={error()}>
            {(err) => <ErrorDisplay error={err() as ErrorDisplayProps["error"]} onLogin={server.startLogin} />}
          </Show>
        </div>
      )}
    </Show>
  )
}
