import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { KiloSessions } from "../../src/kilo-sessions/kilo-sessions"
import { KiloSessionPromptQueue } from "../../src/kilocode/session/prompt-queue"
import { Question } from "../../src/question"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, SessionID } from "../../src/session/schema"
import { Session } from "../../src/session/session"
import { SessionSummary } from "../../src/session/summary"
import { provideTmpdirServer } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      SessionPrompt.node,
      Session.node,
      Question.node,
      CrossSpawnSpawner.node,
      Database.node,
      SessionProjector.node,
      LayerNode.make({ service: MemoryService.Service, layer: MemoryService.layer, deps: [] }),
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
    ]),
    [
      [KiloSessions.node, KiloSessions.testLayer],
      [RuntimeFlags.node, RuntimeFlags.layer({ enableQuestionTool: true })],
      [SessionSummary.node, Layer.mock(SessionSummary.Service)({ summarize: () => Effect.void })],
    ],
  ),
)

const questions = [
  {
    header: "Continue?",
    question: "Should I continue?",
    options: [{ label: "Yes", description: "Continue the task" }],
  },
]

const config = (url: string) => ({
  enabled_providers: ["test"],
  provider: {
    test: {
      npm: "@ai-sdk/openai-compatible",
      options: { baseURL: url, apiKey: "test-key" },
      models: { "test-model": { name: "Test", limit: { context: 100000, output: 10000 } } },
    },
  },
  agent: { code: { model: "test/test-model" } },
})

const pending = (question: Question.Interface, sessionID: SessionID) =>
  pollWithTimeout(
    question.list().pipe(Effect.map((items) => items.find((item) => item.sessionID === sessionID))),
    "question never became pending",
    "10 seconds",
  )

it.live(
  "background completion preserves a pending question and runs after it is answered",
  () =>
    provideTmpdirServer(
      ({ llm }) =>
        Effect.gen(function* () {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const question = yield* Question.Service
          const chat = yield* sessions.create({ title: "Background question regression" })
          yield* llm.tool("question", { questions })
          yield* llm.text("Background result acknowledged")

          const active = yield* prompt
            .prompt({ sessionID: chat.id, agent: "code", parts: [{ type: "text", text: "Ask before continuing" }] })
            .pipe(Effect.forkScoped)
          const request = yield* pending(question, chat.id)
          const id = MessageID.ascending()
          const notification = yield* prompt
            .prompt({
              sessionID: chat.id,
              messageID: id,
              agent: "code",
              parts: [
                {
                  type: "text",
                  text: '<task id="ses_child" state="completed">Background work finished</task>',
                  synthetic: true,
                  metadata: { background: true },
                },
              ],
            })
            .pipe(Effect.forkScoped)
          yield* pollWithTimeout(
            Effect.sync(() => (KiloSessionPromptQueue.snapshot(chat.id).includes(id) ? true : undefined)),
            "background notification did not remain queued behind the question",
          )

          expect((yield* question.list()).map((item) => item.id)).toEqual([request.id])
          expect(yield* llm.inputs.pipe(Effect.map((items) => items.length))).toBe(1)
          yield* question.reply({ requestID: request.id, answers: [["Yes"]] })
          yield* awaitWithTimeout(Fiber.join(active), "active question turn did not complete", "10 seconds")
          const result = yield* awaitWithTimeout(
            Fiber.join(notification),
            "background notification did not run after the question was answered",
            "10 seconds",
          )

          expect(
            result.parts.some((part) => part.type === "text" && part.text === "Background result acknowledged"),
          ).toBe(true)
          const messages = yield* sessions.messages({ sessionID: chat.id })
          const tool = messages.flatMap((message) => message.parts).find((part) => part.type === "tool")
          expect(tool?.type === "tool" && tool.state.status === "completed" && tool.state.metadata.answers).toEqual([
            ["Yes"],
          ])
          expect(yield* question.list()).toEqual([])
          expect(KiloSessionPromptQueue.snapshot(chat.id)).toEqual([])
          const calls = yield* llm.inputs
          expect(calls).toHaveLength(2)
          expect(JSON.stringify(calls.at(-1))).toContain("Background work finished")
        }),
      { config },
    ),
  30_000,
)

it.live(
  "human follow-up still dismisses a pending question and takes over the turn",
  () =>
    provideTmpdirServer(
      ({ llm }) =>
        Effect.gen(function* () {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const question = yield* Question.Service
          const chat = yield* sessions.create({ title: "Human question steering regression" })
          yield* llm.tool("question", { questions })
          yield* llm.text("Human follow-up acknowledged")
          const active = yield* prompt
            .prompt({ sessionID: chat.id, agent: "code", parts: [{ type: "text", text: "Ask before continuing" }] })
            .pipe(Effect.forkScoped)
          yield* pending(question, chat.id)
          const result = yield* prompt
            .prompt({ sessionID: chat.id, agent: "code", parts: [{ type: "text", text: "Do this instead" }] })
            .pipe(Effect.timeout("10 seconds"))
          yield* Fiber.join(active)

          expect(yield* question.list()).toEqual([])
          expect(
            result.parts.some((part) => part.type === "text" && part.text === "Human follow-up acknowledged"),
          ).toBe(true)
          const messages = yield* sessions.messages({ sessionID: chat.id })
          const tool = messages.flatMap((message) => message.parts).find((part) => part.type === "tool")
          expect(tool?.type === "tool" && tool.state.status === "completed" && tool.state.metadata.dismissed).toBe(true)
          expect(yield* llm.inputs.pipe(Effect.map((items) => items.length))).toBe(2)
        }),
      { config },
    ),
  30_000,
)

for (const background of [true, false]) {
  it.instance(
    background
      ? "question asked after a background notification is queued remains answerable"
      : "question asked after a human follow-up is queued is still rejected",
    () =>
      Effect.gen(function* () {
        const question = yield* Question.Service
        const sessionID = SessionID.make(`ses_${crypto.randomUUID()}`)
        const started = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const reserved = yield* Deferred.make<void>()
        const order: string[] = []
        const active = yield* KiloSessionPromptQueue.enqueue(
          sessionID,
          MessageID.ascending(),
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined)
            yield* Deferred.await(release)
            order.push("active")
          }),
          Effect.void,
        ).pipe(Effect.forkScoped)
        yield* Deferred.await(started)
        const queued = yield* KiloSessionPromptQueue.enqueue(
          sessionID,
          MessageID.ascending(),
          Effect.sync(() => {
            order.push("queued")
          }),
          Effect.void,
          Deferred.succeed(reserved, undefined).pipe(Effect.asVoid),
          !background,
        ).pipe(Effect.forkScoped)
        yield* Deferred.await(reserved)
        const ask = yield* question.ask({ sessionID, questions }).pipe(Effect.forkScoped)

        if (background) {
          const request = yield* pending(question, sessionID)
          expect(order).toEqual([])
          yield* question.reply({ requestID: request.id, answers: [["Yes"]] })
          expect(yield* Fiber.join(ask)).toEqual([["Yes"]])
        }
        if (!background) {
          const exit = yield* Fiber.await(ask)
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Question.RejectedError)
          expect(yield* question.list()).toEqual([])
        }

        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(active)
        yield* Fiber.join(queued)
        expect(order).toEqual(["active", "queued"])
        expect(KiloSessionPromptQueue.snapshot(sessionID)).toEqual([])
      }),
    15_000,
  )
}

it.instance("background arrival does not revive an older queued human follow-up's question preemption", () =>
  Effect.gen(function* () {
    const question = yield* Question.Service
    const sessionID = SessionID.make(`ses_${crypto.randomUUID()}`)
    const advance = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const started = yield* Deferred.make<void>()
    const order: string[] = []
    const first = yield* KiloSessionPromptQueue.enqueue(
      sessionID,
      MessageID.ascending(),
      Deferred.await(advance),
      Effect.void,
    ).pipe(Effect.forkScoped)
    yield* pollWithTimeout(
      Effect.sync(() => KiloSessionPromptQueue.active(sessionID)),
      "first turn did not start",
    )

    const second = MessageID.ascending()
    const active = yield* KiloSessionPromptQueue.enqueue(
      sessionID,
      second,
      Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined)
        yield* Deferred.await(release)
        order.push("active")
      }),
      Effect.void,
    ).pipe(Effect.forkScoped)
    yield* pollWithTimeout(
      Effect.sync(() => (KiloSessionPromptQueue.snapshot(sessionID).includes(second) ? true : undefined)),
      "second turn did not queue",
    )
    const older = MessageID.ascending()
    const human = yield* KiloSessionPromptQueue.enqueue(
      sessionID,
      older,
      Effect.sync(() => {
        order.push("human")
      }),
      Effect.void,
    ).pipe(Effect.forkScoped)
    yield* pollWithTimeout(
      Effect.sync(() => (KiloSessionPromptQueue.snapshot(sessionID).includes(older) ? true : undefined)),
      "human follow-up did not queue",
    )
    yield* Deferred.succeed(advance, undefined)
    yield* Fiber.join(first)
    yield* Deferred.await(started)

    const reserved = yield* Deferred.make<void>()
    const notification = yield* KiloSessionPromptQueue.enqueue(
      sessionID,
      MessageID.ascending(),
      Effect.sync(() => {
        order.push("background")
      }),
      Effect.void,
      Deferred.succeed(reserved, undefined).pipe(Effect.asVoid),
      false,
    ).pipe(Effect.forkScoped)
    yield* Deferred.await(reserved)
    const ask = yield* question.ask({ sessionID, questions }).pipe(Effect.forkScoped)
    const request = yield* pending(question, sessionID)
    yield* question.reply({ requestID: request.id, answers: [["Yes"]] })
    expect(yield* Fiber.join(ask)).toEqual([["Yes"]])
    expect(order).toEqual([])

    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(active)
    yield* Fiber.join(human)
    yield* Fiber.join(notification)
    expect(order).toEqual(["active", "human", "background"])
  }),
)
