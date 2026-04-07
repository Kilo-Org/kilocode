import { describe, expect, test } from "bun:test"
import { bridgeMessages } from "../../src/devilcode/agent-sdk-bridge"

// ── Helpers ────────────────────────────────────────────────────────

/** Yield items from an array as an async iterable. */
async function* toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item
  }
}

/** Collect all events from a ReadableStream into an array. */
async function collect<T>(stream: ReadableStream<T> & AsyncIterable<T>): Promise<T[]> {
  const items: T[] = []
  for await (const item of stream) {
    items.push(item)
  }
  return items
}

/** Extract only the `type` field from each event. */
function types(events: { type: string }[]): string[] {
  return events.map((e) => e.type)
}

// ── Fixtures ───────────────────────────────────────────────────────

function assistantText(text: string, uuid = "msg-1") {
  return {
    type: "assistant",
    uuid,
    session_id: "sess-1",
    message: {
      content: [{ type: "text", text }],
      usage: { input_tokens: 100, output_tokens: 50 },
      stop_reason: "end_turn",
    },
  }
}

function assistantThinking(thinking: string, uuid = "msg-think") {
  return {
    type: "assistant",
    uuid,
    session_id: "sess-1",
    message: {
      content: [{ type: "thinking", thinking }],
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  }
}

function assistantToolUse(id: string, name: string, input: unknown, uuid = "msg-tool") {
  return {
    type: "assistant",
    uuid,
    session_id: "sess-1",
    message: {
      content: [{ type: "tool_use", id, name, input }],
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  }
}

function syntheticToolResult(toolUseId: string, content: unknown) {
  return {
    type: "user",
    isSynthetic: true,
    message: {
      content: [{ type: "tool_result", tool_use_id: toolUseId, content }],
    },
  }
}

function resultSuccess(usage: Record<string, number> = { input_tokens: 200, output_tokens: 100 }) {
  return {
    type: "result",
    subtype: "success",
    usage,
    total_cost_usd: 0.01,
  }
}

function resultError(errors: string[] = ["Something went wrong"]) {
  return {
    type: "result",
    subtype: "error_max_turns",
    usage: { input_tokens: 200, output_tokens: 100 },
    errors,
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe("agent-sdk-bridge", () => {
  describe("text event mapping", () => {
    test("assistant with text produces text-start, text-delta, text-end events", async () => {
      const messages = toAsyncIterable([assistantText("Hello, world!"), resultSuccess()])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)
      const eventTypes = types(events as { type: string }[])

      expect(eventTypes).toContain("start")
      expect(eventTypes).toContain("start-step")
      expect(eventTypes).toContain("text-start")
      expect(eventTypes).toContain("text-delta")
      expect(eventTypes).toContain("text-end")
      expect(eventTypes).toContain("finish-step")

      const textDelta = events.find((e: any) => e.type === "text-delta") as any
      expect(textDelta.text).toBe("Hello, world!")
    })

    test("text promise resolves to accumulated text", async () => {
      const messages = toAsyncIterable([assistantText("Hello, world!"), resultSuccess()])
      const output = bridgeMessages(messages)
      // Consume fullStream to drive the processing
      await collect(output.fullStream)
      const text = await output.text
      expect(text).toBe("Hello, world!")
    })

    test("textStream yields text content", async () => {
      const messages = toAsyncIterable([assistantText("Hello, world!"), resultSuccess()])
      const output = bridgeMessages(messages)
      // Must consume fullStream in parallel to drive the bridge
      const [textChunks] = await Promise.all([collect(output.textStream), collect(output.fullStream)])
      expect(textChunks).toContain("Hello, world!")
    })

    test("empty text body is skipped", async () => {
      const messages = toAsyncIterable([assistantText(""), resultSuccess()])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)
      const eventTypes = types(events as { type: string }[])

      expect(eventTypes).not.toContain("text-start")
      expect(eventTypes).not.toContain("text-delta")
      expect(eventTypes).not.toContain("text-end")
    })
  })

  describe("thinking event mapping", () => {
    test("assistant with thinking produces reasoning-start, reasoning-delta, reasoning-end events", async () => {
      const messages = toAsyncIterable([assistantThinking("Let me think about this..."), resultSuccess()])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)
      const eventTypes = types(events as { type: string }[])

      expect(eventTypes).toContain("reasoning-start")
      expect(eventTypes).toContain("reasoning-delta")
      expect(eventTypes).toContain("reasoning-end")

      const delta = events.find((e: any) => e.type === "reasoning-delta") as any
      expect(delta.text).toBe("Let me think about this...")
      expect(delta.id).toBe("msg-think")
    })

    test("thinking uses assistant uuid as id", async () => {
      const messages = toAsyncIterable([assistantThinking("Deep thought", "custom-uuid"), resultSuccess()])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)

      const start = events.find((e: any) => e.type === "reasoning-start") as any
      expect(start.id).toBe("custom-uuid")
    })

    test("thinking with no uuid falls back to 'thinking'", async () => {
      const msg = {
        type: "assistant",
        message: {
          content: [{ type: "thinking", thinking: "Hmm..." }],
        },
      }
      const messages = toAsyncIterable([msg, resultSuccess()])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)

      const start = events.find((e: any) => e.type === "reasoning-start") as any
      expect(start.id).toBe("thinking")
    })

    test("empty thinking body is skipped", async () => {
      const messages = toAsyncIterable([assistantThinking(""), resultSuccess()])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)
      const eventTypes = types(events as { type: string }[])

      expect(eventTypes).not.toContain("reasoning-start")
    })
  })

  describe("tool call and result event mapping", () => {
    test("tool_use block produces tool-input-start, tool-input-end, tool-call events", async () => {
      const messages = toAsyncIterable([
        assistantToolUse("tool_1", "Read", { file_path: "README.md" }),
        syntheticToolResult("tool_1", "File contents here"),
        resultSuccess(),
      ])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)
      const eventTypes = types(events as { type: string }[])

      expect(eventTypes).toContain("tool-input-start")
      expect(eventTypes).toContain("tool-input-end")
      expect(eventTypes).toContain("tool-call")
      expect(eventTypes).toContain("tool-result")

      const toolInputStart = events.find((e: any) => e.type === "tool-input-start") as any
      expect(toolInputStart.id).toBe("tool_1")
      expect(toolInputStart.toolName).toBe("Read")

      const toolCall = events.find((e: any) => e.type === "tool-call") as any
      expect(toolCall.toolCallId).toBe("tool_1")
      expect(toolCall.toolName).toBe("Read")
      expect(toolCall.input).toEqual({ file_path: "README.md" })
    })

    test("synthetic user message with tool_result matches pending tool", async () => {
      const messages = toAsyncIterable([
        assistantToolUse("tool_1", "Bash", { command: "ls" }),
        syntheticToolResult("tool_1", "file1.ts\nfile2.ts"),
        resultSuccess(),
      ])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)

      const toolResult = events.find((e: any) => e.type === "tool-result") as any
      expect(toolResult.toolCallId).toBe("tool_1")
      expect(toolResult.toolName).toBe("Bash")
      expect(toolResult.output.output).toBe("file1.ts\nfile2.ts")
    })

    test("tool result for unknown tool_use_id uses 'unknown' as tool name", async () => {
      const messages = toAsyncIterable([syntheticToolResult("orphan_tool", "some result"), resultSuccess()])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)

      const toolResult = events.find((e: any) => e.type === "tool-result") as any
      expect(toolResult.toolCallId).toBe("orphan_tool")
      expect(toolResult.toolName).toBe("unknown")
    })

    test("non-synthetic user messages are ignored", async () => {
      const msg = {
        type: "user",
        isSynthetic: false,
        message: {
          content: [{ type: "tool_result", tool_use_id: "tool_1", content: "result" }],
        },
      }
      const messages = toAsyncIterable([msg, resultSuccess()])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)
      const eventTypes = types(events as { type: string }[])

      expect(eventTypes).not.toContain("tool-result")
    })

    test("tool input is stringified from object", async () => {
      const messages = toAsyncIterable([
        assistantToolUse("tool_1", "Edit", { file: "a.ts", old: "x", new: "y" }),
        resultSuccess(),
      ])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)

      const toolCall = events.find((e: any) => e.type === "tool-call") as any
      expect(toolCall.input).toEqual({ file: "a.ts", old: "x", new: "y" })
    })
  })

  describe("error result handling", () => {
    test("result with error subtype produces error event and rejects text", async () => {
      const messages = toAsyncIterable([assistantText("Partial response"), resultError(["Max turns exceeded"])])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)
      const eventTypes = types(events as { type: string }[])

      expect(eventTypes).toContain("error")
      expect(eventTypes).not.toContain("finish-step")
      await expect(output.text).rejects.toThrow("Max turns exceeded")
    })

    test("success result produces finish-step with stop reason", async () => {
      const messages = toAsyncIterable([assistantText("Done"), resultSuccess()])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)

      const finishStep = events.find((e: any) => e.type === "finish-step") as any
      expect(finishStep.finishReason).toBe("stop")
    })

    test("usage data is extracted from result message", async () => {
      const messages = toAsyncIterable([
        assistantText("Hello"),
        resultSuccess({ input_tokens: 500, output_tokens: 200, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 }),
      ])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)

      const finishStep = events.find((e: any) => e.type === "finish-step") as any
      expect(finishStep.usage.inputTokens).toBe(500)
      expect(finishStep.usage.outputTokens).toBe(200)
      expect(finishStep.usage.totalTokens).toBe(850)
      expect(finishStep.usage.cachedInputTokens).toBe(100)
    })

    test("thrown error in message stream produces error event", async () => {
      async function* throwingStream() {
        yield assistantText("Before error")
        throw new Error("Stream connection lost")
      }
      const output = bridgeMessages(throwingStream())
      const events = await collect(output.fullStream)
      const eventTypes = types(events as { type: string }[])

      expect(eventTypes).toContain("error")

      await expect(output.text).rejects.toThrow("Stream connection lost")
    })
  })

  describe("multi-turn conversation", () => {
    test("multiple assistant messages accumulate text", async () => {
      const messages = toAsyncIterable([
        assistantText("First response", "msg-1"),
        assistantText("Second response", "msg-2"),
        resultSuccess(),
      ])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)
      const text = await output.text

      const textDeltas = events.filter((e: any) => e.type === "text-delta") as any[]
      expect(textDeltas).toHaveLength(2)
      expect(textDeltas[0].text).toBe("First response")
      expect(textDeltas[1].text).toBe("Second response")

      expect(text).toBe("First response\nSecond response")
    })

    test("mixed text, thinking, and tool_use in one assistant message", async () => {
      const msg = {
        type: "assistant",
        uuid: "msg-mixed",
        session_id: "sess-1",
        message: {
          content: [
            { type: "thinking", thinking: "Let me figure this out" },
            { type: "text", text: "I'll read the file" },
            { type: "tool_use", id: "tool_1", name: "Read", input: { file_path: "foo.ts" } },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }
      const messages = toAsyncIterable([
        msg,
        syntheticToolResult("tool_1", "file contents"),
        assistantText("Here are the results"),
        resultSuccess(),
      ])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)
      const eventTypes = types(events as { type: string }[])

      // Check all event types appear in the right order
      const relevantTypes = eventTypes.filter((t) =>
        ["reasoning-start", "reasoning-delta", "reasoning-end", "text-start", "text-delta", "text-end", "tool-input-start", "tool-input-end", "tool-call", "tool-result"].includes(t),
      )

      expect(relevantTypes).toEqual([
        "reasoning-start",
        "reasoning-delta",
        "reasoning-end",
        "text-start",
        "text-delta",
        "text-end",
        "tool-input-start",
        "tool-input-end",
        "tool-call",
        "tool-result",
        "text-start",
        "text-delta",
        "text-end",
      ])
    })

    test("tool call followed by tool result followed by more text", async () => {
      const messages = toAsyncIterable([
        assistantToolUse("tool_1", "Bash", { command: "echo hi" }),
        syntheticToolResult("tool_1", "hi"),
        assistantText("The command returned 'hi'"),
        resultSuccess(),
      ])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)
      const text = await output.text

      expect(text).toBe("The command returned 'hi'")
    })

    test("multiple tool calls in sequence", async () => {
      const messages = toAsyncIterable([
        assistantToolUse("tool_1", "Read", { file_path: "a.ts" }),
        syntheticToolResult("tool_1", "content A"),
        assistantToolUse("tool_2", "Read", { file_path: "b.ts" }),
        syntheticToolResult("tool_2", "content B"),
        assistantText("Both files read"),
        resultSuccess(),
      ])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)

      const toolCalls = events.filter((e: any) => e.type === "tool-call") as any[]
      expect(toolCalls).toHaveLength(2)
      expect(toolCalls[0].toolCallId).toBe("tool_1")
      expect(toolCalls[1].toolCallId).toBe("tool_2")

      const toolResults = events.filter((e: any) => e.type === "tool-result") as any[]
      expect(toolResults).toHaveLength(2)
    })
  })

  describe("edge cases", () => {
    test("unknown message types are ignored", async () => {
      const messages = toAsyncIterable([
        { type: "system", content: "system info" },
        { type: "status", status: "running" },
        assistantText("Hello"),
        resultSuccess(),
      ])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)
      const text = await output.text

      expect(text).toBe("Hello")
    })

    test("stream that ends without result message closes gracefully", async () => {
      const messages = toAsyncIterable([assistantText("Hello")])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)
      const text = await output.text

      expect(text).toBe("Hello")

      const finishStep = events.find((e: any) => e.type === "finish-step") as any
      expect(finishStep).toBeDefined()
      expect(finishStep.finishReason).toBe("stop")
    })

    test("null or invalid messages in stream are skipped", async () => {
      const messages = toAsyncIterable([null, undefined, 42, "string", assistantText("Valid"), resultSuccess()])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)
      const text = await output.text

      expect(text).toBe("Valid")
    })

    test("assistant message with no content array is handled", async () => {
      const msg = {
        type: "assistant",
        uuid: "msg-empty",
        message: {},
      }
      const messages = toAsyncIterable([msg, resultSuccess()])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)
      const eventTypes = types(events as { type: string }[])

      expect(eventTypes).not.toContain("text-start")
      expect(eventTypes).toContain("finish-step")
    })

    test("result with missing usage defaults to zeros", async () => {
      const messages = toAsyncIterable([
        assistantText("Hello"),
        { type: "result", subtype: "success" },
      ])
      const output = bridgeMessages(messages)
      const events = await collect(output.fullStream)

      const finishStep = events.find((e: any) => e.type === "finish-step") as any
      expect(finishStep.usage.inputTokens).toBe(0)
      expect(finishStep.usage.outputTokens).toBe(0)
      expect(finishStep.usage.totalTokens).toBe(0)
    })
  })
})
