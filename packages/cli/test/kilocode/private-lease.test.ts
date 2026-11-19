import { expect } from "bun:test"
import { Effect, Queue, Stream } from "effect"
import { it } from "../../../core/test/lib/effect"
import { privateLease } from "../../src/kilocode/private-lease"

const url = "http://localhost:0"
const line = (record: { bound: string } | { url: string }) => new TextEncoder().encode(`${JSON.stringify(record)}\n`)

it.effect(
  "publishes the bound endpoint while requests still wait for route readiness",
  Effect.gen(function* () {
    const stdout = yield* Queue.unbounded<Uint8Array>()
    yield* Queue.offer(stdout, new TextEncoder().encode("plugin activated\n"))
    yield* Queue.offer(stdout, line({ bound: url }))
    const lease = yield* privateLease(Stream.fromQueue(stdout), true)
    expect(lease.url).toBe(url)
    const whenReady = lease.whenReady
    if (!whenReady) throw new Error("Missing readiness wait for an early lease")

    const abort = new AbortController()
    const request = whenReady(abort.signal)
    abort.abort()
    yield* Effect.promise(async () => {
      await expect(request).rejects.toThrow()
    })

    yield* Queue.offer(stdout, new TextEncoder().encode('{"url":null}\n{"message":"listening"}\n'))
    yield* Queue.offer(stdout, line({ url }))
    yield* Effect.promise(() => whenReady())
  }),
)

it.effect(
  "accepts a ready-only peer even if stdout closes immediately",
  Effect.gen(function* () {
    const lease = yield* privateLease(Stream.make(line({ url })), true)
    expect(lease.url).toBe(url)
    const whenReady = lease.whenReady
    if (!whenReady) throw new Error("Missing readiness wait for an early lease")
    yield* Effect.promise(() => whenReady())
  }),
)

it.effect(
  "reports startup failure when stdout closes before the endpoint is announced",
  Effect.gen(function* () {
    const failure = yield* Effect.flip(privateLease(Stream.make(new TextEncoder().encode("not ready\n")), true))
    expect(failure.message).toBe("Standalone server exited before reporting readiness")
  }),
)

it.live(
  "rejects a request when the child closes stdout after binding but before readiness",
  Effect.gen(function* () {
    const lease = yield* privateLease(Stream.make(line({ bound: url })), true)
    expect(lease.url).toBe(url)
    const whenReady = lease.whenReady
    if (!whenReady) throw new Error("Missing readiness wait for an early lease")
    const failure = yield* Effect.flip(
      Effect.tryPromise({ try: (signal) => whenReady(signal), catch: (error) => error }),
    )
    expect(failure).toEqual(new Error("Standalone server exited before reporting readiness"))
  }),
)
