import { Schema } from "effect"
import { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { SessionMessage } from "@opencode/schema/session-message"
import { invalidResponse } from "./live-io.js"
import type { Assistant, Content, Row } from "./live-legacy.js"

const record = Schema.Record(Schema.String, Schema.Unknown)
const decode = Schema.decodeUnknownSync(KiloHostedRpc.Message)
const envelope = Schema.decodeUnknownSync(
  Schema.Struct({
    source: Schema.Struct({
      version: Schema.Literal("v2"),
      session: Schema.Struct({
        id: Schema.String,
        agent: Schema.optional(Schema.String),
        model: Schema.optional(record),
      }),
    }),
    message: record,
  }),
)

export function conversationRow(sessionID: string, raw: unknown): Row | undefined {
  const { message, source } = envelope(raw)
  if (source.session.id !== sessionID) return
  if (message.type !== "assistant" && message.type !== "user" && message.type !== "idle") return
  const parsed = decode({
    text: "",
    content: [],
    agent: source.session.agent ?? "",
    model: source.session.model ?? { id: "", providerID: "" },
    ...message,
  })
  // The presenter needs visible content, not provider replay payloads or host-only annotations.
  const { metadata: _, ...visible } = parsed
  if (visible.type !== "assistant") return { message: visible }
  if (visible.content.length > 2048) throw invalidResponse()
  const { native: _native, content, ...assistant } = visible
  return { message: { ...assistant, content: content.map(({ native: _, ...item }) => item) } }
}

export const conversationEvent = Schema.decodeUnknownSync(
  Schema.Struct({
    type: Schema.String,
    id: Schema.optional(Schema.String),
    created: Schema.optional(Schema.Finite),
    data: record,
  }),
)
type Event = ReturnType<typeof conversationEvent>

/** The live runtime announces the step before it has materialized an assistant row. */
export function startedStep(event: Event) {
  if (event.type !== "session.step.started") return
  const data = event.data
  const row = decode({
    id: data.assistantMessageID,
    type: "assistant",
    agent: data.agent,
    model: data.model,
    time: { created: data.started },
    content: [],
  })
  return { message: row }
}

/** The worker sends whole messages at durable boundaries. Fold the intervening text and tool input fragments. */
export function conversationContent(message: Assistant, event: Event): Assistant | undefined {
  if (message.time.completed !== undefined) return
  const { data, type } = event
  const items = [...message.content]
  const text = /^session\.(text|reasoning)\.(started|ended|delta)$/.exec(type)
  if (text) {
    if (!updateText(items, event, text[1] === "text" ? "text" : "reasoning", text[2])) return
  } else if (type.startsWith("session.tool.")) {
    const i = items.findIndex((p) => p.type === "tool" && p.id === data.id)
    const tool = items[i]
    const next = toolChange(event, tool?.type === "tool" ? tool : undefined, message.time.created)
    if (!next) return
    items[i === -1 ? items.length : i] = next
  } else return
  if (items.length > 2048) throw invalidResponse()
  return { ...message, content: items }
}

type Tool = Extract<Content, { type: "tool" }>
const nativePart = Schema.decodeUnknownSync(Schema.toEncoded(SessionMessage.AssistantTool))
const ordinal = Schema.decodeUnknownSync(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2047 })))
const string = Schema.decodeUnknownSync(Schema.String)

function updateText(items: Content[], event: Event, kind: "text" | "reasoning", op: string) {
  const prior = items.filter((p): p is Exclude<Content, { type: "tool" }> => p.type === kind)[
    ordinal(event.data.ordinal)
  ]
  if (op === "started" && prior) return false
  const text =
    op === "delta" ? (prior?.text ?? "") + string(event.data.delta) : op === "ended" ? string(event.data.text) : ""
  items[prior ? items.indexOf(prior) : items.length] = { ...prior, type: kind, text }
  return true
}

function toolChange(event: Event, prior: Tool | undefined, created: number): Tool | undefined {
  const data = event.data
  const at = event.created ?? created
  if (event.type === "session.tool.input.started" && !prior)
    return nativePart({
      type: "tool",
      id: data.id,
      name: data.name,
      time: { created: at },
      state: { status: "streaming", input: "" },
    })
  if (!prior || prior.state.status === "completed" || prior.state.status === "error") return
  const state = prior.state
  switch (event.type) {
    case "session.tool.input.delta":
    case "session.tool.input.ended":
      if (state.status !== "streaming") return
      return {
        ...prior,
        state: {
          ...state,
          input: event.type.endsWith("delta") ? state.input + String(data.delta ?? "") : String(data.text ?? ""),
        },
      }
    case "session.tool.called":
      return nativePart({
        ...prior,
        time: { ...prior.time, ran: at },
        state: { status: "running", input: data.input, metadata: {} },
      })
    case "session.tool.progress":
      return state.status === "running"
        ? nativePart({ ...prior, state: { ...state, metadata: data.metadata } })
        : undefined
    case "session.tool.success":
    case "session.tool.failed":
      return finishTool(prior, at, event)
  }
}

function finishTool(prior: Tool, at: number, event: Event) {
  const { data } = event
  return nativePart({
    ...prior,
    time: { ...prior.time, completed: at },
    state: {
      status: event.type === "session.tool.success" ? "completed" : "error",
      input: typeof prior.state.input === "string" ? {} : prior.state.input,
      ...(data.content !== undefined && { content: data.content }),
      ...(data.error !== undefined && { error: data.error }),
      ...(data.metadata !== undefined && { metadata: data.metadata }),
    },
  })
}
