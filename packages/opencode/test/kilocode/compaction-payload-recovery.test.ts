import { afterEach, describe, expect, mock, test } from "bun:test"
import { APICallError } from "ai"
import { Effect, Layer, ManagedRuntime, Scope } from "effect"
import * as Stream from "effect/Stream"
import { LLMEvent, type LLMEvent as Event } from "@opencode-ai/llm"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Image } from "../../src/image/image"
import { KiloCompactionPayloadRecovery } from "../../src/kilocode/session/compaction-payload-recovery"
import { KiloSessionCompaction } from "../../src/kilocode/session/compaction"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { provideTestInstance } from "../fixture/fixture"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Snapshot } from "../../src/snapshot"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import * as SessionProcessorModule from "../../src/session/processor"
import { Session as SessionNs } from "../../src/session/session"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Reference } from "../../src/reference/reference"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { SyncEvent } from "../../src/sync"
import { ProviderTest } from "../fake/provider"
import { tmpdir } from "../fixture/fixture"

const sessionID = SessionID.make("ses_payload_recovery")
const userID = MessageID.ascending()
const assistantID = MessageID.ascending()
const providerID = ProviderID.make("test")
const modelID = ModelID.make("test-model")

const ref = {
  providerID,
  modelID,
}

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

function base(id: MessageID) {
  return {
    id: PartID.ascending(),
    messageID: id,
    sessionID,
  }
}

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

async function assistant(sessionID: SessionID, parentID: MessageID, root: string) {
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
    finish: "end_turn",
  }
  await svc.updateMessage(msg)
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

function reply(
  text: string,
  capture?: (input: LLM.StreamInput) => void,
): (input: LLM.StreamInput) => Stream.Stream<Event, unknown> {
  return (input) => {
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

const scope = Layer.effect(Scope.Scope, Scope.make())

function runtime(layer: Layer.Layer<LLM.Service>, config = Config.defaultLayer) {
  const bus = Bus.layer
  const status = SessionStatus.layer.pipe(Layer.provide(bus))
  const processor = SessionProcessorModule.SessionProcessor.layer.pipe(
    Layer.provide(summary),
    Layer.provide(Image.defaultLayer),
    Layer.provide(SyncEvent.defaultLayer),
  )
  const model = ProviderTest.model({ providerID, id: modelID, limit: { context: 100_000, output: 32_000 } })
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
      Layer.provide(config),
      Layer.provide(RuntimeFlags.layer()),
      Layer.provide(scope),
      Layer.provide(Reference.defaultLayer),
      Layer.provide(SyncEvent.defaultLayer),
      Layer.provide(EventV2Bridge.defaultLayer),
      Layer.provide(Reference.defaultLayer),
    ),
  )
}

afterEach(() => {
  mock.restore()
})

describe("KiloCompactionPayloadRecovery", () => {
  test("detects Kilo gateway payload-size errors", () => {
    const error = new MessageV2.ContextOverflowError({
      message: "Request Entity Too Large",
      responseBody: "Request Entity Too Large\n\nFUNCTION_PAYLOAD_TOO_LARGE",
    }).toObject()

    expect(KiloCompactionPayloadRecovery.matches(error)).toBe(true)
  })

  test("strips media and marks completed tool outputs compacted", async () => {
    const user: MessageV2.WithParts = {
      info: {
        id: userID,
        role: "user",
        sessionID,
        agent: "build",
        model: { providerID, modelID },
        time: { created: Date.now() },
      },
      parts: [
        {
          ...base(userID),
          type: "file",
          mime: "image/png",
          filename: "screen.png",
          url: "data:image/png;base64,abc",
        },
      ],
    }
    const tool: MessageV2.ToolPart = {
      ...base(assistantID),
      type: "tool",
      callID: "call-1",
      tool: "bash",
      state: {
        status: "completed",
        input: {},
        output: "large output",
        title: "Bash",
        metadata: {},
        time: { start: Date.now(), end: Date.now() },
      },
    }
    const assistant: MessageV2.WithParts = {
      info: {
        id: assistantID,
        role: "assistant",
        parentID: userID,
        sessionID,
        mode: "build",
        agent: "build",
        path: { cwd: "/tmp", root: "/tmp" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID,
        providerID,
        time: { created: Date.now() },
      },
      parts: [tool],
    }
    const updated: MessageV2.Part[] = []

    await Effect.runPromise(
      KiloCompactionPayloadRecovery.strip({
        messages: [user, assistant],
        update: (part) => Effect.sync(() => updated.push(part)).pipe(Effect.as(part)),
      }),
    )

    expect(updated).toHaveLength(2)
    expect(updated[0]).toMatchObject({
      type: "text",
      text: "[Attached image/png: screen.png]",
    })
    expect(updated[1]?.type).toBe("tool")
    if (updated[1]?.type === "tool" && updated[1].state.status === "completed") {
      expect(updated[1].state.time.compacted).toBeNumber()
    }
  })

  test("retries compaction without media and tool outputs after payload-size failure", async () => {
    await using tmp = await tmpdir({ git: true })
    const stub = llm()
    const captures: string[] = []
    stub.push((input) => {
      captures.push(JSON.stringify(input.messages))
      return Stream.fail(
        new APICallError({
          message: "Request Entity Too Large",
          url: "https://api.kilo.ai/api/openrouter/responses",
          requestBodyValues: {},
          statusCode: 413,
          responseHeaders: { "content-type": "text/plain" },
          responseBody: "Request Entity Too Large\n\nFUNCTION_PAYLOAD_TOO_LARGE",
          isRetryable: false,
        }),
      )
    })
    stub.push(
      reply("summary", (input) => {
        captures.push(JSON.stringify(input.messages))
      }),
    )

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const old = await user(session.id, "old image turn")
        await svc.updatePart({
          id: PartID.ascending(),
          messageID: old.id,
          sessionID: session.id,
          type: "file",
          mime: "image/png",
          filename: "old.png",
          url: `data:image/png;base64,${"a".repeat(8_000)}`,
        })
        const oldReply = await assistant(session.id, old.id, tmp.path)
        await svc.updatePart({
          id: PartID.ascending(),
          messageID: oldReply.id,
          sessionID: session.id,
          type: "tool",
          callID: crypto.randomUUID(),
          tool: "bash",
          state: {
            status: "completed",
            input: {},
            output: "old output".repeat(10_000),
            title: "old",
            metadata: {},
            time: { start: Date.now(), end: Date.now() },
          },
        })
        await user(session.id, "latest turn")
        const keep = await user(session.id, "preserved tail turn")
        const keepReply = await assistant(session.id, keep.id, tmp.path)
        await svc.updatePart({
          id: PartID.ascending(),
          messageID: keepReply.id,
          sessionID: session.id,
          type: "tool",
          callID: crypto.randomUUID(),
          tool: "bash",
          state: {
            status: "completed",
            input: {},
            output: "keep output",
            title: "keep",
            metadata: {},
            time: { start: Date.now(), end: Date.now() },
          },
        })
        await Effect.runPromise(
          KiloSessionCompaction.create({
            session: {
              updateMessage: (msg) => Effect.promise(() => svc.updateMessage(msg)),
              updatePart: (part) => Effect.promise(() => svc.updatePart(part)),
            },
            sessionID: session.id,
            agent: "build",
            model: ref,
            auto: false,
          }),
        )

        const rt = runtime(stub.layer, Config.defaultLayer)
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
          expect(captures).toHaveLength(2)
          expect(captures[0]).toContain("Attached image/png: old.png")
          expect(captures[0]).toContain("old output")
          expect(captures[0]).not.toContain("keep output")
          expect(captures[1]).not.toContain("data:image/png;base64")
          expect(captures[1]).not.toContain("old output")
          expect(captures[1]).not.toContain("keep output")
          expect(captures[1]).toContain("Attached image/png: old.png")
          expect(captures[1]).toContain("Old tool result content cleared")
          const tools = (await svc.messages({ sessionID: session.id }))
            .flatMap((msg) => msg.parts)
            .filter((part): part is MessageV2.ToolPart => part.type === "tool")
          expect(tools).toHaveLength(2)
          expect(tools[0]?.type).toBe("tool")
          if (tools[0]?.state.status === "completed") expect(tools[0].state.time.compacted).toBeNumber()
          expect(tools[1]?.type).toBe("tool")
          if (tools[1]?.state.status === "completed") expect(tools[1].state.time.compacted).toBeUndefined()
        } finally {
          await rt.dispose()
        }
      },
    })
  })
})
