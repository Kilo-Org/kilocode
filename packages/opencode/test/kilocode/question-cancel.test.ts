import { afterEach, expect } from "bun:test"
import { Effect, Fiber, Layer, Queue } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Question } from "../../src/question"
import { Bus } from "../../src/bus"
import { QuestionID } from "../../src/question/schema"
import { SessionID } from "../../src/session/schema"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(Question.layer.pipe(Layer.provideMerge(Bus.layer)), CrossSpawnSpawner.defaultLayer),
)

afterEach(async () => {
  await disposeAllInstances()
})

it.instance(
  "publishes rejection when a pending question is interrupted",
  () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const bus = yield* Bus.Service
      const asked = yield* Queue.unbounded<{ properties: Question.Request }>()
      const rejected = yield* Queue.unbounded<{
        properties: { sessionID: SessionID; requestID: QuestionID }
      }>()
      const offAsked = yield* bus.subscribeCallback(Question.Event.Asked, (event) => Queue.offerUnsafe(asked, event))
      const offRejected = yield* bus.subscribeCallback(Question.Event.Rejected, (event) =>
        Queue.offerUnsafe(rejected, event),
      )
      yield* Effect.addFinalizer(() => Effect.sync(() => [offAsked(), offRejected()]))

      const fiber = yield* question
        .ask({
          sessionID: SessionID.make("ses_test"),
          questions: [
            {
              header: "Snapshot",
              question: "Keep waiting?",
              options: [{ label: "Continue", description: "Keep waiting" }],
            },
          ],
        })
        .pipe(Effect.forkChild)
      const request = yield* Queue.take(asked).pipe(Effect.timeout("2 seconds"))

      yield* Fiber.interrupt(fiber)

      const event = yield* Queue.take(rejected).pipe(Effect.timeout("2 seconds"))
      expect(event.properties).toEqual({
        sessionID: request.properties.sessionID,
        requestID: request.properties.id,
      })
      expect(yield* question.list()).toEqual([])
    }),
  { git: true },
)
