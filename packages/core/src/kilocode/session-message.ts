import { StoredToolContent } from "@opencode-ai/llm"
import { Schema } from "effect"

const decode = Schema.decodeUnknownSync(StoredToolContent)

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function normalize(value: unknown): unknown {
  if (!record(value) || value.type !== "assistant" || !Array.isArray(value.content)) return value
  return {
    ...value,
    content: value.content.map((item) => {
      if (!record(item) || item.type !== "tool" || !record(item.state)) return item
      const status = item.state.status
      if (status !== "running" && status !== "completed" && status !== "error") return item
      if (!Array.isArray(item.state.content)) return item
      return { ...item, state: { ...item.state, content: item.state.content.map((entry) => decode(entry)) } }
    }),
  }
}
