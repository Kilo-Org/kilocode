import type { ToolActions, UserMessagePending } from "@kilocode/kilo-ui/message-part"
import { Match, Switch } from "solid-js"
import type { TimelineHighlight } from "../utils/timeline/highlight"
import { AssistantMessage, ErrorCard } from "./assistant"
import type { TranscriptRow } from "./transcript"
import { UserMessage } from "./user"

export function TranscriptRowView(props: {
  row: TranscriptRow
  session: string
  actions?: ToolActions
  /** Instruction files one read loaded, by read tool part ID. */
  instructionFiles?: (partID: string) => readonly string[] | undefined
  highlight?: () => TimelineHighlight | undefined
  /** Whether the current transcript search match is in this row. */
  searchActive?: boolean
  /** Opens the files changed by one turn. */
  onViewTurnChanges?: (sessionID: string, turnID: string) => void
  /** Forks the session before the user message, when the surface can fork. */
  onForkMessage?: (sessionID: string, messageID: string) => void
  /** Opens the session a prompt came from, for example another Agent Manager session. */
  onSelectSession?: (id: string) => void
  /** The delivery state of a user message the server has not handed to the model yet. */
  pending?: (messageID: string) => UserMessagePending | undefined
}) {
  const viewTurnChanges = () => {
    const turn = props.row.type === "assistant" ? props.row.userTurn : undefined
    if (!turn || !props.onViewTurnChanges) return undefined
    return () => props.onViewTurnChanges?.(props.session, turn)
  }
  return (
    <div style={{ display: "contents" }}>
      <Switch>
        <Match when={props.row.type === "user" && props.row}>
          {(row) => (
            <UserMessage
              message={row().message}
              rowKey={row().key}
              sessionID={props.session}
              actions={props.actions}
              searchActive={props.searchActive}
              pending={props.pending?.(row().message.id)}
              onSelectSession={props.onSelectSession}
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
              instructionFiles={props.instructionFiles}
              highlight={props.highlight}
              searchActive={props.searchActive}
              parts={row().parts}
              start={row().start}
              metadata={row().metadata}
              userTurn={row().userTurn}
              rowKey={row().key}
              onViewTurnChanges={viewTurnChanges()}
            />
          )}
        </Match>
        <Match when={props.row.type === "error" && props.row}>
          {(row) => (
            <div
              class="vscode-session-turn"
              data-row="error"
              data-message={row().message.id}
              data-row-key={row().key}
              data-search-active={props.searchActive ? "" : undefined}
            >
              <ErrorCard error={row().error} />
            </div>
          )}
        </Match>
      </Switch>
    </div>
  )
}
