import type { SessionMessageAssistantTool } from "@opencode/client"
import type { JSX } from "@opentui/solid"
import { createMemo, createSignal, Show, type Component } from "solid-js"
import { useTheme } from "../context/theme"
import { INLINE_TOOL_ICON_WIDTH } from "../routes/session/message-parts"

/** The Kilo memory tools, rendered as one inline row with the request and the result count. */
export const memoryTools = new Set(["kilo_memory_recall", "kilo_memory_save"])

type Inline = Component<{
  icon: string
  complete: unknown
  pending: string
  spinner?: boolean
  part: SessionMessageAssistantTool
  onClick?: () => void
  children: JSX.Element
}>

const RECALL: Record<string, string> = {
  search: "Memory search",
  typed: "Memory recall",
  digest: "Memory digest",
  catalog: "Memory catalog",
}

/** The row text: the operation, its quoted text or query, and the result title without its "Kilo memory ...:" prefix. */
export function memoryToolTitle(input: {
  tool: string
  input: Record<string, unknown>
  metadata: Record<string, unknown>
}) {
  const recall = input.tool === "kilo_memory_recall"
  const mode = text(input.input.mode)
  const action = text(input.input.action)
  const label = recall ? (RECALL[mode ?? "search"] ?? `Memory ${mode}`) : `Memory ${action ?? "save"}`
  const subject = text(input.input.query) ?? text(input.input.text) ?? text(input.input.reason)
  const result = text(input.metadata.title)?.replace(/^Kilo memory [^:]*:\s*/i, "")
  return [label, subject ? ` "${clip(subject)}"` : "", result ? ` · ${result}` : ""].join("")
}

export function MemoryTool(props: {
  part: SessionMessageAssistantTool
  input: Record<string, unknown>
  metadata: Record<string, unknown>
  output?: string
  inline: Inline
}) {
  const theme = useTheme()
  const [expanded, setExpanded] = createSignal(false)
  const output = createMemo(() => (props.part.state.status === "completed" ? (props.output?.trim() ?? "") : ""))
  const recall = () => props.part.name === "kilo_memory_recall"
  const ready = () => (recall() ? (text(props.input.mode) ?? text(props.input.query)) : text(props.input.action))

  return (
    <>
      <props.inline
        icon="◇"
        complete={ready()}
        pending={recall() ? "Searching memory…" : "Saving memory…"}
        spinner={props.part.state.status === "streaming" || props.part.state.status === "running"}
        part={props.part}
        onClick={output() ? () => setExpanded((value) => !value) : undefined}
      >
        {memoryToolTitle({ tool: props.part.name, input: props.input, metadata: props.metadata })}
      </props.inline>
      <Show when={expanded() && output()}>
        {(value) => (
          <box paddingLeft={3 + INLINE_TOOL_ICON_WIDTH}>
            <text fg={theme.text.muted} wrapMode="word">
              {value()}
            </text>
          </box>
        )}
      </Show>
    </>
  )
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function clip(value: string) {
  const line = value.replace(/\s+/g, " ")
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}
