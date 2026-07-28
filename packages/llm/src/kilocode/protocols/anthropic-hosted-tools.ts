// kilocode_change - new file
// Provider-hosted (server-side) tool definitions for the Anthropic Messages
// protocol. The Anthropic lowering layer (packages/llm/src/protocols/anthropic-messages.ts)
// calls into this mirror so Kilo-specific hosted-tool wiring stays out of the
// shared upstream protocol file and minimizes merge conflicts.
//
// A ToolDefinition opts into a hosted tool by setting `native.anthropic` to the
// provider-native body fragment. lowerHostedTool returns that fragment when it
// recognizes the shape, otherwise undefined so the caller falls back to the
// client tool shape.
//
// Adding a hosted tool: append an entry to HOSTED_TOOLS keyed by the wire
// `type` and return the trimmed body fragment Anthropic expects.

import type { ToolDefinition } from "../../schema"
import { isRecord } from "../../utils/record"

const trim = (value: unknown): unknown => {
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    const entry = value[key]
    if (entry === undefined) continue
    if (Array.isArray(entry) && entry.length === 0) continue
    out[key] = entry
  }
  return out
}

type AnthropicHostedHandler = (native: Record<string, unknown>) => unknown

const HOSTED_TOOLS: Record<string, AnthropicHostedHandler> = {
  web_search_20250305: (native) => trim({ ...native, name: native.name }),
  web_search_20260209: (native) => trim({ ...native, name: native.name }),
}

export const lowerHostedTool = (tool: ToolDefinition): unknown => {
  const anthropic = tool.native?.["anthropic"]
  if (!isRecord(anthropic)) return undefined
  const type = typeof anthropic.type === "string" ? anthropic.type : undefined
  if (!type) return undefined
  const handle = HOSTED_TOOLS[type]
  if (!handle) return undefined
  return handle(anthropic)
}

export const identification = "@opencode/llm/kilocode/anthropic-hosted-tools"
