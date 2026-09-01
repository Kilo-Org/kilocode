import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import type { MessageV2 } from "@/session/message-v2"
import { Token } from "@/util/token"
import type { ModelMessage } from "ai"

// Token.estimate undercounts provider tokenizers, especially for code and JSON payloads.
const FACTOR = 1.3
const MEDIA = "[encoded media]"
const MEDIA_TOKENS = Token.estimate(MEDIA)
const OPAQUE = "[opaque reasoning state]"
const OPAQUE_TOKENS = Token.estimate(OPAQUE)

type Payload = {
  messages: ModelMessage[]
  tools: Record<string, { description?: string; inputSchema?: unknown }>
}

function continued(messages: ModelMessage[]) {
  const idx = messages.findLastIndex((message) => message.role === "user")
  return messages.slice(idx + 1).some((message) => message.role === "tool")
}

function size(messages: ModelMessage[]) {
  let extra = 0
  const json = JSON.stringify(messages, function (this: unknown, key, value: unknown) {
    // Encrypted reasoning replays as an opaque value; its byte length is not a token count.
    if (key === "reasoningEncryptedContent" && typeof value === "string") {
      extra += Math.max(0, Token.estimate(value) - OPAQUE_TOKENS)
      return OPAQUE
    }
    if (!["data", "url", "image"].includes(key)) return value
    if (!this || typeof this !== "object" || !("type" in this)) return value
    if (!["file", "image", "media"].includes(String(this.type))) return value
    const tokens =
      value instanceof Uint8Array
        ? Math.ceil(value.byteLength / 4)
        : Token.estimate(typeof value === "string" ? value : (JSON.stringify(value) ?? ""))
    extra += Math.max(0, tokens - MEDIA_TOKENS)
    return MEDIA
  })
  return { chars: Token.estimate(json), extra }
}

function pending(messages: ModelMessage[]) {
  const idx = messages.findLastIndex((message) => message.role === "assistant")
  return messages.slice(idx + 1)
}

// System content prepended in front of the payload, e.g. provider-specific
// instructions carried as a system message instead of a separate field.
function leading(messages: ModelMessage[]) {
  let chars = 0
  for (const message of messages) {
    if (message.role !== "system") break
    chars += Token.estimate(
      typeof message.content === "string" ? message.content : (JSON.stringify(message.content) ?? ""),
    )
  }
  return chars
}

export namespace KiloSessionOverflow {
  export class PreflightError extends Error {
    constructor() {
      super("Outgoing context reached the automatic compaction threshold")
      this.name = "PreflightCompactionError"
    }
  }

  export function count(tokens: MessageV2.Assistant["tokens"]) {
    const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
    return total || tokens.total || 0
  }

  // The estimate decides alone when the report would under-count: an unfinished
  // assistant trails the finished one, or the report lacks prompt-side usage.
  export function baseline(input: {
    assistant?: { id: string }
    finished?: { id: string; summary?: boolean; tokens: MessageV2.Assistant["tokens"] }
  }) {
    if (!input.finished || input.finished.summary === true) return undefined
    if (input.assistant?.id !== input.finished.id) return undefined
    const t = input.finished.tokens
    if (t.input + t.cache.read + t.cache.write === 0) return undefined
    return count(input.finished.tokens)
  }

  export function limit(input: { cfg: Config.Info; model: Provider.Model; usable: number }) {
    const percent = input.cfg.compaction?.threshold_percent
    if (typeof percent !== "number") return input.usable

    const context = input.model.limit.context
    if (context === 0) return input.usable

    const cap = Math.floor(context * (percent / 100))
    return Math.min(input.usable, cap)
  }

  export function measure(input: Payload & { system?: string }) {
    const full = size(input.messages)
    const tools = Token.estimate(
      JSON.stringify(
        Object.entries(input.tools).map(([name, tool]) => ({
          name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      ),
    )
    const lead = leading(input.messages)
    const fixed = Token.estimate(input.system ?? "")
    return {
      normalized: Math.ceil((full.chars + tools + fixed) * FACTOR),
      raw: Math.ceil((full.chars + full.extra + tools + fixed) * FACTOR),
      // New messages only; the report already covers the rest of the previous request.
      tail: Math.ceil(size(pending(input.messages)).chars * FACTOR),
      // System content and tool schemas are re-sent every request and may have changed
      // since the report. Adding them in full double-counts unchanged copies - bounded
      // over-projection, never an under-count that bypasses the threshold. Leading
      // system messages already sit inside full.chars, so only the system string joins.
      overhead: Math.ceil((tools + fixed + lead) * FACTOR),
      continuation: continued(input.messages),
    }
  }

  export function enabled(input: { cfg: Config.Info; model: Provider.Model }) {
    return (
      input.cfg.compaction?.auto !== false &&
      typeof input.cfg.compaction?.threshold_percent === "number" &&
      input.model.limit.context !== 0
    )
  }

  export function shouldCompact(
    input: {
      cfg: Config.Info
      model: Provider.Model
      usable: number
      reported?: number
    } & (Payload & { system?: string } | { tokens: number; tail: number; overhead?: number; continuation: boolean }),
  ) {
    if (!enabled(input)) return false
    const stats = "tokens" in input ? input : measure(input)
    if (stats.continuation) return false
    // Baseline = report plus inflated content added since it (messages, system, tools).
    // Without a usable report the full estimate decides alone.
    const baseline = input.reported ? input.reported + stats.tail + (stats.overhead ?? 0) : undefined
    const projected = baseline ?? ("tokens" in stats ? stats.tokens : stats.normalized)
    return projected >= limit(input)
  }
}
