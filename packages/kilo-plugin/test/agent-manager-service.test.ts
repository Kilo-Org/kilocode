import { describe, expect, test } from "bun:test"
import { KiloAgentManagerRpc } from "@opencode/schema/kilocode/agent-manager"
import { SessionID } from "@opencode/schema/session-id"
import { Duration, Effect, Fiber, Ref } from "effect"
import { createService, HostError, type Request } from "../src/agent-manager/service"

const sessionID = SessionID.make("ses_agent_manager_test")

function make(timeout: Duration.Input = "1 minute") {
  return Effect.gen(function* () {
    const requested = yield* Ref.make<ReadonlyArray<Request>>([])
    const cancelled = yield* Ref.make<ReadonlyArray<{ requestID: string; reason: string }>>([])
    const service = yield* createService(
      {
        requested: (request) => Ref.update(requested, (items) => [...items, request]),
        cancelled: (event) => Ref.update(cancelled, (items) => [...items, event]),
      },
      timeout,
    )
    return {
      service,
      requested: () => Ref.get(requested),
      cancelled: () => Ref.get(cancelled),
    }
  })
}

function overview() {
  return { operation: "overview" as const, sessionID }
}

const result = { operation: "overview" as const, overview: { sections: [], ungrouped: [] } }

describe("Agent Manager request service", () => {
  test("publishes, lists, and completes a correlated request", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const subject = yield* make()
        const fiber = yield* subject.service.request(overview()).pipe(Effect.forkChild)
        const pending = yield* subject.service.list().pipe(Effect.repeat({ until: (items) => items.length === 1 }))

        expect(pending).toHaveLength(1)
        expect(pending[0]!.operation).toBe("overview")
        expect((yield* subject.requested())[0]).toEqual(pending[0])

        yield* subject.service.reply({ requestID: pending[0]!.id, result })

        expect(yield* Fiber.join(fiber)).toEqual(result)
        expect(yield* subject.service.list()).toEqual([])
      }),
    ))

  test("keeps pending requests isolated per service instance", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const one = yield* make()
        const two = yield* make()
        const first = yield* one.service.request(overview()).pipe(Effect.forkChild)
        const second = yield* two.service.request(overview()).pipe(Effect.forkChild)
        const pendingOne = yield* one.service
          .list()
          .pipe(Effect.repeat({ until: (items) => items.length === 1 }))
        const pendingTwo = yield* two.service
          .list()
          .pipe(Effect.repeat({ until: (items) => items.length === 1 }))

        expect(pendingOne[0]!.id).not.toBe(pendingTwo[0]!.id)
        const missing = yield* two.service
          .reply({ requestID: pendingOne[0]!.id, result })
          .pipe(Effect.flip)
        expect(missing._tag).toBe("AgentManager.NotFoundError")

        yield* one.service.reply({ requestID: pendingOne[0]!.id, result })
        yield* two.service.reject({
          requestID: pendingTwo[0]!.id,
          error: { code: "stale_session", message: "The target session is stale" },
        })

        expect(yield* Fiber.join(first)).toEqual(result)
        expect((yield* Fiber.join(second).pipe(Effect.flip)).code).toBe("stale_session")
      }),
    ))

  test("propagates a rejection and refuses a mismatched prompt acknowledgement", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const subject = yield* make()
        const prompt = yield* subject.service
          .request({
            operation: "prompt",
            sessionID,
            targetSessionID: SessionID.make("ses_target"),
            prompt: "Continue",
          })
          .pipe(Effect.forkChild)
        const pending = yield* subject.service
          .list()
          .pipe(Effect.repeat({ until: (items) => items.length === 1 }))
        const mismatch = yield* subject.service
          .reply({
            requestID: pending[0]!.id,
            result: { operation: "prompt", sessionID: SessionID.make("ses_other"), delivered: true },
          })
          .pipe(Effect.flip)

        expect(mismatch._tag).toBe("AgentManager.InvalidReplyError")
        yield* subject.service.reject({
          requestID: pending[0]!.id,
          error: { code: "stale_session", message: "The target session is stale" },
        })
        const error = yield* Fiber.join(prompt).pipe(Effect.flip)
        expect(error).toBeInstanceOf(HostError)
        expect(error.code).toBe("stale_session")
      }),
    ))

  test("cancels an interrupted request and times out a missing extension", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const subject = yield* make("20 millis")
        const fiber = yield* subject.service.request(overview()).pipe(Effect.forkChild)
        yield* subject.service.list().pipe(Effect.repeat({ until: (items) => items.length === 1 }))
        yield* Fiber.interrupt(fiber)
        expect((yield* subject.cancelled()).map((event) => event.reason)).toContain("cancelled")

        const error = yield* subject.service.request(overview()).pipe(Effect.flip)
        expect(error.code).toBe("timeout")
        expect(error.message).toContain("extension did not reply")
        expect((yield* subject.cancelled()).at(-1)).toMatchObject({ reason: "timeout" })
      }),
    ))

  test("fails pending requests when the host is disposed", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const subject = yield* make()
        const fiber = yield* subject.service.request(overview()).pipe(Effect.forkChild)
        yield* subject.service.list().pipe(Effect.repeat({ until: (items) => items.length === 1 }))
        yield* subject.service.dispose
        const error = yield* Fiber.join(fiber).pipe(Effect.flip)
        expect(error.code).toBe("disconnected")
        expect(yield* subject.service.list()).toEqual([])
        expect((yield* subject.cancelled()).map((event) => event.reason)).toContain("disposed")
      }),
    ))

  test("replies to an unknown request with not found", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const subject = yield* make()
        const error = yield* subject.service
          .reply({ requestID: KiloAgentManagerRpc.RequestID.make("amr_unknown"), result })
          .pipe(Effect.flip)
        expect(error._tag).toBe("AgentManager.NotFoundError")
      }),
    ))
})
