import type { ModelMessage } from "ai"

// @ai-sdk/openai-compatible stores a Gemini thought_signature under its own provider key
// (providerOptionsName, e.g. "litellm") but only reads it back from providerOptions.google
// when replaying tool calls. Copy it across so Gemini behind a custom provider id round-trips.
export function replayThoughtSignature(msgs: ModelMessage[], providerID: string): ModelMessage[] {
  const key = providerID.split(".")[0].trim()
  if (key === "google") return msgs
  return msgs.map((msg) => {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) return msg
    return {
      ...msg,
      content: msg.content.map((part) => {
        if (part.type !== "tool-call") return part
        const sig = part.providerOptions?.[key]?.thoughtSignature
        if (typeof sig !== "string" || !sig) return part
        if (part.providerOptions?.google?.thoughtSignature) return part
        return {
          ...part,
          providerOptions: {
            ...part.providerOptions,
            google: { ...part.providerOptions?.google, thoughtSignature: sig },
          },
        }
      }),
    }
  }) as ModelMessage[]
}
