import { expect } from "bun:test"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scheduler, Scope } from "effect"
import { AppNodeBuilder } from "../../src/effect/app-node-builder"
import { LayerNode } from "../../src/effect/layer-node"
import { BackgroundJob } from "../../src/background-job"
import { Database } from "../../src/database/database"
import { SessionDrain } from "../../src/kilocode/session/drain"
import { ProjectTable } from "../../src/project/sql"
import { Project } from "../../src/project"
import { AbsolutePath } from "../../src/schema"
import { SessionSchema } from "../../src/session/schema"
import { SessionTable } from "../../src/session/sql"
import { SessionRunCoordinator } from "../../src/session/run-coordinator"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, SessionDrain.node, BackgroundJob.node])))
const parent = SessionSchema.ID.make("ses_drain_parent")
const child = SessionSchema.ID.make("ses_drain_child")
const grandchild = SessionSchema.ID.make("ses_drain_grandchild")
const other = SessionSchema.ID.make("ses_drain_other")

// Seed durable ancestry rather than imitating subagent ownership in a mock registry.
const family = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  for (const session of [
    { id: parent },
    { id: child, parent_id: parent },
    { id: grandchild, parent_id: child },
    { id: other },
  ]) {
    yield* db
      .insert(SessionTable)
      .values({
        ...session,
        project_id: Project.ID.global,
        slug: "drain",
        directory: session.id === child ? "/elsewhere" : "/project",
        title: "drain",
        version: "test",
      })
      .run()
      .pipe(Effect.orDie)
  }
})

it.effect("waits for descendant execution and callback handoff, not unrelated sessions", () =>
  Effect.gen(function* () {
    yield* family
    const drain = yield* SessionDrain.Service
    const first = yield* drain.hold(parent)
    const descendant = yield* drain.hold(grandchild)
    const unrelated = yield* drain.hold(other)
    const waiting = yield* drain.wait(parent).pipe(Effect.forkChild({ startImmediately: true }))
    first()
    expect(waiting.pollUnsafe()).toBeUndefined()
    const callback = yield* drain.hold(parent)
    descendant()
    expect(waiting.pollUnsafe()).toBeUndefined()
    callback()
    yield* Fiber.join(waiting)
    unrelated()
  }),
)

it.effect("an idle child contributes again when resumed; stale releases are harmless", () =>
  Effect.gen(function* () {
    yield* family
    const drain = yield* SessionDrain.Service
    const previous = yield* drain.hold(child)
    previous()
    yield* drain.wait(parent)
    const release = yield* drain.hold(child)
    const waiting = yield* drain.wait(parent).pipe(Effect.forkChild({ startImmediately: true }))
    previous()
    expect(waiting.pollUnsafe()).toBeUndefined()
    release()
    yield* Fiber.join(waiting)
  }),
)

it.effect("cancelling an observer does not cancel work or another observer", () =>
  Effect.gen(function* () {
    const drain = yield* SessionDrain.Service
    const release = yield* drain.hold(parent)
    const cancelled = yield* drain.wait(parent).pipe(Effect.forkChild({ startImmediately: true }))
    const waiting = yield* drain.wait(parent).pipe(Effect.forkChild({ startImmediately: true }))
    yield* Fiber.interrupt(cancelled)
    expect(waiting.pollUnsafe()).toBeUndefined()
    release()
    yield* Fiber.join(waiting)
  }),
)

it.effect("tracked failures release reservations without poisoning later waits", () =>
  Effect.gen(function* () {
    const drain = yield* SessionDrain.Service
    expect((yield* drain.track(parent, Effect.fail("expected failure")).pipe(Effect.exit))._tag).toBe("Failure")
    yield* drain.wait(parent)
    yield* drain.track(parent, Effect.void)
    yield* drain.wait(parent)
  }),
)

it.effect("includes descendants started after the observer registered", () =>
  Effect.gen(function* () {
    yield* family
    const drain = yield* SessionDrain.Service
    const release = yield* drain.hold(parent)
    const waiting = yield* drain.wait(parent).pipe(Effect.forkChild({ startImmediately: true }))
    const descendant = yield* drain.hold(grandchild)
    release()
    expect(waiting.pollUnsafe()).toBeUndefined()
    descendant()
    yield* Fiber.join(waiting)
  }),
)

it.effect("reacquisition before an awakened observer resumes cannot report stale idle", () =>
  Effect.gen(function* () {
    const drain = yield* SessionDrain.Service
    const queued: Array<() => void> = []
    const scheduler = new Scheduler.MixedScheduler("async", (task) => {
      queued.push(task)
      return () => {
        const index = queued.indexOf(task)
        if (index >= 0) queued.splice(index, 1)
      }
    })
    let paused = false
    scheduler.shouldYield = () => paused
    const flush = () => {
      while (queued.length) queued.shift()?.()
    }
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        paused = false
        flush()
      }),
    )
    const first = yield* drain.hold(parent)
    const waiting = yield* drain
      .wait(parent)
      .pipe(Effect.forkChild({ startImmediately: true }), Effect.provideService(Scheduler.Scheduler, scheduler))
    flush()
    paused = true
    first()
    const second = yield* drain.hold(parent)
    paused = false
    flush()
    expect(waiting.pollUnsafe()).toBeUndefined()
    second()
    flush()
    yield* Fiber.join(waiting)
  }),
)

it.effect("failed foreground work hands its reservation to a pending successor", () =>
  Effect.gen(function* () {
    const drain = yield* SessionDrain.Service
    const first = yield* Deferred.make<void>()
    const second = yield* Deferred.make<void>()
    const started = yield* Deferred.make<void>()
    let runs = 0
    const coordinator = yield* SessionRunCoordinator.make({
      lease: drain.hold,
      drain: () =>
        Effect.gen(function* () {
          runs++
          if (runs === 1) return yield* Deferred.await(first).pipe(Effect.andThen(Effect.fail("expected failure")))
          yield* Deferred.succeed(started, undefined)
          return yield* Deferred.await(second)
        }),
    })
    yield* coordinator.wake(parent)
    const waiting = yield* drain.wait(parent).pipe(Effect.forkChild({ startImmediately: true }))
    yield* coordinator.wake(parent)
    yield* Deferred.succeed(first, undefined)
    yield* Deferred.await(started)
    expect(waiting.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(second, undefined)
    yield* Fiber.join(waiting)
  }),
)

it.effect("racing asynchronous reservations do not start duplicate owners or leak holds", () =>
  Effect.gen(function* () {
    const drain = yield* SessionDrain.Service
    const acquired = yield* Deferred.make<void>()
    const ready = yield* Deferred.make<void>()
    const started = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<void>()
    const joined = yield* Deferred.make<void>()
    let leases = 0
    let runs = 0
    const coordinator = yield* SessionRunCoordinator.make({
      lease: (id: SessionSchema.ID) =>
        drain.hold(id).pipe(
          Effect.tap(() =>
            Effect.gen(function* () {
              if (++leases === 2) yield* Deferred.succeed(acquired, undefined)
              yield* Deferred.await(ready)
            }),
          ),
          Effect.map((release) => () => {
            release()
            Deferred.doneUnsafe(joined, Effect.void)
          }),
        ),
      drain: () =>
        Effect.gen(function* () {
          runs++
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(finish)
        }),
    })
    const first = yield* coordinator.run(parent).pipe(Effect.forkChild)
    const second = yield* coordinator.run(parent).pipe(Effect.forkChild)
    yield* Deferred.await(acquired)
    yield* Deferred.succeed(ready, undefined)
    yield* Deferred.await(started)
    yield* Deferred.await(joined)
    const waiting = yield* drain.wait(parent).pipe(Effect.forkChild({ startImmediately: true }))
    yield* Deferred.succeed(finish, undefined)
    yield* Effect.all([Fiber.join(first), Fiber.join(second), Fiber.join(waiting)])
    expect(runs).toBe(1)
  }),
)

it.effect("coalesced foreground wakeups keep a continuous reservation", () =>
  Effect.gen(function* () {
    const drain = yield* SessionDrain.Service
    const first = yield* Deferred.make<void>()
    const second = yield* Deferred.make<void>()
    const started = yield* Deferred.make<void>()
    let runs = 0
    const coordinator = yield* SessionRunCoordinator.make({
      lease: drain.hold,
      drain: () =>
        Effect.gen(function* () {
          runs++
          if (runs === 1) return yield* Deferred.await(first)
          yield* Deferred.succeed(started, undefined)
          return yield* Deferred.await(second)
        }),
    })
    yield* coordinator.wake(parent)
    const waiting = yield* drain.wait(parent).pipe(Effect.forkChild({ startImmediately: true }))
    yield* coordinator.wake(parent)
    yield* Deferred.succeed(first, undefined)
    yield* Deferred.await(started)
    expect(waiting.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(second, undefined)
    yield* Fiber.join(waiting)
    expect(runs).toBe(2)
  }),
)

it.effect("background start and extension are reserved before acknowledgment, including delivery", () =>
  Effect.gen(function* () {
    yield* family
    const drain = yield* SessionDrain.Service
    const jobs = yield* BackgroundJob.Service
    const first = yield* Deferred.make<void>()
    const delivery = yield* Deferred.make<void>()
    const delivered = yield* Deferred.make<void>()
    const job = yield* jobs.start({
      type: "subagent",
      metadata: { sessionID: child },
      run: Deferred.await(first).pipe(Effect.as("child done")),
    })
    expect(
      yield* jobs.extend({
        id: job.id,
        run: Deferred.succeed(delivered, undefined).pipe(
          Effect.andThen(Deferred.await(delivery)),
          Effect.as("callback delivered"),
        ),
      }),
    ).toBe(true)
    const unrelated = yield* jobs.start({ type: "unrelated", metadata: { sessionID: other }, run: Effect.never })
    const waiting = yield* drain.wait(parent).pipe(Effect.forkChild({ startImmediately: true }))
    yield* Deferred.succeed(first, undefined)
    yield* Deferred.await(delivered)
    expect(waiting.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(delivery, undefined)
    yield* Fiber.join(waiting)
    expect((yield* jobs.wait({ id: job.id })).info?.output).toBe("callback delivered")
    expect((yield* jobs.get(unrelated.id))?.status).toBe("running")
  }),
)

it.effect("background cancellation waits for cleanup and releases descendant reservations", () =>
  Effect.gen(function* () {
    yield* family
    const drain = yield* SessionDrain.Service
    const jobs = yield* BackgroundJob.Service
    const cleaning = yield* Deferred.make<void>()
    const cleaned = yield* Deferred.make<void>()
    const job = yield* jobs.start({
      type: "subagent",
      metadata: { parentSessionID: child },
      run: Effect.never.pipe(
        Effect.ensuring(Deferred.succeed(cleaning, undefined).pipe(Effect.andThen(Deferred.await(cleaned)))),
      ),
    })
    const waiting = yield* drain.wait(parent).pipe(Effect.forkChild({ startImmediately: true }))
    const cancelled = yield* jobs.cancel(job.id).pipe(Effect.forkChild)
    yield* Deferred.await(cleaning)
    expect(waiting.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(cleaned, undefined)
    yield* Fiber.join(cancelled)
    yield* Fiber.join(waiting)
  }),
)

it.effect("closing the tracker interrupts observers instead of reporting drained", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const services = yield* LayerNode.compile(SessionDrain.node).pipe(Layer.fresh, Layer.build, Scope.provide(scope))
    const drain = Context.get(services, SessionDrain.Service)
    yield* drain.hold(parent)
    const waiting = yield* drain.wait(parent).pipe(Effect.forkChild({ startImmediately: true }))
    yield* Scope.close(scope, Exit.void)
    expect(Exit.hasInterrupts(yield* Fiber.await(waiting))).toBe(true)
  }),
)
