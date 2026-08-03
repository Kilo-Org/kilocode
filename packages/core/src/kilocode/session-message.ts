import { StoredToolContent } from "@opencode-ai/llm"
import { Schema } from "effect"

const decode = Schema.decodeUnknownSync(StoredToolContent)
const encodeContent = Schema.encodeUnknownSync(StoredToolContent)

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function normalize(value: unknown): unknown {
  if (!record(value)) return value
  // New readers recover the canonical summary while old readers receive recent context inline.
  if (value.type === "compaction" && typeof value.kilo_summary === "string") {
    return { ...value, summary: value.kilo_summary }
  }
  if (value.type !== "assistant" || !Array.isArray(value.content)) return value
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

export function encode(value: unknown): unknown {
  if (!record(value)) return value
  // Preserve current semantics while making released compaction rows self-contained.
  if (value.type === "compaction" && typeof value.summary === "string" && typeof value.recent === "string") {
    return {
      ...value,
      summary: [value.summary, value.recent ? `Recent context:\n${value.recent}` : ""].filter(Boolean).join("\n\n"),
      kilo_summary: value.summary,
    }
  }
  if (value.type !== "assistant" || !Array.isArray(value.content)) return value
  return {
    ...value,
    content: value.content.map((item) => {
      if (!record(item) || item.type !== "tool" || !record(item.state)) return item
      const status = item.state.status
      if (status !== "running" && status !== "completed" && status !== "error") return item
      if (!Array.isArray(item.state.content)) return item
      return { ...item, state: { ...item.state, content: item.state.content.map((entry) => encodeContent(entry)) } }
    }),
  }
}
