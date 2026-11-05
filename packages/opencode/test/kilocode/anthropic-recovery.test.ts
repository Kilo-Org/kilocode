import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { Effect } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import type { ModelMessage } from "ai"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "../../src/provider/provider"
import { AnthropicRecovery } from "../../src/kilocode/session/anthropic-recovery"
import { MessageV2 } from "../../src/session/message-v2"
import historical from "./fixtures/anthropic-thinking-error.json"

const message =
  "messages.55.content.1: thinking or redacted_thinking blocks in the latest assistant message cannot be modified. These blocks must remain as they were in the original response."
const model: Provider.Model = {
  id: ModelV2.ID.make("claude-opus-5-5"),
  providerID: ProviderV2.ID.make("lab"),
  api: { id: "claude-opus-5-5", npm: "@ai-sdk/anthropic", url: "http://127.0.0.1:1/v1" },
  name: "fixture",
  status: "active",
  release_date: "2026-01-01",
  options: {},
  headers: {},
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 200000, input: 200000, output: 4096 },
  capabilities: {
    interleaved: false,
    reasoning: true,
    temperature: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
  },
}
function error(text = message, type = "invalid_request_error", status = 400) {
  return new APICallError({
    message: text,
    statusCode: status,
    isRetryable: false,
    responseBody: JSON.stringify({ type: "error", error: { type, message: text } }),
    url: "http://127.0.0.1:1/v1/messages",
    requestBodyValues: {},
  })
}
const messages: ModelMessage[] = [
  { role: "user", content: "read fixture" },
  {
    role: "assistant",
    content: [
      { type: "reasoning", text: "A", providerOptions: { anthropic: { signature: "sigA" } } },
      { type: "reasoning", text: "B", providerOptions: { anthropic: { signature: "sigB" } } },
      { type: "tool-call", toolCallId: "t", toolName: "read", input: { filePath: "fixture" } },
    ],
  },
  {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: "t", toolName: "read", output: { type: "text", value: "25" } }],
  },
]
const sessionID = SessionID.make("ses_fixture")
const messageID = MessageID.ascending()
const parts: SessionV1.ReasoningPart[] = ["A", "B"].map((text) => ({
  id: PartID.ascending(),
  sessionID,
  messageID,
  type: "reasoning",
  text,
  time: { start: 0, end: 1 },
  metadata: { anthropic: { signature: `sig${text}` } },
}))

describe("Anthropic rejected latest thinking recovery", () => {
  test("matches the error fields stored by the real CCS session", () => {
    const api = new APICallError({
      message: historical.message,
      statusCode: historical.statusCode,
      isRetryable: historical.isRetryable,
      url: "http://fixture/v1/messages",
      requestBodyValues: {},
      responseBody: JSON.stringify({ error: { type: historical.type, message: historical.message } }),
    })
    expect(historical.name).toBe("APIError")
    expect(AnthropicRecovery.matches(api, model, false)).toBe(true)
  })
  test("matches only the exact Anthropic400 and no-output attempt", () => {
    expect(AnthropicRecovery.matches(error(), model, false)).toBe(true)
    expect(AnthropicRecovery.matches(error(), model, true)).toBe(false)
    expect(AnthropicRecovery.matches(error(), { ...model, api: { ...model.api, npm: "@ai-sdk/openai" } }, false)).toBe(
      false,
    )
    expect(AnthropicRecovery.matches(error("invalid signature"), model, false)).toBe(false)
    expect(AnthropicRecovery.matches(error(message, "api_error"), model, false)).toBe(false)
    expect(AnthropicRecovery.matches(error(message, "invalid_request_error", 500), model, false)).toBe(false)
    const malformed = new APICallError({
      message,
      statusCode: 400,
      isRetryable: false,
      responseBody: "not JSON",
      url: "http://127.0.0.1:1",
      requestBodyValues: {},
    })
    expect(AnthropicRecovery.matches(malformed, model, false)).toBe(false)
  })

  test("selects only latest outbound reasoning, preserving all tools and prior reasoning", () => {
    const copy = structuredClone(messages)
    copy.unshift({
      role: "assistant",
      content: [{ type: "reasoning", text: "earlier", providerOptions: { anthropic: { signature: "sig0" } } }],
    })
    const result = AnthropicRecovery.latest(copy)
    expect(result?.map((part) => part.text)).toEqual(["A", "B"])
    expect(copy).toEqual([expect.objectContaining({ role: "assistant" }), ...messages])
  })

  test("any output including empty starts prevents recovery", () => {
    expect(AnthropicRecovery.output(LLMEvent.textStart({ id: "text" }))).toBe(true)
    expect(AnthropicRecovery.output(LLMEvent.reasoningStart({ id: "reasoning" }))).toBe(true)
    expect(AnthropicRecovery.output(LLMEvent.toolInputStart({ id: "tool", name: "read" }))).toBe(true)
    expect(AnthropicRecovery.output(LLMEvent.stepStart({ index: 0 }))).toBe(false)
  })

  test("keeps original signatures and marks replay exclusion durably", () => {
    const marked = parts.map((part) => AnthropicRecovery.exclude(part, model, message))
    expect(marked.map((part) => part.metadata?.anthropic)).toEqual(parts.map((part) => part.metadata?.anthropic))
    expect(marked.map((part) => part.text)).toEqual(["A", "B"])
    expect(marked.every((part) => AnthropicRecovery.excluded(part, model))).toBe(true)
    const fork = marked.map((part) => ({
      ...part,
      id: PartID.ascending(),
      messageID: MessageID.ascending(),
      sessionID: SessionID.make("ses_fork"),
    }))
    expect(fork.every((part) => AnthropicRecovery.excluded(part, model))).toBe(true)
    expect(
      fork.every((part) => AnthropicRecovery.excluded(part, { ...model, id: ModelV2.ID.make("claude-opus-4-8") })),
    ).toBe(true)
  })

  test("omits excluded parts on real toModelMessages replay after JSON restart and fork", async () => {
    const info: SessionV1.Assistant = {
      id: messageID,
      sessionID,
      role: "assistant",
      parentID: MessageID.ascending(),
      modelID: model.id,
      providerID: model.providerID,
      agent: "code",
      mode: "code",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 20, output: 35, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 0 },
    }
    const marked: SessionV1.Part[] = [
      ...parts.map((part) => AnthropicRecovery.exclude(part, model, message)),
      { id: PartID.ascending(), messageID, sessionID, type: "text", text: "kept" },
    ]
    for (const stored of [structuredClone(marked), marked.map((part) => ({ ...part, id: PartID.ascending() }))]) {
      const replay = await Effect.runPromise(MessageV2.toModelMessagesEffect([{ info, parts: stored }], model))
      expect(replay).toEqual([{ role: "assistant", content: [{ type: "text", text: "kept" }] }])
    }
  })

  test("warns with the correlated source and original error", () => {
    const record = AnthropicRecovery.record({
      sessionID,
      messageID,
      parts: parts.map((part) => part.id),
      error: message,
    })
    expect(record).toEqual({ sessionID, messageID, parts: parts.map((part) => part.id), excluded: 2, error: message })
  })

  test("surfaces the resent request's error unchanged", async () => {
    const original = error()
    const resent = error("second failure")
    const calls = { model: 0, repair: 0 }
    const result = await Effect.runPromise(
      AnthropicRecovery.recover({
        model,
        output: () => false,
        run: () => {
          calls.model++
          return Effect.fail(calls.model === 1 ? original : resent)
        },
        repair: () => {
          calls.repair++
          return Effect.succeed(true)
        },
      }).pipe(Effect.flip),
    )
    expect(result).toBe(resent)
    expect(calls).toEqual({ model: 2, repair: 1 })
  })

  test("leaves every other400 unchanged", async () => {
    const original = error("unrelated invalid_request_error")
    const calls = { model: 0, repair: 0 }
    const result = await Effect.runPromise(
      AnthropicRecovery.recover({
        model,
        output: () => false,
        run: () => {
          calls.model++
          return Effect.fail(original)
        },
        repair: () => {
          calls.repair++
          return Effect.succeed(true)
        },
      }).pipe(Effect.flip),
    )
    expect(result).toBe(original)
    expect(calls).toEqual({ model: 1, repair: 0 })
  })

  test("does not retry an unmapped rejection", async () => {
    const original = error()
    const calls = { model: 0, repair: 0 }
    const result = await Effect.runPromise(
      AnthropicRecovery.recover({
        model,
        output: () => false,
        run: () => {
          calls.model++
          return Effect.fail(original)
        },
        repair: () => {
          calls.repair++
          return Effect.succeed(false)
        },
      }).pipe(Effect.flip),
    )
    expect(result).toBe(original)
    expect(calls).toEqual({ model: 1, repair: 1 })
  })

  test("never repairs after a stream produced output", async () => {
    const original = error()
    const calls = { model: 0, repair: 0 }
    const result = await Effect.runPromise(
      AnthropicRecovery.recover({
        model,
        output: () => true,
        run: () => {
          calls.model++
          return Effect.fail(original)
        },
        repair: () => {
          calls.repair++
          return Effect.succeed(true)
        },
      }).pipe(Effect.flip),
    )
    expect(result).toBe(original)
    expect(calls).toEqual({ model: 1, repair: 0 })
  })

  test("keeps the original error if repair persistence fails", async () => {
    const original = error()
    let calls = 0
    const result = await Effect.runPromise(
      AnthropicRecovery.recover({
        model,
        output: () => false,
        run: () => {
          calls++
          return Effect.fail(original)
        },
        repair: () => Effect.fail(new Error("fixture persistence failed")),
      }).pipe(Effect.flip),
    )
    expect(result).toBe(original)
    expect(calls).toBe(1)
  })
})
