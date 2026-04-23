// kilocode_change - new file
//
// Aggressively trim tool result outputs and inlined media attachments before
// they are serialized into a provider request. Most hosted LLM APIs reject
// requests larger than ~4 MB even when the token count would otherwise fit,
// so we trade older tool output and older attachments for request success
// when the accumulated payload gets close to that limit.
//
// Per-tool truncation in `src/tool/truncate.ts` caps each individual result
// at 50 KB, but two things routinely punch through the transport ceiling:
//
//   1. Dozens of 50 KB tool outputs stacked across a long session.
//   2. A single image/PDF returned from a tool — the synthetic user-message
//      attachment shim in `toModelMessagesEffect` embeds a full base64 data
//      URL, which can easily be multiple MB per attachment.
//
// This helper is a last-mile safety net: it walks tool outputs and media
// attachments newest-first, keeps the newest ones under a budget, and
// replaces older ones with a short placeholder. Tool outputs are still on
// disk (via `Truncate.write`), so the agent can reconsult them with Read
// or Grep if it needs to.

import type { UIMessage } from "ai"
import { Log } from "@/util"

export namespace KiloRequestSize {
  const log = Log.create({ service: "session.request-size" })

  // Trigger aggressive trimming when the serialized tool-result payload
  // exceeds this threshold. Provider request limit is typically 4 MB; leave
  // ~1 MB headroom for system prompt, user messages, and the JSON envelope.
  export const LIMIT = 3 * 1024 * 1024

  // Hard provider request ceiling we are defending against. Exposed so tests
  // and telemetry can reference the same constant.
  export const MAX = 4 * 1024 * 1024

  export const PLACEHOLDER =
    "[Older tool output omitted to keep the request under the 4MB provider limit. " +
    "The full output is still on disk — use Read/Grep or the Task tool on the truncation file " +
    "if you need to reconsult it.]"

  export const MEDIA_PLACEHOLDER =
    "[Older attached media (image/PDF) omitted to keep the request under the 4MB provider limit.]"

  type Part = UIMessage["parts"][number]
  type ToolPart = Part & { type: `tool-${string}` }

  // A single trimmable unit — either a tool-result payload or a standalone
  // file/attachment with an inlined data URL.
  type Ref =
    | { kind: "tool"; msgIdx: number; partIdx: number; bytes: number }
    | { kind: "file"; msgIdx: number; partIdx: number; bytes: number }
    | { kind: "attachment"; msgIdx: number; partIdx: number; attIdx: number; bytes: number }

  function isToolResult(part: Part): part is ToolPart {
    return (
      typeof part.type === "string" &&
      part.type.startsWith("tool-") &&
      "state" in part &&
      (part as { state?: string }).state === "output-available"
    )
  }

  function isFile(part: Part): part is Part & { type: "file"; url: string; mediaType?: string } {
    return part.type === "file" && typeof (part as { url?: unknown }).url === "string"
  }

  function byteLen(s: string): number {
    return Buffer.byteLength(s, "utf-8")
  }

  function urlBytes(url: unknown): number {
    if (typeof url !== "string") return 0
    // Data URLs are the expensive case; http(s) URLs are cheap and rare.
    return byteLen(url)
  }

  function outputBytes(output: unknown): number {
    if (output === undefined || output === null) return 0
    if (typeof output === "string") return byteLen(output)
    try {
      return byteLen(JSON.stringify(output))
    } catch {
      return 0
    }
  }

  function attachmentList(output: unknown): Array<{ url?: unknown }> {
    if (!output || typeof output !== "object") return []
    const atts = (output as { attachments?: unknown }).attachments
    return Array.isArray(atts) ? (atts as Array<{ url?: unknown }>) : []
  }

  function replaceToolOutput(part: ToolPart): ToolPart {
    const out = (part as ToolPart & { output?: unknown }).output
    if (typeof out === "object" && out !== null) {
      return { ...part, output: { text: PLACEHOLDER } } as ToolPart
    }
    return { ...part, output: PLACEHOLDER } as ToolPart
  }

  function replaceToolAttachment(part: ToolPart, attIdx: number): ToolPart {
    const p = part as ToolPart & { output?: { text?: unknown; attachments?: Array<unknown> } }
    const out = p.output
    if (!out || typeof out !== "object") return part
    const atts = Array.isArray(out.attachments) ? out.attachments.slice() : []
    if (attIdx < 0 || attIdx >= atts.length) return part
    // Drop the attachment entirely; cheaper than keeping a stub with metadata.
    atts.splice(attIdx, 1)
    const nextOutput = { ...out, attachments: atts }
    return { ...part, output: nextOutput } as ToolPart
  }

  function replaceFilePart(_part: Part): Part {
    // Replace the file part with a short text note in its place.
    return { type: "text", text: MEDIA_PLACEHOLDER } as Part
  }

  /**
   * Walk tool-result and file parts newest-first, preserving outputs until
   * the cumulative byte total would exceed LIMIT. Replace everything older
   * with PLACEHOLDER / MEDIA_PLACEHOLDER.
   *
   * Returns a (possibly new) messages array plus stats. Mutates nothing in
   * place — callers get a shallow-cloned list when trimming happens and the
   * input array back when it does not.
   */
  export function trim(messages: UIMessage[]): {
    messages: UIMessage[]
    trimmed: number
    before: number
    after: number
  } {
    const refs: Ref[] = []
    let total = 0
    for (let m = 0; m < messages.length; m++) {
      const msg = messages[m]
      for (let p = 0; p < msg.parts.length; p++) {
        const part = msg.parts[p]
        if (isToolResult(part)) {
          const out = (part as ToolPart & { output?: unknown }).output
          // Size the text portion of the output separately from each
          // attachment so we can trim attachments independently of text.
          const atts = attachmentList(out)
          if (atts.length > 0) {
            const textOnly =
              typeof out === "object" && out !== null
                ? outputBytes({ ...(out as object), attachments: [] })
                : outputBytes(out)
            refs.push({ kind: "tool", msgIdx: m, partIdx: p, bytes: textOnly })
            total += textOnly
            for (let a = 0; a < atts.length; a++) {
              const bytes = urlBytes((atts[a] as { url?: unknown }).url)
              refs.push({ kind: "attachment", msgIdx: m, partIdx: p, attIdx: a, bytes })
              total += bytes
            }
          } else {
            const bytes = outputBytes(out)
            refs.push({ kind: "tool", msgIdx: m, partIdx: p, bytes })
            total += bytes
          }
          continue
        }
        if (isFile(part)) {
          const bytes = urlBytes((part as { url?: unknown }).url)
          // Cheap text/http links aren't worth trimming individually.
          if (bytes >= 4 * 1024) {
            refs.push({ kind: "file", msgIdx: m, partIdx: p, bytes })
            total += bytes
          }
        }
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

    // Clone only the messages (and their parts) that actually change.
    const out = messages.slice()
    const clonedMsg = new Map<number, UIMessage>()
    const ensure = (idx: number) => {
      let msg = clonedMsg.get(idx)
      if (msg) return msg
      msg = { ...out[idx], parts: out[idx].parts.slice() }
      clonedMsg.set(idx, msg)
      out[idx] = msg
      return msg
    }

    // Process attachment trims first so attIdx stays valid within each part
    // (do it per-part, highest-attIdx-first).
    const attachmentTrims = new Map<string, number[]>()
    for (const i of trimIdx) {
      const ref = refs[i]
      if (ref.kind !== "attachment") continue
      const key = `${ref.msgIdx}:${ref.partIdx}`
      const list = attachmentTrims.get(key) ?? []
      list.push(ref.attIdx)
      attachmentTrims.set(key, list)
    }
    for (const [key, indices] of attachmentTrims) {
      const [msgIdx, partIdx] = key.split(":").map(Number)
      const msg = ensure(msgIdx)
      let part = msg.parts[partIdx] as ToolPart
      for (const a of indices.sort((x, y) => y - x)) {
        part = replaceToolAttachment(part, a)
      }
      msg.parts[partIdx] = part
    }

    // Then tool-output and file trims.
    let trimmed = 0
    let savedBytes = 0
    for (const i of trimIdx) {
      const ref = refs[i]
      savedBytes += ref.bytes
      trimmed++
      if (ref.kind === "attachment") continue
      const msg = ensure(ref.msgIdx)
      if (ref.kind === "tool") {
        msg.parts[ref.partIdx] = replaceToolOutput(msg.parts[ref.partIdx] as ToolPart)
      } else {
        msg.parts[ref.partIdx] = replaceFilePart(msg.parts[ref.partIdx])
      }
    }

    const placeholderBytes =
      byteLen(PLACEHOLDER) *
        Array.from(trimIdx).filter((i) => refs[i].kind === "tool" || refs[i].kind === "file").length +
      byteLen(MEDIA_PLACEHOLDER) * Array.from(trimIdx).filter((i) => refs[i].kind === "file").length
    const after = total - savedBytes + placeholderBytes
    log.warn("trimmed request payload to fit provider limit", {
      trimmed,
      total: refs.length,
      before: total,
      after,
    })
    return { messages: out, trimmed, before: total, after }
  }
}
