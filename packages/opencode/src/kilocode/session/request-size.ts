// kilocode_change - new file
//
// Aggressively trim tool result outputs before they are serialized into a
// provider request. Most hosted LLM APIs reject requests larger than ~4 MB
// even when the token count would otherwise fit, so we trade older tool
// output for request success when the accumulated payload gets close to
// that limit.
//
// Per-tool truncation in `src/tool/truncate.ts` caps each individual result
// at 50 KB, but long sessions can still stack dozens of tool results plus
// attached images/pdfs and blow past the transport limit. This helper is a
// last-mile safety net: it walks the UIMessage array newest-first, keeps
// enough recent tool results under a budget, and replaces the outputs of
// older tool calls with a short placeholder that still points the agent at
// the on-disk full output if it needs to reconsult them.

import type { UIMessage } from "ai"
import { Log } from "@/util"

export namespace KiloRequestSize {
  const log = Log.create({ service: "session.request-size" })

  // Trigger aggressive trimming when the serialized tool-result payload
  // exceeds this threshold. Provider request limit is typically 4 MB; leave
  // ~1 MB headroom for system prompt, user messages, attachments, and the
  // JSON envelope itself.
  export const LIMIT = 3 * 1024 * 1024

  // Hard provider request ceiling we are defending against. Exposed so tests
  // and telemetry can reference the same constant.
  export const MAX = 4 * 1024 * 1024

  export const PLACEHOLDER =
    "[Older tool output omitted to keep the request under the 4MB provider limit. " +
    "The full output is still on disk — use Read/Grep or the Task tool on the truncation file " +
    "if you need to reconsult it.]"

  type ToolPart = UIMessage["parts"][number] & { type: `tool-${string}` }

  function isToolResult(part: UIMessage["parts"][number]): part is ToolPart {
    // UIMessage tool parts use the `tool-${name}` type prefix with a `state`
    // field; only the "output-available" state carries a populated `output`.
    return (
      typeof part.type === "string" &&
      part.type.startsWith("tool-") &&
      "state" in part &&
      (part as { state?: string }).state === "output-available"
    )
  }

  function outputBytes(output: unknown): number {
    if (output === undefined || output === null) return 0
    if (typeof output === "string") return Buffer.byteLength(output, "utf-8")
    // Object form: { text, attachments }. Only the text is cheap to trim;
    // attachments are inline data URLs that the media-stripping path in
    // message-v2 handles when appropriate. Size them via JSON so the budget
    // accounts for them.
    try {
      return Buffer.byteLength(JSON.stringify(output), "utf-8")
    } catch {
      return 0
    }
  }

  function replaceOutput(part: ToolPart): ToolPart {
    const p = part as ToolPart & { output?: unknown }
    if (typeof p.output === "object" && p.output !== null) {
      // Preserve shape so downstream `toModelOutput` still returns the
      // right variant; drop attachments too since the text is gone.
      return { ...part, output: { text: PLACEHOLDER } } as ToolPart
    }
    return { ...part, output: PLACEHOLDER } as ToolPart
  }

  /**
   * Walk tool-result parts newest-first, preserving outputs until the
   * cumulative byte total would exceed LIMIT. Replace every older tool
   * output with PLACEHOLDER.
   *
   * Returns the (possibly new) messages array plus stats. Mutates nothing
   * in place — callers get a shallow-cloned list when trimming happens and
   * the input array back when it does not.
   */
  export function trim(messages: UIMessage[]): {
    messages: UIMessage[]
    trimmed: number
    before: number
    after: number
  } {
    const refs: { msgIdx: number; partIdx: number; bytes: number }[] = []
    let total = 0
    for (let m = 0; m < messages.length; m++) {
      const msg = messages[m]
      for (let p = 0; p < msg.parts.length; p++) {
        const part = msg.parts[p]
        if (!isToolResult(part)) continue
        const bytes = outputBytes((part as { output?: unknown }).output)
        refs.push({ msgIdx: m, partIdx: p, bytes })
        total += bytes
      }
    }

    if (total <= LIMIT || refs.length === 0) {
      return { messages, trimmed: 0, before: total, after: total }
    }

    // Walk newest-first, keep until we hit the budget, mark the rest for trim.
    let kept = 0
    const trimIdx = new Set<number>()
    for (let i = refs.length - 1; i >= 0; i--) {
      const ref = refs[i]
      if (kept + ref.bytes <= LIMIT) {
        kept += ref.bytes
        continue
      }
      trimIdx.add(i)
    }

    // Clone only the messages that actually change.
    const out = messages.slice()
    const clonedMsg = new Map<number, UIMessage>()
    let trimmed = 0
    let savedBytes = 0
    for (const i of trimIdx) {
      const ref = refs[i]
      let msg = clonedMsg.get(ref.msgIdx)
      if (!msg) {
        msg = { ...out[ref.msgIdx], parts: out[ref.msgIdx].parts.slice() }
        clonedMsg.set(ref.msgIdx, msg)
        out[ref.msgIdx] = msg
      }
      msg.parts[ref.partIdx] = replaceOutput(msg.parts[ref.partIdx] as ToolPart)
      trimmed++
      savedBytes += ref.bytes
    }

    const after = total - savedBytes + trimmed * Buffer.byteLength(PLACEHOLDER, "utf-8")
    log.warn("trimmed tool outputs to fit provider request limit", {
      trimmed,
      total: refs.length,
      before: total,
      after,
    })
    return { messages: out, trimmed, before: total, after }
  }
}
