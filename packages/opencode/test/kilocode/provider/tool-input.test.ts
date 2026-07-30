import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { ModelMessage } from "ai"
import { KiloToolInput } from "@/kilocode/provider/tool-input"
import { LLMAISDK } from "@/session/llm/ai-sdk"

describe("KiloToolInput", () => {
  test("defaults missing streamed tool input to an empty object", () => {
    expect(KiloToolInput.normalize(undefined)).toEqual({})
    expect(KiloToolInput.normalize(null)).toEqual({})
  })

  test("repairs a streamed tool call before it reaches session processing", async () => {
    type AdapterEvent = Parameters<typeof LLMAISDK.toLLMEvents>[1]
    const event = {
      type: "tool-call",
      toolCallId: "call-missing-input",
      toolName: "bash",
      input: undefined,
    } as unknown as AdapterEvent

    const events = await Effect.runPromise(LLMAISDK.toLLMEvents(LLMAISDK.adapterState(), event))

    expect(events).toEqual([
      {
        type: "tool-call",
        id: "call-missing-input",
        name: "bash",
        input: {},
        providerExecuted: undefined,
        providerMetadata: undefined,
      },
    ])
  })

  test("repairs missing tool input in replayed assistant messages", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: undefined,
          },
        ],
      },
    ] as unknown as ModelMessage[]

    const normalized = KiloToolInput.normalizeMessages(messages)
    const assistant = normalized[0]
    if (assistant.role !== "assistant" || !Array.isArray(assistant.content)) throw new Error("expected assistant")
    const toolCall = assistant.content[0]
    if (toolCall.type !== "tool-call") throw new Error("expected tool call")

    expect(toolCall.input).toEqual({})
    expect(() => JSON.stringify(toolCall.input).slice(1, -1)).not.toThrow()
  })

  test("preserves valid tool input and non-tool messages", () => {
    const input = { command: "pwd" }
    const messages: ModelMessage[] = [
      { role: "user", content: "run pwd" },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call-1", toolName: "bash", input }],
      },
    ]

    const normalized = KiloToolInput.normalizeMessages(messages)

    expect(normalized[0]).toBe(messages[0])
    expect(normalized[1]).toBe(messages[1])
    const original = messages[1]
    if (original.role !== "assistant" || !Array.isArray(original.content)) throw new Error("expected assistant")
    const assistant = normalized[1]
    if (assistant.role !== "assistant" || !Array.isArray(assistant.content)) throw new Error("expected assistant")
    expect(assistant.content[0]).toBe(original.content[0])
  })
})
