import { afterEach, describe, expect, mock, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Snapshot } from "../../src/snapshot"
import { KiloCompactionChunks } from "../../src/kilocode/session/compaction-chunks"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionCompaction } from "../../src/session/compaction"
import * as SessionProcessorModule from "../../src/session/processor"
import type { SessionProcessor } from "../../src/session/processor"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Session as SessionNs } from "../../src/session/session"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { ProviderTest } from "../fake/provider"
import { tmpdir } from "../fixture/fixture"

const providerID = ProviderID.make("test")
const modelID = ModelID.make("test-model")
const ref = { providerID, modelID }

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

const svc = {
  create(input?: SessionNs.CreateInput) {
    return run(SessionNs.Service.use((svc) => svc.create(input)))
  },
  messages(input: Parameters<SessionNs.Interface["messages"]>[0]) {
    return run(SessionNs.Service.use((svc) => svc.messages(input)))
  },
  updateMessage<T extends MessageV2.Info>(msg: T) {
    return run(SessionNs.Service.use((svc) => svc.updateMessage(msg)))
  },
  updatePart<T extends MessageV2.Part>(part: T) {
    return run(SessionNs.Service.use((svc) => svc.updatePart(part)))
  },
}

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

async function user(sessionID: SessionID, text: string) {
  const msg = await svc.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  await svc.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
}

async function assistant(sessionID: SessionID, parentID: MessageID, root: string, text: string) {
  const msg: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: root, root },
    cost: 0,
    tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID,
    providerID,
    parentID,
    time: { created: Date.now() },
    finish: "stop",
  }
  await svc.updateMessage(msg)
  await svc.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
}

function llm() {
  const queue: Array<
    Stream.Stream<LLM.Event, unknown> | ((input: LLM.StreamInput) => Stream.Stream<LLM.Event, unknown>)
  > = []

  return {
    push(stream: Stream.Stream<LLM.Event, unknown> | ((input: LLM.StreamInput) => Stream.Stream<LLM.Event, unknown>)) {
      queue.push(stream)
    },
    layer: Layer.succeed(
      LLM.Service,
      LLM.Service.of({
        stream: (input) => {
          const item = queue.shift() ?? Stream.empty
          const stream = typeof item === "function" ? item(input) : item
          return stream.pipe(Stream.mapEffect((event) => Effect.succeed(event)))
        },
        raw: () => Effect.die("raw not implemented in test LLM"),
      }),
    ),
  }
}

function reply(text: string, capture?: (input: LLM.StreamInput) => void) {
  return (input: LLM.StreamInput) => {
    capture?.(input)
    return Stream.make(
      { type: "start" } as LLM.Event,
      { type: "text-start", id: "txt-0" } as LLM.Event,
      { type: "text-delta", id: "txt-0", delta: text, text } as LLM.Event,
      { type: "text-end", id: "txt-0" } as LLM.Event,
      {
        type: "finish-step",
        finishReason: "stop",
        rawFinishReason: "stop",
        response: { id: "res", modelId: "test-model", timestamp: new Date() },
        providerMetadata: undefined,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
          outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
        },
      } as LLM.Event,
      {
        type: "finish",
        finishReason: "stop",
        rawFinishReason: "stop",
        totalUsage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
          outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
        },
      } as LLM.Event,
    )
  }
}

function overflow() {
  return Stream.make(
    { type: "start" } as LLM.Event,
    {
      type: "finish-step",
      finishReason: "stop",
      rawFinishReason: "stop",
      response: { id: "res", modelId: "test-model", timestamp: new Date() },
      providerMetadata: undefined,
      usage: {
        inputTokens: 20_000,
        outputTokens: 1,
        totalTokens: 20_001,
        inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      },
    } as LLM.Event,
    {
      type: "finish",
      finishReason: "stop",
      rawFinishReason: "stop",
      totalUsage: {
        inputTokens: 20_000,
        outputTokens: 1,
        totalTokens: 20_001,
        inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      },
    } as LLM.Event,
  )
}

function runtime(layer: Layer.Layer<LLM.Service>, context = 7_000) {
  const bus = Bus.layer
  const status = SessionStatus.layer.pipe(Layer.provide(bus))
  const processor = SessionProcessorModule.SessionProcessor.layer.pipe(Layer.provide(summary))
  const model = ProviderTest.model({ providerID, id: modelID, limit: { context, output: 1_000 } })
  return ManagedRuntime.make(
    Layer.mergeAll(SessionCompaction.layer.pipe(Layer.provide(processor)), processor, bus, status).pipe(
      Layer.provide(ProviderTest.fake({ model }).layer),
      Layer.provide(SessionNs.defaultLayer),
      Layer.provide(Snapshot.defaultLayer),
      Layer.provide(layer),
      Layer.provide(Permission.defaultLayer),
      Layer.provide(Agent.defaultLayer),
      Layer.provide(Plugin.defaultLayer),
      Layer.provide(status),
      Layer.provide(bus),
      Layer.provide(Layer.mock(Config.Service)({ get: () => Effect.succeed({ ...Config.Info.zod.parse({}), compaction: { reserved: 1_000 } }) })),
    ),
  )
}

function fakeRuntime() {
  const calls: string[] = []
  const outputs: number[] = []
  const bus = Bus.layer
  const processor = Layer.effect(
    SessionProcessorModule.SessionProcessor.Service,
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      return SessionProcessorModule.SessionProcessor.Service.of({
        create: Effect.fn("TestSessionProcessor.create")((input) =>
          Effect.succeed({
            get message() {
              return input.assistantMessage
            },
            updateToolCall: Effect.fn("TestSessionProcessor.updateToolCall")(() => Effect.succeed(undefined)),
            completeToolCall: Effect.fn("TestSessionProcessor.completeToolCall")(() => Effect.void),
            process: Effect.fn("TestSessionProcessor.process")((stream: LLM.StreamInput) =>
              Effect.gen(function* () {
                outputs.push(input.model.limit.output)
                calls.push(JSON.stringify(stream.messages))
                const text = stream.messages.some((msg) => JSON.stringify(msg).includes("Create a new anchored summary"))
                  ? "final summary"
                  : calls.length === 1
                    ? "chunk one"
                    : "chunk two"
                yield* sessions.updatePart({
                  id: PartID.ascending(),
                  messageID: input.assistantMessage.id,
                  sessionID: input.sessionID,
                  type: "text",
                  text,
                })
                input.assistantMessage.finish = "stop"
                return "continue" as const
              }),
            ),
          } satisfies SessionProcessor.Handle),
        ),
      })
    }),
  )
  const model = ProviderTest.model({ providerID, id: modelID, limit: { context: 10_000, output: 1_000 } })
  return {
    calls,
    outputs,
    rt: ManagedRuntime.make(
      Layer.mergeAll(SessionCompaction.layer.pipe(Layer.provide(processor)), processor, bus).pipe(
        Layer.provide(ProviderTest.fake({ model }).layer),
        Layer.provide(SessionNs.defaultLayer),
        Layer.provide(Agent.defaultLayer),
        Layer.provide(Plugin.defaultLayer),
        Layer.provide(bus),
        Layer.provide(
          Layer.mock(Config.Service)({
            get: () => Effect.succeed({ ...Config.Info.zod.parse({}), compaction: { reserved: 1_000 } }),
          }),
        ),
      ),
    ),
  }
}

function liveRuntime(layer: Layer.Layer<LLM.Service>, context = 10_000) {
  const bus = Bus.layer
  const status = SessionStatus.layer.pipe(Layer.provide(bus))
  const processor = SessionProcessorModule.SessionProcessor.layer.pipe(Layer.provide(summary))
  const model = ProviderTest.model({ providerID, id: modelID, limit: { context, output: 1_000 } })
  return ManagedRuntime.make(
    Layer.mergeAll(SessionCompaction.layer.pipe(Layer.provide(processor)), processor, bus, status).pipe(
      Layer.provide(ProviderTest.fake({ model }).layer),
      Layer.provide(SessionNs.defaultLayer),
      Layer.provide(Snapshot.defaultLayer),
      Layer.provide(layer),
      Layer.provide(Permission.defaultLayer),
      Layer.provide(Agent.defaultLayer),
      Layer.provide(Plugin.defaultLayer),
      Layer.provide(status),
      Layer.provide(bus),
      Layer.provide(
        Layer.mock(Config.Service)({
          get: () => Effect.succeed({ ...Config.Info.zod.parse({}), compaction: { reserved: 1_000 } }),
        }),
      ),
    ),
  )
}

afterEach(() => {
  mock.restore()
})

describe("KiloCompactionChunks", () => {
  test("splits oversized history into chronological chunks", async () => {
    const model = ProviderTest.model({ providerID, id: modelID, limit: { context: 7_000, output: 1_000 } })
    const sessionID = SessionID.make("ses_chunks_split")
    const messages: MessageV2.WithParts[] = Array.from({ length: 4 }, (_, index) => ({
      info: {
        id: MessageID.ascending(),
        role: "user",
        sessionID,
        agent: "build",
        model: ref,
        time: { created: Date.now() },
      },
      parts: [
        {
          id: PartID.ascending(),
          messageID: MessageID.ascending(),
          sessionID,
          type: "text",
          text: `${index}: ${"x".repeat(8_000)}`,
        },
      ],
    }))

    const chunks = await Effect.runPromise(KiloCompactionChunks.split({ messages, model, size: 2_000 }))

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flatMap((chunk) => chunk.messages.map((msg) => msg.info.id))).toEqual(messages.map((msg) => msg.info.id))
  })

  test("falls back to chunk workers after the first compaction overflows", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const first = await user(session.id, "first " + "a".repeat(10_000))
        await assistant(session.id, first.id, tmp.path, "reply " + "b".repeat(10_000))
        const second = await user(session.id, "second " + "c".repeat(10_000))
        await assistant(session.id, second.id, tmp.path, "reply " + "d".repeat(10_000))
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: false })

        const { rt, calls } = fakeRuntime()
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const all = await svc.messages({ sessionID: session.id })
          const summaries = all.filter((msg) => msg.info.role === "assistant" && msg.info.summary)
          const parts = summaries.flatMap((msg) => msg.parts).filter((part): part is MessageV2.TextPart => part.type === "text")

          expect(result).toBe("continue")
          expect(calls.length).toBeGreaterThanOrEqual(1)
          expect(calls.at(-1)).toContain("Create a new anchored summary")
          expect(summaries).toHaveLength(1)
          expect(parts.map((part) => part.text)).toEqual(["final summary"])
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("uses chunk fallback before sending oversized normal compaction", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const first = await user(session.id, "first " + "a".repeat(10_000))
        await assistant(session.id, first.id, tmp.path, "reply " + "b".repeat(10_000))
        const second = await user(session.id, "second " + "c".repeat(10_000))
        await assistant(session.id, second.id, tmp.path, "reply " + "d".repeat(10_000))
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: false })

        const { rt, calls } = fakeRuntime()
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          expect(result).toBe("continue")
          expect(calls[0]).toContain("Summarize conversation chunk")
          expect(calls[0]).not.toContain("Create a new anchored summary")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("uses a worker even when fallback selection produces one oversized chunk", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const first = await user(session.id, "first " + "a".repeat(20_000))
        await assistant(session.id, first.id, tmp.path, "reply " + "b".repeat(20_000))
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: false })

        const { rt, calls } = fakeRuntime()
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const all = await svc.messages({ sessionID: session.id })
          const summaries = all.filter((msg) => msg.info.role === "assistant" && msg.info.summary)
          const parts = summaries.flatMap((msg) => msg.parts).filter((part): part is MessageV2.TextPart => part.type === "text")

          expect(result).toBe("continue")
          expect(calls.length).toBeGreaterThan(0)
          expect(calls[0]).toContain("Summarize conversation chunk")
          expect(summaries).toHaveLength(1)
          expect(parts.map((part) => part.text)).toEqual(["final summary"])
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("serializes oversized fallback chunks before summarizing", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const first = await user(session.id, "single huge request " + "a".repeat(80_000))
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: false })

        const { rt, calls } = fakeRuntime()
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          expect(result).toBe("continue")
          expect(calls[0]).toContain("compacted transcript")
          expect(calls[0]).toContain("Text truncated for compaction")
          expect(calls[0]).toContain("Summarize conversation chunk")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("caps worker output budget below oversized model output limit", async () => {
    const { rt, calls, outputs } = fakeRuntime()
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const first = await user(session.id, "first " + "a".repeat(1_000))
        await assistant(session.id, first.id, tmp.path, "reply " + "b".repeat(1_000))
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: false })

        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          expect(result).toBe("continue")
          expect(calls.length).toBeGreaterThan(0)
          expect(outputs.every((value) => value <= 2_048)).toBe(true)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("compacts oversized replay turns after overflow compaction", async () => {
    const stub = llm()
    const calls: string[] = []
    stub.push(reply("history summary"))
    stub.push(reply("replay summary", (input) => calls.push(JSON.stringify(input.messages))))

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const old = await user(session.id, "old context")
        await assistant(session.id, old.id, tmp.path, "old reply")
        const large = await user(session.id, "large replay " + "x".repeat(40_000))
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: true, overflow: true })

        const rt = liveRuntime(stub.layer)
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: true,
                overflow: true,
              }),
            ),
          )

          const all = await svc.messages({ sessionID: session.id })
          const replay = all.findLast((msg) => msg.info.role === "user" && msg.info.id !== large.id)
          const part = replay?.parts.find((part): part is MessageV2.TextPart => part.type === "text")

          expect(result).toBe("continue")
          expect(calls).toHaveLength(1)
          expect(calls[0]).toContain("Summarize conversation chunk 1 of 1")
          expect(part?.text).toContain("compacted representation")
          expect(part?.text).toContain("replay summary")
        } finally {
          await rt.dispose()
        }
      },
    })
  })
})
