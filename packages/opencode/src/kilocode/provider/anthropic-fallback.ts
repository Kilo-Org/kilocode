import type { MessageV2 } from "@/session/message-v2"

export namespace AnthropicFallback {
  // V6 has no assistant custom part. Match Anthropic's compaction metadata carrier.
  export function marker(metadata?: Record<string, unknown>) {
    const value = metadata?.anthropic
    return typeof value === "object" && value !== null && "type" in value && value.type === "fallback"
  }

  export function stored(part: MessageV2.Part): part is MessageV2.TextPart & { text: "" } {
    return part.type === "text" && part.text === "" && marker(part.metadata)
  }

  export function finish(part: MessageV2.TextPart) {
    if (!stored(part)) return undefined
    return { ...part, time: { start: part.time?.start ?? Date.now(), end: Date.now() } }
  }
}
