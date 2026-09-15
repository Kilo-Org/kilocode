import { beforeEach, describe, expect, test } from "bun:test"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { APICallError, JSONParseError, type LanguageModelV3 } from "@ai-sdk/provider"
import { Effect } from "effect"
import { ModelNotFoundError, type Provider } from "../../../src/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { MessageV2 } from "../../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../../src/session/schema"
import type { Session } from "../../../src/session/session"
import type { SessionSummary } from "../../../src/session/summary"
import type { Snapshot } from "../../../src/snapshot"
import { MemoryModel, MemorySession, resetStreamNeeded } from "../../../src/kilocode/memory/ports"

const pid = ProviderV2.ID.make("test")
const mid = ModelV2.ID.make("fake-memory-model")

function mdl(id = mid, npm = "test-provider", providerID = pid): Provider.Model {
  return {
    id,
    providerID,
    api: { id, npm, url: "" },
    limit: { context: 100_000, output: 4_000 },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
  } as unknown as Provider.Model
}

function lang(outputs: (string | Error)[] = ["{}"], calls?: unknown[], hang?: boolean): LanguageModelV3 {
  let idx = 0
  const next = () => {
    const item = outputs[idx++] ?? outputs.at(-1) ?? "{}"
    if (item instanceof Error) throw item
    return item
  }
  return {
    specificationVersion: "v3",
    provider: "test",
    modelId: "fake-memory-model",
    supportedUrls: {},
    doGenerate: async (...args: Parameters<LanguageModelV3["doGenerate"]>) => {
      calls?.push(args[0])
      if (hang) return new Promise(() => {})
      const text = next()
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop" },
        usage: {
          inputTokens: { total: 12 },
          outputTokens: { total: 8 },
          raw: {},
        },
        warnings: [],
        providerMetadata: {},
        request: {},
        response: {},
      }
    },
  } as unknown as LanguageModelV3
}

function provider(
  input: {
    outputs?: (string | Error)[]
    seen?: string[]
    calls?: unknown[]
    hang?: boolean
    npm?: string
    providerID?: ProviderV2.ID
  } = {},
): Provider.Interface {
  const providerID = input.providerID ?? pid
  const base = mdl(mid, input.npm, providerID)
  const mem = mdl(ModelV2.ID.make("memory-config-model"), input.npm, providerID)
  const info = {
    id: providerID,
    name: "Test",
    source: "config",
    env: [],
    options: {},
    models: { [base.id]: base, [mem.id]: mem },
  } satisfies Provider.Info
  return {
    list: () => Effect.succeed({ [providerID]: info }),
    getProvider: () => Effect.succeed(info),
    getModel: (providerID, modelID) => {
      const found = info.models[modelID]
      if (found) return Effect.succeed(found)
      return Effect.fail(new ModelNotFoundError({ providerID, modelID }))
    },
    getLanguage: (model) => {
      input.seen?.push(model.id)
      return Effect.succeed(lang(input.outputs, input.calls, input.hang))
    },
    closest: () => Effect.succeed({ providerID: pid, modelID: base.id }),
    getSmallModel: () => Effect.succeed(mem),
    defaultModel: () => Effect.succeed({ providerID: pid, modelID: base.id }),
  }
}

function compatLanguage(input: {
  generate: () => Promise<unknown>
  streamed?: string[]
  called?: string[]
}): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "test",
    modelId: "compat",
    supportedUrls: {},
    doGenerate: input.generate,
    doStream: input.streamed
      ? async () => ({
          stream: new ReadableStream({
            start: (controller: ReadableStreamDefaultController) => {
              input.called?.push("stream")
              controller.enqueue({ type: "text-start", id: "1" })
              for (const chunk of input.streamed!) controller.enqueue({ type: "text-delta", id: "1", delta: chunk })
              controller.enqueue({ type: "text-end", id: "1" })
              controller.enqueue({
                type: "finish",
                finishReason: "stop" as const,
                usage: { inputTokens: 12, outputTokens: 8 },
              })
              controller.close()
            },
          }),
          request: {},
          response: {},
        })
      : async () => {
          input.called?.push("stream")
          throw new Error("streamText should not run")
        },
  } as unknown as LanguageModelV3
}

function compatProvider(input: {
  generate: () => Promise<unknown>
  streamed?: string[]
  called?: string[]
}): Provider.Interface {
  const source = mdl(ModelV2.ID.make("compat"), "@ai-sdk/openai-compatible")
  const info = {
    id: pid,
    name: "Test",
    source: "config",
    env: [],
    options: {},
    models: { [source.id]: source },
  } satisfies Provider.Info
  return {
    list: () => Effect.succeed({ [pid]: info }),
    getProvider: () => Effect.succeed(info),
    getModel: (_providerID, modelID) =>
      info.models[modelID]
        ? Effect.succeed(info.models[modelID])
        : Effect.fail(new ModelNotFoundError({ providerID: pid, modelID })),
    getLanguage: () => Effect.succeed(compatLanguage(input)),
    closest: () => Effect.succeed({ providerID: pid, modelID: source.id }),
    getSmallModel: () => Effect.succeed(source),
    defaultModel: () => Effect.succeed({ providerID: pid, modelID: source.id }),
  }
}

function text(sessionID: SessionID, messageID: MessageID, body: string): MessageV2.TextPart {
  return {
    id: PartID.make(`prt_${messageID}_text`),
    sessionID,
    messageID,
    type: "text",
    text: body,
  }
}

function tool(input: {
  sessionID: SessionID
  messageID: MessageID
  name: string
  command?: string
  meta?: Record<string, unknown>
}): MessageV2.ToolPart {
  return {
    id: PartID.make(`prt_${input.messageID}_tool`),
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "tool",
    callID: `call_${input.messageID}`,
    tool: input.name,
    state: {
      status: "completed",
      input: input.command ? { command: input.command } : {},
      output: "",
      title: input.name,
      metadata: input.meta ?? {},
      time: { start: 1, end: 2 },
    },
  }
}

function user(input: { sessionID: SessionID; id: MessageID; body: string }): MessageV2.WithParts {
  return {
    info: {
      id: input.id,
      sessionID: input.sessionID,
      role: "user",
      time: { created: 1 },
      agent: "code",
      model: { providerID: pid, modelID: mid },
    },
    parts: [text(input.sessionID, input.id, input.body)],
  }
}

function assistant(input: {
  sessionID: SessionID
  id: MessageID
  parentID: MessageID
  parts: MessageV2.Part[]
  time: number
  finish?: string
}): MessageV2.WithParts {
  return {
    info: {
      id: input.id,
      sessionID: input.sessionID,
      role: "assistant",
      time: { created: input.time, completed: input.time + 1 },
      parentID: input.parentID,
      modelID: mid,
      providerID: pid,
      mode: "build",
      agent: "code",
      path: { cwd: "/repo", root: "/repo" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: input.finish ?? "stop",
    },
    parts: input.parts,
  }
}

function sessions(messages: MessageV2.WithParts[]): Session.Interface {
  return {
    get: () => Effect.succeed({ parentID: undefined }),
    messages: (input?: { limit?: number }) => Effect.succeed(input?.limit ? messages.slice(-input.limit) : messages),
  } as unknown as Session.Interface
}

function summary(input: { seen: string[]; diffs: Snapshot.FileDiff[] }): SessionSummary.Interface {
  return {
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: (current: { messages: MessageV2.WithParts[] }) => {
      input.seen.push(...current.messages.map((item) => item.info.id))
      return Effect.succeed(input.diffs)
    },
  } as SessionSummary.Interface
}

const ref = { providerID: "test", modelID: "fake-memory-model" }

describe("memory ports", () => {
  beforeEach(() => resetStreamNeeded())
  test("session port extracts the latest turn, recall markers, and all assistant steps", async () => {
    const sessionID = SessionID.make("ses_memory_adapter")
    const uid = MessageID.make("msg_user")
    const recall = MessageID.make("msg_recall")
    const shell = MessageID.make("msg_shell")
    const final = MessageID.make("msg_final")
    const diffs = [
      {
        file: "packages/opencode/src/kilocode/memory/ports.ts",
        additions: 4,
        deletions: 1,
        status: "modified" as const,
      },
    ] satisfies Snapshot.FileDiff[]
    const seen: string[] = []
    const messages = [
      user({
        sessionID,
        id: uid,
        body: "remember the package test command with OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz1234567890",
      }),
      assistant({
        sessionID,
        id: recall,
        parentID: uid,
        time: 2,
        finish: "tool-calls",
        parts: [
          tool({
            sessionID,
            messageID: recall,
            name: "kilo_memory_recall",
            meta: { count: 2, bytes: 120, tokens: 30, files: ["project.md"] },
          }),
        ],
      }),
      assistant({
        sessionID,
        id: shell,
        parentID: uid,
        time: 4,
        finish: "tool-calls",
        parts: [
          tool({
            sessionID,
            messageID: shell,
            name: "bash",
            command: "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz1234567890 bun test",
          }),
        ],
      }),
      assistant({
        sessionID,
        id: final,
        parentID: uid,
        time: 6,
        parts: [text(sessionID, final, "Run bun test from packages/opencode for CLI memory tests.")],
      }),
    ]

    const view = await Effect.runPromise(
      MemorySession.port({ sessions: sessions(messages), summary: summary({ seen, diffs }) }).readTurn({
        sessionID,
        window: 24,
      }),
    )

    expect(view).toMatchObject({
      user: "remember the package test command with [redacted]",
      assistant: "Run bun test from packages/opencode for CLI memory tests.",
      lastAssistantID: final,
      sessionModel: ref,
      recalledMemory: true,
      diffs,
    })
    expect(view?.recent).toContain("Tool kilo_memory_recall completed")
    expect(view?.recent).toContain("command=[redacted]")
    expect(view?.recent).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz1234567890")
    expect(view?.user).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz1234567890")
    expect(seen).toEqual([uid, recall, shell, final])
  })

  test("model port resolves configured models and falls back to the session model", async () => {
    const seen: string[] = []
    const port = MemoryModel.port({ provider: provider({ seen }) })

    const configured = await Effect.runPromise(port.resolve({ configured: "test/memory-config-model", session: ref }))
    const fallback = await Effect.runPromise(port.resolve({ configured: "test/missing-memory-model", session: ref }))

    expect(configured.fallback).toBeUndefined()
    expect(fallback.fallback).toEqual({ reason: "model unavailable" })
    expect(seen).toEqual(["memory-config-model", "fake-memory-model"])
  })

  test("model port asks OpenAI-compatible providers for a non-streaming JSON response", async () => {
    const calls: unknown[] = []
    const port = MemoryModel.port({ provider: provider({ npm: "@ai-sdk/openai-compatible", calls }) })
    const resolved = await Effect.runPromise(port.resolve({ session: ref }))

    await port.run({ handle: resolved.handle, system: "system", prompt: "prompt", timeoutMs: 30_000 })

    const opts = calls[0] as { providerOptions?: Record<string, { stream?: boolean }> }
    expect(opts.providerOptions?.test?.stream).toBe(false)
  })

  test("model port still disables streaming when a compatible model is registered as openai", async () => {
    const calls: unknown[] = []
    const port = MemoryModel.port({
      provider: provider({
        npm: "@ai-sdk/openai-compatible",
        providerID: ProviderV2.ID.make("openai"),
        calls,
      }),
    })
    const resolved = await Effect.runPromise(port.resolve({ session: ref }))

    await port.run({ handle: resolved.handle, system: "system", prompt: "prompt", timeoutMs: 30_000 })

    const opts = calls[0] as { providerOptions?: Record<string, { stream?: boolean }> }
    expect(opts.providerOptions?.openai?.stream).toBe(false)
  })

  test("model port puts stream:false on the OpenAI-compatible request body", async () => {
    const seen: unknown[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = await request.json()
        seen.push(body)
        if ((body as { stream?: boolean }).stream !== false) {
          return new Response(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "The" } }] })}\n\n`, {
            headers: { "content-type": "text/event-stream" },
          })
        }
        return Response.json({
          id: "mem",
          object: "chat.completion",
          created: 0,
          model: "fake-memory-model",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: '{"topic":"t","summary":"s"}',
                reasoning_content: "The user just",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      },
    })
    try {
      const sdk = createOpenAICompatible({
        name: "test",
        baseURL: `http://127.0.0.1:${server.port}/v1`,
        apiKey: "unused",
      })
      const port = MemoryModel.port({
        provider: {
          ...provider({ npm: "@ai-sdk/openai-compatible" }),
          getLanguage: () => Effect.succeed(sdk.languageModel("fake-memory-model")),
        },
      })
      const resolved = await Effect.runPromise(port.resolve({ session: ref }))
      const result = await port.run({
        handle: resolved.handle,
        system: "system",
        prompt: "prompt",
        timeoutMs: 30_000,
      })

      expect((seen[0] as { stream?: boolean }).stream).toBe(false)
      expect(result.text).toBe('{"topic":"t","summary":"s"}')
    } finally {
      server.stop(true)
    }
  })

  test("model port retries a transient provider failure once", async () => {
    const calls: unknown[] = []
    const err = new APICallError({
      message: "temporarily unavailable",
      url: "https://example.com/v1/generate",
      requestBodyValues: {},
      statusCode: 503,
      responseHeaders: {},
      responseBody: '{"error":"temporarily unavailable"}',
      isRetryable: true,
    })
    const port = MemoryModel.port({ provider: provider({ outputs: [err, "{}"], calls }) })
    const resolved = await Effect.runPromise(port.resolve({ session: ref }))

    await port.run({ handle: resolved.handle, system: "system", prompt: "prompt", timeoutMs: 30_000 })

    expect(calls).toHaveLength(2)
    const opts = calls[0] as { providerOptions?: Record<string, { stream?: boolean }> }
    expect(opts.providerOptions?.test?.stream).toBeUndefined()
  })

  test("model port emits a structured timeout error", async () => {
    const port = MemoryModel.port({ provider: provider({ hang: true }) })
    const resolved = await Effect.runPromise(port.resolve({ session: ref }))

    await expect(
      port.run({ handle: resolved.handle, system: "system", prompt: "prompt", timeoutMs: 1 }),
    ).rejects.toMatchObject({ name: "TimeoutError", message: "memory model timed out" })
  })

  test("model port clears its timeout after successful output", async () => {
    const set = globalThis.setTimeout
    const clear = globalThis.clearTimeout
    const handles = new Set<ReturnType<typeof setTimeout>>()
    const cleared = new Set<ReturnType<typeof setTimeout>>()

    ;(globalThis as { setTimeout: typeof setTimeout }).setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      const handle = set(...args)
      if (args[1] === 30_000) handles.add(handle)
      return handle
    }) as typeof setTimeout
    ;(globalThis as { clearTimeout: typeof clearTimeout }).clearTimeout = ((
      handle?: Parameters<typeof clearTimeout>[0],
    ) => {
      if (handle && handles.has(handle as ReturnType<typeof setTimeout>)) {
        cleared.add(handle as ReturnType<typeof setTimeout>)
      }
      return clear(handle)
    }) as typeof clearTimeout

    try {
      const port = MemoryModel.port({ provider: provider({ outputs: ["{}"] }) })
      const resolved = await Effect.runPromise(port.resolve({ session: ref }))

      await port.run({
        handle: resolved.handle,
        system: "system",
        prompt: "prompt",
        timeoutMs: 30_000,
      })
    } finally {
      ;(globalThis as { setTimeout: typeof setTimeout }).setTimeout = set
      ;(globalThis as { clearTimeout: typeof clearTimeout }).clearTimeout = clear
    }

    expect(handles.size).toBe(1)
    expect(cleared.size).toBe(1)
  })

  test("openai-compatible providers fall back to streamText when generateText returns invalid JSON", async () => {
    const called: string[] = []
    const port = MemoryModel.port({
      provider: compatProvider({
        generate: async () => {
          throw new APICallError({
            message: "Invalid JSON response",
            url: "test://invalid-json",
            requestBodyValues: {},
            cause: new JSONParseError({ text: "event: data, not json", cause: undefined }),
          })
        },
        streamed: ["streamed result"],
        called,
      }),
    })
    const resolved = await Effect.runPromise(port.resolve({ configured: "test/compat", session: ref }))
    const out = await port.run({ handle: resolved.handle, system: "s", prompt: "p", timeoutMs: 30_000 })
    expect(out.text).toBe("streamed result")
    expect(called).toEqual(["stream"])
  })

  test("openai-compatible providers fall back to streamText on a bare JSONParseError", async () => {
    const called: string[] = []
    const port = MemoryModel.port({
      provider: compatProvider({
        generate: async () => {
          throw new JSONParseError({ text: "event: data, not json", cause: undefined })
        },
        streamed: ["streamed result"],
        called,
      }),
    })
    const resolved = await Effect.runPromise(port.resolve({ configured: "test/compat", session: ref }))
    const out = await port.run({ handle: resolved.handle, system: "s", prompt: "p", timeoutMs: 30_000 })
    expect(out.text).toBe("streamed result")
    expect(called).toEqual(["stream"])
  })

  test("openai-compatible providers stay on generateText when it succeeds", async () => {
    const called: string[] = []
    const port = MemoryModel.port({
      provider: compatProvider({
        generate: async () => ({
            content: [{ type: "text", text: '{"topic":"t","summary":"s"}' }],
            finishReason: { unified: "stop" },
            usage: { inputTokens: { total: 12 }, outputTokens: { total: 8 }, raw: {} },
            warnings: [],
            providerMetadata: {},
            request: {},
          response: {},
        }),
        called,
      }),
    })
    const resolved = await Effect.runPromise(port.resolve({ configured: "test/compat", session: ref }))
    const out = await port.run({ handle: resolved.handle, system: "s", prompt: "p", timeoutMs: 30_000 })
    expect(out.text).toBe('{"topic":"t","summary":"s"}')
    expect(called).toEqual([])
  })

  test("openai-compatible providers stream directly once a model is known to need it", async () => {
    const called: string[] = []
    const first = MemoryModel.port({
      provider: compatProvider({
        generate: async () => {
          throw new APICallError({
            message: "Invalid JSON response",
            url: "test://invalid-json",
            requestBodyValues: {},
            cause: new JSONParseError({ text: "event: data, not json", cause: undefined }),
          })
        },
        streamed: ["first"],
        called,
      }),
    })
    const resolved = await Effect.runPromise(first.resolve({ configured: "test/compat", session: ref }))
    const out = await first.run({ handle: resolved.handle, system: "s", prompt: "p", timeoutMs: 30_000 })
    expect(out.text).toBe("first")

    const again = MemoryModel.port({
      provider: compatProvider({
        generate: async () => {
          throw new Error("generateText must not run again")
        },
        streamed: ["second"],
        called,
      }),
    })
    const resolved2 = await Effect.runPromise(again.resolve({ configured: "test/compat", session: ref }))
    const out2 = await again.run({ handle: resolved2.handle, system: "s", prompt: "p", timeoutMs: 30_000 })
    expect(out2.text).toBe("second")
    expect(called).toEqual(["stream", "stream"])
  })
})
