import { expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Scheduler } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { InstanceRef } from "@/effect/instance-ref"
import { disposeInstance, registerDisposer } from "@/effect/instance-registry"
import { SessionDrain } from "@/kilocode/session/drain"
import { SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(SessionDrain.layer)

it.instance(
  "drains only after execution and delivery reservations end",
  Effect.gen(function* () {
    const drain = yield* SessionDrain.Service
    const id = SessionID.make("ses_drain_parent")
    const parent = yield* drain.hold(id)
    const delivery = yield* drain.hold(id)
    const waiting = yield* drain.wait(id).pipe(Effect.forkChild({ startImmediately: true }))
    expect(waiting.pollUnsafe()).toBeUndefined()
    parent()
    expect(waiting.pollUnsafe()).toBeUndefined()
    const callback = yield* drain.hold(id)
    delivery()
    expect(waiting.pollUnsafe()).toBeUndefined()
    callback()
    yield* Fiber.join(waiting)
    expect(waiting.pollUnsafe()?._tag).toBe("Success")
  }),
)

it.instance(
  "includes live descendants without blocking other sessions",
  Effect.gen(function* () {
    const drain = yield* SessionDrain.Service
    const parent = SessionID.make("ses_drain_parent")
    const child = SessionID.make("ses_drain_child")
    const grandchild = SessionID.make("ses_drain_grandchild")
    yield* drain.link(child, parent)
    yield* drain.link(grandchild, child)
    const release = yield* drain.hold(grandchild)
    const waiting = yield* drain.wait(parent).pipe(Effect.forkChild({ startImmediately: true }))
    yield* drain.wait(SessionID.make("ses_drain_other"))
    expect(waiting.pollUnsafe()).toBeUndefined()
    release()
    yield* Fiber.join(waiting)
    yield* drain.wait(child)
    yield* drain.wait(grandchild)
  }),
)

it.instance(
  "a stale release cannot finish a newer reservation",
  Effect.gen(function* () {
    const drain = yield* SessionDrain.Service
    const id = SessionID.make("ses_drain_parent")
    const previous = yield* drain.hold(id)
    const next = yield* drain.hold(id)
    const waiting = yield* drain.wait(id).pipe(Effect.forkChild({ startImmediately: true }))
    previous()
    previous()
    expect(waiting.pollUnsafe()).toBeUndefined()
    next()
    yield* Fiber.join(waiting)
  }),
)

it.instance(
  "interrupting a wait does not cancel other waiters or later generations",
  Effect.gen(function* () {
    const drain = yield* SessionDrain.Service
    const id = SessionID.make("ses_drain_child")
    yield* drain.link(id, SessionID.make("ses_drain_parent"))
    for (let round = 0; round < 2; round++) {
      const release = yield* drain.hold(id)
      const cancelled = yield* drain.wait(id).pipe(Effect.forkChild({ startImmediately: true }))
      const waiting = yield* drain.wait(id).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Fiber.interrupt(cancelled)
      expect(waiting.pollUnsafe()).toBeUndefined()
      release()
      yield* Fiber.join(waiting)
      expect(waiting.pollUnsafe()?._tag).toBe("Success")
    }
  }),
)

it.instance(
  "disposal closes waiters before cancellation releases their last hold",
  Effect.gen(function* () {
    const drain = yield* SessionDrain.Service
    const ctx = yield* InstanceState.context
    const id = SessionID.make("ses_dispose_drain")
    const release = yield* drain.hold(id)
    const cancelled = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<void>()
    const off = registerDisposer(async (directory) => {
      if (directory !== ctx.directory) return
      release()
      Deferred.doneUnsafe(cancelled, Effect.void)
      await Effect.runPromise(Deferred.await(finish))
    })
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        off()
        Deferred.doneUnsafe(finish, Effect.void)
      }),
    )
    const waiting = yield* drain.wait(id).pipe(Effect.exit, Effect.forkChild({ startImmediately: true }))
    const other = yield* drain.wait(id).pipe(Effect.exit, Effect.forkChild({ startImmediately: true }))
    const disposing = yield* Effect.promise(() => disposeInstance(ctx.directory)).pipe(Effect.forkChild)
    yield* Deferred.await(cancelled)
    expect(Exit.hasInterrupts(yield* Fiber.join(waiting))).toBe(true)
    expect(Exit.hasInterrupts(yield* Fiber.join(other).pipe(Effect.timeout("2 seconds")))).toBe(true)
    expect(Exit.hasInterrupts(yield* drain.wait(id).pipe(Effect.exit))).toBe(true)
    yield* Deferred.succeed(finish, undefined)
    yield* Fiber.join(disposing)
    expect(Exit.hasInterrupts(yield* drain.wait(id).pipe(Effect.exit))).toBe(true)
    yield* drain.wait(id).pipe(Effect.provideService(InstanceRef, { ...ctx }))
  }),
)

it.instance(
  "disposing one directory leaves another directory's waiter intact",
  Effect.gen(function* () {
    const drain = yield* SessionDrain.Service
    const ctx = yield* InstanceState.context
    const other = { ...ctx, directory: `${ctx.directory}/other` }
    const id = SessionID.make("ses_isolated_drain")
    const release = yield* drain.hold(id).pipe(Effect.provideService(InstanceRef, other))
    const waiting = yield* drain
      .wait(id)
      .pipe(Effect.provideService(InstanceRef, other), Effect.forkChild({ startImmediately: true }))
    yield* Effect.promise(() => disposeInstance(ctx.directory))
    yield* Effect.yieldNow
    expect(waiting.pollUnsafe()).toBeUndefined()
    release()
    yield* Fiber.join(waiting)
  }),
)

it.instance(
  "reacquiring a released entry cannot strand an awakened waiter on stale state",
  Effect.gen(function* () {
    const drain = yield* SessionDrain.Service
    const id = SessionID.make("ses_reacquire_drain")
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
    const first = yield* drain.hold(id)
    const waiting = yield* drain
      .wait(id)
      .pipe(Effect.forkChild({ startImmediately: true }), Effect.provideService(Scheduler.Scheduler, scheduler))
    flush()
    paused = true
    first()
    const second = yield* drain.hold(id)
    paused = false
    flush()
    expect(waiting.pollUnsafe()).toBeUndefined()
    second()
    flush()
    yield* Fiber.join(waiting)
  }),
)

it.instance(
  "a resumed waiter can acquire work without waking newly registered waiters repeatedly",
  Effect.gen(function* () {
    const drain = yield* SessionDrain.Service
    const id = SessionID.make("ses_reentrant_drain")
    const release = yield* drain.hold(id)
    const first = yield* drain.wait(id).pipe(
      Effect.flatMap(() => drain.hold(id)),
      Effect.forkChild({ startImmediately: true }),
    )
    const waiting = yield* drain.wait(id).pipe(Effect.forkChild({ startImmediately: true }))
    release()
    const releaseAgain = yield* Fiber.join(first)
    expect(waiting.pollUnsafe()).toBeUndefined()
    releaseAgain()
    yield* Fiber.join(waiting)
    expect(waiting.pollUnsafe()?._tag).toBe("Success")
  }),
)

it.instance(
  "resuming an idle child still contributes to its parent",
  Effect.gen(function* () {
    const drain = yield* SessionDrain.Service
    const parent = SessionID.make("ses_resume_parent")
    const child = SessionID.make("ses_resume_child")
    yield* drain.link(child, parent)
    yield* drain.track(child, Effect.void)
    yield* drain.wait(parent)
    const release = yield* drain.hold(child)
    const waiting = yield* drain.wait(parent).pipe(Effect.forkChild({ startImmediately: true }))
    expect(waiting.pollUnsafe()).toBeUndefined()
    release()
    yield* Fiber.join(waiting)
  }),
)

it.instance(
  "tracks failures without retaining work or poisoning later waits",
  Effect.gen(function* () {
    const drain = yield* SessionDrain.Service
    const id = SessionID.make("ses_drain_parent")
    const result = yield* drain.track(id, Effect.fail("handled child failure")).pipe(Effect.exit)
    expect(result._tag).toBe("Failure")
    yield* drain.wait(id)
    yield* drain.track(id, Effect.void)
    yield* drain.wait(id)
  }),
)
