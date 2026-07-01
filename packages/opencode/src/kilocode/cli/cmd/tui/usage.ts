import type { Message } from "@kilocode/sdk/v2"

export namespace KiloTuiUsage {
  export function cost(messages: readonly Message[], fallback = 0) {
    const value = messages.reduce((sum, item) => sum + (item.role === "assistant" ? (item.cost ?? 0) : 0), 0)
    return Math.max(value, fallback)
  }

  export function stamp(messages: readonly Message[]) {
    return messages.reduce((sum, item) => {
      if (item.role !== "assistant") return sum
      return (
        sum +
        (item.cost ?? 0) +
        item.tokens.input +
        item.tokens.output +
        item.tokens.reasoning +
        item.tokens.cache.read +
        item.tokens.cache.write
      )
    }, 0)
  }
}
