import type { SessionMessageAssistantTool } from "@opencode/client"
import type { JSX } from "@opentui/solid"
import { Option, Schema } from "effect"
import { createMemo, For, Show, type Component } from "solid-js"
import { useTheme, useThemes } from "../context/theme"
import { use } from "../routes/session/render-context"
import { isRecord } from "../util/record"

/** The Kilo Swarm board tools, rendered as one board post or the messages of one read. */
export const boardTools = new Set(["board_read", "board_post"])

type Block = Component<{
  title: string
  part: SessionMessageAssistantTool
  spinner: boolean
  children: JSX.Element
}>

export function BoardTool(props: {
  part: SessionMessageAssistantTool
  input: Record<string, unknown>
  metadata: Record<string, unknown>
  output?: string
  block: Block
}) {
  const theme = useTheme()
  const ctx = use()
  const { currentSyntax: syntax } = useThemes()
  const post = () => props.part.name === "board_post"
  const result = createMemo(() => parse(props.part.state.status === "completed" ? props.output : undefined))
  const rows = createMemo(() => {
    const data = result()
    if (!data) return undefined
    const items = post() ? [data] : data.messages
    if (!Array.isArray(items)) return undefined
    return items.every(message) ? items : undefined
  })
  const title = createMemo(() => {
    if (!post()) {
      const count = rows()?.length
      return `# Shared agent board${count === undefined ? "" : ` (${count} message${count === 1 ? "" : "s"})`}`
    }
    const data = result()
    return `# ${route({
      from: props.metadata.from ?? data?.from,
      to: props.metadata.to ?? data?.to ?? props.input.to,
      fromLabel: props.metadata.fromLabel ?? data?.fromLabel,
      toLabel: props.metadata.toLabel ?? data?.toLabel,
      type: props.metadata.type ?? data?.type ?? props.input.type,
    })}`
  })
  const fallback = () =>
    (props.part.state.status === "completed" ? props.output : undefined) ||
    (post() ? text(props.input.body) : undefined)

  return (
    <props.block
      title={title()}
      part={props.part}
      spinner={props.part.state.status === "streaming" || props.part.state.status === "running"}
    >
      <Show
        when={rows()}
        fallback={<Show when={fallback()}>{(body) => <text fg={theme.text.base}>{body()}</text>}</Show>}
      >
        {(items) => (
          <box gap={1}>
            <Show when={items().length} fallback={<text fg={theme.text.muted}>No messages on the board.</text>}>
              <For each={items()}>
                {(item) => (
                  <box gap={1}>
                    <Show when={!post()}>
                      <text fg={theme.text.muted}>{route(item)}</text>
                    </Show>
                    <markdown
                      syntaxStyle={syntax()}
                      content={item.body}
                      conceal={ctx.markdownMode() === "rendered"}
                      fg={theme.markdown.text}
                    />
                  </box>
                )}
              </For>
            </Show>
            <Show when={post() && props.part.state.status === "completed"}>
              <text fg={theme.text.muted}>Stored only. Delivery and reading are not confirmed.</text>
            </Show>
            <Show when={text(result()?.warning)}>
              {(warning) => <text fg={theme.text.feedback.warning.base}>{warning()}</text>}
            </Show>
            <Show when={result()?.hasMore === true}>
              <text fg={theme.text.muted}>More messages are available.</text>
            </Show>
          </box>
        )}
      </Show>
    </props.block>
  )
}

function text(value: unknown) {
  return typeof value === "string" ? value : undefined
}

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

function parse(output?: string) {
  if (!output) return undefined
  const value = Option.getOrUndefined(decode(output))
  return isRecord(value) ? value : undefined
}

function message(value: unknown): value is Record<string, unknown> & { body: string; from: string; to: string } {
  return (
    isRecord(value) && typeof value.body === "string" && typeof value.from === "string" && typeof value.to === "string"
  )
}

function label(id: unknown, value: unknown) {
  if (id === "ALL") return "All agents"
  const title = text(value)?.trim()
  if (title) return title
  if (id === "main") return "Primary agent"
  const key = text(id)
  return key ? `Agent · ${key.slice(-8)}` : "Agent"
}

function route(value: Record<string, unknown>) {
  const kind = text(value.type)
  return `${kind ? `${kind} · ` : ""}${label(value.from, value.fromLabel)} → ${label(value.to, value.toLabel)}`
}
