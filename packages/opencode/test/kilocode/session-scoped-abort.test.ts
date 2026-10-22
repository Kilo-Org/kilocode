import { expect } from "bun:test"
import { Effect, Exit, Fiber, Schema } from "effect"
import { Permission } from "@/permission"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { BackgroundJob } from "@/background/job"
import { KiloSessions } from "@/kilo-sessions/kilo-sessions"
import { KiloSessionControl } from "@/kilocode/session/control"
import { KiloSessionContinuation } from "@/kilocode/session/continuation"
import { KiloSessionPromptQueue } from "@/kilocode/session/prompt-queue"
import { SessionPrompt } from "@/session/prompt"
import { MessageID, SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { provideTmpdirServer } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      SessionPrompt.node,
      SessionProjector.node,
      Session.node,
      SessionStatus.node,
      Permission.node,
      BackgroundJob.node,
      Database.node,
      CrossSpawnSpawner.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
      LayerNode.make({ service: MemoryService.Service, layer: MemoryService.layer, deps: [] }),
    ]),
    [[KiloSessions.node, KiloSessions.testLayer]],
  ),
)

it.instance("background tickets stay paused after a later continuation", () =>
  Effect.gen(function* () {
    const control = yield* KiloSessionControl.make
    const id = SessionID.descending()
    yield* control.stop(id, Effect.void)
    const paused = yield* control.begin(id, false)
    expect(paused.running()).toBe(false)
    const resumed = yield* control.begin(id, true, paused)
    expect(resumed.running()).toBe(true)
    expect(paused.running()).toBe(false)
    yield* control.stop(id, Effect.void)
    expect(resumed.running()).toBe(false)
    expect(Exit.isFailure(yield* control.begin(id, true, resumed).pipe(Effect.exit))).toBe(true)
    expect((yield* control.begin(id, false)).running()).toBe(false)
  }),
)

function config(url: string) {
  return {
    model: "test/test-model",
    enabled_providers: ["test"],
    snapshot: false,
    subagent_depth: 3,
    permission: { "*": "allow" as const },
    provider: {
      test: {
        npm: "@ai-sdk/openai-compatible",
        models: { "test-model": { name: "Test", limit: { context: 100000, output: 10000 } } },
        options: { apiKey: "test-key", baseURL: url },
      },
    },
  }
}

function matches(body: Record<string, unknown>, text: string) {
  if (!Array.isArray(body.messages)) return false
  const user = body.messages.findLast((message) => message.role === "user")
  return JSON.stringify(user?.content)?.includes(text) ?? false
}

const start = Effect.fn("ScopedAbortTest.start")(function* (foreground = false) {
  const prompt = yield* SessionPrompt.Service
  const sessions = yield* Session.Service
  const status = yield* SessionStatus.Service
  const jobs = yield* BackgroundJob.Service
  const llm = yield* TestLLMServer
  const done = Promise.withResolvers<void>()
  const parent = yield* sessions.create({ title: "Scoped stop" })
  yield* llm.pushMatch(
    ({ body }) => matches(body, "PARENT_REQUEST"),
    reply().tool("task", {
      description: "Background work",
      prompt: "CHILD_REQUEST",
      subagent_type: "general",
      background: true,
    }),
    foreground
      ? reply().tool("task", {
          description: "Foreground work",
          prompt: "FOREGROUND_REQUEST",
          subagent_type: "general",
        })
      : reply().hang(),
  )
  yield* llm.pushMatch(
    ({ body }) => matches(body, "CHILD_REQUEST"),
    reply().wait(done.promise).text("RETAINED_CHILD_RESULT").stop(),
  )
  if (foreground) yield* llm.pushMatch(({ body }) => matches(body, "FOREGROUND_REQUEST"), reply().hang())
  const fiber = yield* prompt
    .prompt({
      sessionID: parent.id,
      parts: [{ type: "text", text: "PARENT_REQUEST" }],
    })
    .pipe(Effect.forkScoped)
  yield* awaitWithTimeout(llm.wait(foreground ? 4 : 3), "parent and children did not start", "15 seconds")
  const child = (yield* jobs.list()).find(
    (job) => job.metadata?.parentSessionId === parent.id && job.metadata?.background,
  )
  if (!child) throw new Error("background child not found")
  return { prompt, sessions, status, jobs, llm, parent, child, done, fiber }
})

const delivered = Effect.fn("ScopedAbortTest.delivered")(function* (id: SessionID) {
  const sessions = yield* Session.Service
  return yield* pollWithTimeout(
    sessions
      .messages({ sessionID: id })
      .pipe(
        Effect.map((messages) =>
          messages.some((message) => KiloSessionControl.background(message.parts)) ? messages : undefined,
        ),
      ),
    "background result was not retained",
  )
})

it.live(
  "session stop preserves async work, clears queued prompts, and uses the result on the next prompt",
  () =>
    provideTmpdirServer(
      () =>
        Effect.gen(function* () {
          const run = yield* start()
          expect(() => Schema.decodeUnknownSync(Schema.Json)(run.child.metadata)).not.toThrow()
          const id = MessageID.ascending()
          const queued = yield* run.prompt
            .prompt({
              sessionID: run.parent.id,
              messageID: id,
              parts: [{ type: "text", text: "QUEUED_REQUEST" }],
            })
            .pipe(Effect.forkScoped)
          yield* pollWithTimeout(
            Effect.sync(() => (KiloSessionPromptQueue.snapshot(run.parent.id).includes(id) ? true : undefined)),
            "follow-up was not queued",
          )

          yield* run.prompt.cancel(run.parent.id, "session")
          yield* Effect.all([Fiber.await(run.fiber), Fiber.await(queued)])
          expect((yield* run.status.get(run.parent.id)).type).toBe("idle")
          expect((yield* run.jobs.get(run.child.id))?.status).toBe("running")
          expect((yield* run.status.get(SessionID.make(run.child.id))).type).toBe("busy")
          expect(KiloSessionPromptQueue.snapshot(run.parent.id)).toEqual([])
          const rejected = yield* run.prompt
            .command({ sessionID: run.parent.id, command: "missing-scoped-abort-command", arguments: "" })
            .pipe(Effect.exit)
          expect(Exit.isFailure(rejected)).toBe(true)

          run.done.resolve()
          expect((yield* run.jobs.wait({ id: run.child.id, timeout: 5000 })).info).toMatchObject({
            status: "completed",
            output: "RETAINED_CHILD_RESULT",
          })
          yield* delivered(run.parent.id)
          expect((yield* run.llm.wait(4).pipe(Effect.timeoutOption("100 millis")))._tag).toBe("None")
          expect((yield* run.status.get(run.parent.id)).type).toBe("idle")

          yield* run.llm.text("Result used")
          const result = yield* run.prompt.prompt({
            sessionID: run.parent.id,
            parts: [{ type: "text", text: "Use the retained result" }],
          })
          expect(result.parts.some((part) => part.type === "text" && part.text === "Result used")).toBe(true)
          expect(JSON.stringify((yield* run.llm.inputs).at(-1))).toContain("RETAINED_CHILD_RESULT")
          expect(yield* run.llm.calls).toBe(4)
        }),
      { config },
    ),
  30000,
)

it.live(
  "explicit continuation remains available after a stopped parent's background result arrives",
  () =>
    provideTmpdirServer(
      () =>
        Effect.gen(function* () {
          const run = yield* start()
          yield* run.prompt.cancel(run.parent.id, "session")
          const stopped = yield* Fiber.join(run.fiber)
          run.done.resolve()
          yield* run.jobs.wait({ id: run.child.id, timeout: 5000 })
          const messages = yield* delivered(run.parent.id)
          expect(KiloSessionContinuation.target(messages)).toBe(stopped.info.id)
          yield* run.llm.text("Continued with result")
          const result = yield* run.prompt.loop({ sessionID: run.parent.id, resume: stopped.info.id })
          expect(result.parts.some((part) => part.type === "text" && part.text === "Continued with result")).toBe(true)
          expect(JSON.stringify((yield* run.llm.inputs).at(-1))).toContain("RETAINED_CHILD_RESULT")
          expect(yield* run.llm.calls).toBe(4)
        }),
      { config },
    ),
  30000,
)

for (const scope of [undefined, "tree"] as const) {
  it.live(
    `${scope ?? "default"} stop cancels running background descendants`,
    () =>
      provideTmpdirServer(
        () =>
          Effect.gen(function* () {
            const run = yield* start()
            const child = yield* run.sessions.create({ parentID: SessionID.make(run.child.id), title: "Nested child" })
            yield* run.jobs.start({
              id: child.id,
              type: "task",
              metadata: { parentSessionId: run.child.id, sessionId: child.id, background: true },
              run: Effect.never,
            })
            yield* run.prompt.cancel(run.parent.id, scope)
            yield* Fiber.await(run.fiber)
            expect((yield* run.jobs.get(run.child.id))?.status).toBe("cancelled")
            expect((yield* run.jobs.get(child.id))?.status).toBe("cancelled")
            expect((yield* run.status.get(run.parent.id)).type).toBe("idle")
            expect((yield* run.status.get(SessionID.make(run.child.id))).type).toBe("idle")
            run.done.resolve()
          }),
        { config },
      ),
    30000,
  )
}

it.live(
  "session stop cancels foreground child work while its async sibling keeps running",
  () =>
    provideTmpdirServer(
      () =>
        Effect.gen(function* () {
          const run = yield* start(true)
          const foreground = (yield* run.jobs.list()).find(
            (job) => job.metadata?.parentSessionId === run.parent.id && !job.metadata?.background,
          )
          if (!foreground) throw new Error("foreground child not found")
          yield* run.prompt.cancel(run.parent.id, "session")
          yield* Fiber.await(run.fiber)
          expect((yield* run.jobs.get(foreground.id))?.status).toBe("cancelled")
          expect((yield* run.status.get(SessionID.make(foreground.id))).type).toBe("idle")
          expect((yield* run.jobs.get(run.child.id))?.status).toBe("running")
          yield* run.prompt.cancel(run.parent.id)
          run.done.resolve()
        }),
      { config },
    ),
  30000,
)
