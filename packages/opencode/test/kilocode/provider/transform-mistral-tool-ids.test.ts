import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "@/provider/transform"

const model = (id = "mistral-large-4-nvfp4") =>
  ({
    id: `custom/${id}`,
    providerID: "custom",
    api: { id, url: "https://example.com/v1", npm: "@ai-sdk/openai-compatible" },
  }) as any

const call = (id: string) => ({
  role: "assistant",
  content: [{ type: "tool-call", toolCallId: id, toolName: "read", input: { filePath: "/tmp/a" } }],
})

const result = (id: string) => ({
  role: "tool",
  content: [{ type: "tool-result", toolCallId: id, toolName: "read", output: { type: "text", value: "ok" } }],
})

const normalise = (msgs: any[], target: any = model()) => {
  const out = ProviderTransform.message(msgs, target, {}) as any[]
  return out.flatMap((msg) => msg.content.map((part: any) => part.toolCallId).filter((id: any) => id != null))
}

describe("ProviderTransform.message - Mistral tool call ids", () => {
  test("ids that only differ past the truncation point stay distinct", () => {
    const ids = normalise([
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "chatcmpl-tool-aaaaaaaa", toolName: "read", input: {} },
          { type: "tool-call", toolCallId: "chatcmpl-tool-bbbbbbbb", toolName: "read", input: {} },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "chatcmpl-tool-aaaaaaaa",
            toolName: "read",
            output: { type: "text", value: "a" },
          },
          {
            type: "tool-result",
            toolCallId: "chatcmpl-tool-bbbbbbbb",
            toolName: "read",
            output: { type: "text", value: "b" },
          },
        ],
      },
    ])

    expect(new Set(ids).size).toBe(2)
    expect(ids.slice(2)).toEqual(ids.slice(0, 2))
  })

  test("each id keeps one normalised value across the request", () => {
    const ids = normalise([
      call("call_abc-123"),
      result("call_abc-123"),
      call("call_abc-123-other"),
      result("call_abc-123-other"),
    ])

    expect(ids[0]).toBe(ids[1])
    expect(ids[2]).toBe(ids[3])
    expect(ids[0]).not.toBe(ids[2])
  })

  test("a single id keeps the nine character form", () => {
    const ids = normalise([call("toolu_01CBhTTz95qkd9LJMdC9sf8t"), result("toolu_01CBhTTz95qkd9LJMdC9sf8t")])

    expect(ids[0]).toBe("toolu01CB")
    expect(ids[1]).toBe("toolu01CB")
  })

  test("short ids keep the zero padding", () => {
    const ids = normalise([call("abc"), result("abc")])

    expect(ids[0]).toBe("abc000000")
  })

  test("normalised ids keep the length the API expects", () => {
    const ids = normalise([call("chatcmpl-tool-aaaaaaaa"), call("chatcmpl-tool-bbbbbbbb")])

    expect(ids.map((id) => id.length)).toEqual([9, 9])
  })

  test("the mistral provider normalises the same way", () => {
    const ids = normalise([call("chatcmpl-tool-aaaaaaaa"), call("chatcmpl-tool-bbbbbbbb")], {
      id: "mistral/mistral-large-latest",
      providerID: "mistral",
      api: { id: "mistral-large-latest", url: "https://api.mistral.ai/v1", npm: "@ai-sdk/mistral" },
    } as any)

    expect(new Set(ids).size).toBe(2)
    expect(new Set(ids.map((id) => id.length))).toEqual(new Set([9]))
  })
})
