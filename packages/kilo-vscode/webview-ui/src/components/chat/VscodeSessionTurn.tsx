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
import { DiffChanges } from "@kilocode/kilo-ui/diff-changes"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useData } from "@kilocode/kilo-ui/context/data"
import { useI18n } from "@kilocode/kilo-ui/context/i18n"
import { AssistantMessage } from "./AssistantMessage"
import type {
  AssistantMessage as SDKAssistantMessage,
  Message as SDKMessage,
  Part as SDKPart,
  SnapshotFileDiff,
} from "@kilocode/sdk/v2"
import { ErrorDisplay } from "./ErrorDisplay"
import { useServer } from "../../context/server"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { useFeedback } from "../../context/feedback"
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
  const i18n = useI18n()
  const server = useServer()
  const session = useSession()
  const language = useLanguage()
  const vscode = useVSCode()
  const feedback = useFeedback()

  const emptyParts: SDKPart[] = []
  const emptyDiffs: SnapshotFileDiff[] = []

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

  // Diffs from message summary
  const diffs = createMemo(() => {
    const rawDiffs = (message() as unknown as { summary?: { diffs?: unknown[] } } | undefined)?.summary?.diffs
    if (!rawDiffs?.length) return emptyDiffs
    const seen = new Set<string>()
    return (rawDiffs as SnapshotFileDiff[])
      .reduceRight<SnapshotFileDiff[]>((result, diff) => {
        if (seen.has(diff.file)) return result
        seen.add(diff.file)
        result.push(diff)
        return result
      }, [])
      .reverse()
  })

  const openChanges = () => vscode.postMessage({ type: "openChanges", turnId: message().id })

  // Copy part ID — the last text part from the last assistant message.
  // Synthetic parts (e.g. "Initializing snapshot…" from the slow-repo guard)
  // are transient status lines, not assistant output: they must never win
  // this lookup, otherwise the copy button renders beside the spinner
  // instead of the real response.
  const showAssistantCopyPartID = createMemo(() => {
    const msgs = assistantMessages()
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (!msg) continue
      const msgParts = (data.store.part?.[msg.id] ?? emptyParts) as SDKPart[]
      for (let j = msgParts.length - 1; j >= 0; j--) {
        const part = msgParts[j]
        if (!part || part.type !== "text") continue
        if ((part as SDKPart & { synthetic?: boolean }).synthetic) continue
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
              data-revert-disabled={assistantMessages().length > 0 && session.status() !== "idle" ? "" : undefined}
              title={
                assistantMessages().length > 0 && session.status() !== "idle"
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
                  assistantMessages().length > 0
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
                {(amsg) => (
                  <AssistantMessage
                    message={amsg}
                    showAssistantCopyPartID={showAssistantCopyPartID()}
                    feedback={{
                      enabled: feedback.telemetryEnabled(),
                      rating: feedback.getRating(amsg.id),
                      onRate: (next) =>
                        feedback.rate({
                          messageID: amsg.id,
                          sessionID: amsg.sessionID,
                          parentMessageID: amsg.parentID,
                          providerID: amsg.providerID,
                          modelID: amsg.modelID,
                          variant: (amsg as SDKAssistantMessage & { variant?: string }).variant,
                          next,
                        }),
                    }}
                  />
                )}
              </For>
            </div>
          </Show>

          {/* Diff summary — shown after completion. Click opens the changes view. */}
          <Show when={diffs().length > 0 && server.gitInstalled()}>
            <div class="vscode-session-turn-diffs" data-component="session-turn">
              <button
                type="button"
                class="vscode-session-turn-diffs-trigger"
                onClick={openChanges}
                aria-label={i18n.t("ui.sessionReview.change.modified")}
              >
                <span data-slot="session-turn-diffs-label">{i18n.t("ui.sessionReview.change.modified")}</span>
                <span data-slot="session-turn-diffs-count">
                  {diffs().length} {i18n.t(diffs().length === 1 ? "ui.common.file.one" : "ui.common.file.other")}
                </span>
                <span data-slot="session-turn-diffs-meta">
                  <DiffChanges changes={diffs()} variant="bars" />
                </span>
                <span data-slot="session-turn-diffs-chevron" aria-hidden="true">
                  <Icon name="chevron-right" size="small" />
                </span>
              </button>
            </div>
          </Show>

          {/* Error handling */}
          <Show when={error()}>
            {(err) => <ErrorDisplay error={err() as ErrorDisplayProps["error"]} onLogin={server.goToLogin} />}
          </Show>
        </div>
      )}
    </Show>
  )
}
