import { type Component, Show, createEffect } from "solid-js"
import { DiffChanges } from "@kilocode/kilo-ui/diff-changes"
import { useI18n } from "@kilocode/kilo-ui/context/i18n"
import type { AssistantMessage as SDKAssistantMessage, Part as SDKPart, SnapshotFileDiff } from "@kilocode/sdk-v1/v2"
import type { TranscriptRow } from "../../context/transcript-rows"
import type { TimelineHighlight } from "../../utils/timeline/highlight"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { AssistantMessage } from "./AssistantMessage"
import { ErrorDisplay, type ErrorDisplayProps } from "./ErrorDisplay"
import { VscodeUserMessage } from "./VscodeUserMessage"

interface TranscriptRowViewProps {
  row: TranscriptRow
  index?: number
  onSelectSession?: (id: string) => boolean | void
  isSessionOpen?: (id: string) => boolean
  onForkMessage?: (sessionId: string, messageId: string) => void
  /** Part behind the currently hovered/focused task-timeline bar, if any. */
  highlight?: () => TimelineHighlight | undefined
  activeSearch?: boolean
  readonly?: boolean
  interactivePrompts?: boolean
}

export const TranscriptRowView: Component<TranscriptRowViewProps> = (props) => {
  const session = useSession()
  const server = useServer()
  const i18n = useI18n()

  createEffect(() => session.hydrateParts([props.row.message.id]))

  return (
    <div
      class="vscode-session-turn"
      data-message={props.row.message.id}
      data-row={props.row.type}
      data-row-key={props.row.key}
      data-row-index={props.index}
      data-turn={props.row.turn}
      data-live={props.row.live ? "" : undefined}
      data-search-active={props.activeSearch ? "" : undefined}
    >
      <Show when={props.row.type === "user" ? props.row : undefined}>
        {(row) => (
          <div class="vscode-session-turn-user">
            <VscodeUserMessage
              message={row().message}
              parts={row().parts}
              onSelectSession={props.onSelectSession}
              isSessionOpen={props.isSessionOpen}
              interrupted={row().interrupted}
              queued={row().queued}
              onFork={
                props.onForkMessage ? () => props.onForkMessage?.(row().message.sessionID, row().message.id) : undefined
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
              timing={row().timing}
              highlight={props.highlight}
              readonly={props.readonly}
              interactivePrompts={props.interactivePrompts}
            />
          </div>
        )}
      </Show>

      <Show when={props.row.type === "diff" ? props.row : undefined}>
        {(row) => (
          <Show when={server.gitInstalled()}>
            <div class="vscode-session-turn-diffs" data-component="session-turn">
              <div class="vscode-session-turn-diffs-trigger" aria-label={i18n.t("ui.sessionReview.change.modified")}>
                <span data-slot="session-turn-diffs-label">{i18n.t("ui.sessionReview.change.modified")}</span>
                <span data-slot="session-turn-diffs-count">
                  {row().diffs.length}{" "}
                  {i18n.t(row().diffs.length === 1 ? "ui.common.file.one" : "ui.common.file.other")}
                </span>
                <span data-slot="session-turn-diffs-meta">
                  <DiffChanges changes={row().diffs as SnapshotFileDiff[]} variant="bars" />
                </span>
              </div>
            </div>
          </Show>
        )}
      </Show>

      <Show when={props.row.type === "error" ? props.row : undefined}>
        {(row) => <ErrorDisplay error={row().error as ErrorDisplayProps["error"]} />}
      </Show>
    </div>
  )
}
