import { expect } from "bun:test"
import { Bus } from "@/bus"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { Notebook, HostError } from "@/kilocode/notebook/service"
import { EditRequest, Event, ReadRequest, ReadResult, type Request } from "@/kilocode/notebook/protocol"
import { SessionID } from "@/session/schema"
import { Effect, Fiber, Layer, Queue, Schema } from "effect"
import { TestInstance } from "../fixture/fixture"
import { disposeInstance } from "@/effect/instance-registry"
import { testEffect } from "../lib/effect"

const it = testEffect(Notebook.layer("20 millis").pipe(Layer.provideMerge(Bus.layer)))
const sessionID = SessionID.make("ses_notebook_test")

function request(notebook: Notebook.Interface) {
  return notebook.request({ operation: "read", sessionID, path: "analysis.ipynb", includeOutputs: false })
}

it.instance(
  "publishes, lists, and completes a correlated request",
  () =>
    Effect.gen(function* () {
      const notebook = yield* Notebook.Service
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

      const fiber = yield* request(notebook).pipe(Effect.forkChild)
      const event = yield* Queue.take(events).pipe(Effect.timeout("2 seconds"))
      expect(event.properties.sessionID).toBe(sessionID)
      expect(event.properties.path).toBe("analysis.ipynb")
      expect((yield* Queue.take(global).pipe(Effect.timeout("2 seconds"))).directory).toBe(instance.directory)
      expect(yield* notebook.list()).toEqual([event.properties])

      yield* notebook.reply({
        requestID: event.properties.id,
        result: { operation: "read", path: "analysis.ipynb", requestPath: "analysis.ipynb", revision: "content:3", cells: [] },
      })
      expect(yield* Fiber.join(fiber)).toEqual({
        operation: "read",
        path: "analysis.ipynb",
        requestPath: "analysis.ipynb",
        revision: "content:3",
        cells: [],
      })
      expect(yield* notebook.list()).toEqual([])

      const late = yield* notebook
        .reply({
          requestID: event.properties.id,
          result: { operation: "read", path: "analysis.ipynb", requestPath: "analysis.ipynb", revision: "content:3", cells: [] },
        })
        .pipe(Effect.flip)
      expect(late._tag).toBe("Notebook.NotFoundError")
    }),
  { git: true },
)

it.instance(
  "propagates structured host rejection and removes pending state",
  () =>
    Effect.gen(function* () {
      const notebook = yield* Notebook.Service
      const fiber = yield* request(notebook).pipe(Effect.forkChild)
      const pending = yield* notebook.list().pipe(Effect.repeat({ until: (items) => items.length === 1 }))
      yield* notebook.reject({
        requestID: pending[0].id,
        error: {
          code: "stale_revision",
          message: "Notebook content changed; re-read before retrying",
          path: "analysis.ipynb",
          index: 0,
          currentRevision: "content:current",
        },
      })
      const err = yield* Fiber.join(fiber).pipe(Effect.flip)
      expect(err).toBeInstanceOf(HostError)
      expect(err.code).toBe("stale_revision")
      expect(err.message).toContain("re-read")
      expect(yield* notebook.list()).toEqual([])
    }),
  { git: true },
)

it.instance(
  "cancels interrupted requests and rejects operation-mismatched replies",
  () =>
    Effect.gen(function* () {
      const notebook = yield* Notebook.Service
      const bus = yield* Bus.Service
      const cancelled = yield* Queue.unbounded<string>()
      const off = yield* bus.subscribeCallback(Event.Cancelled, (event) =>
        Queue.offerUnsafe(cancelled, event.properties.reason),
      )
      yield* Effect.addFinalizer(() => Effect.sync(off))

      const fiber = yield* request(notebook).pipe(Effect.forkChild)
      const pending = yield* notebook.list().pipe(Effect.repeat({ until: (items) => items.length === 1 }))
      const mismatch = yield* notebook
        .reply({
          requestID: pending[0].id,
          result: { operation: "edit", path: "analysis.ipynb", requestPath: "analysis.ipynb", revision: "content:2", index: 0, action: "delete" },
        })
        .pipe(Effect.flip)
      expect(mismatch._tag).toBe("Notebook.InvalidReplyError")
      const wrongPath = yield* notebook
        .reply({
          requestID: pending[0].id,
          result: {
            operation: "read",
            path: "other.ipynb",
            requestPath: "other.ipynb",
            revision: "content:2",
            cells: [],
          },
        })
        .pipe(Effect.flip)
      expect(wrongPath._tag).toBe("Notebook.InvalidReplyError")
      yield* Fiber.interrupt(fiber)
      expect(yield* Queue.take(cancelled).pipe(Effect.timeout("2 seconds"))).toBe("cancelled")
      expect(yield* notebook.list()).toEqual([])
    }),
  { git: true },
)

it.instance(
  "times out pending requests",
  () =>
    Effect.gen(function* () {
      const notebook = yield* Notebook.Service
      const err = yield* request(notebook).pipe(Effect.flip)
      expect(err.code).toBe("timeout")
      expect(yield* notebook.list()).toEqual([])
    }),
  { git: true },
)

it.instance(
  "accepts both path forms, requires opaque revisions, and bounds aggregate results",
  () =>
    Effect.gen(function* () {
      const absolute = yield* Schema.decodeUnknownEffect(ReadRequest)({
        id: "nbr_test",
        sessionID,
        operation: "read",
        path: "/workspace/analysis.ipynb",
        includeOutputs: false,
      })
      expect(absolute.path).toBe("/workspace/analysis.ipynb")
      const relative = yield* Schema.decodeUnknownEffect(ReadRequest)({
        ...absolute,
        path: "nested/analysis.ipynb",
      })
      expect(relative.path).toBe("nested/analysis.ipynb")
      const invalid = yield* Schema.decodeUnknownEffect(EditRequest)({
        id: "nbr_edit",
        sessionID,
        operation: "edit",
        path: "analysis.ipynb",
        expectedRevision: 4,
        index: 0,
        edit: { action: "delete" },
      }).pipe(Effect.flip)
      expect(String(invalid)).toContain("string")

      const cells = Array.from({ length: 11 }, (_, index) => ({
        index,
        kind: "code" as const,
        language: "python",
        source: "x".repeat(200_000),
      }))
      const output = yield* Schema.decodeUnknownEffect(ReadResult)({
        operation: "read",
        path: "analysis.ipynb",
        requestPath: "analysis.ipynb",
        revision: "content:1",
        cells,
      }).pipe(Effect.flip)
      expect(String(output)).toContain("aggregate output limit")
    }),
  { git: true },
)

it.instance(
  "fails pending requests when the instance is disposed",
  () =>
    Effect.gen(function* () {
      const notebook = yield* Notebook.Service
      const instance = yield* TestInstance
      const fiber = yield* request(notebook).pipe(Effect.forkChild)
      yield* notebook.list().pipe(Effect.repeat({ until: (items) => items.length === 1 }))
      yield* Effect.promise(() => disposeInstance(instance.directory))
      const err = yield* Fiber.join(fiber).pipe(Effect.flip)
      expect(err.code).toBe("disconnected")
    }),
  { git: true },
)
