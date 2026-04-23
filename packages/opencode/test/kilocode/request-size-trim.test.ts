// Regressions for KiloRequestSize.trim — aggressive tool-result trimming that
// kicks in when the accumulated payload would blow past the provider's 4MB
// request ceiling.

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
  test("leaves small payloads untouched", () => {
    const msgs: UIMessage[] = [assistant([toolPart("a", "hello"), toolPart("b", "world")])]
    const result = KiloRequestSize.trim(msgs)
    expect(result.trimmed).toBe(0)
    expect(result.messages).toBe(msgs)
  })

  test("replaces older outputs once the total exceeds the budget", () => {
    // 3 tool results at 1.5MB each = 4.5MB > 3MB LIMIT.
    const chunk = bigString(1.5 * 1024 * 1024)
    const msgs: UIMessage[] = [
      assistant([toolPart("old", chunk)]),
      assistant([toolPart("mid", chunk)]),
      assistant([toolPart("new", chunk)]),
    ]
    const result = KiloRequestSize.trim(msgs)

    expect(result.before).toBeGreaterThan(KiloRequestSize.LIMIT)
    expect(result.after).toBeLessThan(result.before)
    expect(result.trimmed).toBeGreaterThan(0)

    // Newest result must be preserved in full.
    const last = result.messages.at(-1)!.parts[0] as { output: string }
    expect(last.output).toBe(chunk)

    // Oldest result is replaced with the placeholder sentinel.
    const first = result.messages[0].parts[0] as { output: string }
    expect(first.output).toBe(KiloRequestSize.PLACEHOLDER)
  })

  test("handles object-shaped output (text + attachments)", () => {
    const chunk = bigString(2 * 1024 * 1024)
    const msgs: UIMessage[] = [
      assistant([toolPart("old", { text: chunk, attachments: [] })]),
      assistant([toolPart("new", { text: chunk, attachments: [] })]),
    ]
    const result = KiloRequestSize.trim(msgs)

    expect(result.trimmed).toBe(1)
    const first = result.messages[0].parts[0] as { output: { text: string } }
    expect(first.output).toEqual({ text: KiloRequestSize.PLACEHOLDER })
  })

  test("does not mutate the input messages", () => {
    const chunk = bigString(2 * 1024 * 1024)
    const msgs: UIMessage[] = [assistant([toolPart("a", chunk)]), assistant([toolPart("b", chunk)])]
    const snapshot = (msgs[0].parts[0] as { output: string }).output
    KiloRequestSize.trim(msgs)
    expect((msgs[0].parts[0] as { output: string }).output).toBe(snapshot)
  })

  test("ignores text parts (only tool outputs and file attachments count)", () => {
    const chunk = bigString(3.5 * 1024 * 1024)
    const msgs: UIMessage[] = [
      assistant([{ type: "text", text: chunk } as UIMessage["parts"][number]]),
      assistant([toolPart("t", "ok")]),
    ]
    const result = KiloRequestSize.trim(msgs)
    expect(result.trimmed).toBe(0)
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
    expect(oldAttachment.text).toBe(KiloRequestSize.MEDIA_PLACEHOLDER)

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

    expect(result.trimmed).toBeGreaterThan(0)
    const oldPart = result.messages[0].parts[0] as { output: { text: string; attachments: unknown[] } }
    expect(oldPart.output.text).toBe("small summary")
    expect(oldPart.output.attachments).toEqual([])

    const newPart = result.messages[1].parts[0] as { output: { attachments: Array<{ url: string }> } }
    expect(newPart.output.attachments[0].url).toBe(bigDataUrl)
  })
})
