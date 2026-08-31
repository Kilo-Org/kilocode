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
    // Providers replay encrypted reasoning state as an opaque continuation value.
    // Its encoded byte length is not a token count and can be several times larger
    // than the context the provider reports for the same request.
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

  // The provider report covers only the request that produced the finished assistant.
  // When an unfinished (cancelled or errored) assistant trails it, the payload holds
  // content that report never saw — tool results and partial text generated after it —
  // and the tail estimate cannot see them either, since it starts after the last
  // serialized assistant. Dropping the baseline makes the full estimate decide alone.
  export function baseline(input: {
    assistant?: { id: string }
    finished?: { id: string; summary?: boolean; tokens: MessageV2.Assistant["tokens"] }
  }) {
    if (!input.finished || input.finished.summary === true) return undefined
    if (input.assistant?.id !== input.finished.id) return undefined
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

  export function measure(input: Payload) {
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
    return {
      normalized: Math.ceil((full.chars + tools) * FACTOR),
      raw: Math.ceil((full.chars + full.extra + tools) * FACTOR),
      tail: Math.ceil(size(pending(input.messages)).chars * FACTOR),
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
    } & (Payload | { tokens: number; tail: number; continuation: boolean }),
  ) {
    if (!enabled(input)) return false
    const stats = "tokens" in input ? input : measure(input)
    if (stats.continuation) return false
    // With a provider baseline from the last finished turn, project the next request as
    // that report plus conservatively-inflated content added since it. Without one, the
    // full outgoing estimate decides alone. A failed or usage-less prior report is not
    // a baseline; the estimate covers it.
    const baseline = input.reported ? input.reported + stats.tail : undefined
    const projected = baseline ?? ("tokens" in stats ? stats.tokens : stats.normalized)
    return projected >= limit(input)
  }
}
