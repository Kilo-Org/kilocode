import { createMemo, For, Show } from "solid-js"
import { useI18n } from "../context/i18n"
import { useBoardSessions, type BoardSessionNavigation } from "../context/board-navigation"
import { BasicTool } from "./basic-tool"
import { BoardMessage, BoardParticipantStack, BoardRoute } from "./board-message"
import { preview } from "./board-route"
import { Markdown } from "./markdown"
import type { ToolProps } from "./message-part"

type BoardMessageRow = Record<string, unknown> & { body: string; from: string; to: string }

/**
 * The Kilo Swarm board tools, rendered as the message a post stored or the messages a read returned. The card is
 * the inline message event of the transcript; the board panel shows the same rows beside the conversation.
 */
export function BoardTool(props: ToolProps) {
  const i18n = useI18n()
  const sessions = useBoardSessions()
  const post = () => props.tool === "board_post"
  const navigate: BoardSessionNavigation = (id, title) => {
    if (props.actions?.openSubagent) return props.actions.openSubagent(id, title)
    props.actions?.openSession?.(id)
  }
  const result = createMemo(() => parse(props.output))
  const rows = createMemo(() => {
    const data = result()
    if (!data) return undefined
    const items = post() ? [data] : data.messages
    if (!Array.isArray(items)) return undefined
    return items.every(message) ? items : undefined
  })
  // The stored route only arrives with the result. While the model still streams the post, derive the sender and
  // recipient from the session store so the trigger shows the real avatars and titles from the first frame.
  const live = () => props.status === "pending" || props.status === "running"
  const guess = createMemo(() => {
    if (!post() || !live() || !props.sessionID || !sessions) return undefined
    return preview(sessions(props.sessionID), props.sessionID, props.input.to)
  })
  const participants = createMemo(() => {
    const seen = new Set<string>()
    const ids: string[] = []
    for (const item of rows() ?? []) {
      for (const id of [item.from, item.to]) {
        if (!id || id === "ALL" || seen.has(id)) continue
        seen.add(id)
        ids.push(id)
      }
    }
    const main = ids.indexOf("main")
    if (main > 0) {
      ids.splice(main, 1)
      ids.unshift("main")
    }
    return ids
  })
  const trigger = () => {
    if (post())
      return (
        <BoardRoute
          from={props.metadata.from ?? result()?.from ?? guess()?.from}
          to={props.metadata.to ?? result()?.to ?? guess()?.to ?? props.input.to}
          fromLabel={props.metadata.fromLabel ?? result()?.fromLabel ?? guess()?.fromLabel}
          toLabel={props.metadata.toLabel ?? result()?.toLabel ?? guess()?.toLabel}
          pending={live()}
          onSessionClick={navigate}
          semantic={false}
        />
      )
    const count = rows()?.length
    return {
      title: i18n.t("ui.messagePart.board.read"),
      subtitle: count === undefined ? undefined : String(count),
    }
  }
  const input = () =>
    Object.keys(props.input).length ? "```json\n" + JSON.stringify(props.input, null, 2) + "\n```" : ""
  const output = () => {
    if (rows() || !props.output) return undefined
    try {
      return "```json\n" + JSON.stringify(JSON.parse(props.output), null, 2) + "\n```"
    } catch {
      return props.output
    }
  }

  return (
    <Show
      when={!props.hideDetails}
      fallback={
        <BasicTool
          hideDetails
          icon="task"
          iconNode={
            post() ? undefined : (
              <BoardParticipantStack ids={participants()} onSessionClick={navigate} semantic={false} />
            )
          }
          status={props.status}
          trigger={trigger()}
        />
      }
    >
      <BasicTool
        icon="task"
        iconNode={
          post() ? undefined : <BoardParticipantStack ids={participants()} onSessionClick={navigate} semantic={false} />
        }
        defer
        status={props.status}
        tool={props.tool}
        partID={props.partID}
        trigger={trigger()}
        defaultOpen={props.defaultOpen}
        forceOpen={props.forceOpen}
      >
        <Show when={!rows() && input()}>
          {(text) => (
            <>
              <div data-slot="mcp-section-label">{i18n.t("ui.messagePart.mcp.input")}</div>
              <div data-component="tool-output" data-scrollable>
                <Markdown text={text()} />
              </div>
            </>
          )}
        </Show>
        <Show when={!rows() && output()}>
          {(text) => (
            <>
              <Show when={input()}>
                <div data-slot="mcp-tool-divider" />
              </Show>
              <div data-slot="mcp-section-label">{i18n.t("ui.messagePart.mcp.output")}</div>
              <div data-component="tool-output" data-scrollable>
                <Markdown text={text()} />
              </div>
            </>
          )}
        </Show>
        <Show when={rows()}>
          {(items) => (
            <div data-component="board-messages">
              <Show
                when={items().length}
                fallback={<span data-slot="board-message-note">{i18n.t("ui.messagePart.board.empty")}</span>}
              >
                <For each={items()}>
                  {(message) => <BoardMessage {...message} route={!post()} onSessionClick={navigate} />}
                </For>
              </Show>
              <Show when={post() && props.status === "completed"}>
                <span data-slot="board-message-note">{i18n.t("ui.messagePart.board.stored")}</span>
              </Show>
              <Show when={text(result()?.warning)}>
                {(warning) => <span data-slot="board-message-note">{warning()}</span>}
              </Show>
              <Show when={result()?.hasMore === true}>
                <span data-slot="board-message-note">{i18n.t("ui.messagePart.board.more")}</span>
              </Show>
            </div>
          )}
        </Show>
      </BasicTool>
    </Show>
  )
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function text(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function message(value: unknown): value is BoardMessageRow {
  return (
    record(value) && typeof value.body === "string" && typeof value.from === "string" && typeof value.to === "string"
  )
}

function parse(output: string) {
  if (!output) return undefined
  try {
    const value: unknown = JSON.parse(output)
    return record(value) ? value : undefined
  } catch {
    return undefined
  }
}
