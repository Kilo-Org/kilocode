import { Schema } from "effect"
import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { TokenUsage } from "@opencode/schema/token-usage"
import { invalidResponse } from "./live-io.js"
import { legacyEdit } from "./legacy-edit.js"

export type Message = KiloHostedRpc.Message
export type Assistant = Extract<Message, { type: "assistant" }>
export type Content = Assistant["content"][number]
export interface Row {
  message: Message
  // The part IDs are needed for subsequent native partial updates, but are not part of the public transcript.
  legacy?: { id: string; value: Content }[]
}

const id = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,255}$/))
const timestamp = Schema.optional(Schema.Finite)
const string = Schema.optional(Schema.String)
const metadata = Schema.Record(Schema.String, Schema.Json)
const Info = Schema.Struct({
  id,
  sessionID: id,
  role: Schema.Literals(["user", "assistant"]),
  time: Schema.Struct({ created: Schema.Finite, completed: timestamp }),
  agent: string,
  mode: string,
  modelID: string,
  providerID: string,
  variant: string,
  cost: timestamp,
  tokens: Schema.optional(TokenUsage.Info),
  error: Schema.optional(
    Schema.Union([
      Schema.String,
      Schema.Struct({ name: Schema.String, data: Schema.optional(Schema.Struct({ message: string })) }),
    ]),
  ),
})
const Part = Schema.Struct({
  id,
  sessionID: id,
  messageID: id,
  type: Schema.String,
  text: string,
  synthetic: Schema.optional(Schema.Boolean),
  ignored: Schema.optional(Schema.Boolean),
  time: Schema.optional(Schema.Struct({ start: timestamp, end: timestamp })),
  tool: string,
  callID: string,
  state: Schema.optional(
    Schema.Struct({
      status: Schema.String,
      input: Schema.optional(metadata),
      raw: string,
      output: string,
      error: string,
      metadata: Schema.optional(metadata),
      time: Schema.optional(Schema.Struct({ start: timestamp, end: timestamp })),
    }),
  ),
})
export const info = Schema.decodeUnknownSync(Info)
export const part = Schema.decodeUnknownSync(Part)
const page = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ info: Info, parts: Schema.Array(Part).check(Schema.isMaxLength(2048)) })).check(
    Schema.isMaxLength(40),
  ),
)

export function legacyMessage(value: typeof Info.Type): Row {
  const { id, time } = value
  if (value.role === "user") return { message: { id, time, type: "user", text: "" }, legacy: [] }
  const error = value.error
  return {
    message: {
      id,
      time,
      type: "assistant",
      content: [],
      agent: value.agent ?? value.mode ?? "",
      model: {
        id: value.modelID ?? "",
        providerID: value.providerID ?? "",
        ...(value.variant && { variant: value.variant }),
      },
      ...(value.cost !== undefined && { cost: value.cost }),
      ...(value.tokens && { tokens: value.tokens }),
      ...(error && {
        error: {
          type: typeof error === "string" ? "unknown" : error.name,
          message: typeof error === "string" ? error : (error.data?.message ?? error.name),
        },
      }),
    },
    legacy: [],
  }
}

export function legacyContent(p: typeof Part.Type, created: number): Content | undefined {
  if (p.ignored || (p.synthetic && p.text?.includes("<cloud-agent-context"))) return
  if (p.type === "text") return { type: "text", text: p.text ?? "" }
  if (p.type === "reasoning")
    return {
      type: "reasoning",
      text: p.text ?? "",
      ...(p.time?.start !== undefined && {
        time: { created: p.time.start, ...(p.time.end !== undefined && { completed: p.time.end }) },
      }),
    }
  if (p.type !== "tool" || !p.tool || !p.state) return
  return legacyTool(p.callID ?? p.id, p.tool, p.state, created)
}

function legacyTool(
  id: string,
  name: string,
  state: NonNullable<typeof Part.Type.state>,
  created: number,
): Content | undefined {
  const start = state.time?.start
  const end = state.time?.end
  const projected = legacyEdit(name, state.input ?? {}, state.metadata)
  const tool = {
    type: "tool",
    id,
    name: projected.name,
    time: {
      created: start ?? created,
      ...(start !== undefined && { ran: start }),
      ...(end !== undefined && { completed: end }),
    },
  } as const
  const input = projected.input
  const meta = projected.metadata ? { metadata: projected.metadata } : {}
  switch (state.status) {
    case "pending":
      return { ...tool, state: { status: "streaming", input: state.raw ?? JSON.stringify(input) } }
    case "running":
      return { ...tool, state: { status: "running", input, metadata: projected.metadata ?? {} } }
    case "completed":
      return {
        ...tool,
        state: { status: "completed", input, ...meta, content: [{ type: "text", text: state.output ?? "" }] },
      }
    case "error":
      return {
        ...tool,
        state: { status: "error", input, ...meta, error: { type: "tool.error", message: state.error ?? "" } },
      }
  }
}

export function withParts(message: Message, legacy: NonNullable<Row["legacy"]>): Row {
  if (message.type === "user")
    return {
      message: { ...message, text: legacy.flatMap((p) => (p.value.type === "text" ? [p.value.text] : [])).join("\n") },
      legacy,
    }
  if (message.type === "assistant") return { message: { ...message, content: legacy.map((p) => p.value) }, legacy }
  throw invalidResponse()
}

export function legacyPage(raw: unknown, sessionID: string): Row[] {
  return page(raw).map(({ info, parts }) => {
    if (info.sessionID !== sessionID) throw invalidResponse()
    const items = parts.flatMap((p) => {
      if (p.sessionID !== sessionID || p.messageID !== info.id) throw invalidResponse()
      const value = legacyContent(p, info.time.created)
      return value ? [{ id: p.id, value }] : []
    })
    return withParts(legacyMessage(info).message, items)
  })
}
