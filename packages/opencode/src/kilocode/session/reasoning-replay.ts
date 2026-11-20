import type { ProviderMetadata } from "@opencode-ai/llm"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { PartID } from "@/session/schema"
import { isRecord } from "@/util/record"

/**
 * OpenRouter's AI SDK provider attaches its live, still-accumulating
 * `openrouter.reasoning_details` array to early tool-call and reasoning-end
 * events. Later SSE chunks can append details such as `reasoning.encrypted`
 * (Gemini thought signatures) after those parts were already persisted, so the
 * stored replay state is a stale prefix. The finish-step metadata carries the
 * completed array; reconcile it into the parts of that step before the next
 * request is built from durable history.
 */
export namespace KiloReasoningReplay {
  /**
   * Completed details reported by the step, detached from the provider's live
   * array. `undefined` means the provider did not report the field, which is
   * different from an explicitly reported empty array.
   */
  export function details(meta: ProviderMetadata | undefined): unknown[] | undefined {
    const openrouter = meta?.openrouter
    if (!isRecord(openrouter)) return undefined
    const value = openrouter.reasoning_details
    if (!Array.isArray(value)) return undefined
    // JSON round-trip matches how parts are stored and drops non-JSON undefined fields.
    return JSON.parse(JSON.stringify(value))
  }

  function carries(part: SessionV1.Part): part is SessionV1.ReasoningPart | SessionV1.ToolPart {
    if (part.type === "reasoning") return true
    if (part.type !== "tool") return false
    return isRecord(part.metadata?.openrouter) && Array.isArray(part.metadata.openrouter.reasoning_details)
  }

  /**
   * Returns the parts of the latest step in `parts` that must be rewritten so
   * their replay metadata matches the completed `details`.
   *
   * Targets are the step's reasoning parts and any tool part the provider
   * attached reasoning details to (only the first tool call of a step carries
   * them). When the step produced neither, e.g. encrypted-only reasoning with a
   * text answer, a reasoning part with empty text carries the details.
   */
  export function reconcile(input: {
    parts: readonly SessionV1.Part[]
    details: unknown[]
    messageID: SessionV1.ReasoningPart["messageID"]
    sessionID: SessionV1.ReasoningPart["sessionID"]
  }): SessionV1.Part[] {
    const start = input.parts.findLastIndex((part) => part.type === "step-start")
    const targets = input.parts.slice(start + 1).filter(carries)
    if (targets.length === 0) {
      if (input.details.length === 0) return []
      const now = Date.now()
      return [
        {
          id: PartID.ascending(),
          messageID: input.messageID,
          sessionID: input.sessionID,
          type: "reasoning",
          text: "",
          time: { start: now, end: now },
          metadata: { openrouter: { reasoning_details: structuredClone(input.details) } },
        } satisfies SessionV1.ReasoningPart,
      ]
    }
    const next = JSON.stringify(input.details)
    return targets
      .filter((part) => {
        const prev = part.metadata?.openrouter?.reasoning_details
        if (prev == null) return input.details.length > 0
        return JSON.stringify(prev) !== next
      })
      .map((part) => ({
        ...part,
        metadata: {
          ...part.metadata,
          openrouter: {
            ...(isRecord(part.metadata?.openrouter) ? part.metadata.openrouter : {}),
            reasoning_details: structuredClone(input.details),
          },
        },
      }))
  }

  /**
   * `reconcile` selects parts from the read model, which strips heavy tool
   * `state.metadata` (diffs, file contents). Re-apply only the reconciled
   * top-level metadata onto the stored, unstripped part so the write-back does
   * not drop that data. A part with nothing stored is new and written as is.
   */
  export function restore(next: SessionV1.Part, stored: SessionV1.Part | undefined): SessionV1.Part {
    if (next.type !== "reasoning" && next.type !== "tool") return next
    if (stored?.type !== "reasoning" && stored?.type !== "tool") return next
    return { ...stored, metadata: next.metadata }
  }
}
