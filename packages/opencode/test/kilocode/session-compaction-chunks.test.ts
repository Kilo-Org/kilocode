import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as Stream from "effect/Stream"
import { LLMEvent, type LLMEvent as Event } from "@opencode-ai/llm"
import { Database } from "@opencode-ai/core/database/database"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Image } from "../../src/image/image"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { disposeTestRuntime, provideTestInstance } from "../fixture/fixture"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Snapshot } from "../../src/snapshot"
import { KiloCompactionChunks } from "../../src/kilocode/session/compaction-chunks"
import { KiloSessionCompaction } from "../../src/kilocode/session/compaction"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { Reference } from "../../src/reference/reference"
import { SessionCompaction } from "../../src/session/compaction"
import * as SessionProcessorModule from "../../src/session/processor"
import type { SessionProcessor } from "../../src/session/processor"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Session as SessionNs } from "../../src/session/session"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { SyncEvent } from "../../src/sync"
import { ProviderTest } from "../fake/provider"
import { tmpdir } from "../fixture/fixture"
import { Flag } from "@opencode-ai/core/flag/flag"
import { AppRuntime } from "../../src/effect/app-runtime"
import { remove as cleanup } from "./cleanup"

const providerID = ProviderV2.ID.make("test")
const modelID = ModelV2.ID.make("test-model")
const ref = { providerID, modelID }
const previous = Flag.KILO_DB
const dbfile = path.join(os.tmpdir(), `kilo-compaction-chunks-${process.pid}-${crypto.randomUUID()}.db`)

beforeAll(async () => {
  await fs.rm(dbfile, { force: true })
  Flag.KILO_DB = dbfile
})

afterAll(async () => {
  await AppRuntime.dispose()
  await disposeTestRuntime()
  Flag.KILO_DB = previous
  await Promise.all([dbfile, `${dbfile}-wal`, `${dbfile}-shm`].map(cleanup))
})

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

const store = {
  updateMessage: <T extends MessageV2.Info>(msg: T) => Effect.promise(() => svc.updateMessage(msg)),
  updatePart: <T extends MessageV2.Part>(part: T) => Effect.promise(() => svc.updatePart(part)),
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
  const queue: Array<Stream.Stream<Event, unknown> | ((input: LLM.StreamInput) => Stream.Stream<Event, unknown>)> = []

  return {
    push(stream: Stream.Stream<Event, unknown> | ((input: LLM.StreamInput) => Stream.Stream<Event, unknown>)) {
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
      }),
    ),
  }
}

function reply(text: string, capture?: (input: LLM.StreamInput) => void) {
  return (input: LLM.StreamInput) => {
    capture?.(input)
    const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
    return Stream.make(
      LLMEvent.textStart({ id: "txt-0" }),
      LLMEvent.textDelta({ id: "txt-0", text }),
      LLMEvent.textEnd({ id: "txt-0" }),
      LLMEvent.stepFinish({ index: 0, reason: "stop", usage }),
      LLMEvent.finish({ reason: "stop", usage }),
    )
  }
}

function fakeRuntime(outputTokenMax?: number) {
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
            metadata: Effect.fn("TestSessionProcessor.metadata")(() => Effect.void),
            completeToolCall: Effect.fn("TestSessionProcessor.completeToolCall")(() => Effect.void),
            process: Effect.fn("TestSessionProcessor.process")((stream: LLM.StreamInput) =>
              Effect.gen(function* () {
                outputs.push(input.model.limit.output)
                calls.push(JSON.stringify(stream.messages))
                const text = stream.messages.some((msg) =>
                  JSON.stringify(msg).includes("Create a new anchored summary"),
                )
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
        Layer.provide(SyncEvent.defaultLayer),
        Layer.provide(EventV2Bridge.defaultLayer),
        Layer.provide(Database.defaultLayer),
        Layer.provide(RuntimeFlags.layer({ outputTokenMax })),
        Layer.provide(Reference.defaultLayer),
        Layer.provide(bus),
        Layer.provide(
          Layer.mock(Config.Service)({
            get: () => Effect.succeed({ ...{}, compaction: { reserved: 1_000 } }),
          }),
        ),
      ),
    ),
  }
}

function liveRuntime(layer: Layer.Layer<LLM.Service>, context = 10_000) {
  const bus = Bus.layer
  const status = SessionStatus.layer.pipe(Layer.provide(bus), Layer.provide(EventV2Bridge.defaultLayer))
  const processor = SessionProcessorModule.SessionProcessor.layer.pipe(
    Layer.provide(summary),
    Layer.provide(Image.defaultLayer),
    Layer.provide(SyncEvent.defaultLayer),
  )
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
      Layer.provide(SyncEvent.defaultLayer),
      Layer.provide(EventV2Bridge.defaultLayer),
      Layer.provide(Database.defaultLayer),
      Layer.provide(RuntimeFlags.layer()),
      Layer.provide(Reference.defaultLayer),
      Layer.provide(status),
      Layer.provide(bus),
      Layer.provide(
        Layer.mock(Config.Service)({
          get: () => Effect.succeed({ ...{}, compaction: { reserved: 1_000 } }),
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
    expect(chunks.flatMap((chunk) => chunk.messages.map((msg) => msg.info.id))).toEqual(
      messages.map((msg) => msg.info.id),
    )
  })

  test("uses runtime output cap for fallback selection and chunk budget", () => {
    const model = ProviderTest.model({ providerID, id: modelID, limit: { context: 10_000, output: 8_000 } })
    const cfg = {} as Config.Info
    const outputTokenMax = 512

    expect(KiloCompactionChunks.needed({ cfg, model, tokens: 5_000, outputTokenMax })).toBe(false)
    expect(KiloCompactionChunks.budget({ cfg, model, outputTokenMax })).toBe(5_692)
  })

  test("falls back to chunk workers after the first compaction overflows", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const first = await user(session.id, "first " + "a".repeat(10_000))
        await assistant(session.id, first.id, tmp.path, "reply " + "b".repeat(10_000))
        const second = await user(session.id, "second " + "c".repeat(10_000))
        await assistant(session.id, second.id, tmp.path, "reply " + "d".repeat(10_000))
        await Effect.runPromise(
          KiloSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: ref,
            auto: false,
          }),
        )

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
          const parts = summaries
            .flatMap((msg) => msg.parts)
            .filter((part): part is MessageV2.TextPart => part.type === "text")

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
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const first = await user(session.id, "first " + "a".repeat(10_000))
        await assistant(session.id, first.id, tmp.path, "reply " + "b".repeat(10_000))
        const second = await user(session.id, "second " + "c".repeat(10_000))
        await assistant(session.id, second.id, tmp.path, "reply " + "d".repeat(10_000))
        await Effect.runPromise(
          KiloSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: ref,
            auto: false,
          }),
        )

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
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const first = await user(session.id, "first " + "a".repeat(20_000))
        await assistant(session.id, first.id, tmp.path, "reply " + "b".repeat(20_000))
        await Effect.runPromise(
          KiloSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: ref,
            auto: false,
          }),
        )

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
          const parts = summaries
            .flatMap((msg) => msg.parts)
            .filter((part): part is MessageV2.TextPart => part.type === "text")

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
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const first = await user(session.id, "single huge request " + "a".repeat(80_000))
        await Effect.runPromise(
          KiloSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: ref,
            auto: false,
          }),
        )

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

  test("caps worker output budget below the configured runtime limit", async () => {
    const { rt, calls, outputs } = fakeRuntime(512)
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const first = await user(session.id, "first " + "a".repeat(80_000))
        await assistant(session.id, first.id, tmp.path, "reply " + "b".repeat(80_000))
        await Effect.runPromise(
          KiloSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: ref,
            auto: false,
          }),
        )

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
          expect(outputs.at(-1)).toBe(512)
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
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const old = await user(session.id, "old context")
        await assistant(session.id, old.id, tmp.path, "old reply")
        const large = await user(session.id, "large replay " + "x".repeat(40_000))
        await Effect.runPromise(
          KiloSessionCompaction.create({
            session: store,
            sessionID: session.id,
            agent: "build",
            model: ref,
            auto: true,
            overflow: true,
          }),
        )

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
