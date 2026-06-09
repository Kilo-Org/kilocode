import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { KiloSessionPromptQueue } from "../../src/kilocode/session/prompt-queue"
import { Question } from "../../src/question"
import { MessageID, SessionID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Question.defaultLayer, CrossSpawnSpawner.defaultLayer))

const prompt = [
  {
    header: "Continue?",
    question: "Should I continue?",
    options: [
      { label: "Yes", description: "Go" },
      { label: "No", description: "Stop" },
    ],
  },
]

const waitFor = (question: Question.Interface, count: number) =>
  Effect.gen(function* () {
    for (let i = 0; i < 50; i++) {
      const pending = yield* question.list()
      if (pending.length >= count) return pending
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.fail(new Error(`timed out waiting for ${count} pending question request(s)`))
  })

describe("Question.dismissAll", () => {
  it.instance(
    "rejects pending asks for the target session and clears them",
    () =>
      Effect.gen(function* () {
        const question = yield* Question.Service
        const sesA = SessionID.make("ses_a")
        const sesB = SessionID.make("ses_b")
        const a1 = yield* question.ask({ sessionID: sesA, questions: prompt }).pipe(Effect.forkScoped)
        const a2 = yield* question.ask({ sessionID: sesA, questions: prompt }).pipe(Effect.forkScoped)
        const b1 = yield* question.ask({ sessionID: sesB, questions: prompt }).pipe(Effect.forkScoped)

        expect(yield* waitFor(question, 3)).toHaveLength(3)
        yield* question.dismissAll(sesA)

        for (const fiber of [a1, a2]) {
          const exit = yield* Fiber.await(fiber)
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Question.RejectedError)
        }

        yield* Effect.sleep("10 millis")

        const remaining = yield* question.list()
        expect(remaining).toHaveLength(1)
        expect(remaining[0]?.sessionID).toBe(sesB)

        yield* question.reject(remaining[0]!.id)
        const exit = yield* Fiber.await(b1)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Question.RejectedError)
      }),
    { git: true },
  )

  it.instance(
    "is a no-op when no questions exist",
    () =>
      Effect.gen(function* () {
        const question = yield* Question.Service
        yield* question.dismissAll(SessionID.make("ses_missing"))
        expect(yield* question.list()).toEqual([])
      }),
    { git: true },
  )

  it.instance(
    "ask rejects immediately when a followup is queued on the session",
    () =>
      Effect.gen(function* () {
        const question = yield* Question.Service
        const sessionID = SessionID.make("ses_auto_ask")
        const started = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()

        const first = yield* KiloSessionPromptQueue.enqueue(
          sessionID,
          MessageID.make("msg_ask_1"),
          Effect.gen(function* () {
            started.resolve()
            yield* Effect.promise(() => release.promise)
            return "first" as const
          }),
          Effect.succeed("first-cancelled" as const),
        ).pipe(Effect.forkScoped)
        yield* Effect.promise(() => started.promise)

        const second = yield* KiloSessionPromptQueue.enqueue(
          sessionID,
          MessageID.make("msg_ask_2"),
          Effect.succeed("second" as const),
          Effect.succeed("second-cancelled" as const),
        ).pipe(Effect.forkScoped)
        yield* Effect.sleep("10 millis")
        expect(KiloSessionPromptQueue.hasFollowup(sessionID)).toBe(true)

        const exit = yield* question.ask({ sessionID, questions: prompt }).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Question.RejectedError)
        expect(yield* question.list()).toEqual([])

        release.resolve()
        expect(yield* Fiber.join(first)).toBe("first")
        expect(yield* Fiber.join(second)).toBe("second")
      }),
    { git: true },
  )
})
