import { type Component, Show, createEffect } from "solid-js"
import { DiffChanges } from "@kilocode/kilo-ui/diff-changes"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useI18n } from "@kilocode/kilo-ui/context/i18n"
import type { AssistantMessage as SDKAssistantMessage, Part as SDKPart, SnapshotFileDiff } from "@kilocode/sdk/v2"
import type { TranscriptRow } from "../../context/transcript-rows"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { useFeedback } from "../../context/feedback"
import { AssistantMessage } from "./AssistantMessage"
import { ErrorDisplay, type ErrorDisplayProps } from "./ErrorDisplay"
import { VscodeUserMessage } from "./VscodeUserMessage"

interface TranscriptRowViewProps {
  row: TranscriptRow
  index?: number
  onForkMessage?: (sessionId: string, messageId: string) => void
  activeSearch?: boolean
}

export const TranscriptRowView: Component<TranscriptRowViewProps> = (props) => {
  const session = useSession()
  const server = useServer()
  const language = useLanguage()
  const vscode = useVSCode()
  const feedback = useFeedback()
  const i18n = useI18n()

  createEffect(() => session.hydrateParts([props.row.message.id]))

  const open = () => vscode.postMessage({ type: "openChanges", turnId: props.row.message.id })

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
              feedback={{
                enabled: feedback.telemetryEnabled(),
                rating: feedback.getRating(row().message.id),
                onRate: (next) =>
                  feedback.rate({
                    messageID: row().message.id,
                    sessionID: row().message.sessionID,
                    parentMessageID: row().message.parentID ?? "",
                    providerID: row().message.providerID ?? row().message.model?.providerID ?? "",
                    modelID: row().message.modelID ?? row().message.model?.modelID ?? "",
                    variant: row().message.model?.variant,
                    next,
                  }),
              }}
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
