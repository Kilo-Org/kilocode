import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import type { MessageV2 } from "@/session/message-v2"
import { Token } from "@/util/token"
import type { ModelMessage } from "ai"

// Token.estimate undercounts provider tokenizers, especially for code and JSON payloads.
const FACTOR = 1.3
const MEDIA = "[encoded media]"
const MEDIA_TOKENS = Token.estimate(MEDIA)
const COMPACTION_BUFFER = 20_000
const DEFAULT_COMPACTION_OUTPUT_BUDGET = 8_192

type Payload = {
  messages: ModelMessage[]
  tools: Record<string, { description?: string; inputSchema?: unknown }>
}

function continued(messages: ModelMessage[]) {
  const idx = messages.findLastIndex((message) => message.role === "user")
  return messages.slice(idx + 1).some((message) => message.role === "tool")
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

  export function limit(input: { cfg: Config.Info; model: Provider.Model; usable: number }) {
    const percent = input.cfg.compaction?.threshold_percent
    if (typeof percent !== "number") return input.usable

    const context = input.model.limit.input || input.model.limit.context
    if (context === 0) return input.usable

    const cap = Math.floor(context * (percent / 100))
    return Math.min(input.usable, cap)
  }

  export function measure(input: Payload) {
    let extra = 0
    const normalized = JSON.stringify(input.messages, function (this: unknown, key, value: unknown) {
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
    const messages = Token.estimate(normalized)
    const raw = messages + extra
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
      normalized: Math.ceil((messages + tools) * FACTOR),
      raw: Math.ceil((raw + tools) * FACTOR),
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
    } & (Payload | { tokens: number; continuation: boolean }),
  ) {
    if (!enabled(input)) return false
    const stats = "tokens" in input ? input : measure(input)
    if (stats.continuation) return false
    const tokens = "tokens" in stats ? stats.tokens : stats.normalized
    return tokens >= limit(input)
  }

  export function compactionUsable(input: { cfg: Config.Info; model: Provider.Model }) {
    const context = input.model.limit.context
    if (context === 0) return 0

    const outputBudget = input.cfg.compaction?.outputBudget ?? DEFAULT_COMPACTION_OUTPUT_BUDGET
    const effectiveOutputBudget = Math.min(outputBudget, input.model.limit.output || outputBudget)
    const reserved = input.cfg.compaction?.reserved ?? Math.min(COMPACTION_BUFFER, effectiveOutputBudget)
    const needed = effectiveOutputBudget + reserved

    if (context <= needed) return context

    const inputLimit = input.model.limit.input
    return inputLimit
      ? Math.max(0, inputLimit - effectiveOutputBudget - reserved)
      : Math.max(0, context - effectiveOutputBudget - reserved)
  }
}
