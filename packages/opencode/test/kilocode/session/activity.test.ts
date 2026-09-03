import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Deferred, Effect, Fiber, Schema, Stream } from "effect"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { disposeInstance } from "@/effect/instance-registry"
import { Activity } from "@/kilocode/session/activity"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { QuestionID } from "@/question/schema"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { TestInstance } from "../../fixture/fixture"
import { pollWithTimeout, testEffect } from "../../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      SessionStatus.node,
      EventV2Bridge.node,
      Question.node,
      Permission.node,
      BackgroundJob.node,
      Session.node,
      SessionProjector.node,
    ]),
  ),
)

const question = (sessionID: SessionID, blocking = true) => ({
  sessionID,
  blocking,
  questions: [{ header: "Continue", question: "Continue?", options: [{ label: "Yes", description: "Continue work" }] }],
})

const info = (status: SessionStatus.Interface, id: SessionID) =>
  Effect.map(SessionStatus.snapshot(status), (items) => items.get(id) ?? { type: "idle" as const })

const waiting = (status: SessionStatus.Interface, id: SessionID, value: boolean) =>
  pollWithTimeout(
    Effect.map(info(status, id), (info) =>
      (info.working ?? (info.type === "busy" || info.type === "retry")) === value ? info : undefined,
    ),
    `session did not become working=${value}`,
  )

it.effect("keeps the working field optional on every status variant", () =>
  Effect.sync(() => {
    const encode = Schema.encodeSync(SessionStatus.Info)
    expect(encode({ type: "busy" })).toEqual({ type: "busy" })
    expect(encode({ type: "idle", working: true })).toEqual({ type: "idle", working: true })
    expect(encode({ type: "busy", working: false })).toEqual({ type: "busy", working: false })
    expect(encode({ type: "retry", attempt: 1, message: "retry", next: 1, working: true }).working).toBe(true)
    expect(
      encode({ type: "offline", requestID: QuestionID.make("que_network"), message: "offline", working: true }).working,
    ).toBe(true)
  }),
)

it.instance("overlays snapshot/SSE while keeping internal get/list and project stores raw", () =>
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const events = yield* EventV2Bridge.Service
    const id = SessionID.make("ses_idle_work")
    const seen: SessionStatus.Info[] = []
    yield* events.subscribe(SessionStatus.Event.Status).pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          if (event.data.sessionID === id) seen.push(event.data.status)
        }),
      ),
      Effect.forkChild({ startImmediately: true }),
    )
    expect(yield* info(status, id)).toEqual({ type: "idle" })
    const gate = yield* Deferred.make<void>()
    const fiber = yield* Activity.run(id, Deferred.await(gate), "job").pipe(
      Effect.forkChild({ startImmediately: true }),
    )
    yield* waiting(status, id, true)
    expect(yield* info(status, id)).toEqual({ type: "idle", working: true })
    expect(yield* status.get(id)).toEqual({ type: "idle" })
    expect((yield* status.list()).has(id)).toBe(false)
    expect((yield* SessionStatus.snapshot(status)).get(id)).toEqual({ type: "idle", working: true })
    expect((yield* SessionStatus.listAll()).has(id)).toBe(false)
    yield* Activity.flush
    expect(seen.at(-1)).toEqual({ type: "idle", working: true })
    yield* Deferred.succeed(gate, undefined)
    yield* Fiber.join(fiber)
    yield* Activity.flush
    expect((yield* SessionStatus.snapshot(status)).has(id)).toBe(false)
    expect(yield* info(status, id)).toEqual({ type: "idle" })
    expect(seen.at(-1)).toEqual({ type: "idle", working: false })
    yield* status.set(id, { type: "busy" })
    expect(yield* info(status, id)).toEqual({ type: "busy" })
    expect((yield* SessionStatus.listAll()).get(id)).toEqual({ type: "busy" })
    yield* status.set(id, { type: "idle" })
  }),
)

it.instance("tracks root permission waits and preserves an independent ordinary operation", () =>
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const permission = yield* Permission.Service
    const id = (yield* (yield* Session.Service).create({ title: "Permission activity" })).id
    yield* status.set(id, { type: "busy" })
    const fiber = yield* Activity.run(
      id,
      permission.ask({
        sessionID: id,
        permission: "bash",
        patterns: ["pwd"],
        always: [],
        metadata: {},
        ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
      }),
    ).pipe(Effect.forkChild({ startImmediately: true }))
    yield* waiting(status, id, false)
    expect(yield* status.get(id)).toEqual({ type: "busy" })
    expect((yield* status.list()).get(id)).toEqual({ type: "busy" })
    const gate = yield* Deferred.make<void>()
    const ordinary = yield* Activity.run(id, Deferred.await(gate), "observer").pipe(
      Effect.forkChild({ startImmediately: true }),
    )
    yield* waiting(status, id, true)
    yield* Deferred.succeed(gate, undefined)
    yield* Fiber.join(ordinary)
    yield* waiting(status, id, false)
    const pending = (yield* permission.list()).at(0)
    if (!pending) throw new Error("Missing permission")
    yield* permission.reply({ requestID: pending.id, reply: "once" })
    yield* Fiber.join(fiber)
    yield* status.set(id, { type: "idle" })
  }),
)

it.instance("does not classify untracked busy work as a passive wait", () =>
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const questions = yield* Question.Service
    const id = SessionID.make("ses_unknown_work")
    yield* status.set(id, { type: "busy" })
    const fiber = yield* Activity.run(id, questions.ask(question(id)), "observer").pipe(
      Effect.exit,
      Effect.forkChild({ startImmediately: true }),
    )
    const pending = yield* pollWithTimeout(
      Effect.map(questions.list(), (items) => items.at(0)),
      "Missing question",
    )
    expect((yield* info(status, id)).working).toBe(true)
    yield* questions.reject(pending.id)
    yield* Fiber.join(fiber)
    yield* status.set(id, { type: "idle" })
  }),
)

for (const blocking of [true, false]) {
  it.instance(`honors blocking=${blocking} on the real question wait`, () =>
    Effect.gen(function* () {
      const status = yield* SessionStatus.Service
      const questions = yield* Question.Service
      const id = SessionID.make(`ses_question_${blocking}`)
      yield* status.set(id, { type: "busy" })
      const fiber = yield* Activity.run(id, questions.ask(question(id, blocking))).pipe(
        Effect.exit,
        Effect.forkChild({ startImmediately: true }),
      )
      const pending = yield* pollWithTimeout(
        Effect.map(questions.list(), (items) => items.at(0)),
        "Missing question",
      )
      yield* waiting(status, id, !blocking)
      yield* questions.reject(pending.id)
      yield* Fiber.join(fiber)
      expect((yield* info(status, id)).working).toBe(false)
      yield* status.set(id, { type: "idle" })
    }),
  )
}

it.instance("does not count nested foreground waiters or queued job extensions as automatic work", () =>
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const jobs = yield* BackgroundJob.Service
    const questions = yield* Question.Service
    const parent = SessionID.make("ses_parent")
    const child = SessionID.make("ses_child")
    const nested = SessionID.make("ses_nested")
    yield* status.set(parent, { type: "busy" })
    yield* jobs.start({
      id: nested,
      type: "task",
      metadata: { sessionId: nested },
      run: questions.ask(question(nested)).pipe(Effect.as("nested")),
    })
    yield* jobs.start({
      id: child,
      type: "task",
      metadata: { sessionId: child },
      run: Activity.follow(nested, jobs.wait({ id: nested }), "delivery").pipe(Effect.as("child")),
    })
    const fiber = yield* Activity.run(parent, Activity.follow(child, jobs.wait({ id: child }), "delivery")).pipe(
      Effect.forkChild({ startImmediately: true }),
    )
    yield* waiting(status, parent, false)
    yield* waiting(status, child, false)
    yield* waiting(status, nested, false)
    const queued = yield* Deferred.make<void>()
    yield* jobs.extend({ id: nested, run: Deferred.await(queued).pipe(Effect.as("queued")) })
    expect((yield* SessionStatus.snapshot(status)).has(nested)).toBe(false)
    const pending = (yield* questions.list()).at(0)
    if (!pending) throw new Error("Missing nested question")
    yield* questions.reply({ requestID: pending.id, answers: [["Yes"]] })
    yield* waiting(status, nested, true)
    yield* Deferred.succeed(queued, undefined)
    yield* Fiber.join(fiber)
    yield* waiting(status, child, false)
    yield* waiting(status, nested, false)
    yield* status.set(parent, { type: "idle" })
  }),
)

it.instance("keeps background work independent and covers idle startup and finalization", () =>
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const jobs = yield* BackgroundJob.Service
    const questions = yield* Question.Service
    const parent = SessionID.make("ses_background_parent")
    const child = SessionID.make("ses_background_child")
    const gate = yield* Deferred.make<void>()
    const done = yield* Deferred.make<void>()
    yield* status.set(parent, { type: "busy" })
    const fiber = yield* Activity.run(parent, Deferred.await(done)).pipe(Effect.forkChild({ startImmediately: true }))
    yield* jobs.start({
      id: child,
      type: "task",
      metadata: { sessionId: child, background: true },
      run: Effect.gen(function* () {
        yield* questions.ask(question(child))
        yield* Deferred.await(gate)
        return "complete"
      }),
    })
    yield* waiting(status, child, false)
    expect((yield* info(status, parent)).working).toBe(true)
    const pending = (yield* questions.list()).at(0)
    if (!pending) throw new Error("Missing background question")
    yield* questions.reply({ requestID: pending.id, answers: [["Yes"]] })
    yield* waiting(status, child, true)
    expect((yield* info(status, child)).type).toBe("idle")
    yield* Deferred.succeed(done, undefined)
    yield* Fiber.join(fiber)
    yield* status.set(parent, { type: "idle" })
    expect((yield* SessionStatus.snapshot(status)).get(child)?.working).toBe(true)
    yield* Deferred.succeed(gate, undefined)
    yield* jobs.wait({ id: child })
    yield* waiting(status, child, false)
  }),
)

it.instance("disposes passive background observers and their blocked workers", () =>
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const jobs = yield* BackgroundJob.Service
    const questions = yield* Question.Service
    const id = SessionID.make("ses_disposed_job")
    yield* jobs.start({
      id,
      type: "task",
      metadata: { sessionId: id },
      run: questions.ask(question(id)).pipe(Effect.as("done")),
    })
    yield* pollWithTimeout(
      Effect.map(questions.list(), (items) => items.at(0)),
      "Missing background question",
    )
    yield* waiting(status, id, false)
    const instance = yield* TestInstance
    yield* Effect.promise(() => disposeInstance(instance.directory))
    expect((yield* SessionStatus.snapshot(status)).size).toBe(0)
  }),
)

it.instance("keeps retries and unsettled registration conservative, and rejects old attempt callbacks", () =>
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const questions = yield* Question.Service
    const id = SessionID.make("ses_attempts")
    yield* status.set(id, { type: "busy" })
    const captured = yield* Deferred.make<Activity.Request>()
    const old = yield* Activity.run(
      id,
      Activity.request(
        "old",
        Effect.gen(function* () {
          const request = yield* Activity.Pending
          if (!request) throw new Error("Missing request")
          Activity.start(request)
          Activity.reserve(request, "unregistered")
          Activity.finish(request)
          yield* Deferred.succeed(captured, request)
          yield* Effect.never
        }),
      ),
    ).pipe(Effect.forkChild({ startImmediately: true }))
    const previous = yield* Deferred.await(captured)
    expect((yield* info(status, id)).working).toBe(true)
    yield* Fiber.interrupt(old)
    yield* status.set(id, { type: "retry", attempt: 1, message: "retry", next: Date.now() + 1000 })
    const gate = yield* Deferred.make<void>()
    const retry = yield* Activity.run(id, Deferred.await(gate)).pipe(Effect.forkChild({ startImmediately: true }))
    expect((yield* info(status, id)).working).toBe(true)
    Activity.finish(previous)
    Activity.reserve(previous, "late")
    Activity.settle(previous, "unregistered")
    expect((yield* info(status, id)).working).toBe(true)
    yield* status.set(id, { type: "offline", requestID: QuestionID.make("que_network"), message: "offline" })
    expect(yield* info(status, id)).toMatchObject({ type: "offline", working: true })
    yield* Deferred.succeed(gate, undefined)
    yield* Fiber.join(retry)
    const blocked = yield* Activity.run(id, questions.ask(question(id))).pipe(
      Effect.exit,
      Effect.forkChild({ startImmediately: true }),
    )
    yield* waiting(status, id, false)
    const instance = yield* TestInstance
    const retired = yield* Activity.generation
    yield* Effect.promise(() => disposeInstance(instance.directory))
    Activity.reserve(previous, "disposed")
    Activity.finish(previous)
    yield* Fiber.interrupt(blocked)
    expect(yield* info(status, id)).toEqual({ type: "idle" })
    yield* Activity.run(
      id,
      Effect.gen(function* () {
        yield* Activity.run(id, Effect.void).pipe(Effect.provideService(Activity.Generation, retired))
        expect((yield* info(status, id)).working).toBe(true)
      }),
    )
  }),
)
