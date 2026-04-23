// Regressions for KiloRequestSize.trim — inline-media trimming that kicks
// in when the accumulated base64 data-URL payload would blow past the
// provider's 4MB request ceiling. Tool-result text is already capped by
// truncate.ts and managed by compaction, so this helper only touches
// attachments.

import { describe, expect, test } from "bun:test"
import type { UIMessage } from "ai"
import { KiloRequestSize } from "../../src/kilocode/session/request-size"

function bigString(bytes: number): string {
  return "x".repeat(bytes)
}

function assistant(parts: UIMessage["parts"]): UIMessage {
  return { id: `m_${Math.random().toString(36).slice(2)}`, role: "assistant", parts }
}

function toolPart(id: string, output: unknown): UIMessage["parts"][number] {
  return {
    type: "tool-bash",
    state: "output-available",
    toolCallId: id,
    input: {},
    output,
  } as UIMessage["parts"][number]
}

describe("KiloRequestSize.trim", () => {
  test("leaves payloads without inline media untouched", () => {
    const msgs: UIMessage[] = [assistant([toolPart("a", "hello"), toolPart("b", bigString(4 * 1024 * 1024))])]
    const result = KiloRequestSize.trim(msgs)
    // Tool-result text is handled by truncate.ts + compaction; this helper ignores it.
    expect(result.trimmed).toBe(0)
    expect(result.messages).toBe(msgs)
  })

  test("trims older inline-data-URL file attachments (synthetic media user message)", () => {
    // Mimics the synthetic user message toModelMessagesEffect injects for
    // providers that can't accept media inside tool results.
    const bigDataUrl = "data:image/png;base64," + bigString(2.5 * 1024 * 1024)
    const synthetic = (url: string): UIMessage => ({
      id: `u_${Math.random().toString(36).slice(2)}`,
      role: "user",
      parts: [
        { type: "text", text: "Attached image(s) from tool result:" } as UIMessage["parts"][number],
        { type: "file", url, mediaType: "image/png" } as UIMessage["parts"][number],
      ],
    })
    const msgs: UIMessage[] = [synthetic(bigDataUrl), synthetic(bigDataUrl)]
    const result = KiloRequestSize.trim(msgs)

    expect(result.before).toBeGreaterThan(KiloRequestSize.LIMIT)
    expect(result.trimmed).toBe(1)

    const oldAttachment = result.messages[0].parts[1] as { type: string; text?: string }
    expect(oldAttachment.type).toBe("text")
    expect(oldAttachment.text).toBe(KiloRequestSize.PLACEHOLDER)

    const newAttachment = result.messages[1].parts[1] as { type: string; url?: string }
    expect(newAttachment.type).toBe("file")
    expect(newAttachment.url).toBe(bigDataUrl)
  })

  test("trims older tool-result attachments without nuking the text", () => {
    const bigDataUrl = "data:image/png;base64," + bigString(2.5 * 1024 * 1024)
    const msgs: UIMessage[] = [
      assistant([toolPart("old", { text: "small summary", attachments: [{ mime: "image/png", url: bigDataUrl }] })]),
      assistant([toolPart("new", { text: "small summary", attachments: [{ mime: "image/png", url: bigDataUrl }] })]),
    ]
    const result = KiloRequestSize.trim(msgs)

    expect(result.trimmed).toBe(1)
    const oldPart = result.messages[0].parts[0] as { output: { text: string; attachments: unknown[] } }
    // Text summary kept, only the heavy attachment dropped.
    expect(oldPart.output.text).toBe("small summary")
    expect(oldPart.output.attachments).toEqual([])

    const newPart = result.messages[1].parts[0] as { output: { attachments: Array<{ url: string }> } }
    expect(newPart.output.attachments[0].url).toBe(bigDataUrl)
  })

  test("ignores small URLs below the trim threshold", () => {
    const msgs: UIMessage[] = [
      assistant([
        toolPart("a", { text: "ok", attachments: [{ mime: "image/png", url: "https://example.com/x.png" }] }),
      ]),
    ]
    const result = KiloRequestSize.trim(msgs)
    expect(result.before).toBe(0)
    expect(result.trimmed).toBe(0)
  })

  test("does not mutate the input messages", () => {
    const bigDataUrl = "data:image/png;base64," + bigString(2.5 * 1024 * 1024)
    const msgs: UIMessage[] = [
      assistant([toolPart("a", { text: "s", attachments: [{ mime: "image/png", url: bigDataUrl }] })]),
      assistant([toolPart("b", { text: "s", attachments: [{ mime: "image/png", url: bigDataUrl }] })]),
    ]
    const before = (msgs[0].parts[0] as { output: { attachments: Array<{ url: string }> } }).output.attachments[0].url
    KiloRequestSize.trim(msgs)
    expect((msgs[0].parts[0] as { output: { attachments: Array<{ url: string }> } }).output.attachments[0].url).toBe(
      before,
    )
  })
})
