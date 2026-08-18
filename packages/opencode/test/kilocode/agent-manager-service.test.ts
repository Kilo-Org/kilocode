import { expect } from "bun:test"
import { Bus } from "@/bus"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { disposeInstance } from "@/effect/instance-registry"
import { Event, type Request } from "@/kilocode/agent-manager/protocol"
import { AgentManager, HostError } from "@/kilocode/agent-manager/service"
import { SessionID } from "@/session/schema"
import { Effect, Fiber, Layer, Queue } from "effect"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AgentManager.layer("20 millis").pipe(Layer.provideMerge(Bus.layer)))
const sessionID = SessionID.make("ses_agent_manager_test")

function request(manager: AgentManager.Interface) {
  return manager.request({ operation: "overview", sessionID })
}

it.instance(
  "publishes, lists, and completes a correlated request",
  () =>
    Effect.gen(function* () {
      const manager = yield* AgentManager.Service
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

      const fiber = yield* request(manager).pipe(Effect.forkChild)
      const event = yield* Queue.take(events).pipe(Effect.timeout("2 seconds"))
      expect(event.properties.operation).toBe("overview")
      expect((yield* Queue.take(global).pipe(Effect.timeout("2 seconds"))).directory).toBe(instance.directory)
      expect(yield* manager.list()).toEqual([event.properties])

      const result = { operation: "overview" as const, overview: { sections: [], ungrouped: [] } }
      yield* manager.reply({ requestID: event.properties.id, result })
      expect(yield* Fiber.join(fiber)).toEqual(result)
      expect(yield* manager.list()).toEqual([])
    }),
  { git: true },
)

it.instance(
  "propagates host rejection and rejects mismatched prompt acknowledgements",
  () =>
    Effect.gen(function* () {
      const manager = yield* AgentManager.Service
      const prompt = yield* manager
        .request({
          operation: "prompt",
          sessionID,
          targetSessionID: SessionID.make("ses_target"),
          prompt: "Continue",
        })
        .pipe(Effect.forkChild)
      const pending = yield* manager.list().pipe(Effect.repeat({ until: (items) => items.length === 1 }))
      const mismatch = yield* manager
        .reply({
          requestID: pending[0].id,
          result: { operation: "prompt", sessionID: SessionID.make("ses_other"), delivered: true },
        })
        .pipe(Effect.flip)
      expect(mismatch._tag).toBe("AgentManager.InvalidReplyError")
      yield* manager.reject({
        requestID: pending[0].id,
        error: { code: "stale_session", message: "The target session is stale" },
      })
      const error = yield* Fiber.join(prompt).pipe(Effect.flip)
      expect(error).toBeInstanceOf(HostError)
      expect(error.code).toBe("stale_session")
    }),
  { git: true },
)

it.instance(
  "cancels interrupted requests and times out a missing extension host",
  () =>
    Effect.gen(function* () {
      const manager = yield* AgentManager.Service
      const bus = yield* Bus.Service
      const cancelled = yield* Queue.unbounded<string>()
      const off = yield* bus.subscribeCallback(Event.Cancelled, (event) =>
        Queue.offerUnsafe(cancelled, event.properties.reason),
      )
      yield* Effect.addFinalizer(() => Effect.sync(off))

      const fiber = yield* request(manager).pipe(Effect.forkChild)
      yield* manager.list().pipe(Effect.repeat({ until: (items) => items.length === 1 }))
      yield* Fiber.interrupt(fiber)
      expect(yield* Queue.take(cancelled).pipe(Effect.timeout("2 seconds"))).toBe("cancelled")

      const error = yield* request(manager).pipe(Effect.flip)
      expect(error.code).toBe("timeout")
      expect(error.message).toContain("extension did not reply")
    }),
  { git: true },
)

it.instance(
  "fails pending requests when the routed instance is disposed",
  () =>
    Effect.gen(function* () {
      const manager = yield* AgentManager.Service
      const instance = yield* TestInstance
      const fiber = yield* request(manager).pipe(Effect.forkChild)
      yield* manager.list().pipe(Effect.repeat({ until: (items) => items.length === 1 }))
      yield* Effect.promise(() => disposeInstance(instance.directory))
      const error = yield* Fiber.join(fiber).pipe(Effect.flip)
      expect(error.code).toBe("disconnected")
    }),
  { git: true },
)
