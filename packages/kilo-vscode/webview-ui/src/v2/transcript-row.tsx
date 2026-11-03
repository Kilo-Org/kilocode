import type { ToolActions } from "@kilocode/kilo-ui/message-part"
import { Match, Switch } from "solid-js"
import type { TimelineHighlight } from "../utils/timeline/highlight"
import { AssistantMessage, ErrorCard } from "./assistant"
import type { TranscriptRow } from "./transcript"
import { UserMessage } from "./user"

export function TranscriptRowView(props: {
  row: TranscriptRow
  session: string
  actions?: ToolActions
  highlight?: () => TimelineHighlight | undefined
  /** Forks the session before the user message, when the surface can fork. */
  onForkMessage?: (sessionID: string, messageID: string) => void
}) {
  return (
    <div style={{ display: "contents" }}>
      <Switch>
        <Match when={props.row.type === "user" && props.row}>
          {(row) => (
            <UserMessage
              message={row().message}
              rowKey={row().key}
              onFork={
                props.onForkMessage
                  ? () => props.onForkMessage?.(props.session, row().message.id)
                  : undefined
              }
            />
          )}
        </Match>
        <Match when={props.row.type === "assistant" && props.row}>
          {(row) => (
            <AssistantMessage
              message={row().message}
              session={props.session}
              actions={props.actions}
              highlight={props.highlight}
              parts={row().parts}
              start={row().start}
              metadata={row().metadata}
              rowKey={row().key}
            />
          )}
        </Match>
        <Match when={props.row.type === "error" && props.row}>
          {(row) => (
            <div class="vscode-session-turn" data-row="error" data-message={row().message.id} data-row-key={row().key}>
              <ErrorCard error={row().error} />
            </div>
          )}
        </Match>
      </Switch>
    </div>
  )
}
