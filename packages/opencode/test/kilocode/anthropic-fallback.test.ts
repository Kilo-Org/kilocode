import { describe, expect, test } from "bun:test"
import { createAnthropic } from "@ai-sdk/anthropic"
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"
import { Effect } from "effect"
import { MessageV2 } from "../../src/session/message-v2"
import { ProviderTransform } from "../../src/provider/transform"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { PartID, MessageID, SessionID } from "../../src/session/schema"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "../../src/provider/provider"
import { LLMNativeRuntime } from "../../src/session/llm/native-runtime"
import { LLMRequest } from "@opencode-ai/llm"
import { Stream } from "effect"
import type { LLMClientShape } from "@opencode-ai/llm/route"
import { KiloRun } from "../../src/kilocode/cli/cmd/run"

// Adapted from vercel/ai a587f55 and 686cca9. V6 uses the existing compaction text carrier.
const boundary = {
  type: "fallback",
  from: { model: "claude-opus-5-5" },
  to: { model: "claude-opus-4-8" },
}
const metadata = { anthropic: boundary }
const content = [
  { type: "thinking", thinking: "Opus 5.5 thinking", signature: "SIG_FROM_OPUS_5_5" },
  boundary,
  { type: "thinking", thinking: "Opus 4.8 thinking", signature: "SIG_FROM_OPUS_4_8" },
  { type: "tool_use", id: "toolu_1", name: "lookup", input: { q: "x" } },
]
const response = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content,
  stop_reason: "tool_use",
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 70 },
}
const events = [
  { type: "message_start", message: { ...response, content: [], stop_reason: null } },
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Opus 5.5 thinking" } },
  { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "SIG_FROM_OPUS_5_5" } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: boundary },
  { type: "content_block_stop", index: 1 },
  { type: "content_block_start", index: 2, content_block: { type: "thinking", thinking: "", signature: "" } },
  { type: "content_block_delta", index: 2, delta: { type: "thinking_delta", thinking: "Opus 4.8 thinking" } },
  { type: "content_block_delta", index: 2, delta: { type: "signature_delta", signature: "SIG_FROM_OPUS_4_8" } },
  { type: "content_block_stop", index: 2 },
  {
    type: "content_block_start",
    index: 3,
    content_block: { type: "tool_use", id: "toolu_1", name: "lookup", input: {} },
  },
  { type: "content_block_delta", index: 3, delta: { type: "input_json_delta", partial_json: '{"q":"x"}' } },
  { type: "content_block_stop", index: 3 },
  { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 70 } },
  { type: "message_stop" },
]
const prompt: LanguageModelV3CallOptions["prompt"] = [{ role: "user", content: [{ type: "text", text: "question" }] }]
const replay: LanguageModelV3CallOptions["prompt"] = [
  ...prompt,
  {
    role: "assistant",
    content: [
      {
        type: "reasoning",
        text: "Opus 5.5 thinking",
        providerOptions: { anthropic: { signature: "SIG_FROM_OPUS_5_5" } },
      },
      { type: "text", text: "", providerOptions: metadata },
      {
        type: "reasoning",
        text: "Opus 4.8 thinking",
        providerOptions: { anthropic: { signature: "SIG_FROM_OPUS_4_8" } },
      },
      { type: "tool-call", toolCallId: "toolu_1", toolName: "lookup", input: { q: "x" } },
    ],
  },
  {
    role: "tool",
    content: [
      { type: "tool-result", toolCallId: "toolu_1", toolName: "lookup", output: { type: "text", value: "25" } },
    ],
  },
]

function fixtureModel(): Provider.Model {
  return {
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
}

function fixture(stream = false, fallback = true) {
  const calls: { body: string; headers: Record<string, string> }[] = []
  const provider = createAnthropic({
    apiKey: "synthetic-key",
    baseURL: "http://127.0.0.1:1/v1",
    fetch: Object.assign(
      async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        if (typeof init?.body !== "string") throw new Error("Expected JSON request string")
        calls.push({ body: init.body, headers: Object.fromEntries(new Headers(init.headers).entries()) })
        if (stream) {
          const chunks = fallback
            ? events
            : events
                .filter(
                  (event) =>
                    event.type !== "content_block_start" ||
                    !("content_block" in event) ||
                    event.content_block?.type !== "fallback",
                )
                .filter((event) => event.type !== "content_block_stop" || !("index" in event) || event.index !== 1)
          return new Response(
            chunks.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
            { headers: { "content-type": "text/event-stream" } },
          )
        }
        return Response.json(
          fallback ? response : { ...response, content: content.filter((part) => part.type !== "fallback") },
        )
      },
      { preconnect: fetch.preconnect },
    ),
  })
  return { model: provider("claude-opus-5-5"), calls }
}

describe("Anthropic fallback backport", () => {
  test("native lowering drops stored fallback metadata and equals the normal request", async () => {
    const marker = { type: "text" as const, text: "", providerOptions: metadata }
    const model = fixtureModel()
    const provider = {
      id: ProviderV2.ID.make("anthropic"),
      name: "fixture",
      source: "config" as const,
      env: [],
      options: { apiKey: "synthetic-key" },
      models: {},
    }
    const received: LLMRequest[] = []
    const client: LLMClientShape = {
      prepare: () => Effect.die("unused"),
      generate: () => Effect.die("unused"),
      stream: (request) => {
        received.push(request)
        return Stream.empty
      },
    }
    for (const messages of [
      [
        {
          role: "assistant" as const,
          content: [
            { type: "text" as const, text: "before" },
            { type: "text" as const, text: "after" },
          ],
        },
      ],
      [
        {
          role: "assistant" as const,
          content: [{ type: "text" as const, text: "before" }, marker, { type: "text" as const, text: "after" }],
        },
      ],
    ]) {
      const runtime = LLMNativeRuntime.stream({
        model: { ...model, providerID: provider.id },
        provider,
        auth: undefined,
        llmClient: client,
        messages,
        tools: {},
        headers: {},
        abort: new AbortController().signal,
      })
      if (runtime.type !== "supported") throw new Error(runtime.reason)
      await Effect.runPromise(Stream.runDrain(runtime.stream))
    }
    expect(JSON.stringify(received[1])).toBe(JSON.stringify(received[0]))
  })

  test("CLI JSON ignores the stored marker but emits real text", () => {
    const emitted: unknown[] = []
    const emit = (type: string, data: Record<string, unknown>) => {
      emitted.push({ type, ...data })
      return true
    }
    const marker = {
      id: "part_marker",
      sessionID: "ses_fixture",
      messageID: "msg_fixture",
      type: "text" as const,
      text: "",
      ignored: true,
      metadata,
      time: { start: 0, end: 1 },
    }
    expect(KiloRun.text(marker, emit)).toBe(true)
    expect(emitted).toEqual([])
    KiloRun.text({ ...marker, text: "answer", ignored: false, metadata: undefined }, emit)
    expect(emitted).toHaveLength(1)
    const ignored = { ...marker, text: "notice", metadata: undefined }
    KiloRun.text(ignored, emit)
    expect(emitted).toContainEqual({ type: "text", part: ignored })
  })

  test("preserves the non-streaming boundary between signed reasoning blocks", async () => {
    const result = await fixture().model.doGenerate({ prompt })
    expect(result.content.map((part) => part.type)).toEqual(["reasoning", "text", "reasoning", "tool-call"])
    expect(result.content[1]).toEqual({ type: "text", text: "", providerMetadata: metadata })
    expect(result.usage.outputTokens.total).toBe(70)
  })

  test("preserves the streaming boundary in mid-output order", async () => {
    const { stream } = await fixture(true).model.doStream({ prompt })
    const parts = await Array.fromAsync(stream)
    const first = parts.findIndex((part) => part.type === "reasoning-end" && part.id === "0")
    const marker = parts.findIndex(
      (part) => part.type === "text-start" && part.providerMetadata?.anthropic?.type === "fallback",
    )
    const second = parts.findIndex((part) => part.type === "reasoning-start" && part.id === "2")
    expect(first).toBeGreaterThan(-1)
    expect(marker).toBeGreaterThan(first)
    expect(second).toBeGreaterThan(marker)
    expect(parts[marker]).toEqual({ type: "text-start", id: "1", providerMetadata: metadata })
    expect(parts[marker + 1]).toEqual({ type: "text-end", id: "1", providerMetadata: metadata })
  })

  test("replays primary thinking, boundary, fallback thinking and tool in place", async () => {
    const ctx = fixture()
    await ctx.model.doGenerate({ prompt: replay, providerOptions: { anthropic: { thinking: { type: "adaptive" } } } })
    expect(JSON.parse(ctx.calls[0].body).messages[1].content).toEqual(content)
  })

  test("adds the replay beta without a configured fallback chain", async () => {
    const ctx = fixture()
    await ctx.model.doGenerate({ prompt: replay })
    expect(JSON.parse(ctx.calls[0].body).fallbacks).toBeUndefined()
    expect(ctx.calls[0].headers["anthropic-beta"]).toBe("server-side-fallback-2026-06-01")
  })

  test("warns and skips invalid metadata", async () => {
    const ctx = fixture()
    const result = await ctx.model.doGenerate({
      prompt: [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "",
              providerOptions: { anthropic: { type: "fallback", from: { model: "claude-opus-5-5" } } },
            },
          ],
        },
      ],
    })
    expect(JSON.parse(ctx.calls[0].body).messages).toEqual([])
    expect(result.warnings).toContainEqual({
      type: "other",
      message: "anthropic fallback metadata must include from.model and to.model",
    })
    expect(ctx.calls[0].headers["anthropic-beta"]).toBeUndefined()
  })

  test("does not move tool calls across a fallback boundary", async () => {
    const ctx = fixture()
    await ctx.model.doGenerate({
      prompt: [
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "t", toolName: "lookup", input: {} },
            { type: "text", text: "", providerOptions: metadata },
            { type: "text", text: "answer" },
          ],
        },
      ],
    })
    expect(JSON.parse(ctx.calls[0].body).messages[0].content.map((part: { type: string }) => part.type)).toEqual([
      "tool_use",
      "fallback",
      "text",
    ])
  })

  test("does not add cache control to a marker-only assistant", () => {
    const result = ProviderTransform.message(
      [{ role: "assistant", content: [{ type: "text", text: "", providerOptions: metadata }] }],
      fixtureModel(),
      {},
    )
    expect(result[0].providerOptions).toBeUndefined()
    if (Array.isArray(result[0].content)) {
      const marker = result[0].content[0]
      if (marker.type !== "text") throw new Error("Expected marker")
      expect(marker.providerOptions).toEqual(metadata)
    }
  })

  test("replays an ignored stored marker in place without a space or cache annotation", async () => {
    const model = fixtureModel()
    const sessionID = SessionID.make("ses_fixture")
    const messageID = MessageID.ascending()
    const info: SessionV1.Assistant = {
      id: messageID,
      sessionID,
      role: "assistant",
      parentID: MessageID.ascending(),
      agent: "code",
      mode: "code",
      modelID: model.id,
      providerID: model.providerID,
      path: { cwd: "/", root: "/" },
      time: { created: 0 },
      cost: 0,
      tokens: { input: 10, output: 70, reasoning: 0, cache: { read: 0, write: 0 } },
    }
    const parts: SessionV1.Part[] = [
      {
        id: PartID.ascending(),
        messageID,
        sessionID,
        type: "reasoning",
        text: "A",
        metadata: { anthropic: { signature: "sigA" } },
        time: { start: 0 },
      },
      { id: PartID.ascending(), messageID, sessionID, type: "text", text: "", ignored: true, metadata },
      {
        id: PartID.ascending(),
        messageID,
        sessionID,
        type: "reasoning",
        text: "B",
        metadata: { anthropic: { signature: "sigB" } },
        time: { start: 0 },
      },
    ]
    const converted = await Effect.runPromise(MessageV2.toModelMessagesEffect([{ info, parts }], model))
    const normalized = ProviderTransform.message(converted, model, {})
    const ctx = fixture()
    const prompt: LanguageModelV3CallOptions["prompt"] = normalized.map((message) => {
      if (message.role !== "assistant" || !Array.isArray(message.content)) throw new Error("Expected assistant fixture")
      return {
        role: "assistant",
        content: message.content.map((part) => {
          if (part.type !== "text" && part.type !== "reasoning") throw new Error("Unexpected fixture part")
          return { type: part.type, text: part.text, providerOptions: part.providerOptions }
        }),
      }
    })
    await ctx.model.doGenerate({
      prompt,
      providerOptions: { anthropic: { thinking: { type: "adaptive" } } },
    })
    const sent = JSON.parse(ctx.calls[0].body).messages[0].content
    expect(sent.map((part: { type: string }) => part.type)).toEqual(["thinking", "fallback", "thinking"])
    expect(sent[1]).toEqual(boundary)
    expect(info.tokens.output).toBe(70)
    expect(parts[1]).toMatchObject({ text: "", ignored: true })
  })

  test("does not emit a fallback block or beta in normal multi-turn tool requests", async () => {
    for (const streaming of [false, true]) {
      const ctx = fixture(streaming, false)
      const history = replay.map((message) =>
        message.role !== "assistant"
          ? message
          : {
              ...message,
              content: message.content.filter(
                (part) => part.type !== "text" || part.providerOptions?.anthropic?.type !== "fallback",
              ),
            },
      )
      const opts: LanguageModelV3CallOptions = {
        prompt: history,
        maxOutputTokens: 64,
        providerOptions: { anthropic: { thinking: { type: "adaptive", display: "summarized" }, effort: "xhigh" } },
      }
      if (streaming) await Array.fromAsync((await ctx.model.doStream(opts)).stream)
      if (!streaming) await ctx.model.doGenerate(opts)
      const sent = JSON.parse(ctx.calls[0].body)
      expect(sent.messages[1].content.map((part: { type: string }) => part.type)).toEqual([
        "thinking",
        "thinking",
        "tool_use",
      ])
      expect(
        sent.messages
          .flatMap((message: { content: { type: string }[] }) => message.content)
          .some((part: { type: string }) => part.type === "fallback"),
      ).toBe(false)
      expect(ctx.calls[0].headers["anthropic-beta"] ?? "").not.toContain("server-side-fallback-2026-06-01")
    }
  })
})
