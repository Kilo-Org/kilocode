import { expect } from "bun:test"
import { Bus } from "@/bus"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { disposeInstance } from "@/effect/instance-registry"
import { Event, Request } from "@/kilocode/ide-lsp/protocol"
import { HostError, IdeLsp } from "@/kilocode/ide-lsp/service"
import { SessionID } from "@/session/schema"
import { Effect, Fiber, Layer, Queue } from "effect"
import { TestInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(IdeLsp.layer("20 millis").pipe(Layer.provideMerge(Bus.layer)))
const sessionID = SessionID.make("ses_ide_lsp_test")

function request(ide: IdeLsp.Interface) {
  return ide.request({
    operation: "goToDefinition",
    sessionID,
    filePath: "/workspace/src/main.kt",
    line: 10,
    character: 5,
  })
}

it.instance(
  "publishes, lists, and completes a correlated request",
  () =>
    Effect.gen(function* () {
      const ide = yield* IdeLsp.Service
      const bus = yield* Bus.Service
      const instance = yield* TestInstance
      const events = yield* Queue.unbounded<{ properties: Request }>()
      const global = yield* Queue.unbounded<GlobalEvent>()
      const off = yield* bus.subscribeCallback(Event.Requested, (event) => Queue.offerUnsafe(events, event))
      const handler = (event: GlobalEvent) => {
        if (event.payload?.type === Event.Requested.type) Queue.offerUnsafe(global, event)
      }
      GlobalBus.on("event", handler)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          off()
          GlobalBus.off("event", handler)
        }),
      )

      const fiber = yield* request(ide).pipe(Effect.forkChild)
      const event = yield* Queue.take(events).pipe(Effect.timeout("2 seconds"))
      expect(event.properties.sessionID).toBe(sessionID)
      expect(event.properties.operation).toBe("goToDefinition")
      expect(event.properties.filePath).toBe("/workspace/src/main.kt")
      expect((yield* Queue.take(global).pipe(Effect.timeout("2 seconds"))).directory).toBe(instance.directory)
      expect(yield* ide.list()).toEqual([event.properties])

      yield* ide.reply({
        requestID: event.properties.id,
        result: {
          operation: "goToDefinition",
          entries: [{ filePath: "/workspace/src/main.kt", startLine: 1, endLine: 3, name: "Main", kind: "class" }],
        },
      })
      expect(yield* Fiber.join(fiber)).toEqual({
        operation: "goToDefinition",
        entries: [{ filePath: "/workspace/src/main.kt", startLine: 1, endLine: 3, name: "Main", kind: "class" }],
      })
      expect(yield* ide.list()).toEqual([])

      const late = yield* ide
        .reply({
          requestID: event.properties.id,
          result: { operation: "goToDefinition", entries: [] },
        })
        .pipe(Effect.flip)
      expect(late._tag).toBe("IdeLsp.NotFoundError")
    }),
  { git: true },
)

it.instance(
  "propagates structured host rejection and removes pending state",
  () =>
    Effect.gen(function* () {
      const ide = yield* IdeLsp.Service
      const fiber = yield* request(ide).pipe(Effect.forkChild)
      const pending = yield* ide.list().pipe(Effect.repeat({ until: (items) => items.length === 1 }))
      yield* ide.reject({
        requestID: pending[0].id,
        error: { code: "indexing", message: "IDE indexes are not ready" },
      })
      const err = yield* Fiber.join(fiber).pipe(Effect.flip)
      expect(err).toBeInstanceOf(HostError)
      expect(err.code).toBe("indexing")
      expect(err.message).toContain("indexes")
      expect(yield* ide.list()).toEqual([])
    }),
  { git: true },
)

it.instance(
  "cancels interrupted requests and rejects mismatched replies",
  () =>
    Effect.gen(function* () {
      const ide = yield* IdeLsp.Service
      const bus = yield* Bus.Service
      const cancelled = yield* Queue.unbounded<string>()
      const off = yield* bus.subscribeCallback(Event.Cancelled, (event) =>
        Queue.offerUnsafe(cancelled, event.properties.reason),
      )
      yield* Effect.addFinalizer(() => Effect.sync(off))

      const fiber = yield* request(ide).pipe(Effect.forkChild)
      const pending = yield* ide.list().pipe(Effect.repeat({ until: (items) => items.length === 1 }))
      const mismatch = yield* ide
        .reply({
          requestID: pending[0].id,
          result: { operation: "findReferences", entries: [] },
        })
        .pipe(Effect.flip)
      expect(mismatch._tag).toBe("IdeLsp.InvalidReplyError")
      yield* Fiber.interrupt(fiber)
      expect(yield* Queue.take(cancelled).pipe(Effect.timeout("2 seconds"))).toBe("cancelled")
      expect(yield* ide.list()).toEqual([])
    }),
  { git: true },
)

it.instance(
  "times out pending requests",
  () =>
    Effect.gen(function* () {
      const ide = yield* IdeLsp.Service
      const err = yield* request(ide).pipe(Effect.flip)
      expect(err.code).toBe("timeout")
      expect(yield* ide.list()).toEqual([])
    }),
  { git: true },
)

it.instance(
  "fails pending requests when the instance is disposed",
  () =>
    Effect.gen(function* () {
      const ide = yield* IdeLsp.Service
      const instance = yield* TestInstance
      const fiber = yield* request(ide).pipe(Effect.forkChild)
      yield* ide.list().pipe(Effect.repeat({ until: (items) => items.length === 1 }))
      yield* Effect.promise(() => disposeInstance(instance.directory))
      const err = yield* Fiber.join(fiber).pipe(Effect.flip)
      expect(err.code).toBe("disconnected")
    }),
  { git: true },
)
