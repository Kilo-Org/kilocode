import type { MessageV2 } from "@/session/message-v2"

export namespace KiloMessageV2 {
  /**
   * Empty assistant text parts (left by aborted or failed streams) are rejected by
   * Anthropic when replayed. Only keep them (as a single space) when signed reasoning
   * needs the separator to preserve block positions.
   */
  export function skipEmptyText(part: MessageV2.TextPart, hasSignedReasoning: boolean) {
    return part.text === "" && !hasSignedReasoning
  }
}
