import { expect } from "bun:test"
import { Effect, Fiber } from "effect"
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
    let done = false
    const waiter = yield* drain.wait(id).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          done = true
        }),
      ),
      Effect.forkChild({ startImmediately: true }),
    )
    expect(done).toBe(false)
    parent()
    expect(done).toBe(false)
    const callback = yield* drain.hold(id)
    delivery()
    expect(done).toBe(false)
    callback()
    yield* Fiber.join(waiter)
    expect(done).toBe(true)
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
    let done = false
    const waiter = yield* drain.wait(parent).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          done = true
        }),
      ),
      Effect.forkChild({ startImmediately: true }),
    )
    yield* drain.wait(SessionID.make("ses_drain_other"))
    expect(done).toBe(false)
    release()
    yield* Fiber.join(waiter)
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
    let done = false
    const waiter = yield* drain.wait(id).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          done = true
        }),
      ),
      Effect.forkChild({ startImmediately: true }),
    )
    previous()
    previous()
    expect(done).toBe(false)
    next()
    yield* Fiber.join(waiter)
  }),
)

it.instance(
  "interrupting a wait does not cancel tracked work",
  Effect.gen(function* () {
    const drain = yield* SessionDrain.Service
    const id = SessionID.make("ses_drain_parent")
    const release = yield* drain.hold(id)
    const cancelled = yield* drain.wait(id).pipe(Effect.forkChild({ startImmediately: true }))
    yield* Fiber.interrupt(cancelled)
    let done = false
    const waiter = yield* drain.wait(id).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          done = true
        }),
      ),
      Effect.forkChild({ startImmediately: true }),
    )
    expect(done).toBe(false)
    release()
    yield* Fiber.join(waiter)
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
