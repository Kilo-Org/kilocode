import { type Component, Show, createEffect } from "solid-js"
import { DiffChanges } from "@kilocode/kilo-ui/diff-changes"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useI18n } from "@kilocode/kilo-ui/context/i18n"
import type { AssistantMessage as SDKAssistantMessage, Part as SDKPart, SnapshotFileDiff } from "@kilocode/sdk/v2"
import type { Message } from "../../types/messages"
import type { TranscriptRow } from "../../context/transcript-rows"
import type { TimelineHighlight } from "../../utils/timeline/highlight"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { useFeedback } from "../../context/feedback"
import { AssistantMessage } from "./AssistantMessage"
import { ToolActivityGroup } from "./ToolActivityGroup"
import { ErrorDisplay, type ErrorDisplayProps } from "./ErrorDisplay"
import { VscodeUserMessage } from "./VscodeUserMessage"

interface TranscriptRowViewProps {
  row: TranscriptRow
  index?: number
  onForkMessage?: (sessionId: string, messageId: string) => void
  /** Part behind the currently hovered/focused task-timeline bar, if any. */
  highlight?: () => TimelineHighlight | undefined
  activeSearch?: boolean
  /** id of the part (tool call/reasoning block) containing the current chat
   * search match within this row, if any. */
  activeSearchPartID?: string
  /** For a multi-file apply_patch match, the specific file within that part. */
  activeSearchPartFile?: string
  activityOpen?: (key: string) => boolean
  activityCascade?: (key: string) => boolean
  onActivityOpenChange?: (key: string, open: boolean) => void
  onActivityCascade?: (key: string) => void
}

export const TranscriptRowView: Component<TranscriptRowViewProps> = (props) => {
  const session = useSession()
  const server = useServer()
  const language = useLanguage()
  const vscode = useVSCode()
  const feedback = useFeedback()
  const i18n = useI18n()

  const messages = () =>
    props.row.type === "activity"
      ? [...new Set(props.row.items.map((item) => item.message.id))]
      : [props.row.message.id]
  const message = () => (props.row.type === "activity" ? props.row.items[0]?.message : props.row.message)

  createEffect((prev: string | undefined) => {
    const ids = messages()
    const key = ids.join("\0")
    if (key === prev) return prev
    session.hydrateParts(ids)
    return key
  })

  const open = () => {
    const id = message()?.id
    if (id) vscode.postMessage({ type: "openChanges", turnId: id })
  }

  const controls = (msg: Message) => ({
    enabled: feedback.telemetryEnabled(),
    rating: feedback.getRating(msg.id),
    onRate: (next: "up" | "down" | null) =>
      feedback.rate({
        messageID: msg.id,
        sessionID: msg.sessionID,
        parentMessageID: msg.parentID ?? "",
        providerID: msg.providerID ?? msg.model?.providerID ?? "",
        modelID: msg.modelID ?? msg.model?.modelID ?? "",
        variant: msg.model?.variant,
        next,
      }),
  })

  return (
    <div
      class="vscode-session-turn"
      data-message={message()?.id}
      data-row={props.row.type}
      data-row-key={props.row.key}
      data-row-index={props.index}
      data-turn={props.row.turn}
      data-live={props.row.live ? "" : undefined}
      data-search-active={props.activeSearch ? "" : undefined}
    >
      <Show when={props.row.type === "user" ? props.row : undefined}>
        {(row) => (
          <div
            class="vscode-session-turn-user"
            data-revert-disabled={row().answered && session.status() !== "idle" ? "" : undefined}
            title={row().answered && session.status() !== "idle" ? language.t("revert.disabled.agentBusy") : undefined}
          >
            <VscodeUserMessage
              message={row().message}
              parts={row().parts}
              interrupted={row().interrupted}
              queued={row().queued}
              onFork={
                props.onForkMessage ? () => props.onForkMessage?.(row().message.sessionID, row().message.id) : undefined
              }
              onDelete={
                row().queued ? () => session.deleteQueuedMessage(row().message.sessionID, row().message.id) : undefined
              }
              onRevert={
                row().answered
                  ? () => {
                      if (session.status() !== "idle") return
                      session.revertSession(row().message.id)
                    }
                  : undefined
              }
            />
          </div>
        )}
      </Show>

      <Show when={props.row.type === "assistant" ? props.row : undefined}>
        {(row) => (
          <div class="vscode-session-turn-assistant">
            <AssistantMessage
              message={row().message as unknown as SDKAssistantMessage}
              parts={row().parts as unknown as SDKPart[]}
              showAssistantCopyPartID={row().copy}
              forceOpenPartID={props.activeSearchPartID}
              forceOpenFile={props.activeSearchPartFile}
              highlight={props.highlight}
              feedback={controls(row().message)}
            />
          </div>
        )}
      </Show>

      <Show when={props.row.type === "activity" ? props.row : undefined}>
        {(row) => (
          <div class="vscode-session-turn-assistant">
            <ToolActivityGroup
              groupKey={row().key}
              items={row().items}
              live={row().working}
              open={props.activityOpen?.(row().key) === true}
              cascade={props.activityCascade?.(row().key) !== false}
              forced={props.activeSearchPartID}
              onOpenChange={(open) => props.onActivityOpenChange?.(row().key, open)}
              onCascade={() => props.onActivityCascade?.(row().key)}
              render={(item) => (
                <AssistantMessage
                  message={item().message as unknown as SDKAssistantMessage}
                  parts={[item().part] as unknown as SDKPart[]}
                  activityDetail
                  forceOpenPartID={props.activeSearchPartID}
                  forceOpenFile={props.activeSearchPartFile}
                  highlight={props.highlight}
                  feedback={controls(item().message)}
                />
              )}
            />
          </div>
        )}
      </Show>

      <Show when={props.row.type === "diff" ? props.row : undefined}>
        {(row) => (
          <Show when={server.gitInstalled()}>
            <div class="vscode-session-turn-diffs" data-component="session-turn">
              <button
                type="button"
                class="vscode-session-turn-diffs-trigger"
                onClick={open}
                aria-label={i18n.t("ui.sessionReview.change.modified")}
              >
                <span data-slot="session-turn-diffs-label">{i18n.t("ui.sessionReview.change.modified")}</span>
                <span data-slot="session-turn-diffs-count">
                  {row().diffs.length}{" "}
                  {i18n.t(row().diffs.length === 1 ? "ui.common.file.one" : "ui.common.file.other")}
                </span>
                <span data-slot="session-turn-diffs-meta">
                  <DiffChanges changes={row().diffs as SnapshotFileDiff[]} variant="bars" />
                </span>
                <span data-slot="session-turn-diffs-chevron" aria-hidden="true">
                  <Icon name="chevron-right" size="small" />
                </span>
              </button>
            </div>
          </Show>
        )}
      </Show>

      <Show when={props.row.type === "error" ? props.row : undefined}>
        {(row) => <ErrorDisplay error={row().error as ErrorDisplayProps["error"]} onLogin={server.goToLogin} />}
      </Show>
    </div>
  )
}
