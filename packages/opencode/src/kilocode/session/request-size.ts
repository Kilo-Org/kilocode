// kilocode_change - new file
//
// Trim older inline media (images/PDFs returned from tools) from a request
// when the accumulated base64 payload would push the body past the provider
// request ceiling (~4 MB for most hosted APIs).
//
// Existing layers already cap tool-result *text*:
//
//   - `src/tool/truncate.ts`    — 50 KB hard cap on every tool's text output,
//                                  full text spooled to TRUNCATION_DIR.
//   - `src/session/compaction.ts` — token-overflow-driven session compaction.
//
// Neither of those looks at attachments. A single image or PDF returned from
// a tool is embedded as a full base64 data URL — inside the tool result when
// the provider supports inline media, or as a synthetic user-message `file`
// part when it doesn't (see `toModelMessagesEffect` in session/message-v2.ts).
// That data URL can easily be multiple MB and nothing in the chain caps it,
// so a single tool call returning a screenshot is enough to blow the 4 MB
// request limit even when the token count would fit.
//
// This helper is a last-mile safety net for exactly that case: it walks all
// inlined data-URL media newest-first, keeps recent ones under a byte budget,
// and drops the older ones (replacing them with a short text placeholder so
// the surrounding message structure stays valid).

import type { UIMessage } from "ai"
import { Log } from "@/util"

export namespace KiloRequestSize {
  const log = Log.create({ service: "session.request-size" })

  // Trigger trimming when inlined media bytes exceed this threshold. Provider
  // request limit is typically 4 MB; leave ~1 MB headroom for system prompt,
  // user text, tool schemas, and the JSON envelope itself.
  export const LIMIT = 3 * 1024 * 1024

  // Hard provider request ceiling we are defending against. Exposed so tests
  // and telemetry can reference the same constant.
  export const MAX = 4 * 1024 * 1024

  // Minimum URL size worth trimming. Ignores cheap http(s) links and small
  // inline strings so we don't churn over trivia.
  const MIN_URL_BYTES = 4 * 1024

  export const PLACEHOLDER =
    "[Older attached media (image/PDF) omitted to keep the request under the 4MB provider limit.]"

  type Part = UIMessage["parts"][number]
  type ToolPart = Part & { type: `tool-${string}` }

  // A single trimmable unit. `file` is a user-message file part carrying a
  // data URL; `attachment` is an attachment inside a tool-result output
  // object of shape `{ text, attachments: [...] }`.
  type Ref =
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

  function isFile(part: Part): part is Part & { type: "file"; url: string } {
    return part.type === "file" && typeof (part as { url?: unknown }).url === "string"
  }

  function urlBytes(url: unknown): number {
    return typeof url === "string" ? Buffer.byteLength(url, "utf-8") : 0
  }

  function attachmentList(output: unknown): Array<{ url?: unknown }> {
    if (!output || typeof output !== "object") return []
    const atts = (output as { attachments?: unknown }).attachments
    return Array.isArray(atts) ? (atts as Array<{ url?: unknown }>) : []
  }

  function dropAttachment(part: ToolPart, attIdx: number): ToolPart {
    const p = part as ToolPart & { output?: { attachments?: unknown[] } }
    const out = p.output
    if (!out || typeof out !== "object") return part
    const atts = Array.isArray(out.attachments) ? out.attachments.slice() : []
    if (attIdx < 0 || attIdx >= atts.length) return part
    atts.splice(attIdx, 1)
    return { ...part, output: { ...out, attachments: atts } } as ToolPart
  }

  function replaceFile(_part: Part): Part {
    // Replace the file part with a short text note so the message body
    // stays non-empty and the agent sees why the attachment is gone.
    return { type: "text", text: PLACEHOLDER } as Part
  }

  /**
   * Walk inlined media refs newest-first, preserve entries whose cumulative
   * bytes still fit under LIMIT, and drop the rest.
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
          const atts = attachmentList((part as ToolPart & { output?: unknown }).output)
          for (let a = 0; a < atts.length; a++) {
            const bytes = urlBytes((atts[a] as { url?: unknown }).url)
            if (bytes < MIN_URL_BYTES) continue
            refs.push({ kind: "attachment", msgIdx: m, partIdx: p, attIdx: a, bytes })
            total += bytes
          }
          continue
        }
        if (isFile(part)) {
          const bytes = urlBytes((part as { url?: unknown }).url)
          if (bytes < MIN_URL_BYTES) continue
          refs.push({ kind: "file", msgIdx: m, partIdx: p, bytes })
          total += bytes
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

    // Clone only the messages (and their parts) we actually modify.
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

    // Drop attachments highest-attIdx-first within each tool-result part so
    // the indices we recorded remain valid during mutation.
    const byPart = new Map<string, number[]>()
    for (const i of trimIdx) {
      const ref = refs[i]
      if (ref.kind !== "attachment") continue
      const key = `${ref.msgIdx}:${ref.partIdx}`
      const list = byPart.get(key) ?? []
      list.push(ref.attIdx)
      byPart.set(key, list)
    }
    for (const [key, indices] of byPart) {
      const [msgIdx, partIdx] = key.split(":").map(Number)
      const msg = ensure(msgIdx)
      let part = msg.parts[partIdx] as ToolPart
      for (const a of indices.sort((x, y) => y - x)) part = dropAttachment(part, a)
      msg.parts[partIdx] = part
    }

    let trimmed = 0
    let savedBytes = 0
    for (const i of trimIdx) {
      const ref = refs[i]
      savedBytes += ref.bytes
      trimmed++
      if (ref.kind === "file") {
        const msg = ensure(ref.msgIdx)
        msg.parts[ref.partIdx] = replaceFile(msg.parts[ref.partIdx])
      }
    }

    const fileTrims = Array.from(trimIdx).filter((i) => refs[i].kind === "file").length
    const after = total - savedBytes + fileTrims * Buffer.byteLength(PLACEHOLDER, "utf-8")
    log.warn("trimmed inline media to fit provider request limit", {
      trimmed,
      total: refs.length,
      before: total,
      after,
    })
    return { messages: out, trimmed, before: total, after }
  }
}
