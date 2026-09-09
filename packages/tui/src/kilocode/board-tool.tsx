import type { ToolPart } from "@kilocode/sdk/v2"
import type { JSX } from "@opentui/solid"
import { createMemo, For, Show, type Component } from "solid-js"
import { useTheme } from "../context/theme"
import { formatMarkdownTables } from "../util/markdown"
import { isRecord } from "../util/record"

function text(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function parse(output?: string) {
  if (!output) return undefined
  try {
    const value: unknown = JSON.parse(output)
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
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

export function BoardTool(props: {
  part: ToolPart
  conceal?: boolean
  block: Component<{ title: string; part: ToolPart; spinner: boolean; children: JSX.Element }>
}) {
  const { theme, syntax } = useTheme()
  const post = () => props.part.tool === "board_post"
  const output = () => (props.part.state.status === "completed" ? props.part.state.output : undefined)
  const metadata = () => (props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {}))
  const result = createMemo(() => parse(output()))
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
    const meta = metadata()
    return `# ${route({
      from: meta.from ?? data?.from,
      to: meta.to ?? data?.to ?? props.part.state.input.to,
      fromLabel: meta.fromLabel ?? data?.fromLabel,
      toLabel: meta.toLabel ?? data?.toLabel,
      type: meta.type ?? data?.type ?? props.part.state.input.type,
    })}`
  })
  const fallback = () => output() || (post() ? text(props.part.state.input.body) : undefined)

  return (
    <props.block
      title={title()}
      part={props.part}
      spinner={props.part.state.status === "pending" || props.part.state.status === "running"}
    >
      <Show when={rows()} fallback={<Show when={fallback()}>{(body) => <text fg={theme.text}>{body()}</text>}</Show>}>
        {(items) => (
          <box gap={1}>
            <Show when={items().length} fallback={<text fg={theme.textMuted}>No messages on the board.</text>}>
              <For each={items()}>
                {(item) => (
                  <box gap={1}>
                    <Show when={!post()}>
                      <text fg={theme.textMuted}>{route(item)}</text>
                    </Show>
                    <markdown
                      syntaxStyle={syntax()}
                      content={formatMarkdownTables(item.body)}
                      conceal={props.conceal}
                      fg={theme.markdownText}
                    />
                  </box>
                )}
              </For>
            </Show>
            <Show when={post() && props.part.state.status === "completed"}>
              <text fg={theme.textMuted}>Stored only. Delivery and reading are not confirmed.</text>
            </Show>
            <Show when={text(result()?.warning)}>{(warning) => <text fg={theme.warning}>{warning()}</text>}</Show>
            <Show when={result()?.hasMore === true}>
              <text fg={theme.textMuted}>More messages are available.</text>
            </Show>
          </box>
        )}
      </Show>
    </props.block>
  )
}
