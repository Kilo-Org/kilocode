import { Effect } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { MessageV2 } from "@/session/message-v2"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { MessageID, PartID, type SessionID } from "@/session/schema"
import { KiloSessionPromptQueue } from "./prompt-queue"
// kilocode_change start - #34: import KiloSession to detect child sessions
import { KiloSession } from "./index"
// kilocode_change end

export namespace KiloSessionCompaction {
  type Store = {
    updateMessage: <T extends MessageV2.Info>(msg: T) => Effect.Effect<T>
    updatePart: <T extends MessageV2.Part>(part: T) => Effect.Effect<T>
  }

  export function create(input: {
    session: Store
    sessionID: SessionID
    agent: string
    model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
    auto: boolean
    overflow?: boolean
  }) {
    return Effect.gen(function* () {
      const msg = yield* input.session.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: { created: Date.now() },
      })
      yield* input.session.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
        overflow: input.overflow,
      })
      KiloSessionPromptQueue.retarget(input.sessionID, msg.id)
      return msg
    })
  }

  // kilocode_change start - #34: inject original task prompt into compaction continue for sub-agents
  /**
   * Maximum character length for the extracted original task text. Prevents
   * context bloat when the original task prompt is very long. Split evenly
   * between head and tail.
   */
  const ORIGINAL_TASK_MAX_CHARS = 4000

  /**
   * Keeps both ends of an over-long task: the output format requirements
   * ("Return NO_FINDINGS if…", "Output JSON…") live at the end, so a head-only
   * slice would drop exactly what the continue prompt promises to preserve.
   */
  function truncate(text: string) {
    if (text.length <= ORIGINAL_TASK_MAX_CHARS) return text
    const half = ORIGINAL_TASK_MAX_CHARS / 2
    const dropped = text.length - ORIGINAL_TASK_MAX_CHARS
    return `${text.slice(0, half)}\n[...${dropped} chars truncated...]\n${text.slice(-half)}`
  }

  /**
   * Builds a continue prompt for sub-agent sessions after compaction.
   *
   * When a sub-agent's conversation is compacted, the original Task prompt
   * (which includes output format requirements) is lost from context. This
   * causes the model to re-derive the task every turn, creating a self-
   * referential reasoning loop (#34).
   *
   * This function extracts the original task from the first non-compaction,
   * non-synthetic user message and wraps it in `<original_task>` tags so the
   * model can anchor on the real objective after compaction.
   *
   * Returns `undefined` for root sessions (which use the default continue
   * prompt) or when no original task can be found.
   */
  export function continuePrompt(input: {
    sessionID: SessionID
    messages: SessionV1.WithParts[]
    overflow?: boolean
  }): string | undefined {
    // Only apply to child (sub-agent) sessions
    const parentID = KiloSession.resolveParent(input.sessionID)
    if (!parentID) return undefined

    // Find the first non-compaction, non-synthetic user message.
    // Excluding synthetic parts prevents multi-round compaction nesting:
    // after round 1, the auto-continue message (synthetic: true) would
    // otherwise be matched and its <original_task> tag would nest inside
    // the next round's tag, causing unbounded growth (#34 remaining #2).
    const original = input.messages.find(
      (m) =>
        m.info.role === "user" &&
        !m.parts.some((p) => p.type === "compaction") &&
        !m.parts.some((p) => p.type === "text" && p.synthetic),
    )
    if (!original) return undefined

    // Extract non-synthetic, non-ignored text from the original task message
    const text = original.parts
      .filter(
        (p): p is SessionV1.TextPart =>
          p.type === "text" && !p.synthetic && !p.ignored,
      )
      .map((p) => p.text)
      .filter(Boolean)
      .join("\n")
      .trim()
    if (!text) return undefined

    // Truncate to prevent context bloat
    const truncated = truncate(text)

    const overflowPrefix = input.overflow
      ? "The previous request exceeded the provider's size limit due to large media attachments. The conversation was compacted and media files were removed from context.\n\n"
      : ""

    return `${overflowPrefix}<original_task>
${truncated}
</original_task>

You are a sub-agent whose conversation was compacted. The <original_task> above is your original assignment with its output format requirements. Do NOT reason about what the task is or infer the user's intent — execute the task directly and produce your final result now.`
  }
  // kilocode_change end
}